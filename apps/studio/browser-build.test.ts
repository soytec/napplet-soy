import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { boilerplateFiles } from '../cli/src/creator-kit';
import { BrowserBuilds, browserBuildInput } from './browser-build';
import { compileBrowserProject } from './browser-compiler';
import { Studio } from './studio';
import { StudioStore } from './store';
import { cleanEnvironment, openCodeAgent, type Agent } from './agent';
import { serveStudio } from './server';
import { run } from './process';
import type { BrowserBuildJob } from './browser-build-contract';
import { BrowserBuildCache, browserBuildDelta } from './browser-build-cache';
import { BrowserBuildRunner } from './browser-build-runner';
import { importAsset, saveAssets } from '../../packages/assets/src';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'soy-browser-build-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  const root = join(directory, 'projects', id, 'workspace');
  const files = {
    ...boilerplateFiles('browser-test'),
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'napplet.json': JSON.stringify({
      schema: 'space-local-project/v1',
      name: 'browser-test',
      template: 'boilerplate',
      entry: 'dist/index.html',
      previewId: crypto.randomUUID(),
      identifier: 'browser-test',
      requires: [],
      relays: [],
      servers: [],
      license: 'MIT',
      topics: [],
      description: 'Browser build fixture',
    }),
    '.gitignore': 'node_modules/\ndist/\n',
    'index.html':
      '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
    'src/main.ts': 'import { greeting } from "@napplet/sdk"; document.body.textContent = greeting;',
  };
  for (const [path, body] of Object.entries(files)) {
    if (path.startsWith('src/') && path !== 'src/main.ts') continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  // Exercise package subpath exports, relative imports, TS declarations and tree shaking.
  for (const [name, version, exports, sources] of [
    [
      'sdk',
      '0.24.4',
      { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      {
        'index.js': 'export { greeting } from "@napplet/nap/relay";',
        'index.d.ts': 'export declare const greeting: string;',
      },
    ],
    [
      'nap',
      '0.28.0',
      { './relay': { import: './dist/relay.js' } },
      { 'relay.js': 'export { greeting } from "@napplet/core";' },
    ],
    [
      'core',
      '0.28.0',
      { '.': { import: './dist/index.js' } },
      {
        'index.js': 'export { greeting } from "./value.js";',
        'value.js': 'export const greeting = "Hello from the browser";',
      },
    ],
  ] as const) {
    const base = join(root, 'node_modules/@napplet', name);
    await mkdir(join(base, 'dist'), { recursive: true });
    await writeFile(
      join(base, 'package.json'),
      JSON.stringify({ name: '@napplet/' + name, version, exports, sideEffects: false }),
    );
    for (const [path, text] of Object.entries(sources))
      await writeFile(join(base, 'dist', path), text);
  }
  const git = (args: string[]) =>
    run(['git', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      env: cleanEnvironment(),
      signal: AbortSignal.timeout(10000),
      operation: 'browser fixture Git',
    });
  await git(['init']);
  await git(['add', '.']);
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=test@localhost',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'baseline',
  ]);
  const baseline = (await git(['rev-parse', 'HEAD'])).trim();
  return { root, directory, id, baseline };
}
const job = (input: Awaited<ReturnType<typeof browserBuildInput>>): BrowserBuildJob => ({
  ...input,
  id: crypto.randomUUID(),
});

