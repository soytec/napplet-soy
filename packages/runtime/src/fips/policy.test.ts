import { expect, test } from 'bun:test';
import { withGlobals } from '../host-test-support';
import { fipsEnabled, onFipsPolicyChange, setFipsEnabled } from './policy';

test('FIPS policy reports persistence, keeps blocked access without storage and responds across tabs', () => {
  const window = new EventTarget();
  const values = new Map<string, string>();
  let unavailable = false;
  const restore = withGlobals({
    window,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (unavailable) throw new Error('Storage unavailable');
        values.set(key, value);
      },
    },
  });
  let changes = 0;
  const unsubscribe = onFipsPolicyChange(() => changes++);
  try {
    expect(setFipsEnabled(true)).toBe(true);
    expect(fipsEnabled()).toBe(true);
    unavailable = true;
    expect(setFipsEnabled(false)).toBe(false);
    expect(fipsEnabled()).toBe(false);
    expect(changes).toBe(2);
    const storageEvent = (key: string | null) => {
      const event = new Event('storage');
      Object.defineProperty(event, 'key', { value: key });
      window.dispatchEvent(event);
    };
    storageEvent('unrelated');
    expect(fipsEnabled()).toBe(false);
    expect(changes).toBe(2);
    // The other tab saved Ask; its event replaces the page-only fallback.
    storageEvent('napplet:fips-resources:v1');
    expect(fipsEnabled()).toBe(true);
    expect(changes).toBe(3);
    values.set('napplet:fips-resources:v1', 'blocked');
    storageEvent(null);
    expect(fipsEnabled()).toBe(false);
    unsubscribe();
    storageEvent(null);
    expect(changes).toBe(4);
  } finally {
    unavailable = false;
    setFipsEnabled(true);
    unsubscribe();
    restore();
  }
});
