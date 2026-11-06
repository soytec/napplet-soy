import { z } from 'zod';
import {
  manifestSourceCommit,
  manifestSourceLocation,
  sourceArchiveReference,
} from '../../protocol/src/source-archive';
import { sha256, type SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { sourceArchive } from '../../remix/src/archive';
export const sourceInput = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.string().max(200).optional(),
  view: z.enum(['project', 'html']).default('project'),
});
type SourceInput = z.infer<typeof sourceInput>;
const ARCHIVE_LIMIT = 50 * 1024 * 1024;
export const SOURCE_TEXT_LIMIT = 200 * 1024;
type Archive = { bytes: Uint8Array; files: Map<string, Uint8Array> };
type ArchiveResult = { archive: Archive; error: null } | { archive: null; error: string };
type Dependencies = {
  manifest: (revision: string) => Promise<SignedEvent | null>;
  artifact: (hash: string) => Promise<Uint8Array | null>;
  download: (url: URL, signal: AbortSignal) => Promise<Uint8Array>;
  blocked?: (type: string, target: string) => boolean;
  manifestBlocked?: (event: SignedEvent) => boolean;
};

/** Only a signed archive digest can identify the original project. */
function archiveReference(manifest: SignedEvent) {
  return sourceArchiveReference(manifest.tags);
}

function textFile(bytes: Uint8Array) {
  if (bytes.length > SOURCE_TEXT_LIMIT) return { state: 'large' as const, text: null };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error();
    return { state: 'text' as const, text };
  } catch {
    return { state: 'binary' as const, text: null };
  }
}

