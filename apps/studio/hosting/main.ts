import { mkdir, readFile, writeFile, chmod, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { PrivateKeySigner, ApplesauceRelayPool } from '@contextvm/sdk';
import { OwnerStudios, connectStudioControl } from './control';
import { StudioSessions } from './sessions';
import { StudioTransfers } from './transfers';
import { StudioRequests } from './requests';
import { HostedPreviews } from './previews';
import { ContainerJobs } from './container';
import { StudioQueue } from './queue';
import { isolatedStudio } from './studio';
import { studioHttp } from './http';
import { studioCapacity } from './capacity';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

const configSchema = z
  .object({
    origin: z.url().refine((v) => new URL(v).origin === v && v.startsWith('https://')),
    port: z.number().int().min(1024).max(65535),
    directory: z.string().startsWith('/'),
    libraryRoot: z.string().startsWith('/'),
    soyli: z.array(z.string().min(1)).min(1),
    image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    profile: z.enum(['standard', 'legacy-x64']),
    relays: z
      .array(z.url().refine((v) => new URL(v).protocol === 'wss:' && new URL(v).port === ''))
      .min(1)
      .max(3),
    controlRelay: z.literal('ws://127.0.0.1:19351'),
    admitted: z
      .array(z.string().regex(/^(?:\*|[a-f0-9]{64})$/))
      .min(1)
      .max(256),
    // Operator assertion: service unit installs the UID-bound kernel egress rules.
    networkPolicy: z.literal('public-https-only'),
  })
  .strict();

export async function startHostedStudio(value: unknown) {
  const config = configSchema.parse(value);
  if (process.platform !== 'linux' || !process.getuid || process.getuid() < 100)
    throw new Error('Hosted Studio must run as its dedicated unprivileged Linux service user.');
  const directory = resolve(config.directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const secret = async (name: string) => {
    const path = join(directory, name);
    try {
      await writeFile(path, crypto.getRandomValues(new Uint8Array(32)), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
      throw new Error('Studio secrets require private ordinary files.');
    const bytes = await readFile(path);
    if (bytes.length !== 32) throw new Error('Invalid Studio secret length.');
    return bytes;
  };
  const [masterKey, key] = await Promise.all([secret('vault.key'), secret('cvm.key')]);
  const signer = new PrivateKeySigner(key.toString('hex'));
  const provider = { pubkey: await signer.getPublicKey(), relays: config.relays };
  let registry: OwnerStudios;
  const sessions = new StudioSessions(
    config.origin,
    (owner) => config.admitted.includes('*') || config.admitted.includes(owner),
    Date.now,
    (owner) => {
      void registry
        ?.deactivate(owner)
        .catch(() => console.error('Studio session cleanup failed; inspect the service.'));
    },
  );
  const transfers = new StudioTransfers(),
    previews = new HostedPreviews(config.origin, sessions);
  const requests = new StudioRequests(join(directory, 'requests.sqlite'));
  const jobs = new StudioQueue(new ContainerJobs(config.image, undefined, config.profile));
  const ownersDirectory = join(directory, 'owners');
  await mkdir(ownersDirectory, { recursive: true, mode: 0o700 });
  registry = new OwnerStudios(
    () => config.admitted,
    async (owner) => {
      const opened = await isolatedStudio({
        directory: ownersDirectory,
        owner,
        soyli: config.soyli,
        jobs,
        masterKey,
        browserLibraryRoot: config.libraryRoot,
        networkPolicy: config.networkPolicy,
        preview: (root) => previews.open(owner.slice(6), root),
      });
      return opened.studio;
    },
    {
      transfers,
      requests,
      previews,
      resolveOwner: (actor) => sessions.client(actor).owner,
      beforeMutation: (owner) => studioCapacity(ownersDirectory, owner),
    },
  );
  const relayHandler = new ApplesauceRelayPool([config.controlRelay]);
  const control = await connectStudioControl(registry, { signer, relayHandler });
  const http = studioHttp({ origin: config.origin, provider, sessions, transfers });
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: config.port,
    maxRequestBodySize: 32 * 1024 * 1024,
    idleTimeout: 60,
    fetch(request) {
      // Caddy owns TLS; do not trust a client-supplied Host or forwarded origin.
      const local = new URL(request.url);
      if (local.pathname === '/health' && request.method === 'GET')
        return Response.json({ status: 'ready', profile: config.profile });
      const canonical = new URL(local.pathname + local.search, config.origin);
      const translated = new Request(canonical, request);
      return local.pathname.startsWith('/api/studio/preview/')
        ? previews.fetch(translated)
        : http(translated);
    },
    error() {
      return Response.json(
        { error: 'Studio request failed.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    },
  });
  const sweep = setInterval(() => sessions.sweep(), 30000);
  let closing: Promise<void> | undefined;
  return {
    provider,
    port: listener.port,
    close() {
      return (closing ??= (async () => {
        clearInterval(sweep);
        await listener.stop(true);
        await control.close();
        await registry.close();
        previews.close();
      })());
    },
  };
}

if (import.meta.main) {
  process.umask(0o077);
  try {
    const path = process.argv[2];
    if (!path) throw new Error('Usage: bun apps/studio/hosting/main.ts <operator-config.json>');
    const host = await startHostedStudio(JSON.parse(await readFile(path, 'utf8')));
    console.log(
      `Hosted Studio ready on loopback port ${host.port}; encrypted control ${host.provider.pubkey}`,
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void host.close().then(() => process.exit(0));
      });
  } catch (error) {
    console.error(formatDiagnostic(diagnose(error, 'start hosted Studio')));
    process.exitCode = 1;
  }
}
