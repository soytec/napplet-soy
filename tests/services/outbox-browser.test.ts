import { expect, test } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  finalizeEvent,
  getPublicKey,
  matchFilters,
  nip19,
  verifyEvent,
  type Filter,
  type NostrEvent,
} from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

test('real OUTBOX shim: consent, NIP-65 fanout, partial failures and live reads in preview and website', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-outbox-'));
  const viewer = new Uint8Array(32).fill(51),
    creator = new Uint8Array(32).fill(52),
    recipientKey = new Uint8Array(32).fill(53);
  const pubkey = getPublicKey(viewer),
    recipient = getPublicKey(recipientKey);
  const records: NostrEvent[][] = [[], [], []];
  const writes: NostrEvent[][] = [[], [], []];
  let refuseInbox = false,
    signatures = 0;
  const relays = records.map((stored, index) =>
    Bun.serve<{ subs: Map<string, Filter[]> }>({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) =>
        server.upgrade(request, { data: { subs: new Map() } }) ? undefined : new Response(),
      websocket: {
        message(ws, raw) {
          const [type, value, ...filters] = JSON.parse(String(raw));
          if (type === 'REQ') {
            ws.data.subs.set(value, filters);
            for (const event of stored.filter((event) => matchFilters(filters, event)))
              ws.send(JSON.stringify(['EVENT', value, event]));
            ws.send(JSON.stringify(['EOSE', value]));
          } else if (type === 'CLOSE') ws.data.subs.delete(value);
          else if (type === 'EVENT') {
            writes[index].push(value);
            const accepted =
              verifyEvent(value) && !(refuseInbox && index === 2 && value.kind === 1);
            if (accepted && !stored.some((event) => event.id === value.id)) {
              stored.push(value);
              for (const [id, filters] of ws.data.subs)
                if (matchFilters(filters, value)) ws.send(JSON.stringify(['EVENT', id, value]));
              // Publish sockets and subscription sockets are separate connections.
              for (const peer of peers[index])
                if (peer !== ws)
                  for (const [id, filters] of peer.data.subs)
                    if (matchFilters(filters, value))
                      peer.send(JSON.stringify(['EVENT', id, value]));
            }
            ws.send(
              JSON.stringify([
                'OK',
                value.id,
                accepted,
                accepted ? '' : 'restricted: fixture inbox refused publication',
              ]),
            );
          }
        },
        open(ws) {
          peers[index].add(ws);
        },
        close(ws) {
          peers[index].delete(ws);
        },
      },
    }),
  );
  const peers = relays.map(() => new Set<any>());
  const urls = relays.map((relay) => `ws://127.0.0.1:${relay.port}/`);
  const now = Math.floor(Date.now() / 1000);
  const metadata = [
    finalizeEvent(
      { kind: 10002, created_at: now, content: '', tags: [['r', urls[1], 'write']] },
      viewer,
    ),
    finalizeEvent(
      { kind: 10002, created_at: now, content: '', tags: [['r', urls[2], 'read']] },
      recipientKey,
    ),
  ];
  records.forEach((events) => events.push(...metadata));
  const html = '<!doctype html><title>OUTBOX fixture</title><h1>OUTBOX fixture</h1>';
  const bytes = new TextEncoder().encode(html),
    hash = await sha256(bytes);
  const blossom = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(new URL(request.url).pathname === `/${hash}` ? bytes : null, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
  });
  const serverUrl = `http://127.0.0.1:${blossom.port}`;
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: now,
      content: 'Independent OUTBOX specimen',
      tags: [
        ['d', 'outbox-test'],
        ['title', 'OUTBOX fixture'],
        ['x', hash],
        ['server', serverUrl],
        ['R', 'shell'],
        ['R', 'outbox'],
      ],
    },
    creator,
  );
  records.forEach((events) => events.push(manifest));
  let preview: ReturnType<typeof startPreviewServer> | undefined;
  let web: ReturnType<typeof Bun.spawn> | undefined;
  const browser = await chromium.launch();
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'OUTBOX fixture',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: urls,
        servers: [serverUrl],
      }),
    );
    await Bun.write(join(root, 'index.html'), html);
    preview = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    web = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        SPACE_PUBLICDEV: '0',
        SPACE_INDEX_DIR: '',
        SPACE_COMMUNITY_DIR: join(root, 'community'),
        SPACE_INDEX_RELAYS: urls.join(','),
        SPACE_INDEX_LOCAL_BLOSSOM: serverUrl,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = (web.stdout as ReadableStream<Uint8Array>).getReader();
    let output = '',
      origin = '';
    while (!origin) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          'Website exited: ' + (await new Response(web.stderr as ReadableStream).text()),
        );
      output += new TextDecoder().decode(part.value);
      origin = /listening on (http:\/\/[^\s/]+)/.exec(output)?.[1] ?? '';
    }
    reader.releaseLock();
    for (const mode of ['preview', 'website']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(15000);
      await page.exposeFunction('fixtureSign', (template: any) => {
        signatures++;
        return finalizeEvent(template, viewer);
      });
      await page.addInitScript(
        ({ pubkey, urls, serverUrl }) => {
          if (window !== top) return;
          localStorage.setItem(
            'napplet:network',
            JSON.stringify({ relays: urls, blossom: [serverUrl] }),
          );
          (window as any).nostr = {
            getPublicKey: async () => pubkey,
            signEvent: (template: any) => (window as any).fixtureSign(template),
          };
        },
        { pubkey, urls, serverUrl },
      );
      await page.goto(
        mode === 'preview'
          ? preview.url.href
          : `${origin}/n/${nip19.naddrEncode({ kind: 35129, pubkey: manifest.pubkey, identifier: 'outbox-test', relays: urls })}`,
      );
      if (mode === 'website') await page.locator('.player-cover').click();
      await ui(
        page.frameLocator('iframe').getByRole('heading', { name: 'OUTBOX fixture' }),
      ).toBeVisible();
      const frame = page.frames().find((frame) => frame.parentFrame())!;
      const call = (script: string) => frame.evaluate(async (value) => (0, eval)(value), script);
      const template = (content: string) =>
        JSON.stringify({ kind: 1, created_at: now, content: `${mode}: ${content}`, tags: [] });
      expect(await call(`napplet.outbox.publish(${template('signed out')})`)).toMatchObject({
        ok: false,
      });
      if (mode === 'website') {
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
      await ui.poll(() => call('napplet.identity.getPublicKey()')).toBe(pubkey);
      expect(
        await call(
          `napplet.outbox.resolveRelays({pubkey:${JSON.stringify(pubkey)},direction:'read'})`,
        ),
      ).toMatchObject({ relays: [urls[1]] });
      const before = signatures;
      const denied = call(`napplet.outbox.publish(${template('denied')})`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await denied).toMatchObject({
        ok: false,
        error: expect.stringContaining('user-denied'),
      });
      expect(signatures).toBe(before);
      await call(
        `globalThis.received=[]; globalThis.subscription=napplet.outbox.subscribe({kinds:[1],authors:[${JSON.stringify(pubkey)}]},{timeoutMs:500}); subscription.on('event',value=>received.push(value));`,
      );
      const publish = async (content: string, options?: unknown) => {
        const pending = call(
          `napplet.outbox.publish(${template(content)},${JSON.stringify(options ?? {})})`,
        );
        await ui(page.getByRole('button', { name: 'Approve & publish' })).toBeVisible();
        await page.getByRole('button', { name: 'Approve & publish' }).click();
        return pending;
      };
      const own = await publish('own');
      expect(own).toMatchObject({ ok: true, relays: { [urls[1]]: true } });
      expect(records[0].some((event) => event.id === own.eventId)).toBe(false);
      await ui
        .poll(() => call(`received.some(value=>value.event.id===${JSON.stringify(own.eventId)})`))
        .toBe(true);
      expect(
        await call(
          `napplet.outbox.getEvent(${JSON.stringify(own.eventId)},{author:${JSON.stringify(pubkey)}})`,
        ),
      ).toMatchObject({ result: { event: { id: own.eventId } }, incomplete: false });
      expect(
        await call(
          `napplet.outbox.query({ids:[${JSON.stringify(own.eventId)}]},{authors:[${JSON.stringify(pubkey)}]})`,
        ),
      ).toMatchObject({ events: [{ event: { id: own.eventId } }], incomplete: false });
      const fanout = await publish('directed', { toInboxes: [recipient] });
      expect(fanout).toMatchObject({ ok: true, relays: { [urls[1]]: true, [urls[2]]: true } });
      expect(writes[1].find((event) => event.id === fanout.eventId)).toEqual(
        writes[2].find((event) => event.id === fanout.eventId),
      );
      const explicit = await publish('explicit', { toOutbox: false, relays: [urls[0]] });
      expect(explicit).toMatchObject({ ok: true, relays: { [urls[0]]: true } });
      refuseInbox = true;
      const partial = await publish('partial', { toInboxes: [recipient] });
      expect(partial).toMatchObject({
        ok: false,
        relays: { [urls[1]]: true, [urls[2]]: false },
        error: expect.stringContaining('fixture inbox refused'),
      });
      refuseInbox = false;
      await call('subscription.close()');
      const signedBeforeProtection = signatures;
      for (const kind of [30078, 35858, 5])
        expect(
          await call(
            `napplet.outbox.publish({kind:${kind},created_at:${now},content:'invalid protected write',tags:[]})`,
          ),
        ).toMatchObject({ ok: false });
      expect(signatures).toBe(signedBeforeProtection);
      expect(await call('typeof window.nostr')).toBe('undefined');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await call(
        `globalThis.closedReason=null; globalThis.retiring=napplet.outbox.subscribe({kinds:[1],authors:[${JSON.stringify(pubkey)}]}); retiring.on('closed',reason=>{closedReason=reason});`,
      );
      if (mode === 'preview')
        await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      else {
        await page.getByRole('button', { name: `${pubkey.slice(0, 6)}…`, exact: true }).click();
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      }
      await ui.poll(() => call('napplet.identity.getPublicKey()')).toBe('');
      await ui.poll(() => call('typeof closedReason')).toBe('string');
      expect(await call(`napplet.outbox.publish(${template('after sign-out')})`)).toMatchObject({
        ok: false,
      });
      expect(signatures).toBe(signedBeforeProtection);
      await page.close();
    }
  } finally {
    await browser.close();
    preview?.stop(true);
    web?.kill();
    if (web) await web.exited;
    relays.forEach((relay) => relay.stop(true));
    blossom.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
