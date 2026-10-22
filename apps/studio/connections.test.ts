import { test, expect } from 'bun:test';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections } from './connections';
import { agentEvents } from './agent';
import { reasoningLimits } from './types';

test('connection tests retain service status without echoing credentials and never follow redirects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-connections-'));
  const secret = 'test-provider-credential';
  let mode = 'good',
    calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      calls++;
      expect(req.headers.get('authorization')).toBe('Bearer ' + secret);
      if (mode === 'redirect') return Response.redirect('http://127.0.0.1:1/leak');
      if (mode === 'bad') return new Response(secret, { status: 401 });
      return Response.json({ data: [{ id: 'coder' }] });
    },
  });
  try {
    const connections = new Connections(root);
    await connections.initialize();
    const state = await connections.save({
      name: 'Local',
      provider: 'compatible',
      endpoint: server.url.href + 'v1',
      model: 'coder',
      key: secret,
      steps: 30,
    });
    expect((await stat(join(root, 'connections.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(state)).not.toContain(secret);
    expect((await connections.test(state.selected!)).message).toContain('selected model is listed');
    mode = 'bad';
    await expect(connections.test(state.selected!)).rejects.toThrow('HTTP 401');
    mode = 'redirect';
    await expect(connections.test(state.selected!)).rejects.toThrow('Could not reach');
    expect(calls).toBe(3);
    await connections.remove(state.selected!);
    const reloaded = new Connections(root);
    await reloaded.initialize({ key: 'seed-must-not-reappear', model: 'deepseek/test' });
    expect(reloaded.state().connections).toHaveLength(0);
    expect(await readFile(join(root, 'connections.json'), 'utf8')).not.toContain(secret);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
test('reasoning accepts only exposed text, bounds and redacts it, and excludes provider internals', () => {
  const normalized = agentEvents(
    JSON.stringify({
      type: 'reasoning',
      part: {
        id: 'prt_fixture',
        text: 'Check the source, then run the build.',
        metadata: { signature: 'opaque-signature' },
        encrypted_content: 'opaque-content',
      },
    }),
  );
  expect(normalized).toEqual([
    {
      type: 'reasoning',
      id: 'prt_fixture',
      text: 'Check the source, then run the build.',
      truncated: false,
    },
  ]);
  expect(
    agentEvents(
      JSON.stringify({ type: 'reasoning', part: { encrypted_content: 'opaque-content' } }),
    ),
  ).toEqual([]);
  expect(agentEvents(JSON.stringify({ type: 'reasoning', part: { text: '  ' } }))).toEqual([]);
  const [long] = agentEvents(
    JSON.stringify({ type: 'reasoning', part: { text: 'x'.repeat(20000) } }),
  );
  expect(long.type).toBe('reasoning');
  if (long.type === 'reasoning') {
    expect(long.text).toHaveLength(reasoningLimits.characters);
    expect(long.truncated).toBe(true);
  }
  const [redacted] = agentEvents(
    JSON.stringify({
      type: 'reasoning',
      part: { text: 'api_key=fixture-key\nNext step: verify.' },
    }),
  );
  expect(JSON.stringify(redacted)).not.toContain('fixture-key');
  expect(JSON.stringify(redacted)).toContain('Next step: verify.');
});
test('activity excludes tool arguments while reporting step exhaustion', () => {
  const events = agentEvents(
    JSON.stringify({
      type: 'tool_use',
      part: { tool: 'bash', state: { status: 'completed', input: { command: 'secret command' } } },
    }),
  );
  expect(JSON.stringify(events)).not.toContain('secret command');
  expect(
    agentEvents(
      JSON.stringify({
        type: 'text',
        part: { text: 'Maximum steps for this agent have been reached.' },
      }),
    ),
  ).toContainEqual({ type: 'limit' });
});
