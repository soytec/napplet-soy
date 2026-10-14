import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../grasp/src/client';
import { sourceArchive } from '../../remix/src/archive';
import { materializeSourceArchive } from './source-archive';

const encoder = new TextEncoder();
function header(path: string, size: number, type = 48, link = '', executable = false) {
  const result = new Uint8Array(512);
  const field = (offset: number, value: string) => result.set(encoder.encode(value), offset);
  field(0, path);
  field(100, `${(executable ? 0o755 : 0o644).toString(8).padStart(7, '0')}\0`);
  field(108, '0000000\0');
  field(116, '0000000\0');
  field(124, `${size.toString(8).padStart(11, '0')}\0`);
  field(136, '00000000000\0');
  result[156] = type;
  field(157, link);
  field(257, 'ustar\x0000');
  checksum(result);
  return result;
}
function checksum(header: Uint8Array) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, value) => total + value, 0);
  header.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
}
function tar(
  entries: {
    path: string;
    bytes?: Uint8Array;
    type?: number;
    link?: string;
    executable?: boolean;
  }[],
) {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? new Uint8Array();
    parts.push(header(entry.path, bytes.length, entry.type, entry.link, entry.executable));
    parts.push(bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function pax(key: string, value: string) {
  const field = `${key}=${value}\n`;
  let length = encoder.encode(field).length + 2;
  while (encoder.encode(`${length} ${field}`).length !== length)
    length = encoder.encode(`${length} ${field}`).length;
  return encoder.encode(`${length} ${field}`);
}

test('source archives materialize approved aliases with exact binary and newline bytes', () => {
  const payload = new Uint8Array([0, 255, 195, 40, 10, 13, 10, 0]);
  const metadata = encoder.encode('52 comment=1111111111111111111111111111111111111111\n');
  const input = tar([
    { path: 'pax_global_header', type: 103, bytes: metadata },
    { path: 'AGENTS.md', bytes: payload, executable: true },
    { path: 'CLAUDE.md', type: 50, link: 'AGENTS.md' },
    { path: 'docs/', type: 53 },
    { path: 'docs/instructions.md', type: 50, link: '../CLAUDE.md' },
  ]);
  expect(() => sourceArchive(input)).toThrow('links and special entries');
  const output = materializeSourceArchive(input, [
    { path: 'CLAUDE.md', target: 'AGENTS.md', executable: true },
    { path: 'docs/instructions.md', target: 'AGENTS.md', executable: true },
  ]);
  const files = sourceArchive(output);
  expect(files.size).toBe(3);
  for (const path of ['AGENTS.md', 'CLAUDE.md', 'docs/instructions.md'])
    expect(files.get(path)).toEqual(payload);
  expect(output.slice(0, 2048)).toEqual(input.slice(0, 2048));
  const aliasHeader = output.subarray(2048, 2560);
  expect(aliasHeader[156]).toBe(48);
  expect(new TextDecoder().decode(aliasHeader.subarray(100, 108))).toBe('0000755\0');
  expect(aliasHeader.subarray(157, 257).every((byte) => byte === 0)).toBe(true);
  expect(() => sourceArchive(input)).toThrow('links and special entries');
});

test('source archive materialization rejects unknown, missing, mismatched and duplicate aliases', () => {
  const input = tar([
    { path: 'AGENTS.md', bytes: encoder.encode('guidance\n') },
    { path: 'README.md', bytes: encoder.encode('readme\n') },
    { path: 'CLAUDE.md', type: 50, link: 'AGENTS.md' },
  ]);
  const alias = { path: 'CLAUDE.md', target: 'AGENTS.md', executable: false };
  for (const aliases of [
    [],
    [alias, alias],
    [{ ...alias, path: 'missing.md' }],
    [{ ...alias, target: 'missing.md' }],
    [{ ...alias, target: 'README.md' }],
    [{ ...alias, executable: true }],
    [{ ...alias, path: 'README.md' }],
  ])
    expect(() => materializeSourceArchive(input, aliases)).toThrow();
});

test('archive transformation rejects malformed tar structure and unapproved special entries', () => {
  const valid = tar([{ path: 'README.md', bytes: encoder.encode('hello') }]);
  expect(materializeSourceArchive(valid, [])).toEqual(valid);
  const badChecksum = valid.slice();
  badChecksum[0] ^= 1;
  const truncated = valid.slice(0, 512);
  const nonzeroTail = valid.slice();
  nonzeroTail[nonzeroTail.length - 1] = 1;
  for (const input of [
    badChecksum,
    truncated,
    nonzeroTail,
    tar([{ path: 'README.md', type: 49, link: 'elsewhere' }]),
    tar([{ path: 'README.md', type: 120, bytes: encoder.encode('pax path override') }]),
    tar([{ path: '../README.md', bytes: encoder.encode('outside') }]),
    tar([
      { path: 'README.md', bytes: encoder.encode('one') },
      { path: 'README.md', bytes: encoder.encode('two') },
    ]),
  ])
    expect(() => materializeSourceArchive(input, [])).toThrow();
});

test('materialized aliases count toward expanded source and file count budgets', () => {
  const alias = { path: 'copy.bin', target: 'asset.bin', executable: false };
  const big = tar([
    { path: 'asset.bin', bytes: new Uint8Array(21 * 1024 * 1024) },
    { path: 'copy.bin', type: 50, link: 'asset.bin' },
  ]);
  expect(() => materializeSourceArchive(big, [alias])).toThrow('40 MiB');
  const aliases = Array.from({ length: 1024 }, (_, i) => ({
    path: `copy-${i}.bin`,
    target: 'asset.bin',
    executable: false,
  }));
  const many = tar([
    { path: 'asset.bin', bytes: new Uint8Array() },
    ...aliases.map((alias) => ({ path: alias.path, type: 50, link: alias.target })),
  ]);
  expect(() => materializeSourceArchive(many, aliases)).toThrow('1024');
});

test('real Git archives with long approved symlink targets become regular portable files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-archive-long-link-'));
  try {
    const target = `${'instructions-'.repeat(7)}/AGENTS-guidance.md`;
    expect(target.length).toBeGreaterThan(100);
    const payload = new Uint8Array([0, 255, 195, 40, 10, 13, 10, 0]);
    await sourceGit(directory, ['init']);
    await Bun.write(join(directory, target), payload);
    await symlink(target, join(directory, 'CLAUDE.md'));
    await sourceGit(directory, ['add', '.']);
    await sourceGit(directory, ['commit', '-m', 'Long public guidance alias']);
    await sourceGit(directory, ['archive', '--format=tar', '--output=source.tar', 'HEAD']);
    const input = await Bun.file(join(directory, 'source.tar')).bytes();
    expect(() => sourceArchive(input)).toThrow('links and special entries');
    const output = materializeSourceArchive(input, [
      { path: 'CLAUDE.md', target, executable: false },
    ]);
    const files = sourceArchive(output);
    expect(files.get(target)).toEqual(payload);
    expect(files.get('CLAUDE.md')).toEqual(payload);
    expect(files.size).toBe(2);
    expect(await sourceGit(directory, ['ls-tree', 'HEAD', 'CLAUDE.md'])).toStartWith('120000 blob');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('only bounded single linkpath PAX records on approved aliases can be consumed', () => {
  const regular = { path: 'AGENTS.md', bytes: encoder.encode('public guidance\n') };
  const link = { path: 'CLAUDE.md', type: 50, link: 'AGENTS.md' };
  const alias = { path: 'CLAUDE.md', target: 'AGENTS.md', executable: false };
  const record = (bytes: Uint8Array) => ({ path: 'local-pax-header', type: 120, bytes });
  const correct = record(pax('linkpath', 'AGENTS.md'));
  const invalid = [
    record(pax('path', 'AGENTS.md')),
    record(encoder.encode(new TextDecoder().decode(pax('linkpath', 'AGENTS.md')) + '10 size=1\n')),
    record(encoder.encode('999 linkpath=AGENTS.md\n')),
    record(pax('linkpath', 'AGENTS.md\n')),
    record(pax('linkpath', '/AGENTS.md')),
    record(pax('linkpath', '../AGENTS.md')),
    record(pax('linkpath', 'missing.md')),
    record(pax('linkpath', 'x'.repeat(201))),
  ];
  for (const metadata of invalid)
    expect(() => materializeSourceArchive(tar([regular, metadata, link]), [alias])).toThrow();
  for (const entries of [
    [regular, correct],
    [correct, regular, link],
    [regular, correct, correct, link],
    [regular, correct, { ...link, path: 'unapproved.md' }],
  ])
    expect(() => materializeSourceArchive(tar(entries), [alias])).toThrow();
  const input = tar([regular, correct, link]);
  expect(() => materializeSourceArchive(input, [])).toThrow();
  expect(() => sourceArchive(input)).toThrow('links and special entries');
  expect(sourceArchive(materializeSourceArchive(input, [alias])).get('CLAUDE.md')).toEqual(
    regular.bytes,
  );
});

test('publish and remix archives preserve ordinary Git metadata and reject private paths', () => {
  const entries = [
    { path: '.gitmodules', bytes: encoder.encode('') },
    { path: '.gitattributes', bytes: encoder.encode('* text=auto\n') },
    { path: 'nested/.gitmodules', bytes: encoder.encode('[submodule "library"]\n') },
  ];
  const input = tar(entries);
  for (const bytes of [input, materializeSourceArchive(input, [])]) {
    const files = sourceArchive(bytes);
    expect(files.size).toBe(entries.length);
    for (const entry of entries) expect(files.get(entry.path)).toEqual(entry.bytes);
  }
  for (const path of ['.git/config', '.env', '.napplet-space/accounts.json']) {
    const privateArchive = tar([{ path, bytes: encoder.encode('private') }]);
    expect(() => sourceArchive(privateArchive)).toThrow('Unsafe source archive path');
    expect(() => materializeSourceArchive(privateArchive, [])).toThrow(
      'Unsafe source archive path',
    );
  }
});

test('portable archives materialize source-code and Git metadata symlinks as exact target bytes', () => {
  const code = encoder.encode('export const answer = 42;\n');
  const attributes = encoder.encode('* text=auto\n');
  const input = tar([
    { path: 'src/', type: 53 },
    { path: 'src/shared.ts', bytes: code },
    { path: 'src/alias.ts', type: 50, link: 'shared.ts' },
    { path: '.gitmodules', bytes: new Uint8Array() },
    { path: '.gitattributes', bytes: attributes },
    { path: 'modules-alias', type: 50, link: '.gitmodules' },
    { path: 'attributes-alias', type: 50, link: '.gitattributes' },
  ]);
  const files = sourceArchive(
    materializeSourceArchive(input, [
      { path: 'src/alias.ts', target: 'src/shared.ts', executable: false },
      { path: 'modules-alias', target: '.gitmodules', executable: false },
      { path: 'attributes-alias', target: '.gitattributes', executable: false },
    ]),
  );
  expect(files.get('src/alias.ts')).toEqual(code);
  expect(files.get('modules-alias')).toEqual(new Uint8Array());
  expect(files.get('attributes-alias')).toEqual(attributes);
});
