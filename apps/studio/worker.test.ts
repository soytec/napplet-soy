import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioWorker, type WorkerConfig } from './worker-client';
import { serveStudio } from './server';
import type { StudioSurface } from './surface';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function until<T>(
  check: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 12000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await check();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error('Worker fixture did not reach expected state');
    await Bun.sleep(25);
  }
}
async function settled(client: StudioSurface) {
  return until(
    () => client.state(),
    (s) => !s.busy,
  );
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-worker-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const tool = join(directory, 'soyli.ts'),
    executable = join(directory, 'agent-fixture');
  await writeFile(
    tool,
    String.raw`
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
const [command,arg]=process.argv.slice(2);
if(command==='new') {
  const files={
    'napplet.json':JSON.stringify({schema:'space-local-project/v1',name:'Worker toy',template:'boilerplate',entry:'dist/index.html',previewId:crypto.randomUUID(),identifier:'toy',requires:[],relays:[],servers:[],license:'MIT',topics:[]}),
    'package.json':'{}', '.gitignore':'dist/\nchild-pids\n', 'src/main.ts':'baseline',
    'docs/napplet-space.md':'Use soyLI.', 'docs/napplet-visual-design.md':'Choose your own design.',
    '.agents/skills/napplet-make/SKILL.md':'Make.', '.agents/skills/napplet-ui/SKILL.md':'UI.',
    '.agents/skills/napplet-test/SKILL.md':'Verify.'
  };
  for(const [path,text] of Object.entries(files)) { await mkdir(join(arg,dirname(path)),{recursive:true}); await writeFile(join(arg,path),text); }
  for(const args of [['init'],['add','.'],['-c','user.name=Fixture','-c','user.email=test@localhost','-c','commit.gpgsign=false','commit','-m','scaffold']]) {
    const p=Bun.spawn(['git','-c','core.hooksPath=/dev/null',...args],{cwd:arg,stdout:'ignore',stderr:'ignore'});
    if(await p.exited) process.exit(3);
  }
} else if(command!=='setup') {
  const src=await readFile('src/main.ts','utf8');
  if(src==='BROKEN') { console.error('TS2304: Cannot find name missingOrb'); process.exit(1); }
  await mkdir('dist',{recursive:true}); await writeFile('dist/index.html','<!doctype html><html><body>'+src+'</body></html>');
  console.log('passed');
}
`,
  );
  await writeFile(
    executable,
    '#!' +
      process.execPath +
      '\n' +
      String.raw`
import {readFile,writeFile} from 'node:fs/promises';
const prompt=process.argv.at(-1);
if(!process.argv.includes('--thinking')) throw new Error('Reasoning output was not enabled');
const credentials=JSON.parse(await readFile(process.env.XDG_DATA_HOME+'/opencode/auth.json','utf8'));
console.log(JSON.stringify({type:'reasoning',part:{id:'prt_worker',text:'Check the toy with '+credentials.deepseek.key}}));
console.log(JSON.stringify({type:'text',sessionID:'ses_worker',part:{text:'Guidance loaded; changing the toy.'}}));
if(prompt.includes('HANG_FIXTURE')) {
  const p=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdout:'ignore',stderr:'ignore'});
  await writeFile('child-pids',JSON.stringify([process.pid,p.pid]));
  setInterval(()=>{},1000);
} else if(prompt.includes('FAIL_FIXTURE')) {
  const auth=JSON.parse(await readFile(process.env.XDG_DATA_HOME+'/opencode/auth.json','utf8'));
  console.error('Inference fixture unavailable: '+auth.deepseek.key);
  process.exit(7);
} else {
  // Exercise the controller's real build error and repair round trip through IPC.
  await writeFile('src/main.ts',prompt.includes('Repair the failure')?'working worker preview':'BROKEN');
}
`,
  );
  await chmod(executable, 0o700);
  const config: WorkerConfig = {
    directory,
    owner: 'local:fixture',
    soyli: [process.execPath, tool],
    agent: {
      directory: join(directory, 'agent'),
      executable,
      model: 'fixture/local',
      key: 'fixture-private-provider-key',
    },
  };
  const start = async (options = config) => {
    const worker = new StudioWorker(options);
    cleanup.push(() => worker.close().catch(() => {}));
    return { worker, client: await worker.start() };
  };
  return { directory, config, start };
}

