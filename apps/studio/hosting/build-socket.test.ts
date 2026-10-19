import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSocket } from './build-socket';

test('the real browser-check socket preserves the actionable cause and redacts credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-check-'));
  const path = join(root, 'check.sock');
  const socket = await buildSocket(path, new AbortController().signal, async () => {
    throw new Error(
      'The browser disconnected before compilation.\nAuthorization: Bearer secret-fixture',
    );
  });
  try {
    const response = await fetch('http://studio/check', { unix: path, method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
    const { result } = await response.json();
    expect(result).toContain('STUDIO_BROWSER_CHECK');
    expect(result).toContain('browser disconnected before compilation');
    expect(result).toContain('studio_check again');
    expect(result).not.toContain('secret-fixture');
  } finally {
    await socket.close();
    await rm(root, { recursive: true, force: true });
  }
});
