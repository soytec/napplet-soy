import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DiagnosticError } from '../../../packages/diagnostics/src';

const groups = ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides'] as const;
type Manifest = Record<string, any>;
export function dependencyManifest(manifest: Manifest) {
  return Object.fromEntries([
    ...groups.map((key) => [key, manifest[key] ?? {}]),
    ['packageManager', manifest.packageManager ?? null],
    ['pnpm', manifest.pnpm ?? {}],
  ]);
}
function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
      .join(',') +
    '}'
  );
}
export function toolchainProfileId(manifest: Manifest, lock: Uint8Array) {
  return createHash('sha256')
    .update(stable(dependencyManifest(manifest)))
    .update('\0')
    .update(lock)
    .digest('hex');
}
async function readProfile(root: string) {
  return {
    manifest: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Manifest,
    lock: await readFile(join(root, 'pnpm-lock.yaml')),
  };
}

/** Only image-installed dependencies are eligible. Source cannot select a path or install packages. */
export async function selectToolchainProfile(workspace: string, installed = '/opt') {
  const project = await readProfile(workspace);
  const base = await readProfile(join(installed, 'profile'));
  if (
    toolchainProfileId(base.manifest, base.lock) ===
    toolchainProfileId(project.manifest, project.lock)
  )
    return join(installed, 'profile');
  const candidate = join(installed, 'profiles', toolchainProfileId(project.manifest, project.lock));
  try {
    const extra = await readProfile(candidate);
    if (
      toolchainProfileId(extra.manifest, extra.lock) ===
      toolchainProfileId(project.manifest, project.lock)
    )
      return candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Never echo arbitrary dependency URLs or package-manager configuration (which can contain credentials).
  const different = groups.flatMap((group) =>
    Object.entries(project.manifest[group] ?? {})
      .filter(([name, value]) => base.manifest[group]?.[name] !== value)
      .map(([name, value]) => {
        const label = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,100}$/i.test(name)
          ? name
          : '(custom package)';
        const version =
          typeof value === 'string' && /^[~^]?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value)
            ? '@' + value
            : ' (custom version)';
        return label + version;
      }),
  );
  throw new DiagnosticError(
    'STUDIO_PROFILE',
    'This project’s dependencies are not installed on this Studio worker.',
    {
      operation: 'select installed project toolchain',
      detail: different.length
        ? 'Different dependencies: ' + different.join(', ')
        : 'The package-manager settings or exact lockfile differ from the installed profile.',
      recovery:
        'Ask the operator to install a profile for this package.json and pnpm-lock.yaml, then prepare a fresh proposal review or retry draft checks. You can also review with soyLI locally. Another AI prompt will not install dependencies.',
    },
  );
}
