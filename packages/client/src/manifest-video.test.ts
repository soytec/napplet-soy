import { expect, test } from 'bun:test';
import { sha256 } from '../../protocol/src';
import { manifestVideoBlob } from './manifest-video';

test('browser-only direct clips verify bytes before returning a blob and try only declared safe origins', async () => {
  const bytes = await Bun.file(
    new URL('../../../tests/fixtures/preview.webm', import.meta.url),
  ).bytes();
  const hash = await sha256(bytes),
    oldFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: unknown, init?: RequestInit) => {
      urls.push(String(input));
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      return new Response(urls.length === 1 ? new Uint8Array([1]) : new Uint8Array(bytes));
    },
    { preconnect: oldFetch.preconnect },
  );
  try {
    const url = await manifestVideoBlob(
      [`https://one.example/${hash}`, `https://two.example/${hash}`],
      hash,
      AbortSignal.timeout(3000),
    );
    expect(url).toStartWith('blob:');
    expect(urls).toEqual([`https://one.example/${hash}`, `https://two.example/${hash}`]);
    URL.revokeObjectURL(url);
    await expect(
      manifestVideoBlob(['https://127.0.0.1/private'], hash, AbortSignal.timeout(3000)),
    ).rejects.toThrow('No declared Blossom server');
    expect(urls).toHaveLength(2);
    await expect(
      manifestVideoBlob([`https://two.example/${hash}`], '0'.repeat(64), AbortSignal.timeout(3000)),
    ).rejects.toThrow('verified preview clip');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
