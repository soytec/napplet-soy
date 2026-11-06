import { expect, test } from 'bun:test';
import {
  MANIFEST_PRESENTATION_PROFILE,
  manifestPreviewVideo,
  manifestScreenshots,
} from './presentation';
import { sourceArchiveReference } from './source-archive';

// NIP-5D Presentation media and Source (nostr-protocol/nips PR 2303 at c041f84).
const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
const event = (tags: string[][], kind = 35129) => ({ kind, tags });

test('standard screenshots need no Soy profile and keep tag order', () => {
  expect(
    manifestScreenshots(
      event([
        ['screenshot', `x ${b}`, 'm image/webp', 'dim 1200x750', 'alt The board'],
        ['screenshot', 'm image/png', `x ${a}`, 'size 9'],
        ['screenshot', `x ${b}`, 'm image/webp'],
      ]),
    ),
  ).toEqual([
    { hash: b, mime: 'image/webp' },
    { hash: a, mime: 'image/png' },
  ]);
});

test('malformed standard entries are ignored without suppressing usable ones', () => {
  const usable = ['screenshot', `x ${c}`, 'm image/jpeg'];
  for (const broken of [
    ['screenshot', `x ${a}`, `x ${b}`, 'm image/png'], // repeated x
    ['screenshot', 'm image/png'], // missing x
    ['screenshot', `x ${a.toUpperCase()}`, 'm image/png'], // not lowercase hex
    ['screenshot', `x ${a}`, 'm image/svg+xml'], // unsupported format
    ['screenshot', `x ${a}`], // no declared format this client can verify
    ['screenshot', `x ${a}`, 'm image/png', 'm image/jpeg'], // repeated m
  ])
    expect(manifestScreenshots(event([broken, usable]))).toEqual([{ hash: c, mime: 'image/jpeg' }]);
  expect(manifestScreenshots(event([usable], 1))).toEqual([]);
});

test('more than four usable screenshots display a subset', () => {
  const tags = [...'0123456789'].map((d) => ['screenshot', `x ${d.repeat(64)}`, 'm image/png']);
  expect(manifestScreenshots(event(tags)).map((s) => s.hash)).toEqual(
    [...'0123'].map((d) => d.repeat(64)),
  );
});

test('a preview video is ignored when several standard preview tags are present', () => {
  const preview = ['preview', `x ${a}`, 'm video/webm', 'duration 8.5'];
  expect(manifestPreviewVideo(event([preview]))).toEqual({ hash: a, mime: 'video/webm' });
  expect(manifestPreviewVideo(event([preview, ['preview', `x ${b}`, 'm video/webm']]))).toBeNull();
  expect(manifestPreviewVideo(event([['preview', `x ${a}`, 'm video/mp4']]))).toBeNull();
  for (const second of [
    ['preview'],
    ['preview', 'broken'],
    ['preview', `x ${b}`, `x ${c}`, 'm video/webm'],
    ['preview', b, 'video/webm'],
  ])
    expect(manifestPreviewVideo(event([preview, second]))).toBeNull();
});

test('the earlier Soy presentation convention remains readable', () => {
  const tags = [
    ['presentation', MANIFEST_PRESENTATION_PROFILE],
    ['screenshot', a, 'image/png'],
    ['preview', b, 'video/webm'],
  ];
  expect(manifestScreenshots(event(tags))).toEqual([{ hash: a, mime: 'image/png' }]);
  expect(manifestPreviewVideo(event(tags))).toEqual({ hash: b, mime: 'video/webm' });
  expect(manifestScreenshots(event(tags.slice(1)))).toEqual([]);
});

test('source archive references follow the NIP-5D four-element form and the earlier form', () => {
  expect(
    sourceArchiveReference([
      ['source-archive', 'https://files.example/src', a, 'application/x-tar'],
    ]),
  ).toMatchObject({
    hash: a,
    mime: 'application/x-tar',
    url: new URL('https://files.example/src'),
  });
  expect(sourceArchiveReference([['source-archive', `http://127.0.0.1:8081/${a}`]])).toMatchObject({
    hash: a,
  });
  expect(sourceArchiveReference([['source', 'https://git.example/x.git']])).toBeNull();
  for (const tags of [
    [['source-archive', 'http://files.example/src', a, 'application/x-tar']], // HTTPS only
    [['source-archive', 'https://u:p@files.example/src', a, 'application/x-tar']],
    [['source-archive', 'https://files.example/src#frag', a, 'application/x-tar']],
    [['source-archive', 'https://files.example/src', 'nothex', 'application/x-tar']],
    [['source-archive', 'https://files.example/src', a, 'application/zip']], // unreadable here
    [['source-archive', 'https://files.example/src', a]], // three elements
    [
      ['source-archive', `https://files.example/${a}`],
      ['source-archive', `https://files.example/${b}`],
    ], // repeated
  ])
    expect(() => sourceArchiveReference(tags)).toThrow();
});

test('source fields are ignored when malformed or repeated', async () => {
  const { manifestSourceCommit, manifestSourceLocation } = await import('./source-archive');
  const commit = '1'.repeat(40);
  for (const location of [
    'https://git.example.com/owner/napplet.git',
    'ssh://git@git.example.com/owner/napplet.git',
    'git@git.example.com:owner/napplet.git',
    'git://git.example.com/owner/napplet.git',
    'nostr://npub1example/relay/napplet',
  ]) {
    expect(manifestSourceLocation([['source', location]])).toBe(location);
    expect(
      manifestSourceCommit([
        ['source', location],
        ['source-commit', commit],
      ]),
    ).toBe(commit);
  }
  for (const tags of [
    [['source', 'file:///home/me/napplet']],
    [['source', '/home/me/napplet']],
    [['source', 'https://a.example/x.git', 'extra']],
    [
      ['source', 'https://a.example/x.git'],
      ['source', 'https://b.example/x.git'],
    ],
  ])
    expect(manifestSourceLocation(tags)).toBeNull();
  expect(manifestSourceCommit([['source-commit', commit]])).toBeNull();
  expect(
    manifestSourceCommit([
      ['source', 'https://a.example/x.git'],
      ['source-commit', 'A'.repeat(40)],
    ]),
  ).toBeNull();
});
