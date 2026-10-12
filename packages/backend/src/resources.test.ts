import { test, expect } from 'bun:test';
import { resourceMime, resourceResponse, resolveResource } from './resources';
import { createResourceResponder } from './resource-response';
import { siteOrigin } from './site-origin';
import { fetchPublicBytes, publicResourceUrl } from './blossom';
import records from '../data/catalog.json';
import { publicNapplet, publicNappletSchema } from './public-model';
import { RUNTIME_PROFILE } from '../../runtime/src/capabilities';
import { finalizeEvent } from 'nostr-tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const bytes = (s: string) => new TextEncoder().encode(s);
test('public artifact metadata accepts 100 MiB while resources retain their 10 MiB cap', async () => {
  const entry = await publicNapplet(records[0].current);
  expect(publicNappletSchema.parse({ ...entry, bytes: 100 * 1024 * 1024 }).bytes).toBe(
    100 * 1024 * 1024,
  );
  expect(() => publicNappletSchema.parse({ ...entry, bytes: 100 * 1024 * 1024 + 1 })).toThrow();
  await expect(
    resolveResource(
      { url: 'data:text/plain,' + 'x'.repeat(10 * 1024 * 1024 + 1) },
      [],
      AbortSignal.timeout(5000),
    ),
  ).rejects.toThrow('too-large');
});

test('resources behind an HTTPS proxy admit only the configured host origin', async () => {
  const external = 'https://napplet.example';
  const respond = createResourceResponder(
    async () => ({ servers: [] }),
    () => external,
  );
  const request = (Origin: string, extra = {}) =>
    new Request('http://napplet.example/api/resources', {
      method: 'POST',
      headers: { Origin, 'X-Space-Host': '1', ...extra },
      body: JSON.stringify({ manifest: 'a'.repeat(64), url: 'data:text/plain,hello' }),
    });
  for (const Origin of ['null', 'http://napplet.example', 'https://elsewhere.example'])
    expect(
      (
        await respond(
          request(Origin, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'napplet.example' }),
        )
      ).status,
    ).toBe(403);
  expect((await respond(request(external, { 'X-Space-Host': '' }))).status).toBe(403);
  const response = await respond(request(external));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('hello');
  // The authoring server still defaults to its own loopback request origin.
  const local = createResourceResponder(async () => ({ servers: [] }));
  expect(
    (
      await local(
        new Request('http://localhost:4173/api/resources', {
          method: 'POST',
          headers: { Origin: 'http://localhost:4173', 'X-Space-Host': '1' },
          body: JSON.stringify({ manifest: 'a'.repeat(64), url: 'data:text/plain,hello' }),
        }),
      )
    ).status,
  ).toBe(200);
});
test('resource classification ignores upstream MIME and refuses active documents', () => {
  expect(resourceMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
  expect(resourceMime(bytes('RIFF1234WEBP'))).toBe('image/webp');
  expect(resourceMime(bytes('{"title":"hello"}'))).toBe('application/json');
  expect(resourceMime(new Uint8Array([17, 17, 17]), true)).toBe('application/octet-stream');
  expect(() => resourceMime(bytes('<svg/>'), true)).toThrow();
  for (const source of [
    '<svg onload="alert(1)"/>',
    '<!DOCTYPE html><script>bad()</script>',
    '<?xml version="1.0"?>',
    '\0binary',
  ])
    expect(() => resourceMime(bytes(source))).toThrow();
});

test('known fixture and relay manifests get the same resource service and capability policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-resource-parity-'));
  const previous = {
    enabled: process.env.SPACE_PUBLICDEV,
    directory: process.env.SPACE_PUBLICDEV_DIR,
  };
  const key = new Uint8Array(32);
  key[31] = 1;
  const imported = await publicNapplet(
    finalizeEvent(
      {
        ...records[0].current,
        tags: records[0].current.tags.map((t) =>
          t[0] === 'd' ? ['d', 'independent-publisher'] : t,
        ),
      },
      key,
    ),
  );
  const unsupported = await publicNapplet(
    finalizeEvent(
      {
        ...imported.manifest,
        tags: [...imported.manifest.tags, ['requires', 'connect']],
      },
      key,
    ),
  );
  const request = (manifest: string) =>
    new Request('http://localhost:3000/api/resources', {
      method: 'POST',
      headers: { Origin: siteOrigin(), 'X-Space-Host': '1' },
      body: JSON.stringify({ manifest, url: 'data:text/plain,hello' }),
    });
  try {
    await Bun.write(
      join(directory, 'catalog.json'),
      JSON.stringify({
        version: 2,
        runtime: RUNTIME_PROFILE,
        fetchedAt: Date.now(),
        relays: [],
        rejected: 0,
        entries: [imported, unsupported].map((n) => ({ ...n, availability: 'ready' })),
      }),
    );
    process.env.SPACE_PUBLICDEV = '1';
    process.env.SPACE_PUBLICDEV_DIR = directory;
    for (const id of [records[0].current.id, records[0].snapshot.id, imported.revisionId]) {
      const response = await resourceResponse(request(id));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hello');
    }
    expect((await resourceResponse(request(unsupported.revisionId))).status).toBe(404);
  } finally {
    if (previous.enabled === undefined) delete process.env.SPACE_PUBLICDEV;
    else process.env.SPACE_PUBLICDEV = previous.enabled;
    if (previous.directory === undefined) delete process.env.SPACE_PUBLICDEV_DIR;
    else process.env.SPACE_PUBLICDEV_DIR = previous.directory;
    await rm(directory, { recursive: true, force: true });
  }
});
test('resource fetches reject private networks and unsafe schemes without redirecting', async () => {
  for (const value of [
    'http://example.com/a',
    'file:///etc/passwd',
    'https://user:pass@example.com/a',
    'https://example.com:8443/a',
  ])
    expect(() => publicResourceUrl(value)).toThrow();
  for (const value of [
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://169.254.169.254/latest/meta-data',
  ])
    await expect(fetchPublicBytes(new URL(value), AbortSignal.timeout(1000))).rejects.toThrow();
  await expect(
    resolveResource({ url: 'file:///etc/passwd' }, [], AbortSignal.timeout(1000)),
  ).rejects.toThrow('unsupported-scheme');
});
test('resource endpoint rejects opaque/cross-origin callers and unknown manifests', async () => {
  const url = 'http://localhost:3000/api/resources';
  for (const origin of ['null', 'https://evil.example']) {
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: origin, 'X-Space-Host': '1' },
      body: '{}',
    });
    expect((await resourceResponse(request)).status).toBe(403);
  }
  const request = new Request(url, {
    method: 'POST',
    headers: { Origin: siteOrigin(), 'X-Space-Host': '1' },
    body: JSON.stringify({ manifest: '0'.repeat(64), url: 'https://example.com/picture.png' }),
  });
  expect((await resourceResponse(request)).status).toBe(404);
});
