import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { sha256 } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import {
  MANIFEST_PRESENTATION_PROFILE,
  manifestScreenshotSources,
  manifestScreenshots,
  manifestVideoSources,
} from '../../protocol/src/presentation';
import { validatedPreview } from '../../protocol/src/preview';
import { validatedVideo } from '../../protocol/src/preview-video';
import { linkedMedia } from '../../protocol/src/linked-media';
import { shareMedia } from '../../client/src/share-note';
import { indexPreviewImages, cachedPreviewBytes } from './preview-images';
import { indexPreviewVideos, cachedVideoBytes } from './preview-videos';
import { publicNapplet, publicPoster, publicPreviewVideo } from './public-model';
import { detailAssets } from './detail-assets';

const key = new Uint8Array(32).fill(8);
const image = await sharp({
  create: { width: 120, height: 75, channels: 4, background: '#9354cf' },
})
  .png()
  .toBuffer();
const video = await Bun.file(
  new URL('../../../tests/fixtures/preview.webm', import.meta.url),
).bytes();
const imageHash = await sha256(image),
  videoHash = await sha256(video);
const tags = [
  ['d', 'third-party'],
  ['x', 'a'.repeat(64)],
  ['title', 'Third party'],
  ['server', 'https://first.example'],
  ['server', 'https://second.example'],
  ['presentation', MANIFEST_PRESENTATION_PROFILE],
  ['screenshot', imageHash, 'image/png'],
  ['preview', videoHash, 'video/webm'],
];
const manifest = (extra: string[][] = [], base = tags, created_at = 1700000000) =>
  finalizeEvent(
    {
      kind: 35129,
      created_at,
      content: 'Unchanged readable description',
      tags: [...base, ...extra],
    },
    key,
  );