test('HTTP-to-worker flow repairs real build failures, serves the sandbox, deduplicates concurrent clicks and preserves state after restart', async () => {
  const { start } = await fixture();
  const { worker, client } = await start();
  const server = await serveStudio(client, 0);
  cleanup.push(() => server.stop(true));
  const origin = server.url.origin;
  const { token } = await (await fetch(origin + '/api/session')).json();
  const headers = {
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Studio-Token': token,
    'X-Request-ID': crypto.randomUUID(),
  };
  expect((await fetch(origin + '/api/state')).status).toBe(403);
  const post = () =>
    fetch(origin + '/api/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Toy', prompt: 'Make a toy' }),
    });
  const [first, second] = await Promise.all([post(), post()]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const { id } = await first.json();
  expect((await second.json()).id).toBe(id);
  const state = await settled(client);
  expect(state.projects).toHaveLength(1);
  const project = state.projects[0];
  expect(project.error).toBeUndefined();
  expect(project.phase).toBe('ready');
  expect(project.messages.some((m) => m.text.includes('one repair pass'))).toBe(true);
  expect(project.reasoning).toEqual([
    {
      id: 'prt_worker',
      text: 'Check the toy with [provider credential redacted]',
      truncated: false,
    },
  ]);
  expect(project.messages.every((m) => !m.text.includes('Check the toy with'))).toBe(true);
  expect(JSON.stringify(state)).not.toContain('fixture-private-provider-key');
  expect(state.jobs?.[0].status).toBe('completed');
  const preview = await client.preview(id);
  const html = await (await fetch(preview)).text();
  expect(html).toContain('Preparing preview');
  const revision = await (await fetch(new URL('/revision', preview))).json();
  const artifact = await fetch(new URL('/artifacts/' + revision.artifactHash, preview));
  expect(artifact.headers.get('Content-Security-Policy')).toContain('sandbox');
  expect(await artifact.text()).toContain('working worker preview');
  expect(await client.file(id, 'src/main.ts')).toContain('working worker preview');
  const assetBytes = new TextEncoder().encode('{"colors":["coral","blue"]}');
  const assetHeaders = {
    Origin: origin,
    'X-Studio-Token': token,
    'Content-Type': 'application/octet-stream',
    'X-Asset-Info': encodeURIComponent(
      JSON.stringify({ id: 'palette', license: 'CC0', source: 'Fixture', storage: 'embedded' }),
    ),
  };
  const imported = await fetch(origin + '/api/projects/' + id + '/assets', {
    method: 'POST',
    headers: assetHeaders,
    body: assetBytes,
  });
  expect(imported.status).toBe(200);
  expect((await imported.json())[0].id).toBe('palette');
  const assetRead = await fetch(origin + '/api/projects/' + id + '/asset?name=palette', {
    headers: { 'X-Studio-Token': token },
  });
  expect(assetRead.headers.get('Content-Type')).toBe('application/json');
  expect(new Uint8Array(await assetRead.arrayBuffer())).toEqual(assetBytes);
  expect((await client.state()).projects[0].preview).toBe(project.preview);
  const denied = await fetch(origin + '/api/projects/' + id + '/assets', {
    method: 'POST',
    headers: { ...assetHeaders, Origin: 'https://untrusted.invalid' },
    body: assetBytes,
  });
  expect(denied.status).toBe(403);
  const signer = await client.signing.connect(getPublicKey(generateSecretKey()));
  expect(await client.signing.next(signer.id)).toBeNull();
  await expect(client.signing.reply(signer.id, crypto.randomUUID())).rejects.toThrow(
    'no longer active',
  );
  await client.send(id, 'FAIL_FIXTURE');
  const failure = (await settled(client)).projects[0];
  expect(failure.error?.details?.join('\n')).toContain('Inference fixture unavailable');
  expect(JSON.stringify(failure)).not.toContain('fixture-private-provider-key');
  expect(failure.preview).toBe(project.preview);
  await worker.close();
  const resumed = (await start()).client;
  const restored = await resumed.state();
  expect(restored.projects[0].messages).toEqual(failure.messages);
  expect(restored.projects[0].reasoning).toEqual(failure.reasoning);
  expect(restored.projects[0].preview).toBe(project.preview);
  expect(restored.busy).toBeUndefined();
  await expect(resumed.signing.next(signer.id)).rejects.toThrow('expired');
}, 30000);

