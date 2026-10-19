import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DiagnosticError, redactDiagnostic } from '../../packages/diagnostics/src';
import { run } from './process';
import { defaultSteps, providers, type Provider } from './connections-model';
import { regularFile } from '../../packages/publish/src/project';
import { reasoningLimits } from './types';
import { agentCheckTool } from './agent-check';
import { workspaceMap } from './agent-context';

export const inferenceTimeoutMs = 10 * 60_000;

export type AgentEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; id?: string; text: string; truncated?: boolean }
  | { type: 'activity'; text: string }
  | { type: 'usage'; cost: number }
  | { type: 'limit' };
export type Agent = {
  model: string;
  sessionKey?: string;
  stepLimit?: number;
  run: (
    directory: string,
    prompt: string,
    session: string | undefined,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
    execution?: { browserBuild: boolean; check?: (signal?: AbortSignal) => Promise<string> },
  ) => Promise<void>;
};

export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'LANG'])
    if (process.env[key]) env[key] = process.env[key];
  const cache =
    process.platform === 'darwin' ? join(homedir(), 'Library/Caches') : join(homedir(), '.cache');
  env.SPACE_TOOLCHAIN_CACHE =
    process.env.SPACE_TOOLCHAIN_CACHE ?? join(cache, 'napplet-space/toolchains');
  env.PLAYWRIGHT_BROWSERS_PATH =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(cache, 'napplet-space/browsers');
  // Each project may use an older conformance Playwright. Never prune another tool's browser.
  env.PLAYWRIGHT_SKIP_BROWSER_GC = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** Normalize only useful parts of V1's JSONL stream; never forward raw tool arguments. */
export function agentEvents(line: string): AgentEvent[] {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  const result: AgentEvent[] = [];
  if (typeof event.sessionID === 'string' && /^ses_[a-zA-Z0-9]+$/.test(event.sessionID))
    result.push({ type: 'session', id: event.sessionID });
  if (event.type === 'text' && typeof event.part?.text === 'string') {
    if (/maximum steps for this agent have been reached/i.test(event.part.text))
      result.push({ type: 'limit' });
    result.push({ type: 'text', text: event.part.text.slice(0, 20000) });
  }
  // Only text the provider/OpenCode deliberately exposes. Encrypted/redacted
  // reasoning and provider metadata are never copied into browser-facing state.
  if (event.type === 'reasoning' && typeof event.part?.text === 'string' && event.part.text.trim())
    result.push({
      type: 'reasoning',
      id: typeof event.part.id === 'string' ? event.part.id.slice(0, 128) : undefined,
      text: redactDiagnostic(event.part.text, reasoningLimits.characters),
      truncated: event.part.text.length > reasoningLimits.characters,
    });
  if (event.type === 'tool_use') {
    const tool = event.part?.tool;
    const state = event.part?.state;
    if (typeof tool === 'string') {
      const skill =
        tool === 'skill' && typeof state?.input?.name === 'string' ? `: ${state.input.name}` : '';
      result.push({ type: 'activity', text: `${tool}${skill} · ${state?.status ?? 'running'}` });
    }
  }
  if (event.type === 'step_finish')
    result.push({
      type: 'usage',
      cost: typeof event.part?.cost === 'number' ? Math.max(0, event.part.cost) : 0,
    });
  if (event.type === 'error')
    throw new DiagnosticError('STUDIO_AGENT', 'The inference session failed.', {
      operation: 'OpenCode inference',
      detail: redactDiagnostic(
        event.error?.data?.message ?? event.error?.message ?? 'Provider or agent error.',
      ),
      recovery:
        'Check the configured provider and balance, then send another message to continue this session.',
    });
  return result;
}

