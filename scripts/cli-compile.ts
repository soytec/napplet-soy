import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BunPlugin } from 'bun';
import type { previewAssets } from '../apps/cli/src/preview/assets';

const root = resolve(import.meta.dir, '..');

/** Preserve explicit creator-source imports as text in native and Studio builds. */
export const creatorSourcePlugin: BunPlugin = {
  name: 'raw-creator-source',
  setup(build) {
    // A separate module identity avoids colliding with the executable SDK import.
    build.onResolve({ filter: /\.ts\?raw$/ }, ({ path, importer }) => ({
      path: resolve(dirname(importer), path.slice(0, -4)),
      namespace: 'creator-source',
    }));
    build.onLoad({ filter: /.*/, namespace: 'creator-source' }, async ({ path }) => ({
      contents: await Bun.file(path).text(),
      loader: 'text',
    }));
  },
};

/** Release and standalone integration fixtures share loaders and runtime isolation. */
export async function compileCli(
  outfile: string,
  version: string,
  options: {
    target?: Bun.Build.CompileTarget;
    previewAssets?: Awaited<ReturnType<typeof previewAssets>>;
    /** Package manager that owns the installation; disables soyli update. */
    distribution?: string;
  } = {},
) {
  const build = await Bun.build({
    entrypoints: [join(root, 'apps/cli/src/index.ts')],
    target: 'bun',
    minify: true,
    define: {
      NAPPLET_STANDALONE: 'true',
      NAPPLET_CLI_VERSION: JSON.stringify(version),
      ...(options.previewAssets
        ? { NAPPLET_PREVIEW_ASSETS: JSON.stringify(options.previewAssets) }
        : {}),
      ...(options.distribution
        ? { NAPPLET_DISTRIBUTION: JSON.stringify(options.distribution) }
        : {}),
    },
    plugins: [creatorSourcePlugin],
    compile: {
      ...(options.target ? { target: options.target } : {}),
      outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'preview-assets': { type: 'boolean' },
      distribution: { type: 'string' },
    },
  });
  const [outfile, version] = positionals;
  if (!outfile || !version)
    throw new Error(
      'Usage: bun scripts/cli-compile.ts <outfile> <version> [--preview-assets] [--distribution <name>]',
    );
  if (values.distribution !== undefined && !/^[a-z][a-z0-9-]*$/.test(values.distribution))
    throw new Error('--distribution must be a lowercase package manager name, e.g. nix.');
  const { previewAssets } = await import('../apps/cli/src/preview/assets');
  await compileCli(outfile, version, {
    previewAssets: values['preview-assets'] ? await previewAssets() : undefined,
    distribution: values.distribution,
  });
}
