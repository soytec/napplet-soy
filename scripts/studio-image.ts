/** Prepare a minimal, secret-free Docker context. Never send the repository/.env to Docker. */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { previewAssets } from '../apps/cli/src/preview/assets';
import { playwrightDirectory } from '../apps/cli/src/distribution';
import toolchain from '../apps/cli/vendor/toolchain.json';
import version from '../apps/cli/distribution/version.json';

const [destination, base] = process.argv.slice(2);
if (!destination || !/^oven\/bun@sha256:[a-f0-9]{64}$/.test(base ?? ''))
  throw new Error(
    'Usage: bun scripts/studio-image.ts <new-context-directory> oven/bun@sha256:<digest>',
  );
if (Bun.version !== '1.3.11') throw new Error('Build with pinned Bun 1.3.11.');
const root = resolve(destination);
await mkdir(root); // Refuse overwriting an earlier build context.
await mkdir(join(root, 'tools/lib'), { recursive: true });
await cp('scripts/deploy-cpu-check.sh', join(root, 'tools/check-cpu.sh'));
const assets = await previewAssets();
// Compile from the original module graph, as the soyLI release pipeline does.
// Recompiling a flattened CLI bundle is not equivalent to a standalone release.
const listed = Bun.spawn(
  [
    'git',
    'ls-files',
    '-z',
    'apps/cli',
    'packages',
    'scripts/cli-compile.ts',
    'docs/*.md',
    'docs/examples/coordinated-audio.ts',
    'apps/web/public/install.sh',
  ],
  { stdout: 'pipe', stderr: 'pipe' },
);
const paths = (await new Response(listed.stdout).text()).split('\0').filter(Boolean);
if (await listed.exited) throw new Error('Cannot select trusted image build sources.');
for (const path of [
  ...paths,
  'package.json',
  'bun.lock',
  'apps/web/package.json',
  'apps/cvm/package.json',
  'apps/studio/hosting/capture-entry.ts',
]) {
  await mkdir(dirname(join(root, 'source', path)), { recursive: true });
  await cp(path, join(root, 'source', path));
}
await writeFile(join(root, 'source/preview-assets.json'), JSON.stringify(assets));
await writeFile(
  join(root, 'source/build-tools.ts'),
  `import { compileCli } from './scripts/cli-compile';
import assets from './preview-assets.json';
const output = process.env.STUDIO_IMAGE_TOOLS_DIR || '/opt/studio';
console.log('Compiling soyLI');
await compileCli(output + '/soyli', '${version.version}', { target: 'bun-linux-x64-baseline', previewAssets: assets });
console.log('Compiling capture worker');
const built = await Bun.build({ entrypoints: ['./apps/studio/hosting/capture-entry.ts'], target: 'bun', minify: true,
  define: { NAPPLET_STANDALONE: 'true', NAPPLET_PREVIEW_ASSETS: JSON.stringify(assets) },
  compile: { target: 'bun-linux-x64-baseline', outfile: output + '/capture', autoloadDotenv: false, autoloadBunfig: false } });
if (!built.success) throw new Error(built.logs.join('\\n'));
`,
);
const entry = await Bun.build({
  entrypoints: [resolve('apps/studio/hosting/job-entry.ts')],
  target: 'bun',
  outdir: root,
  minify: true,
});
if (!entry.success) throw new Error(entry.logs.join('\n'));
await cp(playwrightDirectory('current'), join(root, 'tools/lib/playwright-core'), {
  recursive: true,
  dereference: true,
});
await cp(dirname(Bun.resolveSync('ws/package.json', process.cwd())), join(root, 'tools/lib/ws'), {
  recursive: true,
  dereference: true,
});
const node = toolchain.node.platforms['linux-x64'].directory;
await writeFile(
  join(root, 'Dockerfile'),
  `FROM ${base}
USER root
COPY tools/check-cpu.sh /opt/studio/check-cpu.sh
RUN bash -c '. /opt/studio/check-cpu.sh; napplet_check_cpu'
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl \\
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \\
    libxrandr2 libgbm1 libdrm2 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2 libcups2 fonts-liberation \\
    && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends unzip && \\
    curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.11/bun-linux-x64-baseline.zip -o /tmp/bun.zip && \\
    printf '%s  /tmp/bun.zip\\n' abe346f63414547cdf6b35b7a649a490c728b93d006226156923918a84c0e59b | sha256sum -c - && \\
    unzip -q /tmp/bun.zip -d /tmp/bun && cp /tmp/bun/bun-linux-x64-baseline/bun /usr/local/bin/bun && \\
    rm -rf /tmp/bun /tmp/bun.zip /var/lib/apt/lists/*
COPY tools /opt/studio
COPY job-entry.js /opt/studio/job-entry.js
COPY source /opt/build
RUN cd /opt/build && bun install --frozen-lockfile --ignore-scripts
RUN cd /opt/build && bun --smol build-tools.ts && rm -rf /opt/build/node_modules /root/.bun/install/cache
ENV SPACE_TOOLCHAIN_CACHE=/opt/toolchains PLAYWRIGHT_BROWSERS_PATH=/opt/browsers PLAYWRIGHT_SKIP_BROWSER_GC=1
RUN test "$(bun --version)" = "1.3.11" && ln -s /opt/studio/lib /usr/local/bin/lib && ln -s /opt/studio/soyli /usr/local/bin/soyli && \\
    cd /opt && soyli new profile --identity later --no-install && cd profile && soyli setup && \\
    ln -s /opt/toolchains/${node}/bin/node /usr/local/bin/node && \\
    node /opt/studio/lib/playwright-core/cli.js install chromium-headless-shell ffmpeg && \\
    for cli in /opt/profile/node_modules/.pnpm/playwright@*/node_modules/playwright/cli.js; do node "$cli" install chromium-headless-shell || exit; done && \\
    rm -rf /opt/profile/.git /opt/profile/.napplet-space && chmod -R a+rX /opt/profile /opt/toolchains /opt/browsers
RUN mkdir /opt/opencode && cd /opt/opencode && bun add --exact opencode-ai@1.19.3 && \\
    ln -s /opt/opencode/node_modules/.bin/opencode /usr/local/bin/opencode
LABEL soy.studio.profile="standard" soy.studio.bun="1.3.11" soy.studio.opencode="1.19.3"
USER 1000:1000
WORKDIR /workspace
`,
);
await writeFile(
  join(root, 'profile.json'),
  JSON.stringify(
    {
      architecture: 'linux-x64',
      base,
      soyli: version.version,
      bunCompiler: Bun.version,
      opencode: '1.19.3',
      node: toolchain.node.version,
      pnpm: toolchain.pnpm.version,
    },
    null,
    2,
  ),
);
console.log(`Prepared isolated Studio context: ${root}`);