test('browser compiler type-checks real TS libs, bundles SDK subpaths and inlines styles/schema', async () => {
  const { root } = await fixture();
  await writeFile(
    join(root, 'src/main.ts'),
    'import "./style.css"; import { greeting } from "./message.js"; document.body.textContent = greeting;',
  );
  await writeFile(join(root, 'src/message.ts'), 'export { greeting } from "@napplet/sdk";');
  await writeFile(join(root, 'src/style.css'), 'body { color: rebeccapurple }');
  await writeFile(
    join(root, 'config.schema.json'),
    JSON.stringify({ type: 'object', properties: { title: { type: 'string' } } }),
  );
  const result = await compileBrowserProject(job(await browserBuildInput(root)));
  expect(result.error).toBeUndefined();
  expect(result.html).toContain('Hello from the browser');
  expect(result.html).toContain('rebeccapurple');
  expect(result.html).toContain('napplet-config-schema');
  expect(result.html).not.toContain('src="/src/main.ts"');
  await writeFile(join(root, 'src/main.ts'), 'document.body.textContent = missingOrb;');
  const failed = await compileBrowserProject(job(await browserBuildInput(root)));
  expect(failed.error).toContain('/src/main.ts:1:');
  expect(failed.error).toContain('TS2304');
  expect(failed.html).toBeUndefined();
}, 20000);

test('managed images, audio and data use the existing embedded helper or external resource bridge', async () => {
  const { root } = await fixture();
  const image = await importAsset(root, {
    id: 'pixel',
    storage: 'embedded',
    license: 'CC0',
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const wav = new Uint8Array(46);
  wav.set(new TextEncoder().encode('RIFF'));
  wav.set(new TextEncoder().encode('WAVE'), 8);
  await importAsset(root, { id: 'tone', storage: 'embedded', license: 'CC0', bytes: wav });
  const data = await importAsset(root, {
    id: 'levels',
    storage: 'external',
    license: 'CC0',
    bytes: new TextEncoder().encode('{"level":1}'),
  });
  await writeFile(
    join(root, 'src/main.ts'),
    `import {assetUrl, assetBlob} from '../soy-assets.js'; import './style.css';
document.body.dataset.image = await assetUrl('pixel');
document.body.dataset.sound = await assetUrl('tone');
document.body.dataset.level = await (await assetBlob('levels')).text();`,
  );
  await writeFile(join(root, 'src/style.css'), `body { background-image:url('../${image.path}') }`);
  await writeFile(
    join(root, 'index.html'),
    `<img src="/${image.path}"><script type="module" src="/src/main.ts"></script>`,
  );
  const input = await browserBuildInput(root);
  expect(input.files['/' + image.path]).toStartWith('data:image/png;base64,');
  expect(input.files['/' + data.path]).toBeUndefined();
  expect(input.revision).toBe((await browserBuildInput(root, false)).revision);
  const result = await compileBrowserProject(job(input));
  expect(result.error).toBeUndefined();
  expect(result.html).toContain('data:image/png;base64,');
  expect(result.html).toContain('data:audio/wav;base64,');
  expect(result.html).toContain('window.napplet.resource.bytes');
  expect(result.html).toContain(data.hash);
  expect(result.html).not.toContain('?url');
  await writeFile(join(root, data.path), 'corrupt');
  await expect(browserBuildInput(root)).rejects.toThrow('changed or is corrupt');
  await saveAssets(root, { version: 1, assets: [image] });
  await rm(join(root, image.path));
  await symlink('/etc/hosts', join(root, image.path));
  await expect(browserBuildInput(root)).rejects.toThrow();
}, 20000);

test('delta builds remove obsolete source/assets, transfer changed libraries and recover from a lost cache', async () => {
  const { root } = await fixture();
  const first = job(await browserBuildInput(root));
  const cache = new BrowserBuildCache();
  cache.apply(first);
  await writeFile(join(root, 'src/deleted.ts'), 'export const obsolete = 1;');
  const asset = await importAsset(root, {
    id: 'old',
    storage: 'embedded',
    license: 'CC0',
    bytes: new TextEncoder().encode('old asset'),
  });
  const second = job(await browserBuildInput(root));
  const delta = browserBuildDelta(second, first);
  expect(Object.keys(delta.files).some((p) => p.startsWith('/lib/'))).toBe(false);
  expect(Object.keys(delta.files).some((p) => p.startsWith('/node_modules/'))).toBe(false);
  expect(cache.apply(delta).files).toEqual(second.files);
  await rm(join(root, 'src/deleted.ts'));
  await saveAssets(root, { version: 1, assets: [] });
  const third = job(await browserBuildInput(root));
  const removal = browserBuildDelta(third, second);
  expect(removal.removed).toContain('/' + asset.path);
  expect(removal.removed).toContain('/src/deleted.ts');
  expect(cache.apply(removal).files).toEqual(third.files);
  expect((await compileBrowserProject(cache.apply(third))).error).toBeUndefined();
  const lost = new BrowserBuildCache();
  expect(() => lost.apply(removal)).toThrow('cache expired');
  expect(lost.apply(third).files).toEqual(third.files);
  const updated = {
    ...third,
    id: crypto.randomUUID(),
    files: { ...third.files, '/lib/changed.d.ts': 'declare const changed: string;' },
  };
  expect(cache.apply(browserBuildDelta(updated, third)).files).toEqual(updated.files);
  expect(() =>
    cache.apply({ ...updated, files: { '/oversized': 'x'.repeat(12 * 1024 * 1024) } }),
  ).toThrow('limit');
}, 20000);

test('one browser worker survives builds and diagnostics; timeout, disable and crashes reset its cache', async () => {
  const workers: Array<{
    onmessage: Worker['onmessage'];
    onerror: Worker['onerror'];
    postMessage: (job: unknown) => void;
    terminate: () => void;
    terminated: boolean;
  }> = [];
  const runner = new BrowserBuildRunner(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {
        this.terminated = true;
      },
      terminated: false,
    };
    workers.push(worker);
    return worker;
  }, 20);
  const input = { id: crypto.randomUUID(), revision: 'a'.repeat(64), files: {} };
  const answer = (error?: string) =>
    workers.at(-1)!.onmessage!.call(
      null as any,
      {
        data: {
          id: input.id,
          revision: input.revision,
          ...(error ? { error } : { html: '<html/>' }),
          typecheckMs: 1,
          buildMs: 1,
        },
      } as MessageEvent,
    );
  const first = runner.build(input);
  answer();
  await first;
  expect(runner.base).toBe(input.id);
  const failedSource = runner.build(input);
  answer('TS2304');
  await failedSource;
  expect(workers).toHaveLength(1);
  expect(workers[0].terminated).toBe(false);
  await expect(runner.build(input)).rejects.toThrow('timed out');
  expect(workers[0].terminated).toBe(true);
  expect(runner.base).toBeUndefined();
  const retry = runner.build(input);
  answer();
  await retry;
  expect(workers).toHaveLength(2);
  const cancelled = runner.build(input);
  runner.dispose();
  await expect(cancelled).rejects.toThrow('cancelled');
  expect(workers[1].terminated).toBe(true);
  const crashed = runner.build(input);
  workers.at(-1)!.onerror!.call(null as any, { message: 'worker crashed' } as ErrorEvent);
  await expect(crashed).rejects.toThrow('worker crashed');
  expect(runner.base).toBeUndefined();
});

