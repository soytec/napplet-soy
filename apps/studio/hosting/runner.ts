import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Agent, AgentEvent } from '../agent';
import type { Connections } from '../connections';
import { inspectProject } from '../../../packages/publish/src/project';
import type { PublicationHooks } from '../publication';
import type { StudioOptions } from '../studio';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import { ContainerJobs, type JobOptions } from './container';
import { applyWorkspace, workspaceFiles } from './workspace';
import { inferenceSocket } from './inference';

const agentEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(20000) }),
  z.object({
    type: z.literal('reasoning'),
    text: z.string().max(24000),
    id: z.string().max(128).optional(),
    truncated: z.boolean().optional(),
  }),
  z.object({ type: z.literal('activity'), text: z.string().max(20000) }),
  z.object({ type: z.literal('usage'), cost: z.number().finite().min(0).max(100000) }),
  z.object({ type: z.literal('limit') }),
]);

/** Same maintained Studio orchestration, explicit container boundary for project
 * execution. Creating/importing Git and publication remain trusted controller jobs. */
export class HostedTools {
  constructor(
    private jobs: Pick<ContainerJobs, 'run'>,
    private connections: Connections,
  ) {}
  private async job(
    root: string,
    context: Record<string, unknown>,
    mode: 'agent' | 'build',
    options: JobOptions,
  ) {
    const before = await workspaceFiles(root);
    const result = await this.jobs.run(
      before,
      ['bun', '--no-env-file', '/opt/studio/job-entry.js'],
      { ...options, context },
    );
    options.signal.throwIfAborted();
    await applyWorkspace(root, before, result.files, mode);
    return result.output;
  }
  agent(): Agent {
    const settings = this.connections;
    return {
      get model() {
        return settings.model;
      },
      get sessionKey() {
        return 'hosted:' + settings.sessionKey;
      },
      get stepLimit() {
        return settings.current().steps;
      },
      run: async (root, prompt, _session, signal, emit) => {
        const c = settings.current();
        await this.job(
          root,
          {
            operation: 'agent',
            prompt,
            connection: { provider: c.provider, model: c.model, steps: c.steps },
          },
          'agent',
          {
            signal,
            operation: 'run isolated OpenCode',
            prepare: async (input) => {
              const broker = await inferenceSocket(join(input, 'inference.sock'), c, signal);
              return () => broker.close();
            },
            onLine: (line) => {
              if (line.startsWith('SOY_AGENT:')) {
                emit(agentEvent.parse(JSON.parse(line.slice(10))) as AgentEvent);
              }
            },
          },
        );
      },
    };
  }
  /** Called only for project execution, never for Git/scaffold operations. */
  async command(root: string, args: string[], options: JobOptions) {
    if (JSON.stringify(args) === '["setup"]') {
      return this.job(root, { operation: 'setup' }, 'build', options);
    }
    if (
      ![['run', 'verify'], ['check'], ['run', 'test:conformance'], ['build']].some(
        (a) => JSON.stringify(a) === JSON.stringify(args),
      )
    )
      throw new DiagnosticError(
        'STUDIO_EXECUTION',
        'This project command has no hosted execution adapter.',
      );
    return this.job(root, { operation: 'command', args }, 'build', options);
  }

  private async captureContents(
    contents: Map<string, Uint8Array>,
    cover: boolean,
    video: boolean,
    portrait: boolean,
    signal: AbortSignal,
  ) {
    if ([...contents.keys()].some((p) => p.startsWith('.studio-result/')))
      throw new DiagnosticError(
        'STUDIO_CAPTURE',
        'Reserved capture output path in project source.',
      );
    const input = Object.fromEntries(
      [...contents].map(([p, b]) => [p, Buffer.from(b).toString('base64')]),
    );
    const result = await this.jobs.run(input, ['/opt/studio/capture'], {
      context: { cover, video, portrait },
      signal,
      operation: 'capture isolated studio preview',
    });
    signal.throwIfAborted();
    const output = (name: string) => {
      const data = result.files['.studio-result/' + name];
      return data === undefined ? undefined : Buffer.from(data, 'base64');
    };
    const metadata = z
      .object({ profile: z.string().min(1).max(256), browser: z.string().min(1).max(256) })
      .parse(JSON.parse(output('result.json')?.toString() ?? 'null'));
    const preview = output('cover.png'),
      clip = output('clip.webm');
    if ((cover && !preview?.length) || (video && !clip?.length))
      throw new DiagnosticError(
        'STUDIO_CAPTURE',
        'The isolated capture did not return the requested media.',
      );
    return { ...metadata, preview, video: clip };
  }

  /** Supply the whole adapter set together; none may fall back to local execution. */
  adapters(
    signal: AbortSignal,
  ): Pick<StudioOptions, 'agent' | 'projectCommand' | 'capture' | 'publicationCheck'> {
    const capture: NonNullable<PublicationHooks['capture']> = async (
      root,
      pubkey,
      target,
      video,
      portrait,
      jobSignal,
    ) => {
      const { contents } = await inspectProject(root, 'public', pubkey);
      const result = await this.captureContents(contents, true, video, portrait, jobSignal);
      await mkdir(target, { recursive: true, mode: 0o700 });
      await writeFile(join(target, 'cover.png'), result.preview!, { flag: 'wx' });
      if (result.video) await writeFile(join(target, 'clip.webm'), result.video, { flag: 'wx' });
    };
    const publicationCheck: NonNullable<StudioOptions['publicationCheck']> = (
      contents,
      jobSignal,
    ) => this.captureContents(contents, false, false, false, jobSignal ?? signal);
    return {
      agent: this.agent(),
      projectCommand: (root, args, options) => this.command(root, args, options),
      capture,
      publicationCheck,
    };
  }
}
