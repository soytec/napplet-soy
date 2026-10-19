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
  jobs: ContainerJobs;
  preview: NonNullable<StudioOptions['preview']>;
}) {
  if (!/^nostr:[a-f0-9]{64}$/.test(options.owner))
    throw new Error('Verified Nostr owner required.');
  const directory = join(resolve(options.directory), options.owner.slice(6));
  const connections = new HostedConnections(join(directory, 'credentials'));
  const lifetime = new AbortController();
  const tools = new HostedTools(options.jobs, connections);
  await connections.initialize();
  const studio = new Studio({
    directory,
    owner: options.owner,
    soyli: options.soyli,
    connections,
    env: { ...cleanEnvironment(), SPACE_ACCOUNT_HOME: join(directory, 'unused-accounts') },
    preview: options.preview,
    sourcePolicy: () => {
      throw new DiagnosticError(
        'STUDIO_SOURCE',
        'Hosted remix import requires the source-fetch broker. Use local Studio or soyLI for this source.',
      );
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