test('direct manifest previews verify declared fallback bytes, take precedence over icons and bind caches to the exact signed release', async () => {
  const event = manifest([['icon', imageHash, 'image/png']]);
  const directory = await mkdtemp(join(tmpdir(), 'direct-media-'));
  try {
    const entry = await publicNapplet(event),
      urls: string[] = [];
    const download = async (url: URL) => {
      urls.push(url.href);
      return url.hostname === 'first.example'
        ? new Uint8Array([1])
        : url.pathname.endsWith(imageHash)
          ? image
          : video;
    };
    await indexPreviewImages(directory, [entry], [], AbortSignal.timeout(5000), { download });
    await indexPreviewVideos(directory, [entry], [], AbortSignal.timeout(5000), { download });
    expect(urls).toEqual([
      `https://first.example/${imageHash}`,
      `https://second.example/${imageHash}`,
      `https://first.example/${videoHash}`,
      `https://second.example/${videoHash}`,
    ]);
    expect(entry.preview?.descriptor.id).toBe(event.id);
    expect(entry.video?.descriptor.id).toBe(event.id);
    expect(entry.metadata).toEqual([]);
    expect(validatedPreview(event, entry.preview)).not.toBeNull();
    expect(validatedVideo(event, entry.video)).not.toBeNull();
    expect(await cachedPreviewBytes(directory, entry.preview!)).not.toBeNull();
    expect(await cachedVideoBytes(directory, entry.video!)).toEqual(video);
    expect(publicPoster(entry)).toBe(`/api/previews/${event.id}`);
    expect(
      detailAssets(event, entry.preview, entry.video).find((a) => a.kind === 'image')?.thumbnail,
    ).toBe(`/api/previews/${event.id}`);
    expect(publicPreviewVideo(entry)?.url).toBe(`/api/previews/${event.id}/video`);
    expect(
      validatedPreview(event, { ...entry.preview, url: `https://unlisted.example/${imageHash}` }),
    ).toBeNull();
    expect(validatedVideo(event, { ...entry.video, hash: 'b'.repeat(64) })).toBeNull();
    expect(
      validatedVideo(event, { ...entry.video, descriptor: { ...event, content: 'forged' } }),
    ).toBeNull();
    const next = manifest([], tags, event.created_at + 1);
    expect(validatedPreview(next, entry.preview)).toBeNull();
    expect(validatedVideo(next, entry.video)).toBeNull();
    const count = urls.length;
    await indexPreviewImages(directory, [entry], [], AbortSignal.timeout(3000), {
      download,
      previous: [structuredClone(entry)],
    });
    await indexPreviewVideos(directory, [entry], [], AbortSignal.timeout(3000), {
      download,
      previous: [structuredClone(entry)],
    });
    // Failed first origins may be retried; valid immutable cached mirrors are reused.
    expect(urls.slice(count)).toEqual([
      `https://first.example/${imageHash}`,
      `https://first.example/${videoHash}`,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed optional media, unsupported profiles and origins never affect artifact validation', async () => {
  for (const event of [
    manifest([['presentation', MANIFEST_PRESENTATION_PROFILE]]),
    manifest(
      [],
      tags.map((t) => (t[0] === 'presentation' ? ['presentation', 'future/2'] : t)),
    ),
    manifest(
      [],
      tags.map((t) => (t[0] === 'screenshot' ? ['screenshot', imageHash, 'image/svg+xml'] : t)),
    ),
    manifest(
      [],
      tags.map((t) => (t[0] === 'screenshot' ? ['screenshot', 'not-a-hash', 'image/png'] : t)),
    ),
    manifest([['screenshot', imageHash, 'image/jpeg']]),
  ]) {
    expect((await validateManifest(event)).artifactHash).toBe('a'.repeat(64));
    expect(manifestScreenshots(event)).toEqual([]);
  }
  const origins = manifest(
    [],
    tags.map((t) =>
      t[0] === 'server' ? ['server', 'https://user:password@first.example/path'] : t,
    ),
  );
  expect(manifestScreenshotSources(origins)).toEqual([]);
  expect(manifestVideoSources(origins)).toEqual([]);
  expect(manifestVideoSources(manifest([['preview', videoHash, 'video/webm']]))).toEqual([]);
});

test('wrong MIME, damaged optional bytes and removed attachments fall back without resurrecting old cached media', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'direct-media-invalid-'));
  try {
    const good = await publicNapplet(manifest());
    await indexPreviewImages(directory, [good], [], AbortSignal.timeout(3000), {
      download: async () => image,
    });
    await indexPreviewVideos(directory, [good], [], AbortSignal.timeout(3000), {
      download: async () => video,
    });
    const removed = await publicNapplet(
      manifest(
        [],
        tags.filter((t) => !['screenshot', 'preview'].includes(t[0])),
        1700000001,
      ),
    );
    await indexPreviewImages(directory, [removed], [], AbortSignal.timeout(3000), {
      previous: [good],
      download: async () => {
        throw new Error('No media should be fetched');
      },
    });
    await indexPreviewVideos(directory, [removed], [], AbortSignal.timeout(3000), {
      previous: [good],
    });
    expect(removed.preview).toBeNull();
    expect(removed.video).toBeNull();
    const wrong = await publicNapplet(
      manifest(
        [],
        tags.map((t) => (t[0] === 'screenshot' ? ['screenshot', imageHash, 'image/jpeg'] : t)),
      ),
    );
    await indexPreviewImages(directory, [wrong], [], AbortSignal.timeout(3000), {
      download: async () => image,
    });
    await indexPreviewVideos(directory, [wrong], [], AbortSignal.timeout(3000), {
      download: async () => new Uint8Array([1]),
    });
    expect(wrong.preview).toBeNull();
    expect(wrong.video).toBeNull();
    expect(publicPoster(wrong)).toContain('/api/og/');
    expect(wrong.artifactHash).toBe(good.artifactHash);
    expect(wrong.description).toBe('Unchanged readable description');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uncached direct media is discoverable for sharing and opt-in file links without Zapstore events or unverified poster embeds', async () => {
  const event = manifest();
  expect(linkedMedia(event, []).images[0]).toBe(`https://first.example/${imageHash}`);
  expect(shareMedia({ manifest: event })).toMatchObject({
    type: 'video',
    url: `https://first.example/${videoHash}`,
    hash: videoHash,
  });
  const assets = detailAssets(event);
  expect(assets.some((a) => a.kind === 'image' && a.href.endsWith(imageHash))).toBe(true);
  expect(assets.some((a) => a.kind === 'video' && a.href.endsWith(videoHash))).toBe(true);
  expect(assets.some((a) => a.thumbnail)).toBe(false);
  const entry = await publicNapplet(event);
  expect(publicPoster(entry)).toContain('/api/og/');
  expect(publicPreviewVideo(entry)).toMatchObject({
    sources: [`https://first.example/${videoHash}`, `https://second.example/${videoHash}`],
  });
});
