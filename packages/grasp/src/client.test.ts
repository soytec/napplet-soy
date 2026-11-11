import { expect, test } from 'bun:test';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { prepareSource, sourceGit } from './client';

test('source preparation refuses uncommitted files and signer mutation before publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-source-'));
  const signer = new PrivateKeySigner();
  const input = {
    directory,
    signer,
    identifier: 'example',
    title: 'Example',
    origin: 'https://git.example',
  };
  try {
    await sourceGit(directory, ['init', '--initial-branch=main']);
    await Bun.write(join(directory, 'index.html'), '<!doctype html><h1>Source</h1>');
    await sourceGit(directory, ['add', 'index.html']);
    await sourceGit(directory, ['commit', '-m', 'First revision']);
    await Bun.write(join(directory, 'uncommitted.txt'), 'Not part of a release');
    await expect(prepareSource(input)).rejects.toThrow('Commit source changes');
    await rm(join(directory, 'uncommitted.txt'));
    await expect(
      prepareSource({
        ...input,
        signer: {
          getPublicKey: () => signer.getPublicKey(),
          signEvent: async (event) => {
            event.tags.find((t) => t[0] === 'clone')![1] = 'https://unselected.example/source.git';
            return signer.signEvent(event);
          },
        },
      }),
    ).rejects.toThrow('Signer changed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('background Git reads leave the index untouched and required write locks still apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-git-read-'));
  try {
    await sourceGit(directory, ['init', '--initial-branch=main']);
    const source = join(directory, 'index.html');
    await Bun.write(source, '<p>Unchanged content</p>');
    await sourceGit(directory, ['add', 'index.html']);
    await sourceGit(directory, ['commit', '-m', 'Initial']);
    const index = join(directory, '.git/index');
    const before = await Bun.file(index).bytes();
    // Changed stat data ordinarily makes status/diff refresh and lock the index.
    await utimes(source, new Date(0), new Date(0));
    expect(await sourceGit(directory, ['status', '--porcelain'])).toBe('');
    expect(await Bun.file(index).bytes()).toEqual(before);
    await Bun.write(join(directory, '.git/index.lock'), 'another writer');
    expect(await sourceGit(directory, ['status', '--porcelain'])).toBe('');
    await expect(sourceGit(directory, ['add', '--all'])).rejects.toThrow('Git command failed');
    expect(await Bun.file(join(directory, '.git/index.lock')).text()).toBe('another writer');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
