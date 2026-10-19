import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../../packages/grasp/src/client';
import { Connections } from '../connections';
import { HostedTools } from './runner';
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
