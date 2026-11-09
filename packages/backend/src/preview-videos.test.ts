import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { sha256, type SignedEvent } from '../../protocol/src';
import {
  descriptorVideos,
  validatedVideo,
  inspectPreviewVideo,
} from '../../protocol/src/preview-video';
import {
  cachedVideoBytes,
  indexPreviewVideos,
  prunePreviewVideos,
  videoBytesResponse,
} from './preview-videos';

const key = new Uint8Array(32);
key[31] = 1;
const bytes = await Bun.file(
  new URL('../../../tests/fixtures/preview.webm', import.meta.url),
).bytes();
const hash = await sha256(bytes),
  url = `https://media.example/${hash}.webm`;
const at = Math.floor(Date.now() / 1000);
const descriptor = (tags: string[][] = [], content = url, time = at) =>
  finalizeEvent(
    {
      kind: 32267,
      created_at: time,
      content,
      tags: [['d', 'clip'], ['imeta', `url ${url}`, 'm video/webm', `x ${hash}`], ...tags],
    },
    key,
  );
const d = descriptor();
const manifest = finalizeEvent(
  {
    kind: 35129,
    content: '',
    created_at: at,
    tags: [
      ['d', 'test'],
      ['app', `32267:${getPublicKey(key)}:clip`, 'wss://relay.example'],
    ],
  },
  key,
);

test('NIP-92 video binding requires content URL, digest, unique fields and exact signed app reference', () => {
  expect(descriptorVideos(d)).toEqual([{ url, hash }]);
  expect(descriptorVideos(descriptor([], 'No URL'))).toEqual([]);
  expect(
    descriptorVideos(descriptor([['imeta', `url ${url}`, 'm video/webm', `x ${hash}`]])),
  ).toEqual([]);
  expect(
    descriptorVideos({ ...d, tags: [['imeta', `url ${url}`, 'm video/webm', 'x bad']] }),
  ).toEqual([]);
  const cached = { descriptor: d, url, hash, bytes: bytes.length, ...inspectPreviewVideo(bytes) };
  expect(validatedVideo(manifest, cached)).toEqual(JSON.parse(JSON.stringify(cached)));
  expect(validatedVideo({ ...manifest, tags: [] }, cached)).toBeNull();
  expect(
    validatedVideo(manifest, { ...cached, descriptor: { ...d, content: 'forged ' + url } }),
  ).toBeNull();
  expect(validatedVideo(manifest, { ...cached, hash: '0'.repeat(64) })).toBeNull();
});

test('WebM admission checks container, codec, dimensions, duration and frame boundaries', () => {
  expect(inspectPreviewVideo(bytes)).toMatchObject({ width: 960, height: 600 });
  expect(() => inspectPreviewVideo(new TextEncoder().encode('<html>not video</html>'))).toThrow();
  expect(() => inspectPreviewVideo(bytes.slice(0, -1))).toThrow();
  const bad = Buffer.from(bytes);
  bad[bad.indexOf('V_VP8') + 4] = 57;
  expect(() => inspectPreviewVideo(bad)).toThrow();
  const oversized = new Uint8Array(6 * 1024 * 1024);
  expect(() => inspectPreviewVideo(oversized)).toThrow();
  const dimensions = Buffer.from(bytes),
    frame = dimensions.indexOf(Buffer.from([0x9d, 1, 0x2a]));
  dimensions[frame + 3] ^= 1;
  expect(() => inspectPreviewVideo(dimensions)).toThrow();
});

