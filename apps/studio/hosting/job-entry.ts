// Bundled into the image. Project code and its commands only execute in the container.
import { cp, mkdir } from 'node:fs/promises';
import { openCodeAgent, type AgentEvent } from '../agent';
import { providers, type Provider } from '../connections-model';
import { run } from '../process';
import { workspaceFiles } from './workspace';
import { withJobDeadline } from './job-deadline';
import { selectToolchainProfile } from './toolchain-profile';

import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

async function main(context: any, signal: AbortSignal) {
  const profile = await selectToolchainProfile('/workspace');
  await cp(profile + '/node_modules', '/workspace/node_modules', { recursive: true });
  // A throwaway Git repository supports soyLI inspection. It never replaces the real history.
  const env = { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' };
  await mkdir('/tmp/home', { recursive: true });
  await run(['git', 'init', '-q'], {
    cwd: '/workspace',
    env,
    signal,
    operation: 'initialize isolated source inspection',
  });
  for (const args of [
    ['add', '.'],
    [
      '-c',
      'user.name=Studio job',
      '-c',
      'user.email=studio@localhost',
      'commit',
      '-qm',
      'Isolated job input',
    ],
  ])
    await run(['git', ...args], {
      cwd: '/workspace',
      env,
      signal,
      operation: 'prepare isolated source inspection',
    });

  if (context.operation === 'agent') {
    const connection = context.connection as { provider: Provider; model: string; steps: number };
    // HTTP is loopback inside the network-disabled namespace; only the mounted socket
    // can reach the controller. No DNS, generic proxy or arbitrary upstream URL exists.
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      maxRequestBodySize: 2 * 1024 * 1024,
      idleTimeout: 120,
      async fetch(req) {
        const url = new URL(req.url);
        return fetch('http://inference' + url.pathname + url.search, {
          unix: '/input/inference.sock',
          method: req.method,
          body: req.body,
          headers: { 'Content-Type': 'application/json' },
          signal: req.signal,
          redirect: 'error',
        });
      },
    });
    const provider = providers[connection.provider].native ? connection.provider : 'studio';
    try {
      const agent = await openCodeAgent({
        directory: '/tmp/agent',
        executable: '/usr/local/bin/opencode',
        provider: connection.provider,
        model: provider + '/' + connection.model,
        key: '',
        steps: connection.steps,
        browserBuild: !!context.browserBuild,
        endpoint: proxy.url.origin,
        env,
      });
      await agent.run(
        '/workspace',
        context.prompt,
        undefined,
        signal,
        (event: AgentEvent) => {
          if (event.type !== 'session') console.log('SOY_AGENT:' + JSON.stringify(event));
        },
        {
          browserBuild: !!context.browserBuild,
          check: context.browserBuild
            ? async () => {
                const response = await fetch('http://studio/check', {
                  unix: '/input/build.sock',
                  method: 'POST',
                  body: JSON.stringify(await workspaceFiles('/workspace')),
                  signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
                });
                const { result } = await response.json();
                if (typeof result !== 'string') throw new Error('Invalid browser check response.');
                return result;
              }
            : undefined,
        },
      );
    } finally {
      await proxy.stop(true);
    }
  } else if (context.operation === 'setup') {
    console.log('Pinned dependencies available in the isolated workspace.');
  } else if (context.operation === 'command') {
    const allowed = [['run', 'verify'], ['check'], ['run', 'test:conformance'], ['build']];
    if (!allowed.some((args) => JSON.stringify(args) === JSON.stringify(context.args)))
      throw new Error('Unsupported toolchain action.');
    const output = await run(['soyli', ...context.args], {
      cwd: '/workspace',
      env,
      signal,
      operation: 'check isolated project',
      includeStderr: true,
    });
    console.log(output);
  } else throw new Error('Unsupported isolated job.');
}
await (async () => {
  const { context, timeoutMs } = await Bun.file('/input/input.json').json();
  await withJobDeadline(timeoutMs, (signal) => main(context, signal));
})().catch((error) => {
  const diagnostic = diagnose(error, 'execute isolated project');
  if (diagnostic.code === 'STUDIO_TIMEOUT') console.log('SOY_JOB_TIMEOUT');
  if (diagnostic.code === 'STUDIO_PROFILE') console.log('SOY_JOB_PROFILE');
  console.error(formatDiagnostic(diagnostic));
  process.exitCode = 1;
});