test('browser profile refuses custom builds, public assets, symlinks and non-inline HTML media', async () => {
  const { root } = await fixture();
  const before = await browserBuildInput(root, false);
  await writeFile(join(root, 'src/main.ts'), 'document.body.textContent = "changed";');
  expect((await browserBuildInput(root, false)).revision).not.toBe(before.revision);
  await mkdir(join(root, 'public'));
  await expect(browserBuildInput(root)).rejects.toThrow('public');
  await rm(join(root, 'public'), { recursive: true });
  await symlink('/etc/hosts', join(root, 'src/linked.ts'));
  await expect(browserBuildInput(root)).rejects.toThrow('src/linked.ts');
  await rm(join(root, 'src/linked.ts'));
  await writeFile(
    join(root, 'index.html'),
    '<img src="/image.png"><script type="module" src="/src/main.ts"></script>',
  );
  expect((await compileBrowserProject(job(await browserBuildInput(root)))).error).toContain(
    'inline media',
  );
  await writeFile(join(root, 'vite.config.ts'), 'throw new Error("must not execute");');
  await expect(browserBuildInput(root)).rejects.toThrow('standard soyLI vite.config.ts');
}, 20000);

test('browser jobs bind results to the tab and source; timeout/abort reject late replies', async () => {
  const builds = new BrowserBuilds();
  const session = crypto.randomUUID(),
    other = crypto.randomUUID();
  const input = { revision: 'a'.repeat(64), files: {} };
  const controller = new AbortController();
  const pending = builds.run(session, input, controller.signal);
  const next = builds.next(session)!;
  const result = {
    id: next.id,
    revision: input.revision,
    html: '<html></html>',
    typecheckMs: 1,
    buildMs: 2,
  };
  expect(builds.next(other)).toBeNull();
  expect(() => builds.reply(other, result)).toThrow('no longer pending');
  expect(() => builds.reply(session, { ...result, revision: 'b'.repeat(64) })).toThrow(
    'no longer pending',
  );
  builds.reply(session, result);
  expect(await pending).toEqual(result);
  expect(() => builds.reply(session, result)).toThrow('no longer pending');
  await expect(builds.run(session, input, controller.signal, 10)).rejects.toThrow(
    'within two minutes',
  );
  expect(builds.next(session)).toBeNull();
  const cancelled = builds.run(session, input, controller.signal);
  controller.abort(new Error('Stopped by user'));
  await expect(cancelled).rejects.toThrow('Stopped by user');
  expect(builds.next(session)).toBeNull();
});

