import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DiagnosticError } from '../../packages/diagnostics/src';
import { regularFile, checkSource } from '../../packages/publish/src/project';
import { sha256 } from '../../packages/protocol/src/artifact';
import { boilerplateFiles } from '../cli/src/creator-kit';
import { assetBytes, validateAssets } from '../../packages/assets/src';
import { browserBuildDelta } from './browser-build-cache';
import {
  browserBuildLimits as limits,
  type BrowserBuildInput,
  type BrowserBuildJob,
  type BrowserBuildResult,
} from './browser-build-contract';

const unsupported = (detail: string) =>
  new DiagnosticError('STUDIO_BROWSER_PROFILE', detail, {
    operation: 'prepare browser build',
    recovery: 'Turn off Browser builds and use the existing soyLI checks for this project.',
  });
const decoder = new TextDecoder('utf-8', { fatal: true });
const textFile = /\.(?:[cm]?js|ts|tsx|jsx|css|json)$/;
const roots = [
  'index.html',
  'napplet.json',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'pnpm-lock.yaml',
];
const optional = ['config.schema.json', 'soy-assets.js', 'soy-assets.d.ts', 'napplet.assets.json'];

async function collect(
  root: string,
  prefix: string,
  files: Record<string, string>,
  library = false,
) {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + '/' + entry.name;
    if (entry.isDirectory()) await collect(root, path, files, library);
    else if (entry.isFile() && textFile.test(path)) {
      const bytes = await regularFile(root, path, limits.sourceBytes);
      if (!library) checkSource(path, bytes);
      files['/' + path] = decoder.decode(bytes);
    } else if (!library)
      throw unsupported(`Browser builds do not yet support this source file: ${path}`);
    if (Object.keys(files).length > limits.files)
      throw unsupported('Too many files for the browser build profile.');
  }
}

