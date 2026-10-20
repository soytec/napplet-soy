/** Opt-in Linux Docker acceptance. Scripted inference only: no provider keys or public events. */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { ContainerJobs, type JobFiles } from '../apps/studio/hosting/container';
import { inferenceSocket } from '../apps/studio/hosting/inference';
import { buildSocket } from '../apps/studio/hosting/build-socket';

const [image, profile = 'legacy-x64'] = process.argv.slice(2);
if (
  process.platform !== 'linux' ||
  !/^sha256:[a-f0-9]{64}$/.test(image ?? '') ||
  !['standard', 'legacy-x64'].includes(profile)
)
  throw new Error(
    'Usage on Linux: bun scripts/studio-hosted-acceptance.ts sha256:<image> [standard|legacy-x64]',
  );
const jobs = new ContainerJobs(image, undefined, profile as 'standard' | 'legacy-x64');
const signal = AbortSignal.timeout(12 * 60 * 1000);
const options = { signal, operation: 'hosted worker acceptance' };
const seed = await jobs.run(
  {},
  [
    '/bin/bash',
    '-ec',
    'tar --exclude=node_modules --exclude=.git -C /opt/profile -cf - . | tar -xf -',
  ],
  options,
);
assert(!seed.failure);
const config = JSON.parse(Buffer.from(seed.files['napplet.json'], 'base64').toString());
config.preview = {
  delayMs: 500,
  recording: {
    durationMs: 2000,
    startMs: 0,
    actions: [{ atMs: 100, type: 'keyDown', key: 'Space' }],
  },
};
seed.files['napplet.json'] = Buffer.from(JSON.stringify(config)).toString('base64');
let files = seed.files;
for (const browserBuild of [false, true]) {
  let calls = 0,
    stage = 0,
    sawFailure = false,
    sawSuccess = false,
    sawGuidance = false,
    browserChecks = 0;
  const events: { type: string; text?: string }[] = [];
  const steps: Array<[string, Record<string, unknown>]> = [
    ['skill', { name: 'napplet-make' }],
    [
      'write',
      {
        filePath: '/workspace/src/hosted-probe.ts',
        content: 'export const answer: number = "broken";\n',
      },
    ],
    [
      browserBuild ? 'studio_check' : 'bash',
      browserBuild
        ? {}
        : { command: 'soyli run verify', description: 'Check the deliberate error' },
    ],
    [
      'write',
      {
        filePath: '/workspace/src/hosted-probe.ts',
        content: 'export const answer: number = 42;\n',
      },
    ],
    [
      browserBuild ? 'studio_check' : 'bash',
      browserBuild ? {} : { command: 'soyli run verify', description: 'Verify repaired source' },
    ],
  ];
  const upstream = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls++;
    const messages = JSON.stringify(body.messages);
    sawFailure ||= messages.includes('TS2322');
    sawSuccess ||=
      messages.includes('built in') || messages.includes('Browser fixture check passed');
    sawGuidance ||= messages.includes(
      'Installed project guidance: .agents/skills/napplet-make/SKILL.md',
    );
    const step = body.tools?.some((t: any) => t.function?.name === 'write')
      ? steps[stage++]
      : undefined;
    if (step)
      assert(
        body.tools.some((t: any) => t.function?.name === step[0]),
        'Missing agent tool: ' + step[0],
      );
    console.log(
      JSON.stringify({
        profile,
        browserBuild,
        calls,
        tool: step?.[0],
        sawFailure,
        sawSuccess,
        sawGuidance,
      }),
    );
    const delta = step
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_fixture_' + stage,
              type: 'function',
              function: { name: step[0], arguments: JSON.stringify(step[1]) },
            },
          ],
        }
      : { role: 'assistant', content: 'Scripted acceptance complete.' };
    const chunk = (delta: unknown, finish_reason: string | null) =>
      'data: ' +
      JSON.stringify({
        id: 'chatcmpl-fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      }) +
      '\n\n';
    return new Response(
      chunk(delta, null) + chunk({}, step ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const result = await jobs.run(files, ['bun', '--no-env-file', '/opt/studio/job-entry.js'], {
    ...options,
    context: {
      operation: 'agent',
      browserBuild,
      prompt: 'Run the scripted acceptance checks. Do not publish.',
      connection: { provider: 'deepseek', model: 'deepseek-flash', steps: 10 },
    },
    prepare: async (directory) => {
      const inference = await inferenceSocket(
        join(directory, 'inference.sock'),
        {
          name: 'Fixture',
          provider: 'deepseek',
          endpoint: 'https://api.deepseek.com/v1',
          model: 'deepseek-flash',
          steps: 10,
          key: 'fixture-not-a-provider-key',
        },
        signal,
        upstream,
      );
      const bridge = browserBuild
        ? await buildSocket(join(directory, 'build.sock'), signal, async (snapshot: JobFiles) => {
            browserChecks++;
            // Checks the real IPC export/repair cycle; browser compiler correctness has a separate browser gate.
            const source = Buffer.from(snapshot['src/hosted-probe.ts'], 'base64').toString();
            return source.includes('"broken"')
              ? 'TS2322: Type string is not assignable to number.'
              : 'Browser fixture check passed';
          })
        : undefined;
      return async () => {
        await bridge?.close();
        await inference.close();
      };
    },
    onLine: (line) => {
      if (line.startsWith('SOY_AGENT:')) events.push(JSON.parse(line.slice(10)));
    },
  });
  if (result.failure) throw result.failure;
  assert(sawGuidance, 'Agent must load soyLI guidance');
  assert(sawFailure && sawSuccess, 'Agent must see failing and repaired check results');
  assert(
    events.some((e) => e.text?.includes('napplet-make') && e.text.includes('completed')),
    'Skill tool must complete',
  );
  assert(
    Buffer.from(result.files['src/hosted-probe.ts'], 'base64').toString().includes('number = 42'),
  );
  if (browserBuild) assert.equal(browserChecks, 2);
  else assert(result.files['dist/index.html'], 'Server build must export HTML');
  files = result.files;
  console.log('ACCEPTANCE_AGENT_' + (browserBuild ? 'BROWSER_BRIDGE' : 'SERVER') + '_PASSED');
}
// Provider truncation is a successful HTTP stream and OpenCode may exit 0.
// Exercise the real installed adapter, not just the JSONL parser.
const truncated = await jobs.run(files, ['bun', '--no-env-file', '/opt/studio/job-entry.js'], {
  ...options,
  context: {
    operation: 'agent',
    prompt: 'Implement the next feature. Do not publish.',
    connection: { provider: 'deepseek', model: 'deepseek-flash', steps: 10 },
  },
  prepare: async (directory) => {
    const broker = await inferenceSocket(
      join(directory, 'inference.sock'),
      {
        name: 'Fixture',
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-flash',
        steps: 10,
        key: 'fixture-not-a-provider-key',
      },
      signal,
      async (_url, init) => {
        const body = JSON.parse(String(init.body));
        assert(body.max_tokens > 8192, 'The broker must not shrink the model output budget');
        const chunk = (delta: unknown, finish_reason: string | null) =>
          'data: ' +
          JSON.stringify({
            id: 'chatcmpl-length',
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          '\n\n';
        const agent = !!body.tools?.length;
        return new Response(
          chunk(
            agent
              ? { reasoning_content: 'Planning interrupted before implementation.' }
              : { content: 'Fixture title' },
            null,
          ) +
            chunk({}, agent ? 'length' : 'stop') +
            'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    );
    return () => broker.close();
  },
});
assert(truncated.failure, 'A truncated model turn must not report success');
assert(truncated.failure.context.detail?.includes('STUDIO_AGENT_INCOMPLETE'));
assert(truncated.failure.context.detail?.includes('length'));
assert(truncated.files['src/hosted-probe.ts'], 'Existing source survives the failed turn');
console.log('ACCEPTANCE_TRUNCATED_TURN_PASSED');
for (const portrait of [false, true]) {
  const result = await jobs.run(files, ['/opt/studio/capture'], {
    ...options,
    context: { cover: true, video: true, portrait },
  });
  if (result.failure) throw result.failure;
  assert(Buffer.byteLength(result.files['.studio-result/cover.png'], 'base64') > 1000);
  assert(Buffer.byteLength(result.files['.studio-result/clip.webm'], 'base64') > 1000);
  console.log('ACCEPTANCE_CAPTURE_' + (portrait ? 'PORTRAIT' : 'DESKTOP') + '_PASSED');
}
const failure = await jobs.run(
  files,
  [
    'bun',
    '-e',
    'await Bun.write("src/recovered.ts", "export const recovered = true;"); console.error("fixture deliberate failure"); process.exit(2)',
  ],
  options,
);
assert.equal(failure.failure?.context.exitCode, 2);
assert(failure.files['src/recovered.ts']);
console.log('ACCEPTANCE_FAILURE_RECOVERY_PASSED');
const stop = new AbortController();
const running = jobs.run({}, ['bun', '-e', 'setInterval(() => {}, 1000)'], {
  ...options,
  signal: stop.signal,
});
setTimeout(() => stop.abort(), 1000);
await assert.rejects(running);
const next = await jobs.run({}, ['bun', '-e', 'console.log("next job works")'], options);
assert(!next.failure);
console.log('ACCEPTANCE_CANCELLATION_AND_REUSE_PASSED');