test('standard preview clips with unusable optional MIME verify their actual supported bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-optional-mime-'));
  try {
    for (const mimeFields of [[], ['m invalid'], ['m video/webm', 'm video/mp4']]) {
      const standard = finalizeEvent(
        {
          kind: 35129,
          content: 'A public preview',
          created_at: at,
          tags: [
            ['d', 'optional-mime'],
            ['x', 'a'.repeat(64)],
            ['server', 'https://media.example'],
            ['preview', `x ${hash}`, ...mimeFields],
          ],
        },
        key,
      );
      const entry: { manifest: SignedEvent; video?: any } = { manifest: standard };
      await indexPreviewVideos(directory, [entry], [], AbortSignal.timeout(3000), {
        download: async () => bytes,
      });
      expect(entry.video?.hash).toBe(hash);
      expect(await cachedVideoBytes(directory, entry.video)).toEqual(bytes);
      const unsupported = new TextEncoder().encode('<html>not a video</html>');
      const unsupportedHash = await sha256(unsupported);
      entry.manifest = finalizeEvent(
        {
          kind: standard.kind,
          content: standard.content,
          created_at: at,
          tags: standard.tags.map((tag) =>
            tag[0] === 'preview' ? ['preview', `x ${unsupportedHash}`, ...mimeFields] : tag,
          ),
        },
        key,
      );
      await indexPreviewVideos(directory, [entry], [], AbortSignal.timeout(3000), {
        download: async () => unsupported,
      });
      expect(entry.video).toBeNull();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('index caches verified clips, reuses frozen bytes, rejects mutations and honors latest descriptor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-index-'));
  try {
    const entries: Array<{ manifest: SignedEvent; video?: any }> = [{ manifest }];
    let downloads = 0;
    const download = async () => {
      downloads++;
      return bytes;
    };
    await indexPreviewVideos(directory, entries, [d], AbortSignal.timeout(3000), { download });
    expect(entries[0].video.hash).toBe(hash);
    expect(await cachedVideoBytes(directory, entries[0].video)).toEqual(bytes);
    const previous = entries.map((e) => ({ ...e }));
    await indexPreviewVideos(directory, entries, [d], AbortSignal.timeout(3000), {
      download,
      previous,
    });
    expect(downloads).toBe(1);
    await Bun.write(join(directory, 'previews', `${hash}.webm`), 'corrupted');
    expect(await cachedVideoBytes(directory, previous[0].video)).toBeNull();
    await indexPreviewVideos(directory, entries, [d], AbortSignal.timeout(3000), {
      download: async () => new Uint8Array([1]),
      previous,
    });
    expect(entries[0].video).toBeNull();
    await indexPreviewVideos(
      directory,
      entries,
      [d, descriptor([], 'Removed clip', at + 1)],
      AbortSignal.timeout(3000),
      { download },
    );
    expect(entries[0].video).toBeNull();
    expect(downloads).toBe(1);
    await prunePreviewVideos(directory, entries);
    expect(await Bun.file(join(directory, 'previews', `${hash}.webm`)).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('video responses support bounded byte ranges and HEAD', async () => {
  const request = (range?: string, method = 'GET') =>
    new Request('https://site.example/clip', { method, headers: range ? { Range: range } : {} });
  const response = videoBytesResponse(bytes, request('bytes=10-19'));
  expect(response.status).toBe(206);
  expect(await response.bytes()).toEqual(bytes.slice(10, 20));
  expect(videoBytesResponse(bytes, request('bytes=0-1,10-11')).status).toBe(416);
  expect(videoBytesResponse(bytes, request('bytes=-0')).status).toBe(416);
  expect(videoBytesResponse(bytes, request(`bytes=${bytes.length}-`)).status).toBe(416);
  expect(await videoBytesResponse(bytes, request('bytes=-5')).bytes()).toEqual(bytes.slice(-5));
  expect(await videoBytesResponse(bytes, request(undefined, 'HEAD')).text()).toBe('');
});

test('configured loopback CAS supports local publications without accepting event-chosen local paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-cas-'));
  let reads = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      reads++;
      expect(new URL(req.url).pathname).toBe(`/${hash}`);
      return new Response(bytes);
    },
  });
  try {
    const localUrl = `${server.url.origin}/${hash}`;
    const localDescriptor = finalizeEvent(
      {
        kind: 32267,
        created_at: at,
        content: localUrl,
        tags: [
          ['d', 'clip'],
          ['imeta', `url ${localUrl}`, 'm video/webm', `x ${hash}`],
        ],
      },
      key,
    );
    const entries: Array<{ manifest: SignedEvent; video?: any }> = [{ manifest }];
    await indexPreviewVideos(directory, entries, [localDescriptor], AbortSignal.timeout(3000), {
      localOrigin: server.url.origin,
    });
    expect(entries[0].video.hash).toBe(hash);
    expect(reads).toBe(1);
    await indexPreviewVideos(directory, entries, [localDescriptor], AbortSignal.timeout(3000));
    expect(entries[0].video).toBeNull();
    expect(reads).toBe(1);
    const wrongPath = localUrl + '?file=/etc/hosts';
    const wrong = finalizeEvent(
      {
        kind: 32267,
        created_at: at,
        content: wrongPath,
        tags: [
          ['d', 'clip'],
          ['imeta', `url ${wrongPath}`, 'm video/webm', `x ${hash}`],
        ],
      },
      key,
    );
    await indexPreviewVideos(directory, entries, [wrong], AbortSignal.timeout(3000), {
      localOrigin: server.url.origin,
    });
    expect(entries[0].video).toBeNull();
    expect(reads).toBe(1);
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
