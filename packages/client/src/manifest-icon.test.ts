import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { finalizeEvent } from 'nostr-tools';
import { sha256 } from '../../protocol/src';
import {
  resolveManifestIcon,
  resolvedIconUrl,
  resolveManifestScreenshots,
  resolvedScreenshotUrl,
} from './manifest-icon';
import { MANIFEST_PRESENTATION_PROFILE } from '../../protocol/src/presentation';

test('browser icon resolution bounds pixels before decode and caches only verified decoded blob URLs', async () => {
  const bytes = await sharp({
    create: { width: 21, height: 13, channels: 4, background: '#234567' },
  })
    .png()
    .toBuffer();
  const large = Buffer.from(bytes);
  large.writeUInt32BE(100_000, 16);
  large.writeUInt32BE(100_000, 20);
  const makeEvent = async (icon: Uint8Array, id: string) =>
    finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: 'Icon browser test',
        tags: [
          ['d', id],
          ['x', 'a'.repeat(64)],
          ['icon', await sha256(icon), 'image/png'],
          ['server', 'https://blossom.example'],
        ],
      },
      new Uint8Array(32).fill(9),
    );
  const largeEvent = await makeEvent(large, 'oversized'),
    validEvent = await makeEvent(bytes, 'valid');
  const originalFetch = globalThis.fetch;
  const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let downloaded: Uint8Array = large,
    decodeCalls = 0,
    closed = 0,
    fetchCalls = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      decodeCalls++;
      return { width: 21, height: 13, close: () => closed++ };
    },
  });
  globalThis.fetch = Object.assign(
    async () => {
      fetchCalls++;
      return new Response(new Uint8Array(downloaded));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    await resolveManifestIcon(largeEvent);
    expect(decodeCalls).toBe(0);
    expect(resolvedIconUrl(largeEvent.id)).toBeNull();
    downloaded = bytes;
    await resolveManifestIcon(validEvent);
    expect(decodeCalls).toBe(1);
    expect(closed).toBe(1);
    expect(resolvedIconUrl(validEvent.id)).toStartWith('blob:');
    const fetched = fetchCalls;
    await resolveManifestIcon(validEvent);
    expect(fetchCalls).toBe(fetched);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDecoder) Object.defineProperty(globalThis, 'createImageBitmap', originalDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});

test('one manifest deadline covers every origin and releases a decoder that finishes late', async () => {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 4, background: '#345678' },
  })
    .png()
    .toBuffer();
  const event = finalizeEvent(
    {
      kind: 5129,
      created_at: 2,
      content: 'A bounded optional icon',
      tags: [
        ['x', 'b'.repeat(64)],
        ['icon', await sha256(bytes), 'image/png'],
        ['server', 'https://first.example'],
        ['server', 'https://second.example'],
        ['server', 'https://third.example'],
      ],
    },
    new Uint8Array(32).fill(9),
  );
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const deadline = new AbortController();
  const signals: (AbortSignal | null | undefined)[] = [];
  let timeoutCalls = 0,
    closed = 0;
  let finishDecode: (bitmap: ImageBitmap) => void = () => {};
  let announceDecode: () => void = () => {};
  const decoding = new Promise<void>((resolve) => {
    announceDecode = resolve;
  });
  AbortSignal.timeout = (milliseconds) => {
    expect(milliseconds).toBe(4000);
    timeoutCalls++;
    return deadline.signal;
  };
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: () =>
      new Promise<ImageBitmap>((resolve) => {
        finishDecode = resolve;
        announceDecode();
      }),
  });
  globalThis.fetch = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      if (signals.length === 1) return new Response(null, { status: 503 });
      return new Response(new Uint8Array(bytes));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const resolving = resolveManifestIcon(event);
    await decoding;
    deadline.abort(new DOMException('Optional icon deadline', 'TimeoutError'));
    await resolving;
    expect(timeoutCalls).toBe(1);
    expect(signals).toEqual([deadline.signal, deadline.signal]);
    expect(resolvedIconUrl(event.id)).toBeNull();
    finishDecode({ width: 3, height: 2, close: () => closed++ } as ImageBitmap);
    await Promise.resolve();
    expect(closed).toBe(1);
    expect(resolvedIconUrl(event.id)).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalDecoder) Object.defineProperty(globalThis, 'createImageBitmap', originalDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});

test('direct screenshots use the shared bounded browser decoder and never expose unverified remote URLs', async () => {
  const bytes = await sharp({
    create: { width: 10, height: 6, channels: 4, background: '#cc6699' },
  })
    .png()
    .toBuffer();
  const event = finalizeEvent(
    {
      kind: 35129,
      content: 'Direct screenshot',
      created_at: 3,
      tags: [
        ['d', 'screenshot-test'],
        ['x', 'a'.repeat(64)],
        ['server', 'https://one.example'],
        ['server', 'https://two.example'],
        ['presentation', MANIFEST_PRESENTATION_PROFILE],
        ['screenshot', await sha256(bytes), 'image/png'],
      ],
    },
    new Uint8Array(32).fill(9),
  );
  const oldFetch = globalThis.fetch,
    oldDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const urls: string[] = [];
  let decoded = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      decoded++;
      return { width: 10, height: 6, close() {} };
    },
  });
  globalThis.fetch = Object.assign(
    async (input: unknown) => {
      urls.push(String(input));
      return new Response(urls.length === 1 ? new Uint8Array([1]) : new Uint8Array(bytes));
    },
    { preconnect: oldFetch.preconnect },
  );
  try {
    expect(resolvedScreenshotUrl(event.id)).toBeNull();
    await resolveManifestScreenshots(event);
    expect(urls).toHaveLength(2);
    expect(decoded).toBe(1);
    expect(resolvedScreenshotUrl(event.id)).toStartWith('blob:');
    expect(resolvedIconUrl(event.id)).toBeNull();
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDecoder) Object.defineProperty(globalThis, 'createImageBitmap', oldDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});
