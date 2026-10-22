import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections } from './connections';
import { fetchModelCatalogue } from './model-catalogue';
import type { Provider } from './connections-model';

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function catalogue(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  cleanup.push(() => server.stop(true));
  return server.url.href + 'v1';
}
async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-models-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const connections = new Connections(directory);
  await connections.initialize();
  return { connections, file: join(directory, 'connections.json') };
}

test('discovery reads saved keys without changing settings; quick model changes persist and invalidate the session', async () => {
  const { connections, file } = await store();
  const secret = 'saved-private-key';
  const endpoint = catalogue((req) => {
    expect(req.method).toBe('GET');
    expect(new URL(req.url).pathname).toBe('/v1/models');
    expect(req.headers.get('authorization')).toBe('Bearer ' + secret);
    return Response.json({
      data: [
        { id: 'coder-b', name: 'Coder B' },
        { id: 'coder-a', name: 'Coder A' },
        { id: 'coder-a', name: 'Coder A' },
        { id: '<invalid>' },
        { id: secret },
      ],
    });
  });
  const state = await connections.save({
    name: 'Maker',
    provider: 'compatible',
    endpoint,
    key: secret,
    model: 'old-alias',
    steps: 100,
  });
  const c = state.connections[0];
  const before = await readFile(file, 'utf8');
  const source = { id: c.id, endpoint, provider: c.provider };
  expect(await connections.models(source)).toEqual({
    models: [
      { id: 'coder-a', name: 'Coder A' },
      { id: 'coder-b', name: 'Coder B' },
    ],
    truncated: false,
  });
  expect(await readFile(file, 'utf8')).toBe(before);
  const session = connections.sessionKey;
  const selected = await connections.setModel({ id: c.id, revision: c.revision, model: 'coder-b' });
  expect(selected.connections[0].model).toBe('coder-b');
  expect(selected.selected).toBe(c.id);
  expect(JSON.stringify(selected)).not.toContain(secret);
  expect(connections.sessionKey).not.toBe(session);
  await expect(
    connections.setModel({ id: c.id, revision: c.revision, model: 'stale-choice' }),
  ).rejects.toThrow('connection changed');
  const reloaded = new Connections(join(file, '..'));
  await reloaded.initialize();
  expect(reloaded.current().key).toBe(secret);
  expect(reloaded.current().model).toBe('coder-b');
});

test('unsaved discovery accepts a key without saving it and refuses to reuse credentials at a changed destination', async () => {
  const { connections, file } = await store();
  let requests = 0;
  const endpoint = catalogue((req) => {
    requests++;
    expect(req.headers.get('authorization')).toBe('Bearer temporary-key');
    return Response.json({ data: [{ id: 'available' }] });
  });
  const state = await connections.save({
    name: 'Saved',
    provider: 'openai',
    endpoint,
    key: 'stored-key',
    model: 'alias',
    steps: 100,
  });
  const id = state.selected!;
  const before = await readFile(file, 'utf8');
  await expect(
    connections.models({ id, provider: 'openai', endpoint: endpoint + '/different' }),
  ).rejects.toThrow('Re-enter');
  await expect(connections.models({ id, provider: 'deepseek', endpoint })).rejects.toThrow(
    'Re-enter',
  );
  await expect(connections.models({ provider: 'deepseek', endpoint })).rejects.toThrow(
    'Enter an API key',
  );
  expect(requests).toBe(0);
  expect(
    (await connections.models({ provider: 'openai', endpoint, key: 'temporary-key' })).models[0].id,
  ).toBe('available');
  expect(
    (await connections.models({ id, provider: 'deepseek', endpoint, key: 'temporary-key' }))
      .models[0].id,
  ).toBe('available');
  expect(await readFile(file, 'utf8')).toBe(before);
});