async function studioFixture(agent: Agent) {
  const f = await fixture();
  let captures = 0;
  const store = new StudioStore(f.directory);
  const now = new Date().toISOString();
  store.save([
    {
      id: f.id,
      title: 'Browser test',
      createdAt: now,
      updatedAt: now,
      phase: 'idle',
      stage: 'Ready',
      messages: [],
      activity: [],
      checks: [],
      checkpoints: [],
      initialized: true,
      setup: true,
      baseline: f.baseline,
      estimatedCost: 0,
      steps: 0,
    },
  ]);
  store.close();
  const tool = join(f.directory, 'soyli.ts');
  const noBrowser = join(f.directory, 'no-browser-cache');
  await writeFile(noBrowser, 'Browser capture belongs in the service suite.');
  await writeFile(
    tool,
    `import { appendFile, mkdir, writeFile, cp } from 'node:fs/promises';
await appendFile(${JSON.stringify(join(f.directory, 'commands.log'))}, process.argv.slice(2).join(' ')+'\\n');
const [command, ...args] = process.argv.slice(2);
if (command === 'new' || command === 'remix') {
  await cp(${JSON.stringify(f.root)}, command === 'new' ? args[0] : args[1], {recursive:true});
} else if (command !== 'setup') {
  await mkdir('dist', {recursive:true}); await writeFile('dist/index.html','<html><body>Host verified output</body></html>');
}`,
  );
  const studio = new Studio({
    directory: f.directory,
    soyli: [process.execPath, tool],
    env: { ...cleanEnvironment(), PLAYWRIGHT_BROWSERS_PATH: noBrowser },
    agent,
    preview: async () => ({ url: 'http://127.0.0.1:12345/', stop() {} }),
    capture: async (_root, _pubkey, target) => {
      captures++;
      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, 'cover.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
          'base64',
        ),
      );
    },
  });
  await studio.initialize();
  cleanup.push(() => studio.close());
  return { ...f, studio, captures: () => captures };
}
async function waitFor<T>(read: () => T | Promise<T>, matches: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 500; i++) {
    const value = await read();
    if (matches(value)) return value;
    await Bun.sleep(20);
  }
  throw new Error('Test did not settle');
}
const settle = (studio: Studio) =>
  waitFor(
    () => studio.state(),
    (state) => !state.busy,
  );

