import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../../packages/grasp/src/client';
import { Connections } from '../connections';
import { HostedTools } from './runner';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import type { ContainerJobs } from './container';

test('hosted agent/build adapters import only permitted files and never pass reusable keys to the job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-runner-'));
  try {
    const project = join(root, 'project');
    await mkdir(project);
    await sourceGit(project, ['init', '-q']);
    await writeFile(join(project, 'main.ts'), 'before');
    await writeFile(join(project, 'package.json'), '{}');
    await writeFile(join(project, '.gitignore'), 'dist/\n');
    const connections = new Connections(join(root, 'credentials'));
    await connections.initialize({
      key: 'controller-only-test-key',
      model: 'deepseek/deepseek-flash',
    });
    let commandCalls = 0,
      malicious = false;
    const jobs: Pick<ContainerJobs, 'run'> = {
      async run(files, command, options) {
        expect(JSON.stringify([files, command, options.context])).not.toContain(
          'controller-only-test-key',
        );
        commandCalls++;
        const context = options.context as { operation: string };
        expect(command).toEqual(['bun', '--no-env-file', '/opt/studio/job-entry.js']);
        if (context.operation === 'agent') {
          expect(options.prepare).toBeFunction();
          options.onLine?.(
            'SOY_AGENT:' + JSON.stringify({ type: 'activity', text: 'Installed guidance loaded' }),
          );
          if (malicious) options.onLine?.('SOY_AGENT:{"type":"usage","cost":-99}');
          return {
            files: { ...files, 'main.ts': Buffer.from('after').toString('base64') },
            output: '',
          };
        }
        return {
          files: {
            ...files,
            'dist/index.html': Buffer.from('<html>built</html>').toString('base64'),
          },
          output: 'passed',
        };
      },
    };
    const tools = new HostedTools(jobs, connections),
      signal = new AbortController().signal;
    const adapters = tools.adapters(signal);
    const events: unknown[] = [];
    await adapters.agent!.run(project, 'edit', undefined, signal, (e) => events.push(e));
    expect(await readFile(join(project, 'main.ts'), 'utf8')).toBe('after');
    expect(events).toEqual([{ type: 'activity', text: 'Installed guidance loaded' }]);
    await adapters.projectCommand!(project, ['run', 'verify'], { signal, operation: 'verify' });
    expect(await readFile(join(project, 'dist/index.html'), 'utf8')).toBe('<html>built</html>');
    await expect(
      adapters.projectCommand!(project, ['exec', 'evil'], { signal, operation: 'probe' }),
    ).rejects.toThrow('no hosted execution');
    expect(commandCalls).toBe(2);
    malicious = true;
    await expect(
      adapters.agent!.run(project, 'edit', undefined, signal, () => {}),
    ).rejects.toThrow();
    expect(adapters.capture).toBeFunction();
    expect(adapters.publicationCheck).toBeFunction();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a hosted agent checks its current edits in the browser before exporting its final workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-browser-bridge-'));
  try {
    const project = join(root, 'project');
    await mkdir(project);
    await sourceGit(project, ['init', '-q']);
    await writeFile(join(project, 'main.ts'), 'before');
    const connections = new Connections(join(root, 'credentials'));
    await connections.initialize({ key: 'fixture-provider-key', model: 'deepseek/deepseek-flash' });
    let checks = 0;
    const tools = new HostedTools(
      {
        async run(files, _command, options) {
          expect((options.context as { browserBuild: boolean }).browserBuild).toBe(true);
          const input = join(root, 'input');
          await mkdir(input);
          const dispose = await options.prepare!(input);
          try {
            const edited = { ...files, 'main.ts': Buffer.from('first edit').toString('base64') };
            const response = await fetch('http://studio/check', {
              unix: join(input, 'build.sock'),
              method: 'POST',
              body: JSON.stringify(edited),
            });
            expect(await response.json()).toEqual({ result: 'browser diagnostics passed' });
            return {
              files: { ...edited, 'main.ts': Buffer.from('final edit').toString('base64') },
              output: '',
            };
          } finally {
            await dispose();
          }
        },
      },
      connections,
    );
    await tools.agent().run(project, 'make it', undefined, new AbortController().signal, () => {}, {
      browserBuild: true,
      check: async () => {
        checks++;
        expect(await readFile(join(project, 'main.ts'), 'utf8')).toBe('first edit');
        return 'browser diagnostics passed';
      },
    });
    expect(checks).toBe(1);
    expect(await readFile(join(project, 'main.ts'), 'utf8')).toBe('final edit');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed isolated inference preserves validated edits while keeping the failure visible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-recovery-'));
  try {
    await sourceGit(root, ['init', '-q']);
    await writeFile(join(root, 'main.ts'), 'before');
    const connections = new Connections(join(root, 'credentials'));
    await connections.initialize({ key: 'fixture', model: 'deepseek/deepseek-flash' });
    const tools = new HostedTools(
      {
        run: async (files) => ({
          files: { ...files, 'main.ts': Buffer.from('after').toString('base64') },
          output: '',
          failure: new DiagnosticError('STUDIO_INFERENCE', 'provider timed out'),
        }),
      },
      connections,
    );
    await expect(
      tools.agent().run(root, 'edit', undefined, new AbortController().signal, () => {}),
    ).rejects.toThrow('provider timed out');
    expect(await readFile(join(root, 'main.ts'), 'utf8')).toBe('after');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