/** No build commands, package scripts or project configuration are executed here. */
export async function browserBuildInput(
  root: string,
  libraries = true,
  libraryRoot = root,
): Promise<BrowserBuildInput> {
  for (const path of ['public', 'napplet.config.ts', 'napplet.config.js']) {
    const present = await lstat(join(root, path)).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (present) throw unsupported(`Browser builds do not yet support ${path}.`);
  }
  const files: Record<string, string> = {};
  for (const path of [...roots, ...optional]) {
    let bytes;
    try {
      bytes = await regularFile(root, path, limits.sourceBytes);
    } catch (error) {
      if (optional.includes(path) && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    checkSource(path, bytes);
    files['/' + path] = decoder.decode(bytes);
  }
  const starter = boilerplateFiles('browser-preview');
  for (const path of ['vite.config.ts', 'tsconfig.json']) {
    if (files['/' + path].trim() !== starter[path].trim())
      throw unsupported(
        `Browser builds currently require the standard soyLI ${path}. Custom configuration is preserved.`,
      );
  }
  const pkg = JSON.parse(files['/package.json']);
  const reference = JSON.parse(starter['package.json']);
  for (const field of ['dependencies', 'devDependencies', 'scripts', 'packageManager']) {
    if (JSON.stringify(pkg[field]) !== JSON.stringify(reference[field]))
      throw unsupported(`Browser builds currently require the starter's ${field}.`);
  }
  const config = JSON.parse(files['/napplet.json']);
  if (config.entry !== 'dist/index.html' || config.backend?.modules?.length)
    throw unsupported('Browser builds currently support the standard frontend TypeScript starter.');
  const assets = await validateAssets(root);
  await collect(root, 'src', files);
  const revision = await sha256(
    JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  );
  if (Buffer.byteLength(JSON.stringify(files)) > limits.sourceBytes)
    throw unsupported('Browser build source exceeds 2 MiB.');
  if (libraries) {
    // Only embedded bytes enter the compiler. External assets keep using the
    // existing sandbox resource bridge and immutable preview asset store.
    for (const asset of assets.assets.filter((a) => a.storage === 'embedded')) {
      const bytes = await assetBytes(root, asset);
      files['/' + asset.path] =
        `data:${asset.mime};base64,${Buffer.from(bytes).toString('base64')}`;
      if (Buffer.byteLength(JSON.stringify(files)) > limits.inputBytes)
        throw unsupported(
          'Embedded assets exceed the 12 MiB browser input budget. Use external storage or soyLI checks.',
        );
    }
    const sdk = await realpath(join(libraryRoot, 'node_modules/@napplet/sdk'));
    for (const name of ['sdk', 'nap', 'core']) {
      const dir = name === 'sdk' ? sdk : await realpath(join(dirname(sdk), name));
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      const expected = name === 'sdk' ? '0.24.4' : '0.28.0';
      if (pkg.version !== expected)
        throw unsupported(`Unsupported @napplet/${name} version: ${pkg.version}`);
      const additions: Record<string, string> = {};
      await collect(dir, 'dist', additions, true);
      additions['/package.json'] = JSON.stringify(pkg);
      for (const [path, body] of Object.entries(additions))
        files['/node_modules/@napplet/' + name + path] = body;
    }
    const lib = dirname(fileURLToPath(import.meta.resolve('typescript-browser')));
    for (const entry of await readdir(lib)) {
      if (/^lib\..*\.d\.ts$/.test(entry))
        files['/lib/' + entry] = await readFile(join(lib, entry), 'utf8');
    }
  }
  if (Buffer.byteLength(JSON.stringify(files)) > limits.inputBytes)
    throw unsupported('Browser build input exceeds 12 MiB.');
  if (Object.keys(files).length > limits.files)
    throw unsupported('Browser build input exceeds 512 files, including compiler libraries.');
  return { revision, files };
}

const resultSchema = z
  .object({
    id: z.uuid(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    html: z.string().max(limits.outputBytes).optional(),
    error: z.string().min(1).max(12000).optional(),
    errorKind: z.literal('worker').optional(),
    typecheckMs: z.number().finite().min(0).max(limits.timeoutMs),
    buildMs: z.number().finite().min(0).max(limits.timeoutMs),
  })
  .strict()
  .refine((v) => (v.html !== undefined) !== (v.error !== undefined))
  .refine((v) => !v.errorKind || v.error !== undefined);

/** Single active turn, bound to the initiating tab and exact immutable input. */
export class BrowserBuilds {
  private previous?: { session: string; job: BrowserBuildJob };
  private pending?: {
    session: string;
    job: BrowserBuildJob;
    resolve: (result: BrowserBuildResult) => void;
  };
  next(session: string, base?: string) {
    z.uuid().parse(session);
    if (base) z.uuid().parse(base);
    if (this.pending?.session !== session) return null;
    return this.previous?.session === session && this.previous.job.id === base
      ? browserBuildDelta(this.pending.job, this.previous.job)
      : this.pending.job;
  }
  reply(session: string, input: unknown) {
    const result = resultSchema.parse(input);
    const p = this.pending;
    if (!p || p.session !== session || p.job.id !== result.id || p.job.revision !== result.revision)
      throw new DiagnosticError('STUDIO_BROWSER_STALE', 'This browser build is no longer pending.');
    if (result.html !== undefined && Buffer.byteLength(result.html) > limits.outputBytes)
      throw unsupported('Browser output exceeds 8 MiB.');
    this.pending = undefined;
    this.previous = result.errorKind ? undefined : { session, job: p.job };
    p.resolve(result);
  }
  async run(
    session: string,
    input: BrowserBuildInput,
    signal: AbortSignal,
    timeoutMs: number = limits.timeoutMs,
  ) {
    z.uuid().parse(session);
    signal.throwIfAborted();
    if (this.pending) throw new Error('A browser build is already pending.');
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    try {
      return await new Promise<BrowserBuildResult>((resolve, reject) => {
        this.pending = { session, job: { ...input, id: crypto.randomUUID() }, resolve };
        abort = () => reject(signal.reason ?? new Error('Browser build cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () =>
            reject(
              new DiagnosticError(
                'STUDIO_BROWSER_DISCONNECTED',
                'The browser did not finish this build within two minutes.',
                {
                  recovery:
                    'Keep the Studio tab open, then run checks again. No host build or inference was retried automatically.',
                },
              ),
            ),
          timeoutMs,
        );
      });
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort!);
      this.pending = undefined;
    }
  }
}
