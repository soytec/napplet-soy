import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferenceSocket } from './inference';
import { HostedConnections } from './connections';

test('hosted connection settings reject custom destinations before saving or testing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-hosted-connections-'));
  try {
    const connections = new HostedConnections(root, 'a'.repeat(64), new Uint8Array(32).fill(1));
    await connections.initialize();
    const input = {
      name: 'test',
      provider: 'compatible',
      endpoint: 'http://127.0.0.1:8080',
      model: 'test',
      steps: 100,
      key: 'test-key',
    };
    await expect(connections.save(input)).rejects.toThrow('default endpoint');
    await expect(
      connections.save({ ...input, endpoint: 'https://untrusted.example' }),
    ).rejects.toThrow('default endpoint');
    expect(connections.state().connections).toHaveLength(0);
    await connections.save({
      ...input,
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/v1',
    });
    expect(connections.state().connections).toHaveLength(1);
    expect(JSON.stringify(connections.state())).not.toContain('test-key');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the job inference socket confines provider, model and credentials and enforces its budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-broker-'));
  const socket = join(root, 'inference.sock'),
    controller = new AbortController();
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const upstream = async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return Response.json({ choices: [{ message: { content: 'done' } }] });
  };
  const connection = {
    name: 'test',
    provider: 'deepseek' as const,
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    steps: 10,
    key: 'test-credential-not-for-container',
  };
  const broker = await inferenceSocket(socket, connection, controller.signal, upstream);
  const send = (
    path = '/chat/completions',
    body: unknown = { model: connection.model, messages: [] },
  ) =>
    fetch('http://broker' + path, {
      unix: socket,
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', 'x-api-key': 'attacker' },
      body: JSON.stringify(body),
    });
  try {
    expect((await send('/files')).status).toBe(403);
    expect((await send('/chat/completions', { model: 'other-model' })).status).toBe(400);
    expect(
      (
        await send('/chat/completions', {
          model: connection.model,
          tools: [{ type: 'web_search' }],
        })
      ).status,
    ).toBe(400);
    expect((await send('/chat/completions?url=https://evil.example')).status).toBe(400);
    expect(calls).toHaveLength(0);
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(connection.key);
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0].options.redirect).toBe('error');
    expect(calls[0].options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + connection.key,
    });
    expect(JSON.parse(calls[0].options.body as string).max_tokens).toBeUndefined();
    for (let n = 1; n < 14; n++) await (await send()).text();
    expect((await send()).status).toBe(200);
    expect(calls).toHaveLength(15);
    controller.abort();
    expect((await send()).status).toBe(410);
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the inference broker preserves provider output budgets without injecting a Studio token cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-budgets-'));
  try {
    for (const [provider, endpoint, path, field] of [
      ['deepseek', 'https://api.deepseek.com/v1', '/chat/completions', 'max_tokens'],
      ['openai', 'https://api.openai.com/v1', '/chat/completions', 'max_completion_tokens'],
      ['openai', 'https://api.openai.com/v1', '/responses', 'max_output_tokens'],
      ['anthropic', 'https://api.anthropic.com/v1', '/messages', 'max_tokens'],
      [
        'google',
        'https://generativelanguage.googleapis.com/v1beta',
        '/models/fixture:generateContent',
        'maxOutputTokens',
      ],
    ] as const) {
      const socket = join(root, 'broker.sock');
      const bodies: any[] = [];
      const broker = await inferenceSocket(
        socket,
        {
          name: 'Fixture',
          provider,
          endpoint,
          model: 'fixture',
          steps: 10,
          key: 'fixture-key',
        },
        new AbortController().signal,
        async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ ok: true });
        },
      );
      try {
        for (const budget of [undefined, 65536, 4096, 0, -1, 1.5]) {
          const limits = budget === undefined ? {} : { [field]: budget };
          const response = await fetch('http://broker' + path, {
            unix: socket,
            method: 'POST',
            body: JSON.stringify({
              model: 'fixture',
              ...(provider === 'google' ? { generationConfig: limits } : limits),
            }),
          });
          const valid = budget === undefined || (Number.isSafeInteger(budget) && budget > 0);
          expect(response.status).toBe(valid ? 200 : 400);
          await response.text();
          if (valid) {
            const body = bodies.at(-1);
            expect((provider === 'google' ? body.generationConfig : body)[field]).toBe(budget);
          }
        }
      } finally {
        await broker.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted inference refuses local/custom destinations and sanitizes provider failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-broker-'));
  const signal = new AbortController().signal;
  const connection = {
    name: 'test',
    provider: 'anthropic' as const,
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-test',
    steps: 10,
    key: 'sensitive-test-key',
  };
  try {
    await expect(
      inferenceSocket(
        join(root, 'bad.sock'),
        { ...connection, endpoint: 'http://127.0.0.1' },
        signal,
      ),
    ).rejects.toThrow('default endpoint');
    const broker = await inferenceSocket(
      join(root, 'ok.sock'),
      connection,
      signal,
      async () => new Response(connection.key, { status: 401 }),
    );
    try {
      const response = await fetch('http://broker/messages', {
        unix: join(root, 'ok.sock'),
        method: 'POST',
        body: JSON.stringify({ model: connection.model, max_tokens: 100 }),
      });
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('HTTP 401');
      expect(text).not.toContain(connection.key);
    } finally {
      await broker.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