test('a killed worker releases its store, cleans owned tools and recovers without repeating inference', async () => {
  const { directory, start, config } = await fixture();
  const { worker, client } = await start();
  const id = await client.create('Interrupted toy', 'HANG_FIXTURE');
  const file = join(directory, 'projects', id, 'workspace/child-pids');
  await until(() => Bun.file(file).exists(), Boolean);
  const pids = JSON.parse(await readFile(file, 'utf8')) as number[];
  await until(
    () => client.state(),
    (s) => s.projects[0].session === 'ses_worker',
  );
  process.kill(worker.pid, 'SIGKILL');
  await until(async () => {
    try {
      await client.state();
      return false;
    } catch {
      return true;
    }
  }, Boolean);
  await worker.close();
  for (const pid of pids)
    await until(async () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, Boolean);
  const restarted = await start();
  const state = await restarted.client.state();
  expect(state.projects[0].phase).toBe('stopped');
  expect(state.projects[0].session).toBe('ses_worker');
  expect(state.projects[0].messages[0].text).toBe('HANG_FIXTURE');
  expect(state.jobs?.[0].status).toBe('interrupted');
  expect(state.busy).toBeUndefined();
  const auth = await readFile(join(config.agent.directory, 'data/opencode/auth.json'), 'utf8');
  await expect(
    start({ ...config, agent: { ...config.agent, key: 'must-not-overwrite' } }),
  ).rejects.toThrow('Another worker');
  expect(await readFile(join(config.agent.directory, 'data/opencode/auth.json'), 'utf8')).toBe(
    auth,
  );
  await restarted.worker.close();
  await expect(
    start({
      ...config,
      owner: 'local:other',
      agent: { ...config.agent, key: 'must-not-overwrite' },
    }),
  ).rejects.toThrow('different owner');
  expect(await readFile(join(config.agent.directory, 'data/opencode/auth.json'), 'utf8')).toBe(
    auth,
  );
}, 30000);

test('supervisor death disconnects and stops the worker and its active process group', async () => {
  const { directory, config, start } = await fixture();
  const launcher = join(directory, 'supervisor.ts'),
    info = join(directory, 'supervisor-info.json');
  await writeFile(
    launcher,
    `
    import {StudioWorker} from ${JSON.stringify(new URL('./worker-client.ts', import.meta.url).pathname)};
    const worker=new StudioWorker(${JSON.stringify(config)});
    const client=await worker.start();
    const id=await client.create('Disconnect toy','HANG_FIXTURE');
    await Bun.write(${JSON.stringify(info)},JSON.stringify({pid:worker.pid,id}));
    setInterval(()=>{},1000);
  `,
  );
  const supervisor = Bun.spawn([process.execPath, '--no-env-file', launcher], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  cleanup.push(async () => {
    supervisor.kill('SIGKILL');
    await supervisor.exited;
  });
  await until(() => Bun.file(info).exists(), Boolean);
  const { pid, id } = await Bun.file(info).json();
  const childFile = join(directory, 'projects', id, 'workspace/child-pids');
  await until(() => Bun.file(childFile).exists(), Boolean);
  const descendants = await Bun.file(childFile).json();
  supervisor.kill('SIGKILL');
  await supervisor.exited;
  for (const child of [pid, ...descendants])
    await until(async () => {
      try {
        process.kill(child, 0);
        return false;
      } catch {
        return true;
      }
    }, Boolean);
  const restored = await (await start()).client.state();
  expect(restored.projects[0].phase).toBe('stopped');
  expect(restored.jobs?.[0].status).toBe('cancelled');
  expect(restored.busy).toBeUndefined();
}, 30000);

test('saved connections survive worker restarts without exposing keys, and switching is explicit', async () => {
  const { start, config, directory } = await fixture();
  const { client, worker } = await start();
  const server = await serveStudio(client, 0);
  cleanup.push(() => server.stop(true));
  const origin = server.url.origin;
  const { token } = await (await fetch(origin + '/api/session')).json();
  async function post(path: string, body: unknown) {
    return fetch(origin + '/api/' + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Studio-Token': token,
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
  }
  const secret = 'another-private-fixture-api-key';
  const input = {
    name: 'Local coder',
    provider: 'lmstudio',
    endpoint: 'http://127.0.0.1:1234/v1',
    model: 'local-coder',
    key: secret,
    steps: 60,
  };
  const response = await post('connections/save', input);
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(JSON.stringify(saved)).not.toContain(secret);
  const connection = saved.connections.find((c: any) => c.name === 'Local coder');
  expect(saved.selected).not.toBe(connection.id);
  expect((await post('connections/select', { id: connection.id })).status).toBe(200);
  expect((await client.state()).model).toContain('Local coder');
  expect(JSON.stringify(await client.state())).not.toContain(secret);
  const edit = {
    ...input,
    id: connection.id,
    endpoint: 'https://other.invalid/v1',
    key: undefined,
  };
  expect((await post('connections/save', edit)).status).toBe(400);
  const rejected = await post('connections/save', {
    ...input,
    endpoint: 'http://remote.invalid/v1',
  });
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).not.toContain(secret);
  await worker.close();
  const restarted = await start({ ...config, agent: { ...config.agent, key: '' } });
  expect((await restarted.client.state()).connections?.selected).toBe(connection.id);
  expect(await readFile(join(directory, 'agent/data/opencode/auth.json'), 'utf8')).not.toContain(
    secret,
  );
  await restarted.client.connectionAction('remove', { id: connection.id });
  expect((await restarted.client.state()).connections?.selected).toBeUndefined();
});
