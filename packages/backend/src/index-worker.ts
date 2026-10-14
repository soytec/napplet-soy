import { indexPreviewVideos } from './preview-videos';
import { manifestBlocked } from '../../moderation/src/policy';
import { Database } from 'bun:sqlite';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { matchFilter, type Filter } from 'nostr-tools';
import { PublicationRelays } from '../../publish/src/relay';
import { MAX_READ_ARTIFACT_BYTES, sha256 } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { PREVIEW_PROFILE } from '../../protocol/src/preview';
import { RUNTIME_PROFILE, missingDomains } from '../../runtime/src/capabilities';
import { downloadArtifact } from './blossom';
import { discoverPreviewMetadata } from './preview-discovery';
import { indexPreviewImages } from './preview-images';
import { IndexStore, indexedProjection } from './index-store';
import { DiscoveryQueue, targetBlocked } from './discovery-queue';
import { decodeAddress, type SignedEvent } from '../../protocol/src';
import type { DiscoveryTarget } from '../../protocol/src/discovery';
import { discoverFromHints } from './preview-discovery';

type HydrateOptions = {
  download?: typeof downloadArtifact;
  metadata?: typeof discoverPreviewMetadata;
  now?: number;
  keys?: string[];
};

export type IndexConfig = {
  directory: string;
  relays: string[];
  hints?: string[];
  localBlossom?: string;
  release: string;
};
export function indexConfig(env = process.env): IndexConfig {
  if (!env.SPACE_INDEX_DIR) throw new Error('SPACE_INDEX_DIR is required');
  const relays = [...new Set((env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean))];
  if (!relays.length || relays.length > 8) throw new Error('Configure 1–8 index relays');
  const hints = env.SPACE_INDEX_HINTS
    ? [...new Set(env.SPACE_INDEX_HINTS.split(',').filter(Boolean))]
    : relays;
  if (!hints.length || hints.length > 8) throw new Error('Configure 1–8 relay hints');
  for (const value of [...relays, ...hints]) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.hash ||
      value.length > 256 ||
      !(
        u.protocol === 'wss:' ||
        (u.protocol === 'ws:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname))
      )
    )
      throw new Error(
        'Index relays require wss:// or an explicitly configured loopback ws:// origin',
      );
  }
  const localBlossom = env.SPACE_INDEX_LOCAL_BLOSSOM || undefined;
  if (localBlossom) {
    const u = new URL(localBlossom);
    if (
      u.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      u.origin !== localBlossom ||
      u.username ||
      u.password
    )
      throw new Error('Local Blossom override must be an exact numeric loopback HTTP origin');
  }
  return {
    directory: env.SPACE_INDEX_DIR,
    relays,
    hints,
    localBlossom,
    release: env.SPACE_RELEASE_ID ?? 'local',
  };
}

