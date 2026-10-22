import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioRequests } from './requests';

test('request receipts survive restart, reject changed retries and retain ambiguous operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-receipts-'));
  const path = join(root, 'requests.sqlite');
  let journal = new StudioRequests(path);
  try {
    let calls = 0;
    const id = crypto.randomUUID(),
      now = Date.now();
    const action = async () => {
      calls++;
      return { status: 200, value: { ok: true } };
    };
    await Promise.all([
      journal.run('owner', id, now, 'hash', action),
      journal.run('owner', id, now, 'hash', action),
    ]);
    expect(calls).toBe(1);
    journal.close();
    journal = new StudioRequests(path);
    await journal.run('owner', id, now, 'hash', action);
    expect(calls).toBe(1);
    await expect(journal.run('owner', id, now, 'changed', action)).rejects.toThrow(
      'different input',
    );
    const failed = crypto.randomUUID();
    await expect(
      journal.run('owner', failed, now, 'hash', async () => {
        throw new Error('terminated');
      }),
    ).rejects.toThrow('terminated');
    journal.close();
    journal = new StudioRequests(path);
    await expect(journal.run('owner', failed, now, 'hash', action)).rejects.toThrow('restarted');
    await expect(
      journal.run('owner', crypto.randomUUID(), now - 86401000, 'hash', action),
    ).rejects.toThrow('expired');
    await journal.run('other', id, now, 'hash', action);
    expect(calls).toBe(2);
  } finally {
    journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
