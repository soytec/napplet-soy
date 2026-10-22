import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { sha256 } from '../../../packages/protocol/src';
import { StudioSessions } from './sessions';
import { HostedPreviews } from './previews';

test('private previews require a live owner session and expose only the sandbox host and immutable artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-private-preview-'));
  const origin = 'https://studio.example',
    key = generateSecretKey(),
    owner = getPublicKey(key),
    client = getPublicKey(generateSecretKey());
  const sessions = new StudioSessions(origin, () => true);
  const body = JSON.stringify({ client, nonce: crypto.randomUUID() });
  const event = finalizeEvent(
    {
      kind: 27235,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', origin + '/api/studio/session'],
        ['method', 'POST'],
        ['payload', await sha256(body)],
      ],
    },
    key,
  );
  await sessions.authorize('Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64'), body);
  const previews = new HostedPreviews(origin, sessions);
  try {
    await writeFile(
      join(root, 'napplet.json'),
      JSON.stringify({ title: 'Private', previewId: crypto.randomUUID(), entry: 'index.html' }),
    );
    await writeFile(join(root, 'index.html'), '<html><body>Private game</body></html>');
    const preview = await previews.open(owner, root);
    expect((await previews.fetch(new Request(preview.url))).status).toBe(403);
    expect(() => previews.grant('b'.repeat(64), client, preview.url)).toThrow('unavailable');
    const grant = previews.grant(owner, client, preview.url);
    const response = await previews.fetch(new Request(grant));
    expect(response.status).toBe(302);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    const headers = { Cookie: cookie.split(';')[0] };
    expect((await previews.fetch(new Request(grant, { headers }))).status).toBe(302);
    expect((await previews.fetch(new Request(grant))).status).toBe(403);
    const html = await previews.fetch(new Request(preview.url, { headers }));
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('./runtime.js');
    const revision = await (
      await previews.fetch(new Request(preview.url + 'revision', { headers }))
    ).json();
    const artifact = await previews.fetch(
      new Request(preview.url + 'artifacts/' + revision.artifactHash, { headers }),
    );
    expect(artifact.headers.get('content-type')).toBe('application/octet-stream');
    expect(artifact.headers.get('content-security-policy')).toContain('sandbox');
    expect((await previews.fetch(new Request(preview.url + 'manager', { headers }))).status).toBe(
      403,
    );
    expect(
      (await previews.fetch(new Request(preview.url, { method: 'POST', headers }))).status,
    ).toBe(403);
    sessions.revoke(client);
    expect((await previews.fetch(new Request(preview.url, { headers }))).status).toBe(403);
    preview.stop();
  } finally {
    previews.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