// This exception belongs to operator configuration, never to arbitrary event
// URLs. Only GET /<verified-hash> on this exact origin may reach local services.
export async function indexDownload(
  servers: string[],
  hash: string,
  signal: AbortSignal,
  localOrigin?: string,
) {
  // The operator's local CAS is a cache for every author, including manifests
  // without hints. The event still cannot choose a local destination or path.
  if (localOrigin) {
    try {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid hash');
      const response = await fetch(`${localOrigin}/${hash}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        redirect: 'error',
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length')) > MAX_READ_ARTIFACT_BYTES
      )
        throw new Error('Blob unavailable');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_READ_ARTIFACT_BYTES) throw new Error('Blob too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      if ((await sha256(bytes)) !== hash) throw new Error('Hash mismatch');
      return bytes;
    } catch {
      /* Continue with safe public signed hints. */
    }
  }
  return downloadArtifact(servers, hash, signal);
}

export class IndexWorker {
  readonly store: IndexStore;
  private lock: Database;
  private hydrating: Promise<unknown> = Promise.resolve();
  constructor(readonly config: IndexConfig) {
    this.store = new IndexStore(config.directory, true);
    this.lock = new Database(join(config.directory, 'writer.sqlite'), { create: true });
    try {
      this.lock.exec('BEGIN EXCLUSIVE');
    } catch {
      this.lock.close();
      this.store.close();
      throw new Error('Another index worker owns this directory');
    }
  }
  close() {
    this.lock.close();
    this.store.close();
  }
  async collect(read: PublicationRelays['read'], now = Date.now()) {
    const errors: string[] = [];
    const collect = async (relay: string, stream: string, filter: Filter, forceFull = false) => {
      const cursor = `cursor:${relay}:${stream}`;
      const full = this.store.state<number>(`full:${cursor}`) ?? 0;
      const since = forceFull || now - full >= 3600000 ? null : this.store.state<number>(cursor);
      let until = Math.floor(now / 1000);
      try {
        // Descending pages overlap the last timestamp so ties are never skipped.
        // A saturated second is reported; its cursor is deliberately not advanced.
        for (let page = 0; ; page++) {
          if (page >= 100) throw new Error('Catch-up page capacity reached');
          const events = await read(relay, {
            ...filter,
            limit: 200,
            until,
            ...(since === null ? {} : { since: Math.max(0, since - 600) }),
          });
          for (const event of events) this.store.admit(event, now);
          if (events.length < 200) break;
          const oldest = Math.min(...events.map((event) => event.created_at));
          if (oldest >= until)
            throw new Error('Relay page saturated within one second; catch-up incomplete');
          until = oldest;
        }
        this.store.setState(cursor, Math.floor(now / 1000));
        if (since === null) this.store.setState(`full:${cursor}`, now);
      } catch (error) {
        errors.push(
          `${relay} ${stream}: ${error instanceof Error ? error.message : 'discovery failed'}`,
        );
      }
    };
    const kinds = [35129, 15129, 5129];
    // Discover all targets first. General-purpose relays carry enormous volumes
    // of unrelated kind-5 events; never run an unfiltered deletion firehose.
    for (const relay of this.config.relays)
      for (const kind of kinds) await collect(relay, String(kind), { kinds: [kind] });
    const rows = this.store.allRows();
    const targets = {
      '#e': rows.map((row) => row.id).sort(),
      '#a': rows
        .filter((row) => JSON.parse(row.event).kind !== 5129)
        .map((row) => row.key)
        .sort(),
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(targets)).digest('hex');
    for (const relay of this.config.relays) {
      await collect(relay, 'napplet-deletions', { kinds: [5], '#k': kinds.map(String) });
      // NIP-09 recommends k tags, but older clients may omit them. Query exact
      // known IDs/addresses too. New target sets must get full history even when
      // their deletion predates this worker's previous catch-up cursor.
      const changed = this.store.state<string>(`deletion-targets:${relay}`) !== fingerprint;
      const before = errors.length;
      for (const tag of ['#e', '#a'] as const) {
        const values = targets[tag];
        // Match the managed relay's maximum values per tag filter.
        for (let offset = 0; offset < values.length; offset += 64) {
          const filter: Filter = { kinds: [5] };
          filter[tag] = values.slice(offset, offset + 64);
          await collect(relay, `deletion-targets:${tag}:${offset}`, filter, changed);
        }
      }
      if (errors.length === before) this.store.setState(`deletion-targets:${relay}`, fingerprint);
    }
    return errors;
  }
  hydrate(signal: AbortSignal, options: HydrateOptions = {}) {
    const task = this.hydrating.catch(() => {}).then(() => this.hydrateUnlocked(signal, options));
    this.hydrating = task;
    return task;
  }
  private async hydrateUnlocked(signal: AbortSignal, options: HydrateOptions = {}) {
    const now = options.now ?? Date.now();
    const profile = `${RUNTIME_PROFILE}:${PREVIEW_PROFILE}:html-${MAX_READ_ARTIFACT_BYTES}`;
    const changed = this.store.state<string>('profile') !== profile;
    if (changed) this.store.invalidate();
    const directory = join(this.config.directory, 'artifacts');
    await mkdir(directory, { recursive: true });
    const queue = await Promise.all(
      (options.keys
        ? options.keys.flatMap((key) => this.store.row(key) ?? this.store.revision(key) ?? [])
        : this.store.due(now)
      )
        .filter((row) => !manifestBlocked(JSON.parse(row.event)))
        .map(async (row) => ({
          row,
          entry: this.store.removed(JSON.parse(row.event))
            ? null
            : await indexedProjection(row, this.config.hints ?? this.config.relays),
        })),
    );
    const retained = new Set([
      ...this.store.references().map((r) => r.hash),
      ...queue.map(({ entry }) => entry?.artifactHash),
    ]);
    let usedBytes = 0;
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.html$/.test(name)) continue;
      if (!retained.has(name.slice(0, -5))) await rm(join(directory, name));
      else usedBytes += (await stat(join(directory, name))).size;
    }
    let capacity = false;
    // Sequential reservations keep the total disk budget exact; each job has a deadline.
    for (const { row, entry } of queue) {
      if (signal.aborted) break;
      if (!entry) {
        this.store.project(row.id, null, now + 3600000, now + 3600000);
        continue;
      }
      const needsArtifact = !!options.keys || changed || row.retry_at <= now;
      if (needsArtifact && !missingDomains(entry.domains).length) {
        try {
          const file = Bun.file(join(directory, `${entry.artifactHash}.html`));
          let data: Uint8Array | undefined;
          if ((await file.exists()) && file.size <= MAX_READ_ARTIFACT_BYTES) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if ((await sha256(bytes)) === entry.artifactHash) data = bytes;
          }
          if (!data) {
            if (usedBytes + MAX_READ_ARTIFACT_BYTES > 1024 ** 3) {
              capacity = true;
              throw new Error('Artifact cache capacity reached');
            }
            const manifest = await validateManifest(entry.manifest);
            data = await (
              options.download ??
              ((servers, hash, s) => indexDownload(servers, hash, s, this.config.localBlossom))
            )(
              manifest.servers,
              entry.artifactHash,
              AbortSignal.any([signal, AbortSignal.timeout(60000)]),
            );
            if (
              data.length > MAX_READ_ARTIFACT_BYTES ||
              (await sha256(data)) !== entry.artifactHash
            )
              throw new Error('Hash mismatch');
            new TextDecoder('utf-8', { fatal: true }).decode(data);
            const temporary = `${file.name}.${crypto.randomUUID()}.tmp`;
            await Bun.write(temporary, data);
            await rename(temporary, file.name!);
            usedBytes += data.length;
          }
          new TextDecoder('utf-8', { fatal: true }).decode(data);
          entry.bytes = data.length;
          entry.availability = 'ready';
        } catch {
          entry.availability = 'unavailable';
          entry.bytes = null;
        }
      }
      // Save playback before optional image work, so a slow descriptor cannot delay opening.
      this.store.project(
        row.id,
        entry,
        now + (entry.availability === 'ready' ? 300000 : 30000),
        row.preview_at,
      );
    }
    const previews = queue.filter(
      ({ entry, row }) => entry && (!!options.keys || changed || row.preview_at <= now),
    );
    if (previews.length && !signal.aborted) {
      try {
        const previewSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const entries = previews.map(({ entry }) => entry!);
        const previous = entries.map((entry) => ({ ...entry }));
        const metadata = await (options.metadata ?? discoverPreviewMetadata)(
          entries.map((e) => e.manifest),
          this.config.relays,
          previewSignal,
        );
        await Promise.all([
          indexPreviewImages(this.config.directory, entries, metadata, previewSignal, { previous }),
          indexPreviewVideos(this.config.directory, entries, metadata, previewSignal, {
            previous,
            localOrigin: this.config.localBlossom,
          }),
        ]);
      } catch {
        /* Keep existing validated previews when discovery is offline. */
      }
      for (const { entry, row } of previews) {
        const current = this.store.revision(row.id);
        if (current) this.store.project(row.id, entry, current.retry_at, now + 900000);
      }
    }
    const previewHashes = new Set(this.store.references().flatMap((r) => [r.preview, r.video]));
    let previewBytes = 0;
    const previewsDirectory = join(this.config.directory, 'previews');
    for (const file of await readdir(previewsDirectory).catch(() => [] as string[])) {
      if (!/^[a-f0-9]{64}\.(png|webm)$/.test(file)) continue;
      const path = join(previewsDirectory, file),
        size = (await stat(path)).size;
      if (!previewHashes.has(file.slice(0, 64)) || previewBytes + size > 256 * 1024 ** 2)
        await rm(path);
      else previewBytes += size;
    }
    this.store.setState('profile', profile);
    return capacity ? ['Artifact cache capacity reached (1 GiB)'] : [];
  }
  async discover(
    target: DiscoveryTarget,
    signal: AbortSignal,
    options: {
      read?: PublicationRelays['read'];
      hints?: typeof discoverFromHints;
      hydrate?: HydrateOptions;
    } = {},
  ) {
    if (targetBlocked(target)) return 'missing' as const;
    const transport = new PublicationRelays(signal);
    const read = options.read ?? ((url, filter) => transport.read(url, filter, 2000));
    const filter: Filter =
      target.type === 'snapshot'
        ? { kinds: [35129, 15129, 5129], ids: [target.id], limit: 4 }
        : (() => {
            const identity = decodeAddress(target.naddr);
            return {
              kinds: [identity.kind],
              authors: [identity.pubkey],
              ...(identity.kind === 35129 ? { '#d': [identity.identifier] } : {}),
              limit: 4,
            };
          })();
    let completed = false;
    const query = async (filters: Filter[]) => {
      const events: SignedEvent[] = [];
      const hints = target.hints.filter((h) => !this.config.relays.includes(h));
      await Promise.all([
        ...this.config.relays.map(async (relay) => {
          for (const f of filters)
            try {
              events.push(...(await read(relay, f)));
              completed = true;
            } catch {
              /* Other relays may answer. */
            }
        }),
        (async () => {
          try {
            const result = await (options.hints ?? discoverFromHints)(hints, filters, signal);
            events.push(...result.events);
            completed ||= result.complete;
          } catch {
            /* Optional hint failed. */
          }
        })(),
      ]);
      return events;
    };
    try {
      const events = await query([filter]);
      for (const event of events) {
        // The injected/read transport is not an admission authority.
        if (event.kind !== 5 && matchFilter(filter, event)) {
          try {
            this.store.admit(event);
          } catch {
            /* Signature, replacement and capacity checks. */
          }
        }
      }
      const row =
        target.type === 'snapshot' ? this.store.revision(target.id) : this.store.row(target.key);
      if (!row) return completed ? ('missing' as const) : ('failed' as const);
      const event = JSON.parse(row.event) as SignedEvent;
      const deletions: Filter[] = [
        { kinds: [5], authors: [event.pubkey], '#e': [event.id], limit: 64 },
      ];
      if (event.kind !== 5129)
        deletions.push({ kinds: [5], authors: [event.pubkey], '#a': [row.key], limit: 64 });
      for (const deletion of await query(deletions))
        try {
          if (deletion.kind === 5) this.store.admit(deletion);
        } catch {
          /* Invalid deletion. */
        }
      if (manifestBlocked(event) || this.store.removed(event)) return 'missing' as const;
      await this.hydrate(signal, { ...options.hydrate, keys: [target.key] });
      return 'found' as const;
    } finally {
      transport.close();
    }
  }
  private async discoveryLoop(signal: AbortSignal) {
    const queue = new DiscoveryQueue(this.config.directory);
    try {
      while (!signal.aborted) {
        const job = queue.take();
        if (job) {
          try {
            queue.finish(
              job.key,
              await this.discover(
                JSON.parse(job.target),
                // Finish before the queue's 60-second abandoned-job lease.
                AbortSignal.any([signal, AbortSignal.timeout(45000)]),
              ),
            );
          } catch {
            queue.finish(job.key, 'failed');
          }
        } else await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      queue.close();
    }
  }
  async run(signal: AbortSignal) {
    const stop = new AbortController();
    signal = AbortSignal.any([signal, stop.signal]);
    // Readiness is worker liveness, not completion of a potentially slow remote
    // catch-up. Keep catalog health/errors separate and never invent a fresh scan.
    const heartbeat = () =>
      this.store.setState('worker', {
        checkedAt: Date.now(),
        release: this.config.release,
      });
    if (!signal.aborted) heartbeat();
    const timer = setInterval(() => {
      if (!signal.aborted) heartbeat();
    }, 10000);
    const clearHeartbeat = () => {
      clearInterval(timer);
      this.store.setState('worker', null);
    };
    signal.addEventListener('abort', clearHeartbeat, { once: true });
    const relays = new PublicationRelays(signal);
    const discovery = this.discoveryLoop(signal);
    try {
      while (!signal.aborted) {
        const errors = await this.collect(relays.read.bind(relays));
        errors.push(...(await this.hydrate(AbortSignal.any([signal, AbortSignal.timeout(60000)]))));
        this.store.setState('health', {
          checkedAt: Date.now(),
          release: this.config.release,
          relays: this.config.hints ?? this.config.relays,
          errors,
        });
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 5000);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    } finally {
      stop.abort();
      clearHeartbeat();
      signal.removeEventListener('abort', clearHeartbeat);
      relays.close();
      await discovery;
    }
  }
}
