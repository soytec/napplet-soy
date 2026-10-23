import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Studio, type StudioOptions } from './studio';
import { StudioStore } from './store';
import { cleanEnvironment, agentEvents, type Agent } from './agent';
import { run } from './process';
import { serveStudio } from './server';
import { diagnose, DiagnosticError, formatDiagnostic } from '../../packages/diagnostics/src';
import { startPreviewServer } from '../cli/src/preview/server';
import { pathToFileURL } from 'node:url';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { reasoningLimits } from './types';
import { writeBinding } from '../../packages/publish/src/binding';
import { dispatchStudio } from './dispatch';
import catalog from '../../packages/backend/data/catalog.json';

const cleanup: Array<() => Promise<unknown>> = [];

test('an existing remix remembers its imported manifest before inference without promoting a draft preview', async () => {
  let calls = 0;
  const revision = 'a'.repeat(64);
  const { studio, root, options } = await fixture({
    model: 'fixture',
    async run() {
      calls++;
    },
  });
  const id = await studio.create('Original', 'Make a game');
  await settled(studio);
  const p = studio.project(id);
  p.source = 'https://napplet.soy/n/latest-address';
  await writeBinding(join(root, 'projects', id, 'workspace'), {
    version: 1,
    project: { remix: { revision } },
  });
  // This represents an existing saved remix from before the preview metadata field.
  await studio.close();
  const store = new StudioStore(root);
  store.save([p]);
  store.close();
  const restored = new Studio(options);
  await restored.initialize();
  cleanup.push(() => restored.close());
  const loaded = (await restored.state()).projects[0];
  expect(loaded.sourceRevision).toBe(revision);
  expect(loaded.preview).toBeUndefined();
  expect(loaded.checkpoints).toHaveLength(0);
  expect(calls).toBe(1);
});

test('merge dispatch requires explicit confirmation and refuses non-author reviews without inference', async () => {
  let calls = 0;
  const { studio } = await fixture({
    model: 'fixture',
    async run() {
      calls++;
    },
  });
  const session = studio.signing.connect(getPublicKey(generateSecretKey()));
  const response = await dispatchStudio(studio, 'merge-reviews', {
    session: session.id,
    review: { proposal: 'a'.repeat(64), revision: 'a'.repeat(64), manifest: catalog[0].current },
  });
  const { id } = await response.json();
  const project = await settled(studio);
  expect(project.id).toBe(id);
  expect(project.phase).toBe('failed');
  expect(project.error?.code).toBe('STUDIO_MERGE_REVIEW');
  expect(project.error?.message).toContain('original napplet author');
  expect(project.preview).toBeUndefined();
  expect(calls).toBe(0);
  const confirmSession = studio.signing.connect(getPublicKey(generateSecretKey()));
  await expect(
    dispatchStudio(studio, `projects/${id}/merge-proposal`, {
      session: confirmSession.id,
      review: crypto.randomUUID(),
      confirmed: false,
    }),
  ).rejects.toThrow();
  await expect(
    dispatchStudio(studio, `projects/${id}/merge-proposal`, {
      session: confirmSession.id,
      review: crypto.randomUUID(),
      confirmed: true,
    }),
  ).rejects.toThrow('Prepare and play');
  await expect(studio.send(id, 'Edit this review')).rejects.toMatchObject({
    code: 'STUDIO_MERGE_PENDING',
  });
  await expect(studio.check(id)).rejects.toMatchObject({ code: 'STUDIO_MERGE_PENDING' });
});

test('a recording preparation prompt mentioning Publish reaches the maker', async () => {
  const prompts: string[] = [];
  const { studio } = await fixture({
    model: 'fixture',
    async run(_cwd, prompt) {
      prompts.push(prompt);
    },
  });
  const id = await studio.create('Recording', 'Create a toy');
  await settled(studio);
  const prompt =
    'Prepare a gameplay recording plan for this app. Inspect its actual start screen and controls. Configure preview.recording in napplet.json with an early start action and timed inputs that demonstrate the core interaction, not just the menu. Keep the app working. Do not publish or claim a clip was captured. I will use Publish to capture and watch the result.';
  await studio.send(id, prompt);
  const project = await settled(studio);
  expect(prompts.some((request) => request.endsWith(prompt))).toBe(true);
  expect(project.publicationIntent).toBeUndefined();
});

