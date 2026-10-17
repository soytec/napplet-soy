import { expect, test } from 'bun:test';
import {
  LEGACY_PRESENTATION_PROFILE,
  MANIFEST_PRESENTATION_PROFILE,
  manifestScreenshots,
  inventoryScreenshots,
  manifestPreviewVideo,
} from './presentation';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const shots = (count: number) =>
  Array.from({ length: count }, (_, i) => ['screenshot', hash(i + 1), 'image/png']);
const event = (tags: string[][], profile: string | null = MANIFEST_PRESENTATION_PROFILE) => ({
  kind: 35129,
  tags: [...(profile ? [['presentation', profile]] : []), ...tags],
});

for (const profile of [null, LEGACY_PRESENTATION_PROFILE, MANIFEST_PRESENTATION_PROFILE]) {
  test(`${profile ?? 'proposed marker-free'} screenshots preserve the first eight and ignore extras`, () => {
    const input = event(shots(12), profile);
    expect(manifestScreenshots(input).map((c) => c.hash)).toEqual(shots(8).map((t) => t[1]));
    expect(inventoryScreenshots(input)).toHaveLength(12);
    expect(manifestScreenshots(event(shots(5), profile))).toHaveLength(5);
    // Beyond the display window, even a conflicting claim cannot poison the visible set.
    expect(
      manifestScreenshots(event([...shots(8), ['screenshot', hash(1), 'image/jpeg']], profile)),
    ).toHaveLength(8);
  });
}
test('bad entries, duplicate claims and conflicting MIME types do not discard unrelated images', () => {
  const input = event([
    ['screenshot', 'bad', 'image/png'],
    ['screenshot', hash(100), 'image/svg+xml'],
    ...shots(2),
    shots(2)[1],
    ['screenshot', hash(1), 'image/jpeg'],
    ...shots(12).slice(2),
  ]);
  expect(manifestScreenshots(input).map((c) => c.hash)).toEqual(
    Array.from({ length: 8 }, (_, i) => hash(i + 2)),
  );
  expect(manifestScreenshots(event(shots(2), 'future/3'))).toEqual([]);
  expect(
    manifestScreenshots(event([['presentation', MANIFEST_PRESENTATION_PROFILE], ...shots(2)])),
  ).toEqual([]);
});
test('media attributes extend the hash/MIME tuple and remain optional untrusted hints', () => {
  const screenshot = [
    'screenshot',
    hash(1),
    'image/webp',
    'dim 750x1200',
    'size 4321',
    'alt Two players <jumping> over a gap',
    'future anything',
  ];
  expect(manifestScreenshots(event([screenshot]))[0]).toEqual({
    hash: hash(1),
    mime: 'image/webp',
    width: 750,
    height: 1200,
    bytes: 4321,
    alt: 'Two players <jumping> over a gap',
  });
  expect(manifestScreenshots(event([screenshot], null))).toHaveLength(1);
  expect(manifestScreenshots(event([screenshot], LEGACY_PRESENTATION_PROFILE))).toEqual([]);
  expect(
    manifestPreviewVideo(
      event([['preview', hash(2), 'video/webm', 'duration 8.5', 'dim 960x600']]),
    ),
  ).toMatchObject({ duration: 8.5, width: 960, height: 600 });
  expect(
    manifestPreviewVideo(
      event([
        ['preview', hash(2), 'video/webm'],
        ['preview', hash(3), 'video/webm'],
      ]),
    ),
  ).toBeNull();
});
test('invalid or duplicate attributes never poison a valid optional media reference', () => {
  for (const fields of [
    ['dim -1x5', 'size -1', 'duration NaN'],
    ['dim 9007199254740992x1', 'size 1e30', 'duration Infinity'],
    ['dim 1x2', 'dim 3x4', 'size 12', 'size 12', 'alt first', 'alt second'],
    ['alt ' + 'a'.repeat(2001)],
  ])
    expect(manifestScreenshots(event([['screenshot', hash(1), 'image/png', ...fields]]))).toEqual([
      { hash: hash(1), mime: 'image/png' },
    ]);
});
