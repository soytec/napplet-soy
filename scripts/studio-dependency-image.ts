/** Operator-only: prepare a secret-free additive image context for reviewed dependency profiles. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dependencyManifest, toolchainProfileId } from '../apps/studio/hosting/toolchain-profile';
import toolchain from '../apps/cli/vendor/toolchain.json';

const [destination, image, ...projects] = process.argv.slice(2);
if (!destination || !/^sha256:[a-f0-9]{64}$/.test(image ?? '') || !projects.length)
  throw new Error(
    'Usage: bun scripts/studio-dependency-image.ts <new-context-directory> sha256:<installed-worker-image> <reviewed-project-directory> [...]',
  );
if (Bun.version !== '1.3.11') throw new Error('Prepare with pinned Bun 1.3.11.');
const root = resolve(destination);
await mkdir(root);
const ids = new Set<string>();
for (const project of projects) {
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  if (manifest.packageManager !== `pnpm@${toolchain.pnpm.version}`)
    throw new Error('Additional profiles must use the worker’s pinned pnpm version.');
  // Do not import project hooks, registry credentials, source or scripts into the build context.
  if (manifest.pnpm && Object.keys(manifest.pnpm).length)
    throw new Error(
      'Additional profiles with custom pnpm settings require a separately reviewed image.',
    );
  const dependencies = dependencyManifest(manifest);
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides'])
    for (const [name, version] of Object.entries(dependencies[group] ?? {}))
      if (
        !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
        typeof version !== 'string' ||
        !/^[~^]?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)
      )
        throw new Error(
          'Additional profiles support registry package versions only; review custom dependencies separately.',
        );
  const lock = await readFile(join(project, 'pnpm-lock.yaml'));
  const id = toolchainProfileId(manifest, lock);
  if (ids.has(id)) continue;
  ids.add(id);
  const directory = join(root, 'profiles', id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, ...dependencies }, null, 2),
  );
  await writeFile(join(directory, 'pnpm-lock.yaml'), lock);
}
const built = await Bun.build({
  entrypoints: [resolve('apps/studio/hosting/job-entry.ts')],
  target: 'bun',
  minify: true,
  outdir: root,
});
if (!built.success) throw new Error(built.logs.join('\n'));
// BuildKit interprets a bare sha256: ID as a registry name. The companion build
// script verifies and tags the exact local image before invoking the builder.
const baseTag = `soy-studio-profile-base:${image!.slice(7)}`;
await writeFile(
  join(root, 'Dockerfile'),
  `FROM ${baseTag}
USER root
COPY profiles /opt/profiles
COPY job-entry.js /opt/studio/job-entry.js
RUN for profile in /opt/profiles/*; do \\
      cd "$profile" && /usr/local/bin/node /opt/toolchains/pnpm-${toolchain.pnpm.version}/package/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts --store-dir /tmp/soy-profile-store || exit; \\
    done && rm -rf /tmp/soy-profile-store && chmod -R a+rX /opt/profiles
USER 1000:1000
WORKDIR /workspace
`,
);
await writeFile(
  join(root, 'build.sh'),
  `#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
docker image inspect '${image}' >/dev/null
docker image tag '${image}' '${baseTag}'
docker build --pull=false --iidfile "$root/image-id" "$root"
`,
  { mode: 0o700 },
);
await writeFile(
  join(root, 'profiles.json'),
  JSON.stringify({ image, profiles: [...ids] }, null, 2),
);
console.log(
  `Prepared dependency image context: ${root}. Review the manifests and lockfiles before building; deploying the resulting image is a separate operator action.`,
);
