import { regularFile } from '../../../packages/publish/src/project';

/** Editable HTML has no install/build toolchain. Missing dependency locks alone
 * must never cause a dependency-bearing project to be treated as standalone. */
export async function standaloneProject(directory: string): Promise<boolean> {
  const json = async (path: string) =>
    JSON.parse(new TextDecoder().decode(await regularFile(directory, path, 1024 * 1024)));
  let config;
  try {
    config = await json('napplet.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (config.entry !== 'index.html' || config.build || config.backend?.modules?.length)
    return false;
  const pkg = await json('package.json');
  if (
    [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'overrides',
    ].some((key) => Object.keys(pkg[key] ?? {}).length)
  )
    return false;
  if (pkg.packageManager || pkg.workspaces || pkg.pnpm) return false;
  const commands: Record<string, string> = {
    dev: 'soyli dev',
    check: 'soyli check',
    publish: 'soyli publish',
  };
  return Object.entries(pkg.scripts ?? {}).every(([name, script]) => commands[name] === script);
}
