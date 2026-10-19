import * as esbuild from 'esbuild-wasm';
import ts from 'typescript-browser';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import {
  browserBuildLimits as limits,
  type BrowserBuildJob,
  type BrowserBuildResult,
} from './browser-build-contract';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const children = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);
function elements(node: Node): Element[] {
  return [...('tagName' in node ? [node as Element] : []), ...children(node).flatMap(elements)];
}
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const escapeAttribute = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function append(node: Element, html: string) {
  for (const child of parseFragment(html).childNodes) {
    child.parentNode = node;
    node.childNodes.push(child);
  }
}
function remove(node: Element) {
  if (node.parentNode)
    node.parentNode.childNodes = node.parentNode.childNodes.filter((n) => n !== node);
}
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Import escapes the project.');
      parts.pop();
    } else parts.push(part);
  }
  return '/' + parts.join('/');
}
function diagnostics(files: Record<string, string>) {
  const configuration = ts.readConfigFile('/tsconfig.json', (p) => files[p]);
  if (configuration.error) return [configuration.error];
  const options = ts.convertCompilerOptionsFromJson(configuration.config.compilerOptions, '/');
  const host: ts.CompilerHost = {
    fileExists: (p) => Object.hasOwn(files, p),
    readFile: (p) => files[p],
    directoryExists: (p) =>
      Object.keys(files).some((f) => f.startsWith(p.replace(/\/$/, '') + '/')),
    getDirectories: () => [],
    getSourceFile: (p, language) =>
      files[p] === undefined ? undefined : ts.createSourceFile(p, files[p], language, true),
    getDefaultLibFileName: (opts) => '/lib/' + ts.getDefaultLibFileName(opts),
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (p) => p,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    writeFile: () => {},
  };
  const program = ts.createProgram(
    Object.keys(files).filter((p) => p.startsWith('/src/') && /\.tsx?$/.test(p)),
    options.options,
    host,
  );
  return [...options.errors, ...ts.getPreEmitDiagnostics(program)];
}
function diagnosticText(d: ts.Diagnostic) {
  const at =
    d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
  return `${d.file?.fileName ?? 'TypeScript'}${at ? `:${at.line + 1}:${at.character + 1}` : ''} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
}

/** Called only in the browser worker. It never executes Vite config or package scripts. */
export async function compileBrowserProject(job: BrowserBuildJob): Promise<BrowserBuildResult> {
  const result: BrowserBuildResult = {
    id: job.id,
    revision: job.revision,
    typecheckMs: 0,
    buildMs: 0,
  };
  const files = job.files;
  const checkStart = performance.now();
  try {
    const errors = diagnostics(files).filter((d) => d.category === ts.DiagnosticCategory.Error);
    result.typecheckMs = performance.now() - checkStart;
    if (errors.length) throw new Error(errors.slice(0, 30).map(diagnosticText).join('\n'));
    const started = performance.now();
    const document = parse(files['/index.html']);
    const nodes = elements(document);
    const head = nodes.find((n) => n.tagName === 'head')!;
    const scripts = nodes.filter((n) => n.tagName === 'script' && attr(n, 'src'));
    if (
      scripts.length !== 1 ||
      attr(scripts[0], 'type') !== 'module' ||
      nodes.some((n) => n.tagName === 'script' && attr(n, 'type') === 'module' && !attr(n, 'src'))
    )
      throw new Error(
        'Browser profile requires one local module script in index.html. Use soyLI checks for other entries.',
      );
    const script = scripts[0];
    const entry = attr(script, 'src')!;
    if (!/^\/?(?:src\/|\.\/src\/)/.test(entry) || /[?#]/.test(entry))
      throw new Error('Unsupported browser entry: ' + entry);
    const styles = nodes.filter((n) => n.tagName === 'link' && attr(n, 'rel') === 'stylesheet');
    const imports = styles.map((n) => attr(n, 'href')!);
    if (imports.some((p) => !p || /^(?:[a-z]+:|\/\/)/i.test(p) || /[?#]/.test(p)))
      throw new Error('Browser builds require local stylesheets.');
    const embeddedAsset = (reference: string) => {
      if (/^(?:[a-z]+:|\/\/)/i.test(reference) || /[?#]/.test(reference)) return;
      const data = files[normalize(reference)];
      return data?.startsWith('data:') && normalize(reference).startsWith('/assets/')
        ? data
        : undefined;
    };
    for (const node of nodes) {
      if (node === script || styles.includes(node)) continue;
      for (const attribute of node.attrs) {
        if (
          ['src', 'poster', ...(node.tagName === 'link' ? ['href'] : [])].includes(attribute.name)
        ) {
          const data = embeddedAsset(attribute.value);
          if (data) attribute.value = data;
        }
      }
      if (
        attr(node, 'srcset') ||
        ['src', 'poster', ...(node.tagName === 'link' ? ['href'] : [])].some((name) => {
          const value = attr(node, name);
          return value && !value.startsWith('data:');
        })
      )
        throw new Error(
          'Browser builds require inline media or registered embedded assets. Use assetUrl for managed external assets, or soyLI checks for other HTML references.',
        );
    }
    const bundler = await esbuild.build({
      stdin: {
        contents: [...imports, entry]
          .map((p) => `import ${JSON.stringify(normalize(p))};`)
          .join('\n'),
        resolveDir: '/',
        sourcefile: 'studio-entry.js',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outfile: '/out/app.js',
      logLevel: 'silent',
      charset: 'utf8',
      legalComments: 'inline',
      define: {
        'import.meta.env.DEV': 'false',
        'import.meta.env.PROD': 'true',
        'import.meta.env.MODE': '"production"',
        'import.meta.env.BASE_URL': '"/"',
      },
      plugins: [
        {
          name: 'studio-files',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'url-token' && args.path.startsWith('data:'))
                return { path: args.path, external: true };
              const dependency = /^(@napplet\/(?:sdk|nap|core))(\/.*)?$/.exec(args.path);
              if (dependency) {
                const base = '/node_modules/' + dependency[1];
                const pkg = JSON.parse(files[base + '/package.json']);
                const exported = pkg.exports?.[dependency[2] ? '.' + dependency[2] : '.']?.import;
                if (typeof exported !== 'string' || !exported.startsWith('./dist/'))
                  throw new Error('Unsupported SDK export: ' + args.path);
                return {
                  path: normalize(base + '/' + exported),
                  namespace: 'studio',
                  sideEffects: pkg.sideEffects !== false,
                };
              }
              if (!args.path.startsWith('.') && !args.path.startsWith('/'))
                throw new Error('Unsupported dependency: ' + args.path);
              const urlImport = args.path.endsWith('?url');
              const specifier = urlImport ? args.path.slice(0, -4) : args.path;
              if (/[?#]/.test(specifier) || specifier.startsWith('//'))
                throw new Error('Unsupported import: ' + args.path);
              const path = normalize(
                (specifier.startsWith('/')
                  ? ''
                  : args.importer.slice(0, args.importer.lastIndexOf('/') + 1)) + specifier,
              );
              const asset = embeddedAsset(path);
              if (asset && (urlImport || args.kind === 'url-token'))
                return args.kind === 'url-token'
                  ? { path: asset, external: true }
                  : { path, namespace: 'studio-asset' };
              if (urlImport || path.startsWith('/assets/'))
                throw new Error(
                  'Only registered embedded assets support direct URL imports. Use assetUrl for external assets: ' +
                    args.path,
                );
              // The starter uses ESM .js specifiers for its TypeScript source files.
              const resolved = [
                path,
                ...(/\.jsx?$/.test(path)
                  ? [path.replace(/\.jsx?$/, '.ts'), path.replace(/\.jsx?$/, '.tsx')]
                  : []),
                path + '.ts',
                path + '.tsx',
                path + '.js',
                path + '/index.ts',
                path + '/index.js',
              ].find((p) => Object.hasOwn(files, p));
              if (!resolved)
                throw new Error(
                  'Cannot resolve ' + args.path + ' from ' + (args.importer || 'index.html'),
                );
              return { path: resolved, namespace: 'studio' };
            });
            build.onLoad({ filter: /.*/, namespace: 'studio-asset' }, (args) => ({
              contents: `export default ${JSON.stringify(files[args.path])};`,
              loader: 'js',
            }));
            build.onLoad({ filter: /.*/, namespace: 'studio' }, (args) => {
              const suffix = args.path.split('.').pop()!;
              if (!['ts', 'tsx', 'js', 'jsx', 'css', 'json'].includes(suffix))
                throw new Error('Unsupported source: ' + args.path);
              return { contents: files[args.path], loader: suffix as esbuild.Loader };
            });
          },
        },
      ],
    });
    const js = bundler.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
    const css = bundler.outputFiles.find((f) => f.path.endsWith('.css'))?.text;
    script.attrs = [{ name: 'type', value: 'module' }];
    script.childNodes = [
      { nodeName: '#text', value: js.replace(/<\/script/gi, '<\\/script'), parentNode: script },
    ];
    for (const style of styles) remove(style);
    if (css) append(head, `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
    append(head, '<meta name="napplet-type" content="my-napplet">');
    if (files['/config.schema.json']) {
      const schema = JSON.stringify(JSON.parse(files['/config.schema.json']));
      append(head, `<meta name="napplet-config-schema" content="${escapeAttribute(schema)}">`);
    }
    const html = serialize(document);
    if (new TextEncoder().encode(html).length > limits.outputBytes)
      throw new Error('Browser output exceeds 8 MiB. Use soyLI checks.');
    result.buildMs = performance.now() - started;
    result.html = html;
  } catch (error) {
    result.typecheckMs ||= performance.now() - checkStart;
    result.error = (error instanceof Error ? error.message : String(error)).slice(0, 12000);
  }
  return result;
}