test('new and remix requests carry the initiating browser session through setup and first preview', async () => {
  const executions: boolean[] = [];
  const { studio, directory } = await studioFixture({
    model: 'fixture',
    async run(root, prompt, _session, _signal, _emit, execution) {
      executions.push(!!execution?.browserBuild);
      if (execution?.browserBuild) expect(prompt).toContain('experimental browser compiler');
      await writeFile(
        join(root, 'src/main.ts'),
        'document.body.textContent = "First browser preview";',
      );
    },
  });
  const server = await serveStudio(studio, 0);
  cleanup.push(() => server.stop(true));
  const { token } = await (await fetch(server.url + 'api/session')).json();
  const create = (body: unknown, requestId = crypto.randomUUID()) =>
    fetch(server.url + 'api/projects', {
      method: 'POST',
      headers: {
        Origin: server.url.origin,
        'Content-Type': 'application/json',
        'X-Studio-Token': token,
        'X-Request-ID': requestId,
      },
      body: JSON.stringify(body),
    });
  expect(
    (await create({ title: 'Bad session', prompt: 'Create', browserSession: 'bad' })).status,
  ).toBe(400);
  expect((await studio.state()).projects).toHaveLength(1);
  const browserSession = crypto.randomUUID();
  for (const source of [undefined, 'http://127.0.0.1:9999/n/test']) {
    const requestId = crypto.randomUUID();
    const body = { title: 'New browser draft', prompt: 'Create a toy', source, browserSession };
    const response = await create(body, requestId);
    expect(response.status).toBe(200);
    const { id } = await response.json();
    expect(await (await create(body, requestId)).json()).toEqual({ id });
    const next = (await waitFor(
      () => studio.browserBuilds.next(browserSession),
      (v) => !!v,
    ))!;
    expect(studio.browserBuilds.next(crypto.randomUUID())).toBeNull();
    const result = await compileBrowserProject(next);
    expect(result.error).toBeUndefined();
    studio.browserBuilds.reply(browserSession, result);
    const project = (await settle(studio)).projects.find((p) => p.id === id)!;
    expect(project.phase).toBe('ready');
    expect(project.previewValidation).toBe('browser');
    expect(project.source).toBe(source);
    expect(project.baseline).toBeTruthy();
    expect(project.checkpoints.length).toBeGreaterThan(0);
    expect(
      await Bun.file(join(directory, 'projects', id, 'workspace/dist/index.html')).exists(),
    ).toBe(false);
  }
  expect(executions).toEqual([true, true]);
  expect(await readFile(join(directory, 'commands.log'), 'utf8')).toBe(
    'new workspace --identity later --no-install\nsetup\nremix http://127.0.0.1:9999/n/test workspace --network local --identity later --no-install\nsetup\n',
  );
  // The ordinary create request keeps its native verification sequence.
  const native = await (await create({ title: 'Native draft', prompt: 'Create a toy' })).json();
  expect((await settle(studio)).projects.find((p) => p.id === native.id)?.previewValidation).toBe(
    'full',
  );
  expect(executions).toEqual([true, true, false]);
  expect(await readFile(join(directory, 'commands.log'), 'utf8')).toEndWith(
    'new workspace --identity later --no-install\nsetup\nrun verify\ncheck\nrun test:conformance\n',
  );
}, 30000);

test('agent requests browser diagnostics during the same turn and repairs before finishing', async () => {
  const outcomes: string[] = [];
  const { studio, directory, id } = await studioFixture({
    model: 'fixture',
    async run(root, _prompt, _session, _signal, _emit, execution) {
      expect(execution?.check).toBeFunction();
      await writeFile(join(root, 'src/main.ts'), 'document.body.textContent = missingOrb;');
      outcomes.push(await execution!.check!());
      await writeFile(join(root, 'src/main.ts'), 'document.body.textContent = "Repaired in turn";');
      outcomes.push(await execution!.check!());
    },
  });
  const session = crypto.randomUUID();
  await studio.send(id, 'Make a toy', session);
  // Two agent-initiated checks and the independent final check.
  for (let i = 0; i < 3; i++) {
    const next = (await waitFor(
      () => studio.browserBuilds.next(session),
      (v) => !!v,
    ))!;
    studio.browserBuilds.reply(session, await compileBrowserProject(next));
  }
  const result = (await settle(studio)).projects[0];
  expect(outcomes[0]).toContain('TS2304');
  expect(outcomes[1]).toContain('passed');
  expect(result.phase).toBe('ready');
  expect(result.previewValidation).toBe('browser');
  expect(await Bun.file(join(directory, 'commands.log')).exists()).toBe(false);
}, 20000);

