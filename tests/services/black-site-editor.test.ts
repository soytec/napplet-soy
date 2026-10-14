import { test, expect } from 'bun:test';
import { chromium, expect as ui, type Page, type Frame } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  finalizeEvent,
  getPublicKey,
  matchFilters,
  verifyEvent,
  type NostrEvent,
} from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

// Local fixture identities only. App code gets the actual source host shim, never fake domains.
test('native Black Site editor publishes, updates, remixes and deletes through real host; game plays uploaded map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'black-site-editor-host-'));
  const keys = [new Uint8Array(32).fill(61), new Uint8Array(32).fill(62)],
    pubkeys = keys.map(getPublicKey);
  const events: NostrEvent[] = [];
  const blobs = new Map<string, Uint8Array>();
  let puts = 0;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256',
  };
  const blossom: Bun.Server<any> = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const path = new URL(request.url).pathname;
      if (path === '/upload' && request.method === 'PUT') {
        const auth = JSON.parse(atob(request.headers.get('authorization')!.slice(6))),
          data = new Uint8Array(await request.arrayBuffer()),
          hash = await sha256(data);
        if (
          !verifyEvent(auth) ||
          !pubkeys.includes(auth.pubkey) ||
          !auth.tags.some((t: string[]) => t[0] === 'x' && t[1] === hash)
        )
          return new Response('bad auth', { status: 403, headers: cors });
        puts++;
        blobs.set(hash, data);
        return Response.json(
          { sha256: hash, size: data.length, url: `http://127.0.0.1:${blossom.port}/${hash}` },
          { status: 201, headers: cors },
        );
      }
      const data = blobs.get(path.slice(1).replace(/\.json$/, ''));
      return new Response(data ? new Uint8Array(data).buffer : null, {
        status: data ? 200 : 404,
        headers: cors,
      });
    },
  });
  const blossomUrl = `http://127.0.0.1:${blossom.port}`;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(ws, raw) {
        const [type, value, ...filters] = JSON.parse(String(raw));
        if (type === 'REQ') {
          const matching = new Map<string, NostrEvent>();
          for (const filter of filters)
            for (const event of events
              .filter((e) => matchFilters([filter], e))
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, filter.limit ?? 100))
              matching.set(event.id, event);
          for (const event of matching.values()) ws.send(JSON.stringify(['EVENT', value, event]));
          ws.send(JSON.stringify(['EOSE', value]));
        } else if (type === 'EVENT') {
          const valid = verifyEvent(value);
          if (valid) events.push(value);
          ws.send(JSON.stringify(['OK', value.id, valid, '']));
        }
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  for (const key of keys)
    events.push(
      finalizeEvent(
        {
          kind: 10002,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [['r', relayUrl]],
        },
        key,
      ),
    );
  const previews: ReturnType<typeof startPreviewServer>[] = [];
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const assets = await previewAssets();
    async function project(name: string, source: string) {
      const dir = join(root, name);
      await Bun.write(join(dir, 'index.html'), await readFile(source));
      await Bun.write(
        join(dir, 'napplet.json'),
        JSON.stringify({
          schema: 'space-local-project/v1',
          name,
          entry: 'index.html',
          previewId: crypto.randomUUID(),
          license: 'MIT',
          relays: [relayUrl],
          servers: [blossomUrl],
        }),
      );
      const preview = startPreviewServer(pathToFileURL(dir + '/'), 0, false, assets);
      previews.push(preview);
      return preview.url.href;
    }
    const editorBytes = new Uint8Array(await readFile('../black-site-editor/dist/index.html'));
    const editorHash = await sha256(editorBytes);
    blobs.set(editorHash, editorBytes);
    const editorManifest = finalizeEvent(
      {
        kind: 35129,
        content: 'Black Site map editor fixture',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'fixture-map-editor'],
          ['title', 'Fixture map editor'],
          ['x', editorHash],
          ['z', 'map'],
          ...['edit', 'open', 'remix', 'new'].map((action) => [
            'i',
            `napplet:map/${action}`,
            'address',
            'relays',
          ]),
        ],
      },
      keys[0],
    );
    const editorUrl = await project('Black Site editor', '../black-site-editor/dist/index.html');
    const gameUrl = await project('Black Site', '../black-site/dist/index.html');
    async function player(url: string, identity: number) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => {
        errors.push(e.message);
        console.error('PAGE ERROR STACK', e.stack);
      });
      await page.exposeFunction('fixtureSign', (template: any) =>
        finalizeEvent(template, keys[identity]),
      );
      await page.addInitScript(
        ({ pubkey, relayUrl, blossomUrl }) => {
          if (window !== top) return;
          localStorage.setItem(
            'napplet:network',
            JSON.stringify({ relays: [relayUrl], blossom: [blossomUrl] }),
          );
          (window as any).nostr = {
            getPublicKey: async () => pubkey,
            signEvent: (template: any) => (window as any).fixtureSign(template),
          };
        },
        { pubkey: pubkeys[identity], relayUrl, blossomUrl },
      );
      await page.goto(url);
      await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
      const frame = page.frames().find((f) => f.parentFrame())!;
      await ui
        .poll(() => frame.evaluate(() => (window as any).napplet.identity.getPublicKey()))
        .toBe(pubkeys[identity]);
      return { page, frame };
    }
    async function publish(page: Page, target?: Frame) {
      const frame = target ?? page.frames().find((f) => f.parentFrame())!;
      await frame.locator('#publish').click();
      await frame.locator('#confirm-ok').click();
      try {
        await page.getByRole('button', { name: 'Approve upload', exact: true }).click();
      } catch (error) {
        console.error('EDITOR STATUS', await frame.locator('#status').innerText());
        console.error('HOST', await page.locator('body').innerText());
        throw error;
      }
      try {
        await page.getByRole('button', { name: 'Approve & publish', exact: true }).click();
      } catch (error) {
        console.error('POST UPLOAD STATUS', await frame.locator('#status').innerText());
        console.error('HOST', await page.locator('body').innerText());
        throw error;
      }
      await ui(frame.locator('#status')).toContainText('Published');
    }
    const alice = await player(editorUrl, 0);
    await ui(alice.frame.locator('#publish')).toBeEnabled();
    await alice.frame.locator('#id').fill('host-operation');
    await alice.frame.locator('#id').dispatchEvent('change');
    await alice.frame.locator('#name').fill('Host Operation');
    await alice.frame.locator('#name').dispatchEvent('change');
    await publish(alice.page);
    const first = events.find((e) => e.kind === 35858 && e.pubkey === pubkeys[0])!;
    expect(first).toBeDefined();
    expect(verifyEvent(first)).toBe(true);
    expect(first.tags.find((t) => t[0] === 'd')?.[1]).toBe('host-operation');
    const firstHash = first.tags.find((t) => t[0] === 'x')![1];
    expect(blobs.has(firstHash)).toBe(true);
    await alice.frame.locator('#name').fill('Updated Operation');
    await alice.frame.locator('#name').dispatchEvent('change');
    await publish(alice.page);
    expect(events.filter((e) => e.kind === 35858 && e.pubkey === pubkeys[0])).toHaveLength(2);
    await alice.page.reload();
    await alice.page
      .getByRole('button', { name: 'Connect browser extension', exact: true })
      .click();
    await alice.page.locator('iframe').waitFor();
    alice.frame = alice.page.frames().find((f) => f.parentFrame())!;
    await ui(alice.frame.locator('#identity')).toContainText(pubkeys[0].slice(0, 12));
    await alice.frame.locator('#library-open').click();
    await alice.frame.locator('#my-maps').click();
    await ui(alice.frame.locator('.map-card h3')).toHaveText('Updated Operation');
    await alice.frame
      .locator('.map-card')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await ui(alice.frame.locator('#name')).toHaveValue('Updated Operation');
    const bob = await player(editorUrl, 1);
    await bob.frame.locator('#library-open').click();
    await bob.frame.locator('#community-maps').click();
    const parent = bob.frame.locator('.map-card').filter({ hasText: 'Updated Operation' });
    await parent.getByRole('button', { name: 'Remix', exact: true }).click();
    await ui(bob.frame.locator('#status')).toContainText('Remix ready');
    await publish(bob.page);
    const remix = events.find((e) => e.kind === 35858 && e.pubkey === pubkeys[1])!;
    expect(
      remix.tags.some((t) => t[0] === 'a' && t[1] === `35858:${pubkeys[0]}:host-operation`),
    ).toBe(true);
    const game = await player(gameUrl, 0);
    await game.frame.locator('[data-go=maps]').click();
    await game.frame.locator('#ownMaps').click();
    await ui(game.frame.locator('.community-map strong')).toHaveText('Updated Operation');
    await game.page.getByText('Network settings', { exact: true }).click();
    await game.page.getByText('Napplet handlers', { exact: true }).click();
    await game.page.getByLabel('Install signed napplet manifest').setInputFiles({
      name: 'editor.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(editorManifest)),
    });
    await ui(game.page.getByText('Installed Fixture map editor.', { exact: true })).toBeVisible();
    await game.page.getByText('Network settings', { exact: true }).click();
    await game.frame.locator('.community-map button').nth(1).click();
    await ui(game.page.getByRole('button', { name: 'Close napplet', exact: true })).toBeVisible();
    await ui.poll(() => game.page.frames().filter((f) => f.parentFrame()).length).toBe(2);
    const delivered = game.page
      .frames()
      .filter((f) => f.parentFrame())
      .find((f) => f !== game.frame)!;
    await ui(delivered.locator('#name')).toHaveValue('Updated Operation');
    await ui(delivered.locator('#id')).toHaveValue('host-operation');
    await ui(delivered.locator('#id')).toBeDisabled();
    await delivered.locator('#name').fill('Handed-off Operation');
    await delivered.locator('#name').dispatchEvent('change');
    await delivered
      .locator('#desc')
      .fill('Updated inside the game INTENT target using its connected viewer signer.');
    await delivered.locator('#desc').dispatchEvent('change');
    await publish(game.page, delivered);
    const handoffUpdate = events.filter((e) => e.kind === 35858 && e.pubkey === pubkeys[0]).at(-1)!;
    expect(verifyEvent(handoffUpdate)).toBe(true);
    expect(handoffUpdate.tags.find((tag) => tag[0] === 'd')?.[1]).toBe('host-operation');
    expect(handoffUpdate.tags.find((tag) => tag[0] === 'summary')?.[1]).toContain('INTENT target');
    expect(events.filter((e) => e.kind === 35858 && e.pubkey === pubkeys[0])).toHaveLength(3);
    await game.page.getByRole('button', { name: 'Close napplet', exact: true }).click();
    await game.frame.locator('#ownMaps').click();
    await ui(game.frame.locator('.community-map strong')).toHaveText('Handed-off Operation');
    await ui(game.frame.locator('.community-map p')).toContainText('INTENT target');
    await game.frame.locator('.community-map button').first().click();
    await ui(game.frame.locator('#menuMap')).toContainText('Handed-off Operation');
    await game.frame.locator('[data-go=deploy]').first().click();
    try {
      await ui(game.frame.locator('#menu')).not.toHaveClass(/on/);
    } catch (error) {
      console.error('GAME ERRORS', errors);
      throw error;
    }
    await game.page.waitForTimeout(1200);
    expect(errors).toEqual([]);
    await alice.frame.locator('#library-open').click();
    await alice.frame.locator('#my-maps').click();
    await alice.frame
      .locator('.map-card')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await alice.frame.locator('#confirm-ok').click();
    await alice.page.getByRole('button', { name: 'Approve & publish', exact: true }).click();
    await ui(alice.frame.locator('#status')).toContainText('Deletion request published');
    expect(
      events.some(
        (e) =>
          e.kind === 5 &&
          e.pubkey === pubkeys[0] &&
          e.tags.some((t) => t[0] === 'a' && t[1] === `35858:${pubkeys[0]}:host-operation`),
      ),
    ).toBe(true);
    expect(puts).toBe(4);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    for (const preview of previews) preview.stop(true);
    relay.stop(true);
    blossom.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 180000);
