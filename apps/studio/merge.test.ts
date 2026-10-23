import { expect, test } from 'bun:test';
import { mergeRuntimeContents } from './merge';

test('merge sandbox uses the exact executable while retaining inherited media for later publication checks', () => {
  const config = {
    entry: 'dist/index.html',
    preview: {
      image: 'cover.png',
      video: { file: 'clip.webm', artifactHash: 'old' },
      delayMs: 750,
      readySelector: '.station-row',
      recording: { durationMs: 8000 },
    },
  };
  const original = new TextEncoder().encode(JSON.stringify(config));
  const html = new TextEncoder().encode('<html>changed runtime</html>');
  const contents = new Map([
    ['napplet.json', original],
    ['dist/index.html', html],
  ]);
  const checked = mergeRuntimeContents(contents);
  expect(JSON.parse(new TextDecoder().decode(checked.get('napplet.json')))).toEqual({
    entry: config.entry,
    preview: { image: 'cover.png', delayMs: 750, recording: { durationMs: 8000 } },
  });
  expect(checked.get('dist/index.html')).toBe(html);
  expect(contents.get('napplet.json')).toBe(original);
  expect(JSON.parse(new TextDecoder().decode(contents.get('napplet.json')))).toEqual(config);
});
