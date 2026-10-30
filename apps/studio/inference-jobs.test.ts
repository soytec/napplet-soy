import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections } from './connections';
import { Studio } from './studio';
import { serveStudio } from './server';
test('real Studio HTTP authenticates inference, isolates jobs and redacts provider failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-http-'));
  let calls = 0,
    fail = false;
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(r) {
      calls++;
      expect(r.headers.get('authorization')).toBe('Bearer fixture-secret');
      const input = await r.json();
      expect(input.messages[0].content[0].text).toBe('private input');
      return fail
        ? new Response('fixture-secret private input', { status: 401 })
        : Response.json({
            choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          });
    },
  });
  const connections = new Connections(join(root, 'connections'));
  await connections.initialize();
  const state = await connections.save({
    name: 'Fixture',
    provider: 'compatible',
    model: 'fixture',
    endpoint: provider.url.href + 'v1',
    key: 'fixture-secret',
    steps: 100,
    json: true,
  });
  const c = state.connections[0];
  const studio = new Studio({
    directory: join(root, 'studio'),
    connections,
    agent: { model: 'fixture', async run() {} },
    soyli: [],
    env: {},
  });
  await studio.initialize();
  const server = await serveStudio(studio, 0),
    origin = server.url.origin;
  try {
    const { token } = await (await fetch(origin + '/api/session')).json();
    const post = (action: string, body: unknown, auth = token) =>
      fetch(origin + '/api/connections/' + action, {
        method: 'POST',
        headers: {
          Origin: origin,
          'content-type': 'application/json',
          'x-studio-token': auth,
          'x-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
    const body = {
      handle: c.id + ':' + c.revision,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'private input' }] }],
      format: 'json',
    };
    expect((await post('llm-start', body, 'wrong')).status).toBe(403);
    expect(calls).toBe(0);
    const run = async () => {
      const start = await post('llm-start', body);
      expect(start.status).toBe(200);
      const { id } = await start.json();
      for (let i = 0; i < 100; i++) {
        const s = await (await post('llm-read', { id })).json();
        if (!s.pending) return s;
        await Bun.sleep(5);
      }
      throw new Error('fixture did not finish');
    };
    expect((await run()).result.text).toBe('{"ok":true}');
    fail = true;
    const error = await run();
    expect(error.error).toContain('HTTP 401');
    expect(JSON.stringify(error)).not.toContain('fixture-secret');
    expect(JSON.stringify(error)).not.toContain('private input');
    const { InferenceJobs } = await import('./inference-jobs');
    const isolated = new InferenceJobs(connections);
    await expect(isolated.action('llm-read', { id: crypto.randomUUID() })).rejects.toThrow(
      'expired',
    );
    isolated.close();
  } finally {
    server.stop(true);
    await studio.close();
    provider.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
