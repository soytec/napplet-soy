import { expect, test } from 'bun:test';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectToolchainProfile, toolchainProfileId } from './toolchain-profile';

test('a proposal can use its exact operator-installed dependency profile without rewriting source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-profile-'));
  const base = { packageManager: 'pnpm@10.8.0', dependencies: { '@napplet/sdk': '^0.24.4' } };
  const project = {
    ...base,
    dependencies: { ...base.dependencies, three: '0.177.0' },
    devDependencies: { '@types/three': '0.177.0' },
  };
  const lock = Buffer.from('exact locked packages\n');
  async function put(directory: string, manifest: unknown, bytes: Uint8Array) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'pnpm-lock.yaml'), bytes);
  }
  try {
    await put(join(root, 'profile'), base, Buffer.from('starter lock'));
    await put(join(root, 'workspace'), project, lock);
    const installed = join(root, 'profiles', toolchainProfileId(project, lock));
    await put(installed, project, lock);
    expect(await selectToolchainProfile(join(root, 'workspace'), root)).toBe(installed);
    // A directory name alone cannot authorize a changed installed lockfile.
    await writeFile(join(installed, 'pnpm-lock.yaml'), 'tampered installed lock');
    await expect(selectToolchainProfile(join(root, 'workspace'), root)).rejects.toMatchObject({
      code: 'STUDIO_PROFILE',
    });
    await put(installed, project, lock);
    // A changed lock, even with unchanged top-level ranges, needs another installed profile.
    await writeFile(join(root, 'workspace/pnpm-lock.yaml'), 'different locked packages');
    await expect(selectToolchainProfile(join(root, 'workspace'), root)).rejects.toMatchObject({
      code: 'STUDIO_PROFILE',
    });
    await put(
      join(root, 'workspace'),
      { ...base, dependencies: { custom: 'https://user:private-credential@example.com/pkg.tgz' } },
      lock,
    );
    try {
      await selectToolchainProfile(join(root, 'workspace'), root);
      throw new Error('Expected profile refusal');
    } catch (error) {
      const diagnostic = diagnose(error);
      expect(diagnostic.code).toBe('STUDIO_PROFILE');
      expect(formatDiagnostic(diagnostic)).not.toContain('private-credential');
      expect(formatDiagnostic(diagnostic)).toContain(
        'Different dependencies: custom (custom version)',
      );
    }
    // Package names, scripts and JSON ordering do not change the installed dependencies.
    await put(
      join(root, 'workspace'),
      { scripts: { build: 'vite build' }, name: 'renamed', ...base },
      Buffer.from('starter lock'),
    );
    expect(await selectToolchainProfile(join(root, 'workspace'), root)).toBe(join(root, 'profile'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
