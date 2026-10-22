import { test, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agentCheckTool } from './agent-check';

test('agent check exposes only the current workspace compiler with authenticated, revocable access', async () => {
  let calls = 0;
  const bridge = await agentCheckTool(async () =>
    ++calls === 1 ? 'TS2304: Cannot find name missingOrb' : 'Browser build passed',
  );
  const client = new Client({ name: 'fixture', version: '1' });
  try {
    expect((await fetch(bridge.config.url)).status).toBe(403);
    expect(
      (
        await fetch(bridge.config.url, {
          headers: { ...bridge.config.headers, Origin: 'http://localhost:3000' },
        })
      ).status,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(bridge.config.url), {
        requestInit: { headers: bridge.config.headers },
      }),
    );
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['check']);
    const failed = await client.callTool({ name: 'check', arguments: {} });
    expect(JSON.stringify(failed)).toContain('TS2304');
    expect(JSON.stringify(await client.callTool({ name: 'check', arguments: {} }))).toContain(
      'passed',
    );
    expect((await client.callTool({ name: 'publish', arguments: {} })).isError).toBe(true);
    expect(calls).toBe(2);
  } finally {
    await client.close();
    await bridge.close();
  }
  await expect(fetch(bridge.config.url, { headers: bridge.config.headers })).rejects.toThrow();
});

test('ending the inference process cancels a pending browser check', async () => {
  let started = false,
    cancelled = false;
  const bridge = await agentCheckTool(
    (signal) =>
      new Promise((_, reject) => {
        started = true;
        signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  );
  const client = new Client({ name: 'fixture', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(bridge.config.url), {
        requestInit: { headers: bridge.config.headers },
      }),
    );
    const pending = client.callTool({ name: 'check', arguments: {} }).catch(() => {});
    for (let i = 0; !started && i < 100; i++) await Bun.sleep(5);
    expect(started).toBe(true);
    await bridge.close();
    await pending;
    expect(cancelled).toBe(true);
  } finally {
    await client.close();
  }
});