test('publication follow-up opens only after the maker and checks finish, never after failure', async () => {
  let release: () => void = () => {};
  let paused: Promise<void> | undefined;
  let fail = false;
  const { studio } = await fixture({
    model: 'fixture',
    async run(directory) {
      if (paused) await paused;
      if (fail) throw new Error('Maker failed');
      await writeFile(join(directory, 'src/main.ts'), 'working toy');
    },
  });
  const id = await studio.create('Recording', 'Create a toy');
  await settled(studio);
  await studio.send(id, 'Lets publish this');
  expect((await studio.state()).projects[0].publicationIntent).toBeTruthy();
  const server = await serveStudio(studio, 0);
  cleanup.push(async () => {
    await server.stop(true);
  });
  const { token } = await (await fetch(new URL('/api/session', server.url))).json();
  const sendFollowup = (prompt: string) =>
    fetch(new URL(`/api/projects/${id}/messages`, server.url), {
      method: 'POST',
      headers: {
        Origin: server.url.origin,
        'X-Studio-Token': token,
        'X-Request-ID': crypto.randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, reviewPublication: true }),
    });
  paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  expect((await sendFollowup('Prepare gameplay. Do not publish.')).ok).toBe(true);
  expect((await studio.state()).projects[0].publicationIntent).toBeUndefined();
  expect((await studio.state()).busy).toBe(id);
  release();
  const ready = await settled(studio);
  expect(ready.phase).toBe('ready');
  expect(ready.publicationIntent).toBeTruthy();
  expect(ready.messages.at(-1)?.text).toContain('No new clip has been captured yet');
  fail = true;
  expect((await sendFollowup('Prepare another recording.')).ok).toBe(true);
  const failed = await settled(studio);
  expect(failed.phase).toBe('failed');
  expect(failed.publicationIntent).toBeUndefined();
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
test('a successful agent exit without implementing the new app never delivers the starter', async () => {
  let edit = false,
    calls = 0;
  const { studio, root } = await fixture({
    model: 'fixture',
    async run(directory, _prompt, _session, _signal, emit) {
      calls++;
      emit({ type: 'text', text: edit ? 'Made the game.' : 'Here is the plan.' });
      if (edit) await writeFile(join(directory, 'src/main.ts'), 'working game');
      else await writeFile(join(directory, 'README.md'), 'Metadata edits alone are not a game.');
    },
  });
  const id = await studio.create('Physics puzzle', 'Make a physics puzzle game');
  const unchanged = await settled(studio);
  expect(unchanged.phase).toBe('failed');
  expect(unchanged.error?.code).toBe('STUDIO_NO_CHANGES');
  expect(unchanged.preview).toBeUndefined();
  expect(unchanged.checkpoints).toHaveLength(0);
  expect(calls).toBe(1);
  expect(await Bun.file(join(root, 'projects', id, 'workspace/dist/index.html')).exists()).toBe(
    false,
  );
  edit = true;
  await studio.send(id, 'Implement it');
  expect((await settled(studio)).phase).toBe('ready');
  edit = false;
  await studio.send(id, 'Explain the controls without changing the code');
  expect((await settled(studio)).phase).toBe('ready');
  expect(calls).toBe(3);
});
test('an incomplete model turn retains edits and the previous preview without buying a repair', async () => {
  let calls = 0;
  const { studio, root } = await fixture({
    model: 'fixture',
    async run(directory, _prompt, _session, _signal, emit) {
      calls++;
      await writeFile(
        join(directory, 'src/main.ts'),
        calls === 1 ? 'working toy' : 'partial change',
      );
      emit({ type: 'usage', cost: 0.01, finishReason: calls === 1 ? 'stop' : 'length' });
      if (calls > 1)
        throw new DiagnosticError(
          'STUDIO_AGENT_INCOMPLETE',
          'The model reached its response limit.',
        );
    },
  });
  const id = await studio.create('Toy', 'Make it');
  const original = await settled(studio);
  await studio.send(id, 'Improve it');
  const incomplete = await settled(studio);
  expect(incomplete.phase).toBe('failed');
  expect(incomplete.error?.code).toBe('STUDIO_AGENT_INCOMPLETE');
  expect(incomplete.agentFinishReason).toBe('length');
  expect(incomplete.preview).toBe(original.preview);
  expect(incomplete.checkpoints).toHaveLength(1);
  expect(calls).toBe(2);
  expect(await readFile(join(root, 'projects', id, 'workspace/src/main.ts'), 'utf8')).toBe(
    'partial change',
  );
});
async function fixture(agent: Agent, extra: Partial<StudioOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'soy-studio-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const tool = join(root, 'soyli.ts');
  await writeFile(
    tool,
    `
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const [command, arg] = process.argv.slice(2);
if(command === 'new') {
  await mkdir(join(arg,'src'),{recursive:true});
  await writeFile(join(arg,'napplet.json'), JSON.stringify({schema:'space-local-project/v1',name:'test',template:'boilerplate',entry:'dist/index.html',previewId:crypto.randomUUID(),identifier:'test',requires:[],relays:[],servers:[],license:'MIT',topics:[]}));
  await writeFile(join(arg,'package.json'), '{}');
  await writeFile(join(arg,'.gitignore'), 'dist/\\n');
  await writeFile(join(arg,'src/main.ts'), 'baseline');
  for(const args of [['init'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgsign=false','commit','-m','scaffold']]) {
    const child=Bun.spawn(['git','-c','core.hooksPath=/dev/null',...args],{cwd:arg,stdout:'ignore',stderr:'ignore'});
    if(await child.exited) process.exit(3);
  }
} else if(command !== 'setup') {
  const source=await readFile('src/main.ts','utf8');
  if(source.includes('BROKEN')) { console.error('TS2304: Cannot find name missingOrb'); process.exit(1); }
  await mkdir('dist',{recursive:true});
  await writeFile('dist/index.html','<!doctype html><html><body>'+source+'</body></html>');
  if(command === 'run' && arg === 'test:conformance') console.error('5 passed; 5 skipped (manifest not supplied)');
  else console.log('passed');
}
`,
  );
  const preview = async (directory: string) => ({
    url: 'http://127.0.0.1:12345/' + directory.split('/').pop(),
    stop() {},
  });
  const options = {
    directory: root,
    agent,
    soyli: [process.execPath, tool],
    env: cleanEnvironment(),
    preview,
    ...extra,
  };
  const studio = new Studio(options);
  await studio.initialize();
  cleanup.push(() => studio.close());
  return { root, studio, options };
}
test('isolated setup failure never falls back to local project execution or starts inference', async () => {
  let agentCalls = 0;
  const commands: string[][] = [];
  const { studio, root } = await fixture(
    {
      model: 'fixture',
      async run() {
        agentCalls++;
      },
    },
    {
      projectCommand: async (_root, args) => {
        commands.push(args);
        throw new Error('STUDIO_PROFILE: unsupported lockfile');
      },
    },
  );
  const id = await studio.create('Isolated', 'Create a toy');
  const result = await settled(studio);
  expect(result.phase).toBe('failed');
  expect(result.error?.message).toContain('unsupported lockfile');
  expect(commands).toEqual([['setup']]);
  expect(agentCalls).toBe(0);
  expect(await Bun.file(join(root, 'projects', id, 'workspace/dist/index.html')).exists()).toBe(
    false,
  );
});
async function settled(studio: Studio) {
  const until = Date.now() + 10000;
  while ((await studio.state()).busy) {
    if (Date.now() > until) throw new Error('Studio did not settle');
    await Bun.sleep(20);
  }
  return (await studio.state()).projects[0];
}

test('real process failure is repaired, skipped checks stay visible, and reload resumes the same agent session', async () => {
  const sessions: Array<string | undefined> = [];
  let calls = 0;
  const agent: Agent = {
    model: 'fixture/local',
    async run(directory, prompt, session, signal, emit) {
      sessions.push(session);
      calls++;
      emit({ type: 'session', id: 'ses_fixture' });
      emit({ type: 'text', text: calls === 1 ? 'Building the toy.' : 'Repaired.' });
      if (calls === 2) expect(prompt).toContain('TS2304');
      await writeFile(join(directory, 'src/main.ts'), calls === 1 ? 'BROKEN' : `working-${calls}`);
    },
  };
  const { studio, options, root } = await fixture(agent);
  const id = await studio.create('Toy', 'Make a toy');
  const result = await settled(studio);
  expect(result.phase).toBe('ready');
  expect(calls).toBe(2);
  expect(result.checks[2].detail).toContain('5 skipped');
  expect(sessions).toEqual([undefined, 'ses_fixture']);
  expect(result.messages.some((m) => m.text.includes('one repair pass'))).toBe(true);
  const saved = await readFile(
    join(root, 'projects', id, 'previews', result.preview!, 'dist/index.html'),
    'utf8',
  );
  await studio.close();
  let opened = 0;
  const originalPreview = options.preview;
  options.preview = async (directory: string) => {
    opened++;
    await Bun.sleep(20);
    return originalPreview(directory);
  };
  const reloaded = new Studio(options);
  await reloaded.initialize();
  cleanup.push(() => reloaded.close());
  expect((await reloaded.state()).projects[0].messages).toEqual(result.messages);
  await Promise.all([reloaded.preview(id), reloaded.preview(id), reloaded.preview(id)]);
  expect(opened).toBe(1);
  await reloaded.send(id, 'Now change the color');
  await settled(reloaded);
  expect(sessions.at(-1)).toBe('ses_fixture');
  expect(
    await readFile(
      join(root, 'projects', id, 'previews', result.preview!, 'dist/index.html'),
      'utf8',
    ),
  ).toBe(saved);
}, 20000);

test('reasoning is bounded, replaces repeated parts, survives reload and resets for the next run', async () => {
  let calls = 0;
  const agent: Agent = {
    model: 'fixture/local',
    async run(directory, _prompt, _session, _signal, emit) {
      calls++;
      if (calls === 1) {
        for (let i = 0; i < reasoningLimits.blocks + 3; i++)
          emit({ type: 'reasoning', id: `part-${i}`, text: `Inspect source ${i}.` });
        emit({
          type: 'reasoning',
          id: `part-${reasoningLimits.blocks + 2}`,
          text: 'Source inspected.',
        });
        emit({ type: 'activity', text: 'edit · completed' });
      } else emit({ type: 'reasoning', id: 'next-part', text: 'Verify the updated controls.' });
      await writeFile(join(directory, 'src/main.ts'), `working-${calls}`);
    },
  };
  const { studio, options, root } = await fixture(agent);
  const id = await studio.create('Reasoning toy', 'Make a toy');
  const first = await settled(studio);
  expect(first.reasoning).toHaveLength(reasoningLimits.blocks);
  expect(first.reasoning?.[0].text).toBe('Inspect source 3.');
  expect(first.reasoning?.at(-1)?.text).toBe('Source inspected.');
  expect(first.reasoningOlder).toBe(true);
  const thought = first.workshop!.findIndex((e) => e.id === `part-${reasoningLimits.blocks + 2}`);
  expect(first.workshop![thought + 1]).toMatchObject({
    type: 'activity',
    text: 'edit · completed',
  });
  expect(first.messages.every((m) => !m.text.includes('Source inspected.'))).toBe(true);
  const files = await run(['git', 'ls-files'], {
    cwd: join(root, 'projects', id, 'workspace'),
    env: cleanEnvironment(),
    signal: new AbortController().signal,
    operation: 'Inspect fixture source',
  });
  expect(files).not.toContain('reasoning');
  await studio.close();
  const reloaded = new Studio(options);
  await reloaded.initialize();
  cleanup.push(() => reloaded.close());
  expect((await reloaded.state()).projects[0].reasoning).toEqual(first.reasoning);
  expect((await reloaded.state()).projects[0].workshop).toEqual(first.workshop);
  await reloaded.send(id, 'Change the controls');
  const second = await settled(reloaded);
  expect(second.reasoning).toEqual([
    {
      id: 'next-part',
      text: 'Verify the updated controls.',
      truncated: false,
    },
  ]);
  expect(second.reasoningOlder).toBe(false);
  expect(second.workshop!.some((e) => e.id === `part-${reasoningLimits.blocks + 2}`)).toBe(false);
}, 20000);

test('failed turns keep the passing preview; restoring backs up changes and preserves Git ancestry', async () => {
  let broken = false;
  const agent: Agent = {
    model: 'fixture/local',
    async run(directory) {
      await writeFile(join(directory, 'src/main.ts'), broken ? 'BROKEN' : 'working');
    },
  };
  const { studio, root } = await fixture(agent);
  const id = await studio.create('Toy', 'Make it');
  const first = await settled(studio);
  const commit = first.preview!;
  broken = true;
  await studio.send(id, 'Introduce a mistake');
  const failed = await settled(studio);
  expect(failed.phase).toBe('failed');
  expect(failed.preview).toBe(commit);
  expect(failed.error?.details?.join('\n')).toContain('TS2304');
  await studio.restore(id, commit);
  const restored = await settled(studio);
  expect(restored.phase).toBe('ready');
  expect(restored.checkpoints).toHaveLength(2);
  expect(await readFile(join(root, 'projects', id, 'workspace/src/main.ts'), 'utf8')).toBe(
    'working',
  );
  const history = await run(['git', 'log', '--oneline'], {
    cwd: studio.workspace(id),
    env: cleanEnvironment(),
    signal: AbortSignal.timeout(2000),
    operation: 'test history',
  });
  expect(history).toContain('Backup before restoring preview');
  expect(history).toContain('scaffold');
}, 20000);

test('changing a protected check cannot be blessed by retrying another turn', async () => {
  const agent: Agent = {
    model: 'fixture/local',
    async run(directory) {
      await writeFile(join(directory, 'package.json'), '{"scripts":{"verify":"true"}}');
    },
  };
  const { studio } = await fixture(agent);
  const id = await studio.create('Toy', 'Make it');
  expect((await settled(studio)).error?.code).toBe('STUDIO_GUARDRAIL');
  await studio.send(id, 'Continue');
  expect((await settled(studio)).error?.code).toBe('STUDIO_GUARDRAIL');
  expect((await studio.state()).projects[0].preview).toBeUndefined();
}, 15000);

test('cancellation kills owned process descendants and retains a resumable draft', async () => {
  let pidFile = '';
  const agent: Agent = {
    model: 'fixture/local',
    async run(directory, prompt, session, signal, emit) {
      emit({ type: 'session', id: 'ses_stopping' });
      pidFile = join(directory, 'child-pids');
      await run(
        [
          process.execPath,
          '-e',
          `const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)']); await Bun.write(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`,
        ],
        { cwd: directory, env: cleanEnvironment(), signal, operation: 'fixture agent' },
      );
    },
  };
  const { studio } = await fixture(agent);
  const id = await studio.create('Toy', 'Wait');
  const deadline = Date.now() + 5000;
  while (!pidFile || !(await Bun.file(pidFile).exists())) {
    if (Date.now() > deadline) throw new Error('No child');
    await Bun.sleep(20);
  }
  const pids: number[] = await Bun.file(pidFile).json();
  await studio.stop(id);
  expect((await studio.state()).projects[0].phase).toBe('stopped');
  expect((await studio.state()).projects[0].session).toBe('ses_stopping');
  await Bun.sleep(100);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}, 10000);

test('inference timeout verifies saved work without another paid turn and retains continuation', async () => {
  let calls = 0;
  const { studio, root } = await fixture({
    model: 'fixture',
    async run(directory, _prompt, _session, signal, emit) {
      calls++;
      emit({ type: 'session', id: 'ses_timeout' });
      await writeFile(join(directory, 'src/main.ts'), 'working after cutoff');
      await run([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
        cwd: directory,
        env: cleanEnvironment(),
        signal,
        operation: 'OpenCode inference',
        timeoutMs: 150,
      });
    },
  });
  const id = await studio.create('Timed out toy', 'Make it');
  const result = await settled(studio);
  expect(result.phase).toBe('ready');
  expect(result.preview).toBeTruthy();
  expect(result.timeLimitReached).toBe(true);
  expect(result.session).toBe('ses_timeout');
  expect(calls).toBe(1);
  expect(result.messages.some((m) => /time limit/i.test(m.text))).toBe(true);
  expect(
    await readFile(
      join(root, 'projects', id, 'previews', result.preview!, 'dist/index.html'),
      'utf8',
    ),
  ).toContain('working after cutoff');
}, 15000);

test('inference stream never becomes an error diagnostic; tool stderr still explains failure', async () => {
  for (const stderr of ['', 'Provider unavailable: HTTP 503']) {
    let failure: unknown;
    try {
      await run(
        [
          process.execPath,
          '-e',
          `console.log(JSON.stringify({type:'reasoning',part:{text:'PRIVATE_STREAM_MARKER'}}));console.error(${JSON.stringify(stderr)});process.exit(1);`,
        ],
        {
          cwd: process.cwd(),
          env: cleanEnvironment(),
          signal: new AbortController().signal,
          operation: 'OpenCode inference',
          stdoutDiagnostic: false,
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeTruthy();
    const message = formatDiagnostic(diagnose(failure));
    expect(message).not.toContain('PRIVATE_STREAM_MARKER');
    expect(message).toContain('Exit status: 1');
    if (stderr) expect(message).toContain(stderr);
  }
});

test('timeout before edits is not delivered as a starter; failed recovery keeps the old preview and never buys a repair', async () => {
  let mode = 'empty',
    calls = 0;
  const { studio } = await fixture({
    model: 'fixture',
    async run(directory, _prompt, _session, signal) {
      calls++;
      if (mode === 'working') {
        await writeFile(join(directory, 'src/main.ts'), 'working');
        return;
      }
      if (mode === 'broken') await writeFile(join(directory, 'src/main.ts'), 'BROKEN');
      if (mode === 'protected') await writeFile(join(directory, 'package.json'), '{"scripts":{}}');
      await run([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
        cwd: directory,
        env: cleanEnvironment(),
        signal,
        operation: 'OpenCode inference',
        timeoutMs: 100,
      });
    },
  });
  const id = await studio.create('Empty', 'Make it');
  const empty = await settled(studio);
  expect(empty.phase).toBe('failed');
  expect(empty.error?.code).toBe('STUDIO_TIMEOUT');
  expect(empty.preview).toBeUndefined();
  mode = 'working';
  await studio.send(id, 'Try again');
  const passing = await settled(studio);
  expect(passing.phase).toBe('ready');
  mode = 'broken';
  await studio.send(id, 'Change it');
  const broken = await settled(studio);
  expect(broken.phase).toBe('failed');
  expect(broken.preview).toBe(passing.preview);
  expect(broken.checks[0].detail).toContain('TS2304');
  expect(calls).toBe(3);
  mode = 'protected';
  await studio.send(id, 'Try again');
  const guarded = await settled(studio);
  expect(guarded.error?.code).toBe('STUDIO_GUARDRAIL');
  expect(guarded.preview).toBe(passing.preview);
  expect(calls).toBe(4);
}, 15000);

test('loopback HTTP requires the page token and same origin; duplicate actions do not start another draft', async () => {
  const agent: Agent = { model: 'fixture/local', async run() {} };
  const { studio } = await fixture(agent);
  const server = await serveStudio(studio, 0);
  cleanup.push(async () => {
    await server.stop(true);
  });
  const origin = server.url.origin;
  const { token } = await (await fetch(origin + '/api/session')).json();
  const shell = 'http://127.0.0.1:3000';
  const handshake = await fetch(origin + '/api/session', {
    headers: { Origin: shell, 'Sec-Fetch-Site': 'cross-site' },
  });
  expect(handshake.status).toBe(200);
  expect(handshake.headers.get('Access-Control-Allow-Origin')).toBe(shell);
  expect((await handshake.json()).token).toBe(token);
  const preflight = await fetch(origin + '/api/state', {
    method: 'OPTIONS',
    headers: {
      Origin: shell,
      'Access-Control-Request-Headers': 'X-Studio-Token',
      'Access-Control-Request-Method': 'GET',
    },
  });
  expect(preflight.status).toBe(204);
  expect(
    (await fetch(origin + '/api/state', { headers: { Origin: shell, 'X-Studio-Token': token } }))
      .status,
  ).toBe(200);
  for (const untrusted of ['null', 'https://evil.example', 'http://127.0.0.1:6666']) {
    expect((await fetch(origin + '/api/session', { headers: { Origin: untrusted } })).status).toBe(
      403,
    );
  }
  const beforeNavigation = await studio.state();
  for (const path of [
    '/studio',
    '/create?source=https%3A%2F%2Fnapplet.soy%2Fr%2F' + 'a'.repeat(64),
    '/studio/0602a60b-df41-4600-aed5-84bd70529892',
  ]) {
    const response = await fetch(origin + path, {
      redirect: 'manual',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
      },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('http://127.0.0.1:3000/studio');
  }
  expect(await studio.state()).toEqual(beforeNavigation);
  expect(
    (await fetch(origin + '/studio', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
  ).toBe(403);
  expect(
    (
      await fetch(origin + '/api/state', {
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Dest': 'document',
          'X-Studio-Token': token,
        },
      })
    ).status,
  ).toBe(403);
  expect((await fetch(origin + '/api/state')).status).toBe(403);
  expect(
    (
      await fetch(origin + '/api/state', {
        headers: { Origin: 'https://unrelated.example', 'X-Studio-Token': token },
      })
    ).status,
  ).toBe(403);
  const headers = {
    Origin: origin,
    'X-Studio-Token': token,
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
  };
  const post = () =>
    fetch(origin + '/api/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Test', prompt: 'Build' }),
    });
  const first = await (await post()).json();
  const again = await (await post()).json();
  expect(first.id).toBe(again.id);
  expect((await studio.state()).projects).toHaveLength(1);
  const traversal = await fetch(
    origin + `/api/projects/${first.id}/file?path=../../agent/auth.json`,
    { headers: { 'X-Studio-Token': token } },
  );
  expect(traversal.status).toBe(400);
  await settled(studio);
  const send = (path: string, body: unknown) =>
    fetch(origin + '/api/' + path, {
      method: 'POST',
      headers: { ...headers, 'X-Request-ID': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
  const session = await (
    await send('signers', { pubkey: getPublicKey(generateSecretKey()) })
  ).json();
  const publish = { session: session.id, review: crypto.randomUUID(), resume: false };
  expect((await send(`projects/${first.id}/publish`, publish)).status).toBe(400);
  const missingReview = await send(`projects/${first.id}/publish`, { ...publish, confirmed: true });
  expect(missingReview.status).toBe(400);
  expect(await missingReview.text()).toContain('review this release first');
  expect((await fetch(origin + `/api/signers/${session.id}`)).status).toBe(403);
  expect((await fetch(origin + `/api/projects/${first.id}/media?name=cover.png`)).status).toBe(403);
  expect(
    (await send(`signers/${session.id}`, { requestId: crypto.randomUUID(), event: {} })).status,
  ).toBe(400);
  await studio.send(first.id, 'Lets publish this');
  const intent = (await studio.state()).projects[0].publicationIntent;
  expect(intent).toBeTruthy();
  await studio.send(first.id, 'Lets publish this');
  expect((await studio.state()).projects[0].publicationIntent).not.toBe(intent);
  expect((await studio.state()).busy).toBeUndefined();
}, 15000);

test('tool failures retain exit status and useful cause without credentials', async () => {
  let caught: unknown;
  try {
    await run(
      [
        process.execPath,
        '-e',
        'console.error("Missing browser binary; authorization: Bearer do-not-leak"); process.exit(7)',
      ],
      {
        cwd: tmpdir(),
        env: cleanEnvironment(),
        signal: AbortSignal.timeout(3000),
        operation: 'check sandbox',
      },
    );
  } catch (error) {
    caught = error;
  }
  const message = formatDiagnostic(diagnose(caught));
  expect(message).toContain('Missing browser binary');
  expect(message).toContain('Exit status: 7');
  expect(message).not.toContain('do-not-leak');
  expect(cleanEnvironment().DEEPSEEK_KEY).toBeUndefined();
  expect(
    agentEvents(
      JSON.stringify({
        type: 'tool_use',
        part: {
          tool: 'bash',
          state: { status: 'completed', input: { command: 'secret command' } },
        },
      }),
    ),
  ).toEqual([{ type: 'activity', text: 'bash · completed' }]);
});

test('frozen preview refuses mutations even with its valid manager token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-frozen-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = startPreviewServer(
    pathToFileURL(root + '/'),
    0,
    false,
    { html: '<html lang="en"><header></header></html>', client: '' },
    { network: 'local', readOnly: true },
  );
  cleanup.push(async () => {
    await server.stop(true);
  });
  const origin = server.url.origin;
  const response = await fetch(origin);
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
  );
  const html = await response.text();
  const token = /name="soyli-token" content="([^"]+)"/.exec(html)![1];
  for (const route of ['/manager', '/capture', '/workshop']) {
    const response = await fetch(origin + route, {
      method: 'POST',
      headers: { Origin: origin, 'X-Soyli-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(405);
  }
});

test('restart marks an interrupted saved job stopped without spending on automatic retry', async () => {
  let calls = 0;
  const { studio, root, options } = await fixture({
    model: 'fixture/local',
    async run() {
      calls++;
    },
  });
  await studio.create('Draft', 'Make it');
  await settled(studio);
  await studio.close();
  const store = new StudioStore(root);
  const saved = store.load();
  saved[0].phase = 'editing';
  store.begin(saved, saved[0].id);
  store.close();
  const before = calls;
  const recovered = new Studio(options);
  await recovered.initialize();
  cleanup.push(() => recovered.close());
  const state = await recovered.state();
  expect(calls).toBe(before);
  expect(state.busy).toBeUndefined();
  expect(state.projects[0].phase).toBe('stopped');
  expect(state.projects[0].messages.at(-1)?.text).toContain('restarted');
});

test('asset imports are serialized with turns, validated through the shared importer, and leave the passing preview intact', async () => {
  let finish: (() => void) | undefined;
  let block = false;
  const { studio, root } = await fixture({
    model: 'fixture',
    async run(directory) {
      if (block)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      await writeFile(join(directory, 'src/main.ts'), 'working');
    },
  });
  const id = await studio.create('Asset toy', 'Build');
  const original = await settled(studio);
  const metadata = {
    id: 'palette',
    license: 'CC0',
    source: 'Original',
    storage: 'embedded' as const,
  };
  const bytes = new TextEncoder().encode('{"colors":["coral","blue"]}');
  const assets = await studio.importAsset(id, metadata, bytes);
  expect(assets[0].mime).toBe('application/json');
  expect((await studio.assetMedia(id, 'palette')).bytes).toEqual(bytes);
  expect((await studio.state()).projects[0].preview).toBe(original.preview);
  expect(
    await readFile(join(root, 'projects', id, 'workspace', 'soy-assets.js'), 'utf8'),
  ).toContain('assetUrl');
  await expect(studio.importAsset(id, { ...metadata, id: '../escape' }, bytes)).rejects.toThrow();
  await expect(
    studio.importAsset(
      id,
      { ...metadata, id: 'script' },
      new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
    ),
  ).rejects.toThrow();
  await expect(
    studio.importAsset(id, { ...metadata, id: 'large' }, new Uint8Array(10 * 1024 * 1024 + 1)),
  ).rejects.toThrow('10 MiB');
  await expect(studio.importAsset(id, metadata, bytes)).rejects.toThrow();
  block = true;
  await studio.send(id, 'Keep working');
  await expect(studio.importAsset(id, { ...metadata, id: 'another' }, bytes)).rejects.toThrow(
    'already running',
  );
  while (!finish) await Bun.sleep(10);
  finish();
  await settled(studio);
});

test('connection changes discard only the agent session, and step limits remain distinct from independent checks', async () => {
  const sessions: Array<string | undefined> = [];
  const agent: Agent = {
    model: 'fixture',
    sessionKey: 'first',
    stepLimit: 10,
    async run(directory, prompt, session, _signal, emit) {
      sessions.push(session);
      emit({ type: 'session', id: 'ses_stored' });
      emit({ type: 'limit' });
      await writeFile(join(directory, 'src/main.ts'), 'working');
    },
  };
  const { studio } = await fixture(agent);
  const id = await studio.create('Toy', 'Build');
  await settled(studio);
  await studio.send(id, 'Continue');
  await settled(studio);
  agent.sessionKey = 'second';
  await studio.send(id, 'Use the new provider');
  const project = await settled(studio);
  expect(sessions).toEqual([undefined, 'ses_stored', undefined]);
  expect(project.phase).toBe('ready');
  expect(project.budgetReached).toBe(true);
  expect(project.messages.at(-1)?.text).toContain('some requested work may remain');
  expect(project.messages.filter((m) => m.role === 'user')).toHaveLength(3);
  expect(project.checkpoints).toHaveLength(3);
});

test('merge verification accepts committed contributor tests but still rejects later protected edits', async () => {
  const { studio, root, options } = await fixture({
    model: 'fixture',
    async run(directory) {
      await writeFile(join(directory, 'src/main.ts'), 'working');
    },
  });
  const signal = new AbortController().signal;
  const id = await studio.create('Merge review', 'Make it');
  await settled(studio);
  const p = studio.project(id),
    directory = join(root, 'projects', id, 'workspace');
  await writeFile(join(directory, 'LICENSE'), 'MIT');
  await writeFile(join(directory, 'index.html'), '<html>source</html>');
  await mkdir(join(directory, 'tests'));
  await writeFile(join(directory, 'tests/volume.test.ts'), 'contributor regression test');
  await run(['git', 'add', 'tests'], {
    cwd: directory,
    env: cleanEnvironment(),
    signal,
    operation: 'stage proposal fixture',
  });
  await run(
    [
      'git',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Contributor tests',
    ],
    { cwd: directory, env: cleanEnvironment(), signal, operation: 'commit proposal fixture' },
  );
  const candidate = (
    await run(['git', 'rev-parse', 'HEAD'], {
      cwd: directory,
      env: cleanEnvironment(),
      signal,
      operation: 'pin proposal fixture',
    })
  ).trim();
  p.merge = {
    status: 'preparing',
    detail: '',
    review: { candidate, pubkey: '1'.repeat(64) } as any,
  };
  p.source = 'nostr:original';
  expect(await studio['protectedFiles'](p, signal)).toBe('');
  let sandboxCalls = 0;
  options.publicationCheck = async (contents) => {
    sandboxCalls++;
    expect(new TextDecoder().decode(contents.get('dist/index.html'))).toContain('working');
    return { profile: 'isolated-fixture', browser: 'fixture' };
  };
  await studio['verify'](p, signal);
  expect(sandboxCalls).toBe(1);
  expect(p.checks.map((c) => c.state)).toEqual(['passed', 'passed', 'passed']);
  expect(p.preview).toBeTruthy();
  p.merge.status = 'merged';
  p.merge.review!.commit = candidate;
  expect(await studio['protectedFiles'](p, signal)).toBe('');
  // Preparing a release after merge must reach fresh media capture; the final
  // reviewed-publication checker still validates its real media separately.
  await studio['verify'](p, signal);
  expect(sandboxCalls).toBe(2);
  p.merge.status = 'preparing';
  await writeFile(join(directory, 'tests/volume.test.ts'), 'unexpected edit after pinning');
  expect(await studio['protectedFiles'](p, signal)).toContain('unexpected edit');
  delete p.merge.review!.candidate;
  await expect(studio['protectedFiles'](p, signal)).rejects.toMatchObject({
    code: 'STUDIO_MERGE_REVIEW',
  });
});