/** Read-only source inspection, with the same tar policy as remix. No files are extracted. */
export function createSourceBrowser(deps: Dependencies) {
  const blocked = deps.blocked ?? (() => false);
  const manifestBlocked = deps.manifestBlocked ?? (() => false);
  const cache = new Map<string, { value: ArchiveResult; expires: number; size: number }>();
  const pending = new Map<string, Promise<ArchiveResult>>();
  let cacheBytes = 0,
    budgetStart = 0,
    attempts = 0;
  async function load(ref: NonNullable<ReturnType<typeof archiveReference>>) {
    if (blocked('hash', ref.hash))
      return { archive: null, error: 'Source archive is unavailable.' } as const;
    // A standard source URL can stay unchanged across signed revisions.
    const key = JSON.stringify([ref.url.href, ref.hash]);
    for (const [key, entry] of cache) {
      if (entry.expires <= Date.now()) {
        cacheBytes -= entry.size;
        cache.delete(key);
      }
    }
    const old = cache.get(key);
    if (old) return old.value;
    const running = pending.get(key);
    if (running) return running;
    if (Date.now() - budgetStart > 60000) {
      budgetStart = Date.now();
      attempts = 0;
    }
    if (pending.size >= 2 || attempts >= 12)
      return { archive: null, error: 'Source downloads are busy. Try again in a minute.' } as const;
    attempts++;
    const request = (async (): Promise<ArchiveResult> => {
      try {
        const bytes = await deps.download(ref.url, AbortSignal.timeout(12000));
        if (bytes.length > ARCHIVE_LIMIT || (await sha256(bytes)) !== ref.hash) throw new Error();
        return { archive: { bytes, files: sourceArchive(bytes) }, error: null };
      } catch {
        return {
          archive: null,
          error:
            'The source archive could not be retrieved and verified. It may be unavailable or use an unsupported archive format.',
        };
      }
    })();
    pending.set(key, request);
    try {
      const value = await request;
      const size = value.archive
        ? value.archive.bytes.length +
          [...value.archive.files.values()].reduce((n, b) => n + b.length, 0)
        : 0;
      while (cache.size && (cache.size >= 8 || cacheBytes + size > 96 * 1024 * 1024)) {
        const first = cache.keys().next().value!;
        cacheBytes -= cache.get(first)!.size;
        cache.delete(first);
      }
      cache.set(key, { value, size, expires: Date.now() + (value.archive ? 600000 : 30000) });
      cacheBytes += size;
      return value;
    } finally {
      pending.delete(key);
    }
  }

  async function admitted(revision: string) {
    const event = await deps.manifest(revision);
    if (!event || event.id !== revision || manifestBlocked(event)) return null;
    return validateManifest(event);
  }
  async function original(manifest: SignedEvent): Promise<ArchiveResult> {
    try {
      const ref = archiveReference(manifest);
      return ref
        ? load(ref)
        : {
            archive: null,
            error: 'The author has not attached a pinned source archive to this release.',
          };
    } catch {
      return { archive: null, error: 'This release has an invalid source archive reference.' };
    }
  }
  async function html(hash: string) {
    const bytes = await deps.artifact(hash);
    return bytes && (await sha256(bytes)) === hash ? bytes : null;
  }

  return {
    async readme(revision: string) {
      const release = await admitted(revision);
      if (!release) return null;
      const result = await original(release.manifest);
      if (!result.archive || !(await admitted(revision))) return null;
      if (blocked('hash', archiveReference(release.manifest)!.hash)) return null;
      const files = [...result.archive.files.keys()].sort();
      const path = [/^readme\.md$/i, /^readme\.markdown$/i, /^readme$/i, /^readme\.(?:txt|rst)$/i]
        .map((pattern) => files.find((path) => pattern.test(path)))
        .find(Boolean);
      if (!path) return null;
      const file = textFile(result.archive.files.get(path)!);
      if (file.state !== 'text' || !file.text) return null;
      const lines = file.text.replace(/\r\n?/g, '\n').split('\n');
      const excerpt = lines.slice(0, 10);
      return {
        revision,
        path,
        lines: excerpt.map((line) => (line.length > 1000 ? line.slice(0, 999) + '…' : line)),
        truncated: lines.length > 10 || excerpt.some((line) => line.length > 1000),
      };
    },
    async view(input: SourceInput) {
      const release = await admitted(input.revision);
      if (!release) return null;
      const { manifest } = release;
      const tag = (key: string) => manifest.tags.find((t) => t[0] === key)?.[1];
      let sourceUrl: string | null = null;
      const sourceReference = manifestSourceLocation(manifest.tags);
      try {
        const url = new URL(sourceReference ?? '');
        if (url.protocol === 'https:' && !url.username && !url.password) sourceUrl = url.href;
      } catch {}
      const result = input.view === 'html' ? null : await original(manifest);
      // Check visibility again after I/O; cached bytes never override moderation/deletion.
      if (!(await admitted(input.revision))) return null;
      let files = result?.archive?.files;
      if (result?.archive && blocked('hash', archiveReference(manifest)!.hash)) return null;
      if (input.view === 'html') {
        const bytes = await html(release.artifactHash);
        if (bytes) files = new Map([['index.html', bytes]]);
      }
      if (!(await admitted(input.revision))) return null;
      const paths = [...(files ?? new Map<string, Uint8Array>())]
        .map(([path, bytes]) => ({ path, size: bytes.length }))
        .sort((a, b) => a.path.localeCompare(b.path, 'en'));
      const licenseFile =
        input.view === 'project'
          ? (paths.find((f) => /^(?:LICENSE|COPYING)(?:\.(?:md|txt))?$/i.test(f.path))?.path ??
            null)
          : null;
      const path =
        input.file ??
        paths.find((f) => /^readme\.md$/i.test(f.path))?.path ??
        paths.find((f) => f.path === 'src/main.ts')?.path ??
        paths[0]?.path;
      const selected = path && files?.get(path);
      return {
        revision: manifest.id,
        title: (tag('title') || release.identity?.identifier || 'Untitled napplet').slice(0, 160),
        sourceUrl,
        sourceReference,
        commit: manifestSourceCommit(manifest.tags),
        archiveUrl: (() => {
          try {
            return archiveReference(manifest)?.url.href ?? null;
          } catch {
            return null;
          }
        })(),
        artifactUrl: (() => {
          try {
            const url = new URL(
              `${release.servers[0]?.replace(/\/$/, '')}/${release.artifactHash}`,
            );
            return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
              ? url.href
              : null;
          } catch {
            return null;
          }
        })(),
        archiveHash: result?.archive ? archiveReference(manifest)!.hash : null,
        view: input.view,
        files: paths,
        licenseFile,
        message:
          input.view === 'html'
            ? files
              ? null
              : 'The verified built HTML is not available here yet.'
            : (result?.error ?? null),
        selected: path
          ? {
              path,
              size: selected?.length ?? null,
              ...(selected ? textFile(selected) : { state: 'missing' as const, text: null }),
            }
          : null,
      };
    },
    async download(input: SourceInput, archive = false) {
      const release = await admitted(input.revision);
      if (!release) return null;
      let bytes: Uint8Array | null = null;
      let name = 'index.html';
      if (input.view === 'html') bytes = await html(release.artifactHash);
      else {
        const result = await original(release.manifest);
        const ref = archiveReference(release.manifest);
        if (!ref || blocked('hash', ref.hash)) return null;
        if (archive) {
          bytes = result.archive?.bytes ?? null;
          name = `${input.revision.slice(0, 12)}-source.tar`;
        } else {
          bytes = result.archive?.files.get(input.file ?? '') ?? null;
          name = input.file?.split('/').pop() ?? 'source';
        }
      }
      if (!bytes || !(await admitted(input.revision))) return null;
      return { bytes, name };
    },
  };
}
