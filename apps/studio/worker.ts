import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { studioToolPath } from './toolchain';
import { Connections } from './connections';
import { providers } from './connections-model';
import { Studio } from './studio';
import { cleanEnvironment, openCodeAgent, type Agent } from './agent';
import { workerConfig } from './worker-client';
import { reportProcessGroups } from './process';
import { diagnose, DiagnosticError } from '../../packages/diagnostics/src';

if (!process.send) throw new Error('Studio worker requires its private IPC supervisor.');
const send = (message: unknown) => {
  try {
    if (process.connected) process.send!({ protocol: 1, ...(message as object) });
  } catch {
    // The supervisor may disappear between the connected check and send.
    void close();
  }
};
let connections: Connections | undefined;
let studio: Studio | undefined,
  initializing = false,
  closing = false,
  key = '';
reportProcessGroups((pid, active) => send({ type: 'process', pid, active }));
async function close() {
  if (closing) return;
  closing = true;
  try {
    await studio?.close();
  } finally {
    process.exit(0);
  }
}
process.once('disconnect', () => void close());
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
process.on('message', async (value: any) => {
  if (value?.protocol !== 1 || value.type !== 'request' || typeof value.id !== 'string') return;
  try {
    if (closing) throw new DiagnosticError('STUDIO_WORKER_EXIT', 'The worker is shutting down.');
    if (!Array.isArray(value.args) || value.args.length > 6)
      throw new Error('Invalid worker request.');
    let result;
    if (value.method === 'initialize') {
      if (initializing || studio) throw new Error('Worker is already initialized.');
      initializing = true;
      const config = workerConfig.parse(value.args[0]);
      key = config.agent.key;
      const env = cleanEnvironment();
      env.PATH = await studioToolPath(config.directory, config.soyli, env.PATH);
      env.SPACE_ACCOUNT_HOME = join(config.directory, 'unused-accounts');
      connections = new Connections(join(config.directory, 'credentials'));
      const settings = connections;
      const agent: Agent = {
        get model() {
          return settings.model;
        },
        get sessionKey() {
          return settings.sessionKey;
        },
        get stepLimit() {
          return settings.current().steps;
        },
        async run(...args) {
          const c = settings.current();
          const providerId = providers[c.provider].native ? c.provider : 'studio';
          const runner = await openCodeAgent({
            ...config.agent,
            env,
            provider: c.provider,
            endpoint: c.endpoint,
            key: c.key,
            model: providerId + '/' + c.model,
            steps: c.steps,
            browserBuild: args[5]?.browserBuild,
          });
          try {
            return await runner.run(...args);
          } finally {
            await writeFile(join(config.agent.directory, 'data/opencode/auth.json'), '{}', {
              mode: 0o600,
            });
          }
        },
      };
      studio = new Studio({
        directory: config.directory,
        owner: config.owner,
        soyli: config.soyli,
        env,
        agent,
        connections: settings,
      });
      await studio.initialize();
      await settings.initialize(
        config.agent.key ? { key: config.agent.key, model: config.agent.model } : undefined,
      );
      await mkdir(join(config.agent.directory, 'data/opencode'), { recursive: true, mode: 0o700 });
      await writeFile(join(config.agent.directory, 'data/opencode/auth.json'), '{}', {
        mode: 0o600,
      });
      result = { model: agent.model };
    } else {
      if (!studio) throw new Error('Worker is not initialized.');
      const methods = {
        state: () => studio!.state(),
        browserBuildNext: (session: string, base?: string) =>
          studio!.browserBuilds.next(session, base),
        browserBuildReply: (session: string, input: unknown) =>
          studio!.browserBuilds.reply(session, input),
        connectionAction: studio.connectionAction.bind(studio),
        browserGit: studio.browserGit.bind(studio),
        assets: studio.assets.bind(studio),
        importAsset: studio.importAsset.bind(studio),
        assetMedia: studio.assetMedia.bind(studio),
        create: studio.create.bind(studio),
        send: studio.send.bind(studio),
        stop: studio.stop.bind(studio),
        check: studio.check.bind(studio),
        restore: studio.restore.bind(studio),
        files: studio.files.bind(studio),
        file: studio.file.bind(studio),
        diff: studio.diff.bind(studio),
        preview: studio.preview.bind(studio),
        listing: studio.listing.bind(studio),
        preparePublication: studio.preparePublication.bind(studio),
        publish: studio.publish.bind(studio),
        prepareProposal: studio.prepareProposal.bind(studio),
        propose: studio.propose.bind(studio),
        refreshPublication: studio.refreshPublication.bind(studio),
        fixPublication: studio.fixPublication.bind(studio),
        publicationMedia: studio.publicationMedia.bind(studio),
        signerConnect: studio.signing.connect.bind(studio.signing),
        signerNext: studio.signing.next.bind(studio.signing),
        signerReply: studio.signing.reply.bind(studio.signing),
        close: () => studio!.close(),
      };
      if (!Object.hasOwn(methods, value.method)) throw new Error('Unknown worker operation.');
      result = await Reflect.apply(
        methods[value.method as keyof typeof methods],
        undefined,
        value.args,
      );
    }
    send({ type: 'result', id: value.id, value: result });
    if (value.method === 'close') void close();
  } catch (error) {
    const diagnostic = diagnose(error, 'studio worker');
    const safe = key
      ? JSON.parse(JSON.stringify(diagnostic), (_name, value) =>
          typeof value === 'string'
            ? (connections?.scrub(value) ?? value).replaceAll(key, '[provider credential redacted]')
            : value,
        )
      : JSON.parse(JSON.stringify(diagnostic), (_name, value) =>
          typeof value === 'string' ? (connections?.scrub(value) ?? value) : value,
        );
    send({ type: 'error', id: value.id, diagnostic: safe });
  }
});