export async function openCodeAgent(options: {
  directory: string;
  executable: string;
  model: string;
  key: string;
  provider?: Provider;
  endpoint?: string;
  steps?: number;
  browserBuild?: boolean;
  env: NodeJS.ProcessEnv;
}): Promise<Agent> {
  const { directory, executable, model, key } = options;
  const provider = options.provider ?? 'deepseek';
  const providerId = providers[provider].native ? provider : 'studio';
  const modelId = model.slice(model.indexOf('/') + 1);
  await mkdir(join(directory, 'data/opencode'), { recursive: true, mode: 0o700 });
  const auth = join(directory, 'data/opencode/auth.json');
  await writeFile(auth, JSON.stringify(key ? { [providerId]: { type: 'api', key } } : {}), {
    mode: 0o600,
  });
  await chmod(auth, 0o600);
  const config = join(directory, 'opencode.json');
  const protectedEdits = [
    '.git/**',
    '.env*',
    '.opencode/**',
    'opencode*',
    '.agents/**',
    '.claude/**',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/**',
    'tests/**',
    'package.json',
    '*lock*',
    'vite.config.*',
    'tsconfig*',
  ];
  await writeFile(
    config,
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model,
        share: 'disabled',
        autoupdate: false,
        enabled_providers: [providerId],
        provider: {
          [providerId]: {
            ...(!providers[provider].native
              ? { npm: '@ai-sdk/openai-compatible', name: providers[provider].name }
              : {}),
            options: {
              baseURL: options.endpoint ?? providers[provider].url,
              ...(!key ? { apiKey: 'local-no-auth' } : {}),
            },
            models: { [modelId]: { name: modelId } },
          },
        },
        agent: { build: { steps: options.steps ?? defaultSteps } },
        permission: {
          '*': 'deny',
          read: { '*': 'allow', '*.env*': 'deny' },
          edit: {
            '*': 'allow',
            ...Object.fromEntries(protectedEdits.map((pattern) => [pattern, 'deny'])),
          },
          glob: 'allow',
          grep: 'allow',
          skill: { '*': 'deny', 'napplet-*': 'allow', 'soy-backends': 'allow' },
          bash: {
            '*': 'deny',
            ...Object.fromEntries(
              [
                'pwd',
                'ls*',
                'cat *',
                'sed -n *',
                'rg *',
                'find *',
                'head *',
                'wc *',
                'echo *',
                'git status*',
                'git diff*',
                'git log*',
                'soyli build',
                'soyli run verify',
                'soyli run type-check',
                'soyli run test:guidance',
                'soyli run test:conformance',
                'soyli check',
              ]
                .filter((pattern) => !options.browserBuild || !pattern.startsWith('soyli '))
                .map((pattern) => [pattern, 'allow']),
            ),
          },
          external_directory: 'deny',
          question: 'deny',
        },
      },
      null,
      2,
    ),
  );
  const env = {
    ...options.env,
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    XDG_STATE_HOME: join(directory, 'state'),
    OPENCODE_CONFIG: config,
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
    OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
  };
  return {
    model,
    async run(cwd, prompt, session, signal, emit, execution) {
      const guidance: string[] = [];
      for (const path of [
        'docs/napplet-space.md',
        'docs/napplet-visual-design.md',
        '.agents/skills/napplet-make/SKILL.md',
        '.agents/skills/napplet-ui/SKILL.md',
        '.agents/skills/napplet-test/SKILL.md',
      ]) {
        const body = new TextDecoder().decode(await regularFile(cwd, path, 64 * 1024));
        guidance.push(`\n--- Installed project guidance: ${path} ---\n${body}`);
        emit({ type: 'activity', text: `Studio loaded ${path}` });
      }
      // Skill discovery alone did not reliably load phase guidance in the experiment.
      // Supply the actual installed files, not a second copy of the soyLI templates.
      const context =
        guidance.join('\n') + '\n--- Verified workspace map ---\n' + (await workspaceMap(cwd));
      if (Buffer.byteLength(context + prompt, 'utf8') > 110000)
        throw new DiagnosticError(
          'STUDIO_GUIDANCE',
          'Installed guidance exceeds the local context budget.',
          { recovery: 'Review the project’s installed guidance before retrying.' },
        );
      let reportedError: unknown;
      if (options.browserBuild && !execution?.check)
        throw new DiagnosticError('STUDIO_BROWSER_TOOL', 'The browser check tool is unavailable.', {
          recovery: 'Restart Studio with the matching worker version, or use native checks.',
        });
      const checker = execution?.check ? await agentCheckTool(execution.check) : undefined;
      try {
        if (checker) {
          const configured = await Bun.file(config).json();
          configured.mcp = { studio: checker.config };
          configured.permission.studio_check = 'allow';
          await writeFile(config, JSON.stringify(configured), { mode: 0o600 });
        }
        await run(
          [
            executable,
            '--pure',
            'run',
            '--format',
            'json',
            '--thinking',
            '--model',
            model,
            ...(session ? ['--session', session] : []),
            context +
              '\n\n--- Studio task (tooling/lifecycle overrides above guidance) ---\n' +
              prompt,
          ],
          {
            cwd,
            env,
            signal,
            operation: 'OpenCode inference',
            timeoutMs: inferenceTimeoutMs,
            stdoutDiagnostic: false,
            recovery:
              'The edited files and agent session are saved. Run checks or send a follow-up to continue.',
            scrub: (text) => (key ? text.replaceAll(key, '[provider credential redacted]') : text),
            onLine: (line) => {
              try {
                for (const event of agentEvents(line)) emit(event);
              } catch (error) {
                reportedError = error;
              }
            },
          },
        );
        if (reportedError) throw reportedError;
      } catch (error) {
        // Structured provider errors carry the useful cause; stdout is intentionally omitted.
        throw reportedError ?? error;
      } finally {
        await checker?.close();
      }
    },
  };
}

export const taskInstructions = `You are working in an existing soyLI project. Do not re-scaffold, use Paja or the standalone napplet CLI, or reinstall skills.
Before editing read AGENTS.md, docs/napplet-space.md and docs/napplet-visual-design.md. Load napplet-make and napplet-ui; load napplet-test before verification. Use installed SDK and project structure.
Implement the user's requested experience and its own visual language. Make a small playable version first, check it, then improve it. Choose a direction promptly; do not spend the run comparing ideas or repeatedly reviewing code by eye. Use compiler diagnostics to resolve type uncertainty. Maintain usable pointer, touch and keyboard controls at 200x160, 320x560 and desktop sizes. Preserve upstream attribution on remixes.
You may edit application source, styles, napplet.json metadata, README and tests of your own in src. Do not change dependency manifests/locks, build configuration, installed guidance or existing tests to make checks pass. No publishing, accounts, pushing, commits or new dependencies.
Use soyli run verify, soyli check and soyli run test:conformance. Repair failures rather than weakening checks. The controller independently repeats verification and owns previews: do not start a dev server.
Focus on the requested playable experience. Leave promotional media and recording configuration alone unless the creator explicitly asks for them. The Publish panel handles release preparation separately; never publish or change accounts.
Use read, glob and grep for project inspection. Keep searches inside this workspace; do not search the creator's home, other drafts or installed CLI binaries. Shell access is limited to inspection and the check commands above; it cannot install packages or start services. Loaded guidance is already in your context; read additional references only when needed for the current feature. You have 10 minutes per inference run; finish a checked playable slice before polishing optional extras.
Give occasional short progress summaries describing the action and its result, without exposing private reasoning. Finish with a concise description of the working features and any limitations. Do not claim skipped checks passed. If the budget ends, explain what remains.\n\nCreator request:\n`;
