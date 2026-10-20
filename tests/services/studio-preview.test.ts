import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { browserEngine } from '../../apps/cli/src/browser';
import { HostedPreviews } from '../../apps/studio/hosting/previews';
import { StudioSessions } from '../../apps/studio/hosting/sessions';
import { sha256 } from '../../packages/protocol/src';

test('the private preview player downloads verified HTML with its cookie and runs the game', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-preview-browser-'));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let previews: HostedPreviews | undefined;
  let browser:
    | Awaited<ReturnType<Awaited<ReturnType<typeof browserEngine>>['chromium']['launch']>>
    | undefined;
  try {
    // Exercise Secure/HttpOnly cookies over real HTTPS, not manually copied headers.
    const certificate = Bun.spawn(
      [
        'openssl',
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-keyout',
        join(root, 'key.pem'),
        '-out',
        join(root, 'cert.pem'),
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );
    const certificateError = await new Response(certificate.stderr).text();
    if (await certificate.exited) throw new Error('Test certificate failed: ' + certificateError);
    let previewUrl = '';
    const downloads: { status: number; cookie: boolean }[] = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      tls: { key: Bun.file(join(root, 'key.pem')), cert: Bun.file(join(root, 'cert.pem')) },
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/')
          return new Response(`<iframe title="Studio preview" src="${previewUrl}"></iframe>`, {
            headers: { 'Content-Type': 'text/html' },
          });
        if (!path.startsWith('/api/studio/preview/')) return new Response(null, { status: 404 });
        const response = await previews!.fetch(request);
        if (path.includes('/artifacts/'))
          downloads.push({ status: response.status, cookie: request.headers.has('cookie') });
        return response;
      },
    });
    const origin = server.url.origin;
    const sessions = new StudioSessions(origin, () => true);
    const key = generateSecretKey(),
      owner = getPublicKey(key),
      client = getPublicKey(generateSecretKey());
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
    await sessions.authorize(
      'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64'),
      body,
    );
    await writeFile(
      join(root, 'napplet.json'),
      JSON.stringify({
        title: 'Private playable preview',
        previewId: crypto.randomUUID(),
        entry: 'index.html',
      }),
    );
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><button>Play</button><output>0</output>
      <script>document.querySelector('button').onclick=()=>document.querySelector('output').textContent='1'</script>`,
    );
    previews = new HostedPreviews(origin, sessions);
    const preview = await previews.open(owner, root);
    previewUrl = previews.grant(owner, client, preview.url);
    browser = await (await browserEngine()).chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe')!;
      const previewDocument = frame.contentDocument;
      return (
        previewDocument?.querySelector('#stage iframe') ||
        previewDocument?.querySelector('#status')?.textContent?.includes('Download unavailable')
      );
    });
    const host = page.frames().find((frame) => frame.url().startsWith(preview.url))!;
    expect(await host.locator('#status').textContent()).not.toContain('Download unavailable');
    const game = host.childFrames()[0]!;
    expect(game).toBeDefined();
    await game.getByRole('button', { name: 'Play' }).click();
    expect(await game.locator('output').textContent()).toBe('1');
    expect(downloads).toContainEqual({ status: 200, cookie: true });
    expect(await game.evaluate(() => location.origin)).toBe('null');
    const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
    expect((await anonymous.request.get(preview.url + 'revision')).status()).toBe(403);
    sessions.revoke(client);
    expect(await host.evaluate(async () => (await fetch('./revision')).status)).toBe(403);
  } finally {
    await browser?.close();
    previews?.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
