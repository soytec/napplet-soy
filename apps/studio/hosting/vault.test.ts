import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connectionVault } from './vault';
import { HostedConnections } from './connections';

test('hosted connections survive restart encrypted and cannot be moved across owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-vault-'));
  const master = crypto.getRandomValues(new Uint8Array(32)),
    owner = 'a'.repeat(64);
  const key = 'private-provider-test-key';
  try {
    const first = new HostedConnections(root, owner, master);
    await first.initialize();
    await first.save({
      name: 'My provider',
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com/v1',
      model: 'fixture',
      steps: 100,
      key,
    });
    const bytes = await readFile(join(root, 'connections.json'), 'utf8');
    expect(bytes).not.toContain(key);
    expect(bytes).not.toContain('My provider');
    expect((await stat(join(root, 'connections.json'))).mode & 0o777).toBe(0o600);
    const reopened = new HostedConnections(root, owner, master);
    await reopened.initialize();
    expect(reopened.current().key).toBe(key);
    expect(JSON.stringify(reopened.state())).not.toContain(key);
    await expect(new HostedConnections(root, 'b'.repeat(64), master).initialize()).rejects.toThrow(
      'Cannot read saved connections',
    );
    await expect(
      new HostedConnections(root, owner, new Uint8Array(32)).initialize(),
    ).rejects.toThrow('Cannot read saved connections');
    const altered = JSON.parse(bytes);
    altered.tag = Buffer.alloc(16).toString('base64');
    expect(() => connectionVault(master, owner).decode(JSON.stringify(altered))).toThrow(
      'Cannot unlock',
    );
    await expect(
      reopened.models({ provider: 'compatible', endpoint: 'http://127.0.0.1:1/v1', key: 'test' }),
    ).rejects.toThrow('default endpoint');
    await expect(
      reopened.models({ provider: 'deepseek', endpoint: 'https://other.invalid/v1', key: 'test' }),
    ).rejects.toThrow('default endpoint');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
