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

test('a stalled first icon origin cannot starve a healthy declared fallback', async () => {
  const bytes = await sharp({
    create: { width: 256, height: 256, channels: 4, background: '#e84c43' },
  })
    .png()
    .toBuffer();
  const event = finalizeEvent(
    {
      kind: 35129,
      created_at: 4,
      content: 'Pokédex fallback regression',
      tags: [
        ['d', 'healthy-icon-fallback'],
        ['x', 'a'.repeat(64)],
        ['icon', await sha256(bytes), 'image/png'],
        ['server', 'https://first.example'],
        ['server', 'https://second.example'],
        ['server', 'https://third.example'],
      ],
    },
    new Uint8Array(32).fill(9),
  );
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout,
    originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const timers: ReturnType<typeof setTimeout>[] = [],
    urls: string[] = [];
  const stalledSignals: AbortSignal[] = [];
  AbortSignal.timeout = (milliseconds) => {
    const controller = new AbortController();
    // Preserve relative budgets while keeping the real failure path fast.
    timers.push(
      setTimeout(
        () => controller.abort(new DOMException('Deadline', 'TimeoutError')),
        milliseconds / 100,
      ),
    );
    return controller.signal;
  };
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 256, height: 256, close() {} }),
  });
  globalThis.fetch = Object.assign(
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      urls.push(url.hostname);
      if (url.hostname === 'first.example')
        return new Promise<Response>((_, reject) => {
          const signal = init!.signal!;
          stalledSignals.push(signal);
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      return url.hostname === 'second.example'
        ? new Response(new Uint8Array(bytes))
        : new Response(null, { status: 404 });
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    await Promise.all([resolveManifestIcon(event), resolveManifestIcon(event)]);
    expect(resolvedIconUrl(event.id)).toStartWith('blob:');
    expect(urls.filter((url) => url === 'second.example')).toHaveLength(1);
    expect(stalledSignals[0]?.aborted).toBe(true);
    expect(urls).toHaveLength(2);
    const fetched = urls.length;
    await resolveManifestIcon(event);
    expect(urls).toHaveLength(fetched);
  } finally {
    timers.forEach(clearTimeout);
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalDecoder) Object.defineProperty(globalThis, 'createImageBitmap', originalDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});

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
  const finishDecode: Array<(bitmap: ImageBitmap) => void> = [];
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
        finishDecode.push(resolve);
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
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal === signals[0] && signal?.aborted)).toBe(true);
    expect(resolvedIconUrl(event.id)).toBeNull();
    finishDecode.forEach((finish) =>
      finish({ width: 3, height: 2, close: () => closed++ } as ImageBitmap),
    );
    await Promise.resolve();
    expect(closed).toBe(finishDecode.length);
    expect(resolvedIconUrl(event.id)).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalDecoder) Object.defineProperty(globalThis, 'createImageBitmap', originalDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});

test('browser screenshot decoding infers absent or unusable MIME fields from verified bytes', async () => {
  const bytes = await sharp({
    create: { width: 12, height: 7, channels: 4, background: '#cc6699' },
  })
    .png()
    .toBuffer();
  const hash = await sha256(bytes);
  const originalFetch = globalThis.fetch,
    originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const decodedTypes: string[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (blob: Blob) => {
      decodedTypes.push(blob.type);
      return { width: 12, height: 7, close() {} };
    },
  });
  globalThis.fetch = Object.assign(async () => new Response(new Uint8Array(bytes)), {
    preconnect: originalFetch.preconnect,
  });
  try {
    for (const [index, fields] of [[], ['m'], ['m image/png', 'm image/jpeg']].entries()) {
      const event = finalizeEvent(
        {
          kind: 35129,
          created_at: 10 + index,
          content: 'Optional screenshot MIME',
          tags: [
            ['d', `optional-mime-${index}`],
            ['x', 'a'.repeat(64)],
            ['server', 'https://image.example'],
            ['screenshot', `x ${hash}`, ...fields],
          ],
        },
        new Uint8Array(32).fill(9),
      );
      await resolveManifestScreenshots(event);
      expect(resolvedScreenshotUrl(event.id)).toStartWith('blob:');
    }
    expect(decodedTypes).toEqual(['image/png', 'image/png', 'image/png']);
  } finally {
    globalThis.fetch = originalFetch;
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
        ['screenshot', 'c'.repeat(64), 'image/png'],
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
    expect(urls.every((url) => !url.endsWith('c'.repeat(64)))).toBe(true);
    expect(decoded).toBe(1);
    expect(resolvedScreenshotUrl(event.id)).toStartWith('blob:');
    expect(resolvedIconUrl(event.id)).toBeNull();
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDecoder) Object.defineProperty(globalThis, 'createImageBitmap', oldDecoder);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});
