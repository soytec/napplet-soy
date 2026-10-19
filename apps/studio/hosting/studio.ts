import { join, resolve } from 'node:path';
import { Studio, type StudioOptions } from '../studio';
import { HostedConnections } from './connections';
import { cleanEnvironment } from '../agent';
import { ContainerJobs } from './container';
import { HostedTools } from './runner';
import { DiagnosticError } from '../../../packages/diagnostics/src';

/** Operator-only assembly. No browser chooses a disk path, command, image or owner.
 * Preview delivery must be supplied explicitly; loopback URLs are not a hosted UI. */
export async function isolatedStudio(options: {
  directory: string;
  owner: string;
  soyli: string[];
  jobs: Pick<ContainerJobs, 'run'>;
  masterKey: Uint8Array;
  browserLibraryRoot: string;
  networkPolicy: 'public-https-only';
  preview: NonNullable<StudioOptions['preview']>;
}) {
  if (!/^nostr:[a-f0-9]{64}$/.test(options.owner))
    throw new Error('Verified Nostr owner required.');
  if (options.networkPolicy !== 'public-https-only')
    throw new Error('Hosted Studio requires the operator egress boundary.');
  const directory = join(resolve(options.directory), options.owner.slice(6));
  const connections = new HostedConnections(
    join(directory, 'credentials'),
    options.owner.slice(6),
    options.masterKey,
  );
  const lifetime = new AbortController();
  const tools = new HostedTools(options.jobs, connections);
  await connections.initialize();
  const studio = new Studio({
    directory,
    owner: options.owner,
    soyli: options.soyli,
    connections,
    browserLibraryRoot: options.browserLibraryRoot,
    env: { ...cleanEnvironment(), SPACE_ACCOUNT_HOME: join(directory, 'unused-accounts') },
    preview: options.preview,
    sourcePolicy: (source) => {
      if (/^https?:/.test(source)) {
        const url = new URL(source);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash
        )
          throw new DiagnosticError(
            'STUDIO_SOURCE',
            'Use a public HTTPS napplet link or Nostr reference.',
          );
      } else if (!/^(?:nostr:)?(?:naddr1|nevent1|note1|[a-f0-9]{64}$)/.test(source))
        throw new DiagnosticError('STUDIO_SOURCE', 'Use a published napplet Nostr reference.');
    },
    ...tools.adapters(lifetime.signal),
  });
  await studio.initialize();
  return {
    studio,
    async close() {
      lifetime.abort();
      await studio.close();
    },
  };
}