test('Anthropic uses its key header and safely follows bounded model cursors', async () => {
  const pages: string[] = [];
  const endpoint = catalogue((req) => {
    expect(req.headers.get('x-api-key')).toBe('anthropic-key');
    expect(req.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(req.headers.has('authorization')).toBe(false);
    const cursor = new URL(req.url).searchParams.get('after_id') ?? '';
    pages.push(cursor);
    return Response.json(
      cursor
        ? { data: [{ id: 'claude-b', display_name: 'Claude B' }], has_more: false }
        : {
            data: [{ id: 'claude-a', display_name: 'Claude A' }],
            has_more: true,
            last_id: 'claude-a',
          },
    );
  });
  expect(
    (
      await fetchModelCatalogue({ provider: 'anthropic', endpoint, key: 'anthropic-key' })
    ).models.map((m) => m.name),
  ).toEqual(['Claude A', 'Claude B']);
  expect(pages).toEqual(['', 'claude-a']);
});

test('Gemini uses header auth, strips the resource prefix, paginates and omits embedding-only models', async () => {
  const pages: string[] = [];
  const endpoint = catalogue((req) => {
    expect(req.headers.get('x-goog-api-key')).toBe('google-key');
    expect(req.url).not.toContain('google-key');
    const cursor = new URL(req.url).searchParams.get('pageToken') ?? '';
    pages.push(cursor);
    return Response.json(
      cursor
        ? { models: [{ name: 'models/gemini-b', displayName: 'Gemini B' }] }
        : {
            models: [
              { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
              {
                name: 'models/gemini-a',
                displayName: 'Gemini A',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
            nextPageToken: 'page/two',
          },
    );
  });
  expect(
    (await fetchModelCatalogue({ provider: 'google', endpoint, key: 'google-key' })).models,
  ).toEqual([
    { id: 'gemini-a', name: 'Gemini A' },
    { id: 'gemini-b', name: 'Gemini B' },
  ]);
  expect(pages).toEqual(['', 'page/two']);
});

test('OpenAI-compatible provider catalogues and local servers need no hardcoded model list', async () => {
  const endpoint = catalogue((req) => {
    expect(req.headers.has('authorization')).toBe(false);
    return Response.json({ data: [{ id: 'local:latest' }] });
  });
  for (const provider of ['ollama', 'lmstudio', 'llamacpp', 'compatible'] as Provider[]) {
    expect((await fetchModelCatalogue({ endpoint, provider })).models[0].id).toBe('local:latest');
  }
  const together = catalogue(() => Response.json([{ id: 'org/model', display_name: 'Model' }]));
  expect(
    (await fetchModelCatalogue({ endpoint: together, provider: 'together', key: 'fixture' }))
      .models,
  ).toEqual([{ id: 'org/model', name: 'Model' }]);
});

test('large lists report truncation; looping cursors and malformed or oversized responses retain useful errors', async () => {
  let mode = 'large',
    requests = 0;
  const endpoint = catalogue(() => {
    requests++;
    if (mode === 'invalid') return Response.json({ error: 'private-key' });
    if (mode === 'oversized')
      return new Response('x', { headers: { 'content-length': String(9 * 1024 * 1024) } });
    if (mode === 'loop')
      return Response.json({ data: [{ id: 'model' }], has_more: true, last_id: 'same' });
    return Response.json({ data: Array.from({ length: 2001 }, (_, i) => ({ id: 'model-' + i })) });
  });
  const result = await fetchModelCatalogue({ provider: 'openrouter', endpoint });
  expect(result.models).toHaveLength(2000);
  expect(result.truncated).toBe(true);
  mode = 'loop';
  requests = 0;
  await expect(fetchModelCatalogue({ provider: 'anthropic', endpoint })).rejects.toThrow(
    'pagination cursor',
  );
  expect(requests).toBe(2);
  mode = 'invalid';
  await expect(fetchModelCatalogue({ provider: 'openai', endpoint })).rejects.toThrow(
    'supported model catalogue',
  );
  mode = 'oversized';
  await expect(fetchModelCatalogue({ provider: 'openai', endpoint })).rejects.toThrow('8 MiB');
});

test('Studio HTTP exposes model discovery and selection with authentication and safe service diagnostics', async () => {
  const { Studio } = await import('./studio');
  const { serveStudio } = await import('./server');
  const { connections, file } = await store();
  let fail = false,
    inference = 0;
  const endpoint = catalogue(() =>
    fail
      ? new Response('provider says key=do-not-expose', { status: 401 })
      : Response.json({ data: [{ id: 'coder' }] }),
  );
  const state = await connections.save({
    name: 'Maker',
    provider: 'compatible',
    endpoint,
    key: 'do-not-expose',
    model: 'alias',
    steps: 100,
  });
  const c = state.connections[0];
  const studio = new Studio({
    directory: join(file, '..', 'studio'),
    connections,
    agent: {
      get model() {
        return connections.model;
      },
      async run() {
        inference++;
      },
    },
    soyli: [],
    env: {},
  });
  await studio.initialize();
  cleanup.push(() => studio.close());
  const server = await serveStudio(studio, 0);
  cleanup.push(() => server.stop(true));
  const origin = server.url.origin;
  const { token } = await (await fetch(origin + '/api/session')).json();
  const post = (action: string, body: unknown, authorized = true) =>
    fetch(origin + '/api/connections/' + action, {
      method: 'POST',
      headers: {
        Origin: origin,
        'content-type': 'application/json',
        'x-studio-token': authorized ? token : 'wrong',
        'x-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
  const input = { id: c.id, provider: c.provider, endpoint };
  expect((await post('models', input, false)).status).toBe(403);
  const listing = await post('models', input);
  expect(listing.status).toBe(200);
  expect((await listing.json()).models).toEqual([{ id: 'coder', name: 'coder' }]);
  const selection = await post('model', { id: c.id, revision: c.revision, model: 'coder' });
  expect(selection.status).toBe(200);
  expect((await studio.state()).model).toBe('Maker / coder');
  fail = true;
  const error = await post('models', input);
  expect(error.ok).toBe(false);
  const diagnostic = await error.text();
  expect(diagnostic).toContain('HTTP 401');
  expect(diagnostic).toContain('fetch inference models');
  expect(diagnostic).toContain('No generation was requested');
  expect(diagnostic).not.toContain('do-not-expose');
  expect(inference).toBe(0);
});
