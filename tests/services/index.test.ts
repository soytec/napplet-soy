import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { buildRelay, relayBinary } from '../../scripts/relay';
import { createBlossom } from '../../services/blossom/server';
import { uploadBlob } from '../../packages/blossom/src/client';
import { PublicationRelays } from '../../packages/publish/src/relay';
import { confirmWebsite } from '../../packages/publish/src/website';
import { aggregateHash, encodeAddress, identityAddress, sha256 } from '../../packages/protocol/src';

test('32 MiB napplet: relay → index worker → production SSR → sandbox playback survives worker restart', async () => {
  const root = resolve(import.meta.dir, '../..');
  const directory = await mkdtemp(join(tmpdir(), 'napplet-index-services-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let blossom: Awaited<ReturnType<typeof createBlossom>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const relays = new PublicationRelays();
  async function processWithUrl(args: string[], env: Record<string, string>, pattern: RegExp) {
    const child = Bun.spawn(args, {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(child);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    const reader = child.stdout.getReader();
    let output = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`Service exited: ${output}`);
        output += new TextDecoder().decode(value);
        const match = pattern.exec(output);
        if (match) return match[1];
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
      void (async () => {
        for await (const _ of child.stdout) {
          /* drain */
        }
      })();
    }
  }
  try {
    await buildRelay();
    const relayOrigin = await processWithUrl(
      [relayBinary],
      {
        SPACE_SERVICE_DATA: join(directory, 'relay'),
        SPACE_SERVICE_BIND: '127.0.0.1:0',
        SPACE_SERVICE_URL: 'http://127.0.0.1/relay',
        SPACE_SERVICE_INSTANCE: 'index-test',
      },
      /listening on (http:\/\/127\.0\.0\.1:\d+)/,
    );
    const relay = `${relayOrigin.replace('http:', 'ws:')}/relay`;
    blossom = await createBlossom({
      directory: join(directory, 'blossom'),
      origin: 'http://127.0.0.1:19348',
      local: true,
      port: 0,
      instance: 'index-test',
      build: 'test',
    });
    const origin = `http://127.0.0.1:${blossom.server.port}`;
    const bytes = new TextEncoder().encode(
      '<!doctype html><title>Relay arrival</title><h1>Arrived through Nostr</h1><button onclick="this.textContent=\'It works\'">Try me</button>'.padEnd(
        32 * 1024 * 1024,
        ' ',
      ),
    );
    const hash = await sha256(bytes),
      signer = new PrivateKeySigner();
    await uploadBlob({ origin, bytes, type: 'text/html', signer, local: true });
    const identity = {
      kind: 35129 as const,
      pubkey: await signer.getPublicKey(),
      identifier: 'relay-arrival',
    };
    const tags = [
      ['title', 'Relay arrival'],
      ['description', 'An ordinary signed napplet'],
      ['t', 'visual'],
      ['path', '/index.html', hash],
      ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
      ['server', origin],
    ];
    const created_at = Math.floor(Date.now() / 1000);
    const current = await signer.signEvent({
      kind: 35129,
      created_at,
      content: '',
      tags: [...tags, ['d', identity.identifier]],
    });
    const snapshot = await signer.signEvent({
      kind: 5129,
      created_at,
      content: '',
      tags: [...tags, ['a', identityAddress(identity)]],
    });
    const env = {
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: relay,
      SPACE_INDEX_LOCAL_BLOSSOM: origin,
      SPACE_RELEASE_ID: 'index-test',
    };
    const startWorker = () => {
      const child = Bun.spawn([process.execPath, 'services/indexer/index.ts'], {
        cwd: root,
        env: { PATH: process.env.PATH, ...env },
        stdout: 'ignore',
        stderr: 'inherit',
      });
      children.push(child);
      return child;
    };
    let worker = startWorker();
    const site = await processWithUrl(
      [process.execPath, 'apps/web/server.ts'],
      {
        ...env,
        PORT: '0',
        HOST: '127.0.0.1',
        SPACE_PUBLICDEV: '0',
      },
      /listening on (http:\/\/127\.0\.0\.1:\d+)/,
    );
    // Publish after both processes start: no startup seed or publisher hook can populate this index.
    await relays.ensure(relay, snapshot);
    await relays.ensure(relay, current);
    const publication = {
      current,
      snapshot,
      plan: {
        pubkey: identity.pubkey,
        identifier: identity.identifier,
        artifactHash: hash,
        targets: { site },
      },
    };
    expect(await confirmWebsite(publication)).toMatchObject({ ready: true });
    const naddr = encodeAddress(identity, [relay]);
    for (const path of [`/n/${naddr}`, `/r/${snapshot.id}`]) {
      const response = await fetch(site + path),
        html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('Relay arrival');
      expect(html).toContain('og:image');
    }
    expect(await (await fetch(`${origin}/${hash}`)).bytes()).toEqual(bytes);
    const og = await fetch(`${site}/api/og/${current.id}`);
    expect(og.headers.get('content-type')).toBe('image/png');
    expect(og.status).toBe(200);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${site}/n/${naddr}`);
    expect(await page.locator('iframe').count()).toBe(0);
    await page.getByRole('button', { name: 'Start Relay arrival' }).click();
    const button = page.frameLocator('iframe').getByRole('button', { name: 'Try me' });
    await button.click();
    expect(
      await page.frameLocator('iframe').getByRole('button', { name: 'It works' }).textContent(),
    ).toBe('It works');
    expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    expect(errors).toEqual([]);
    worker.kill('SIGTERM');
    expect(await worker.exited).toBe(0);
    expect((await fetch(`${site}/r/${snapshot.id}`)).status).toBe(200);
    worker = startWorker();
    expect(await confirmWebsite(publication)).toMatchObject({ ready: true });
    await page.goto(site);
    expect(await page.locator('.napplet-card').filter({ hasText: 'Relay arrival' }).count()).toBe(
      1,
    );
  } finally {
    relays.close();
    await browser?.close();
    for (const child of children) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
      await child.exited;
      clearTimeout(timeout);
    }
    await blossom?.close(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