test('browser failure preserves preview, feeds one repair pass, avoids host builds; publication reruns host checks', async () => {
  let calls = 0;
  const { studio, root, directory, id, captures } = await studioFixture({
    model: 'fixture',
    async run(root, prompt, _session, _signal, _emit, execution) {
      calls++;
      expect(execution?.browserBuild).toBe(true);
      expect(prompt).toContain('experimental browser compiler');
      if (calls === 2) expect(prompt).toContain('TS2304');
      await writeFile(
        join(root, 'src/main.ts'),
        calls === 1
          ? 'document.body.textContent = missingOrb;'
          : 'document.body.textContent = "Repaired";',
      );
    },
  });
  const session = crypto.randomUUID();
  const answer = async () => {
    const next = (await waitFor(
      () => studio.browserBuilds.next(session),
      (v) => v !== null,
    ))!;
    studio.browserBuilds.reply(session, await compileBrowserProject(next));
  };
  await studio.check(id, session);
  await answer();
  const first = (await settle(studio)).projects[0];
  expect(first.previewValidation).toBe('browser');
  expect(first.phase).toBe('ready');
  await studio.send(id, 'Change the label', session);
  await answer();
  expect((await studio.state()).projects[0].preview).toBe(first.preview);
  await answer();
  const repaired = (await settle(studio)).projects[0];
  expect(repaired.phase).toBe('ready');
  expect(repaired.preview).not.toBe(first.preview);
  expect(calls).toBe(2);
  expect(await Bun.file(join(directory, 'commands.log')).exists()).toBe(false);
  expect(await Bun.file(join(root, 'dist/index.html')).exists()).toBe(false);
  expect(
    await Bun.file(
      join(directory, 'projects', id, 'previews', repaired.preview!, 'dist/index.html'),
    ).text(),
  ).toContain('Repaired');
  // Release preparation has no browser session parameter: native checks always run.
  const signer = studio.signing.connect('a'.repeat(64));
  await studio.preparePublication(id, signer.id, {
    title: 'Test release',
    description: 'A publication fixture',
    topics: [],
    video: false,
    portrait: false,
  });
  await settle(studio);
  expect(await readFile(join(directory, 'commands.log'), 'utf8')).toBe(
    'run verify\ncheck\nrun test:conformance\n',
  );
  expect((await studio.state()).projects[0].previewValidation).toBe('full');
  expect((await studio.state()).projects[0].phase).toBe('ready');
  expect((await studio.state()).projects[0].publication?.review).toBeDefined();
  expect(captures()).toBe(1);
}, 30000);

