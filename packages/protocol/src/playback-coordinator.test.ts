import { describe, expect, test } from 'bun:test';
import { PlaybackCoordinator } from '../../../apps/web/src/lib/playback-coordinator';

describe('preview playback groups', () => {
  test('visible previews in one group play together and release independently', () => {
    const playback = new PlaybackCoordinator(),
      group = {},
      a = {},
      b = {},
      c = {};
    const stopped: string[] = [];
    expect(playback.claim(a, 'preview', () => stopped.push('a'), group)).toBe(true);
    expect(playback.claim(b, 'preview', () => stopped.push('b'), group)).toBe(true);
    expect(stopped).toEqual([]);
    playback.release(a);
    expect(playback.claim(c, 'napplet', () => {})).toBe(true);
    expect(stopped).toEqual(['b']);
  });

  test('a different group replaces every previous preview, even with cleanup callbacks', () => {
    const playback = new PlaybackCoordinator(),
      group = {},
      otherGroup = {},
      a = {},
      b = {},
      c = {};
    const stopped: string[] = [];
    playback.claim(
      a,
      'preview',
      () => {
        stopped.push('a');
        playback.release(a);
      },
      group,
    );
    playback.claim(
      b,
      'preview',
      () => {
        stopped.push('b');
        playback.release(b);
      },
      group,
    );
    playback.claim(c, 'preview', () => stopped.push('c'), otherGroup);
    expect(stopped).toEqual(['a', 'b']);
    playback.claim({}, 'media', () => {});
    expect(stopped).toEqual(['a', 'b', 'c']);
  });

  test('ungrouped previews retain exclusive playback', () => {
    const playback = new PlaybackCoordinator(),
      group = {};
    const stopped: string[] = [];
    playback.claim({}, 'preview', () => stopped.push('grouped'), group);
    playback.claim({}, 'preview', () => stopped.push('first'));
    playback.claim({}, 'preview', () => stopped.push('second'));
    expect(stopped).toEqual(['grouped', 'first']);
    playback.claim({}, 'preview', () => {}, group);
    expect(stopped).toEqual(['grouped', 'first', 'second']);
  });

  for (const kind of ['napplet', 'media'] as const) {
    test(`${kind} stops all decorative previews and refuses automatic interruptions`, () => {
      const playback = new PlaybackCoordinator(),
        group = {},
        explicit = {};
      let stopped = 0;
      playback.claim({}, 'preview', () => stopped++, group);
      playback.claim({}, 'preview', () => stopped++, group);
      expect(playback.claim(explicit, kind, () => stopped++, group)).toBe(true);
      expect(stopped).toBe(2);
      expect(playback.claim({}, 'preview', () => {}, group)).toBe(false);
      expect(playback.claim({}, 'preview', () => {})).toBe(false);
      expect(stopped).toBe(2);
      playback.release(explicit);
      expect(playback.claim({}, 'preview', () => {}, group)).toBe(true);
    });
  }

  test('repeated claim by the same preview does not restart or stop its group', () => {
    const playback = new PlaybackCoordinator(),
      group = {},
      owner = {};
    let stopped = 0;
    playback.claim(owner, 'preview', () => stopped++, group);
    playback.claim({}, 'preview', () => stopped++, group);
    expect(playback.claim(owner, 'preview', () => stopped++, group)).toBe(true);
    expect(stopped).toBe(0);
  });
});
