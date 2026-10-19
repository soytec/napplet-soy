import { test, expect } from 'bun:test';
import { StudioTransfers } from './transfers';

test('private build transfers bind ownership and expire without granting cross-account access', () => {
  let now = 0;
  const transfers = new StudioTransfers(() => now);
  const id = transfers.put('alice', new TextEncoder().encode('private source'), 'application/json');
  expect(() => transfers.get('bob', id)).toThrow('another account');
  expect(new TextDecoder().decode(transfers.get('alice', id).bytes)).toBe('private source');
  now = 120001;
  expect(() => transfers.get('alice', id)).toThrow('expired');
  expect(() => transfers.put('alice', new Uint8Array(32 * 1024 * 1024 + 1))).toThrow('capacity');
});