test('browser build HTTP retains origin/token checks and rejects stale revisions', async () => {
  const { studio } = await studioFixture({ model: 'fixture', async run() {} });
  const server = await serveStudio(studio, 0);
  cleanup.push(() => server.stop(true));
  const origin = server.url.origin;
  const { token } = await (await fetch(origin + '/api/session')).json();
  const session = crypto.randomUUID();
  const path = origin + '/api/browser-builds/' + session;
  const pending = studio.browserBuilds.run(
    session,
    { revision: 'a'.repeat(64), files: {} },
    AbortSignal.timeout(10000),
  );
  const next = studio.browserBuilds.next(session)!;
  const result = {
    id: next.id,
    revision: next.revision,
    html: '<html></html>',
    typecheckMs: 0,
    buildMs: 1,
  };
  const post = (data: unknown, source = origin, auth = token) =>
    fetch(path, {
      method: 'POST',
      headers: {
        Origin: source,
        'Content-Type': 'application/json',
        'X-Studio-Token': auth,
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify(data),
    });
  expect((await fetch(path)).status).toBe(403);
  expect((await post(result, 'https://evil.example')).status).toBe(403);
  expect((await post(result, origin, 'wrong')).status).toBe(403);
  expect((await post({ ...result, revision: 'b'.repeat(64) })).status).toBe(400);
  expect((await post(result)).status).toBe(200);
  await pending;
  expect((await post(result)).status).toBe(400);
  const changed = studio.browserBuilds.run(
    session,
    { revision: 'c'.repeat(64), files: { '/src/main.ts': 'changed' } },
    AbortSignal.timeout(10000),
  );
  const get = (base: string) =>
    fetch(path + '?base=' + base, { headers: { 'X-Studio-Token': token } }).then((r) => r.json());
  const delta = await get(next.id);
  expect(delta.base).toBe(next.id);
  expect(delta.files).toEqual({ '/src/main.ts': 'changed' });
  expect((await get(crypto.randomUUID())).base).toBeUndefined();
  expect(
    (
      await fetch(origin + '/api/browser-builds/' + crypto.randomUUID() + '?base=' + next.id, {
        headers: { 'X-Studio-Token': token },
      })
    ).status,
  ).toBe(200);
  expect(studio.browserBuilds.next(crypto.randomUUID(), next.id)).toBeNull();
  expect((await post({ ...result, id: delta.id, revision: delta.revision })).status).toBe(200);
  await changed;
});

test('browser agent permissions omit host build commands without changing the normal profile', async () => {
  const { directory } = await fixture();
  for (const browserBuild of [false, true]) {
    await openCodeAgent({
      directory,
      executable: 'unused',
      model: 'deepseek/test',
      key: '',
      env: cleanEnvironment(),
      browserBuild,
    });
    const config = JSON.parse(await readFile(join(directory, 'opencode.json'), 'utf8'));
    expect(config.permission.bash['soyli run verify']).toBe(browserBuild ? undefined : 'allow');
    expect(config.permission.bash['*']).toBe('deny');
  }
});

test('worker failure and source changes during compilation do not start paid repairs or replace the preview', async () => {
  let calls = 0;
  const { studio, root, id } = await studioFixture({
    model: 'fixture',
    async run() {
      calls++;
    },
  });
  const session = crypto.randomUUID();
  await studio.check(id, session);
  const initial = (await waitFor(
    () => studio.browserBuilds.next(session),
    (v) => !!v,
  ))!;
  studio.browserBuilds.reply(session, await compileBrowserProject(initial));
  const preview = (await settle(studio)).projects[0].preview;
  await studio.send(id, 'Try an edit', session);
  const broken = (await waitFor(
    () => studio.browserBuilds.next(session),
    (v) => !!v,
  ))!;
  studio.browserBuilds.reply(session, {
    id: broken.id,
    revision: broken.revision,
    error: 'WebAssembly could not initialize',
    errorKind: 'worker',
    typecheckMs: 0,
    buildMs: 0,
  });
  const failed = (await settle(studio)).projects[0];
  expect(failed.error?.code).toBe('STUDIO_BROWSER_WORKER');
  expect(failed.error?.details?.join('\n')).toContain('WebAssembly could not initialize');
  expect(calls).toBe(1);
  expect(failed.preview).toBe(preview);
  await studio.check(id, session);
  const stale = (await waitFor(
    () => studio.browserBuilds.next(session),
    (v) => !!v,
  ))!;
  const compiled = await compileBrowserProject(stale);
  await writeFile(join(root, 'src/main.ts'), 'document.body.textContent = "newer source";');
  studio.browserBuilds.reply(session, compiled);
  const changed = (await settle(studio)).projects[0];
  expect(changed.error?.code).toBe('STUDIO_BROWSER_STALE');
  expect(changed.preview).toBe(preview);
  expect(calls).toBe(1);
}, 20000);
