import { realpath, readFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { standaloneProject } from '../cli/src/standalone-project';

/** Resolve pnpm links once instead of making every agent rediscover package layout. */
export async function workspaceMap(root: string): Promise<string> {
  if (await standaloneProject(root))
    return 'Workspace map: this is a standalone HTML remix. index.html is the editable application and its playable artifact. Preserve its existing NAP APIs and attribution. There is no src/main.ts, package installation or compiler required. Keep package.json and installed guidance unchanged; use soyli build and soyli check for validation. No upstream conformance suite is configured.';
  const lines = [
    'Workspace map: index.html mounts src/main.ts; src/styles.css styles the app.',
    'src/domain-availability.ts and src/napplet-settings.ts show the existing optional-domain/config pattern. Preserve working helpers unless the request needs a change.',
    'Keep package.json, lockfiles, build configuration, installed guides and existing tests unchanged.',
  ];
  try {
    const base = await realpath(root);
    const sdk = await realpath(join(base, 'node_modules/@napplet/sdk'));
    for (const [name, paths] of [
      ['sdk', ['dist/index.d.ts']],
      ['core', ['dist/index.d.ts']],
      ['nap', ['dist/config/sdk.d.ts', 'dist/config/types.d.ts']],
    ] as const) {
      const dir = name === 'sdk' ? sdk : await realpath(join(dirname(sdk), name));
      const path = relative(base, dir);
      if (path.startsWith('..') || isAbsolute(path)) continue;
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      lines.push(
        `Installed @napplet/${name} ${pkg.version}: read ${paths.map((p) => `${path}/${p}`).join(', ')} directly for declarations.`,
      );
    }
    lines.push(
      'Dependency searches ignore node_modules by default. Use the exact paths above with read; if needed rg --follow --hidden --no-ignore on just that package. Do not scan all dependencies or the home directory.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return lines.join('\n');
}
