/** Reproducible legacy-x64 context. No checkout, credentials or draft is sent to Docker. */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { previewAssets } from '../apps/cli/src/preview/assets';
import { playwrightDirectory } from '../apps/cli/src/distribution';
import version from '../apps/cli/distribution/version.json';
import { createHash } from 'node:crypto';

const [destination, base] = process.argv.slice(2);
if (!destination || !/^oven\/bun@sha256:[a-f0-9]{64}$/.test(base ?? ''))
  throw new Error(
    'Usage: bun scripts/studio-legacy-image.ts <new-directory> oven/bun@sha256:<digest>',
  );
if (Bun.version !== '1.3.11') throw new Error('Prepare with pinned Bun 1.3.11.');
const root = resolve(destination),
  sourceRoot = process.cwd();
await mkdir(root);
// Fetch once into the secret-free context so image retries do not redownload the
// full upstream monorepo. Never accept an unpinned local source tree.
const archive = new Uint8Array(
  await (
    await fetch('https://github.com/anomalyco/opencode/archive/refs/tags/v1.19.3.tar.gz', {
      signal: AbortSignal.timeout(600000),
    })
  ).arrayBuffer(),
);
if (
  createHash('sha256').update(archive).digest('hex') !==
  '8395f12e26df2d16610760ae224daf87da1d253a9883bf230be2c53984fe99ea'
)
  throw new Error('Pinned OpenCode source checksum mismatch.');
await writeFile(join(root, 'opencode-source.tar.gz'), archive);
await mkdir(join(root, 'tools/lib'), { recursive: true });
const assets = await previewAssets();
for (const [name, entry] of [
  ['soyli', 'apps/cli/src/index.ts'],
  ['capture', 'apps/studio/hosting/capture-entry.ts'],
  ['job-entry', 'apps/studio/hosting/job-entry.ts'],
] as const) {
  const result = await Bun.build({
    entrypoints: [resolve(entry)],
    target: 'bun',
    minify: true,
    outdir: join(root, 'tools'),
    naming: name + '.js',
    define: {
      NAPPLET_STANDALONE: 'true',
      NAPPLET_CLI_VERSION: JSON.stringify(version.version),
      NAPPLET_PREVIEW_ASSETS: JSON.stringify(assets),
      NAPPLET_DISTRIBUTION: JSON.stringify('studio-container'),
    },
    plugins: [
      {
        name: 'creator-source',
        setup(build) {
          build.onResolve(
            {
              filter:
                /\/(gamepad|app-data|app-data-contract|handler|handler-types|coordinated-audio)\.ts\?raw$/,
            },
            ({ path }) => ({
              path: resolve(sourceRoot, 'apps/cli/src', path.slice(0, -4)),
              namespace: 'creator-source',
            }),
          );
          build.onLoad({ filter: /.*/, namespace: 'creator-source' }, async ({ path }) => ({
            contents: await Bun.file(path).text(),
            loader: 'text',
          }));
        },
      },
    ],
  });
  if (!result.success) throw new Error(result.logs.join('\n'));
}
await cp(playwrightDirectory('current'), join(root, 'tools/lib/playwright-core'), {
  recursive: true,
  dereference: true,
});
await cp(dirname(Bun.resolveSync('ws/package.json', process.cwd())), join(root, 'tools/lib/ws'), {
  recursive: true,
  dereference: true,
});
await cp('apps/studio/vendor/models.json', join(root, 'tools/models.json'));
await cp('apps/studio/vendor/LICENSE.models.dev', join(root, 'tools/LICENSE.models.dev'));
await cp('apps/studio/vendor/README.md', join(root, 'tools/models-README.md'));
await cp('LICENSE', join(root, 'tools/LICENSE.soyli'));
await cp('scripts/deploy-cpu-check.sh', join(root, 'tools/check-cpu.sh'));
await writeFile(
  join(root, 'tools/profile.json'),
  JSON.stringify({
    profile: 'legacy-x64',
    bun: '1.3.8',
    opencode: '1.19.3',
    soyli: version.version,
  }),
);
await writeFile(
  join(root, 'Dockerfile'),
  `FROM ${base}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.8/bun-linux-x64-baseline.zip -o /tmp/bun.zip && \\
    unzip -q /tmp/bun.zip -d /tmp/bun && \\
    echo 'b607d67724a4de3e149f15813a2d52f15e470c4feba3e0db753d2043ce3a6607  /tmp/bun/bun-linux-x64-baseline/bun' | sha256sum -c - && \\
    cp /tmp/bun/bun-linux-x64-baseline/bun /usr/local/bin/bun && rm -rf /tmp/bun /tmp/bun.zip
COPY tools /opt/studio
RUN bash -c '. /opt/studio/check-cpu.sh; napplet_check_cpu Linux "$(uname -m)" /proc/cpuinfo legacy-x64' && test "$(bun --version)" = 1.3.8
RUN printf '#!/bin/sh\\nexec /usr/local/bin/bun --no-env-file /opt/studio/soyli.js "$@"\\n' > /usr/local/bin/soyli && \\
    printf '#!/bin/sh\\nexec /usr/local/bin/bun --no-env-file /opt/studio/capture.js "$@"\\n' > /opt/studio/capture && \\
    chmod 755 /usr/local/bin/soyli /opt/studio/capture && ln -s /opt/studio/lib /usr/local/bin/lib
ENV SPACE_TOOLCHAIN_CACHE=/opt/toolchains PLAYWRIGHT_BROWSERS_PATH=/opt/browsers PLAYWRIGHT_SKIP_BROWSER_GC=1
RUN cd /opt && soyli new profile --identity later --no-install && cd profile && soyli setup && \\
    ln -s /opt/toolchains/node-v24.21.0-linux-x64/bin/node /usr/local/bin/node && \\
    node /opt/studio/lib/playwright-core/cli.js install --with-deps chromium-headless-shell ffmpeg && \\
    for cli in /opt/profile/node_modules/.pnpm/playwright@*/node_modules/playwright/cli.js; do node "$cli" install chromium-headless-shell || exit; done && \\
    rm -rf /opt/profile/.git /opt/profile/.napplet-space /var/lib/apt/lists/* /root/.cache /root/.bun/install/cache && \\
    chmod -R a+rX /opt/profile /opt/toolchains /opt/browsers
COPY opencode-source.tar.gz /tmp/opencode.tar.gz
RUN \\
    echo '8395f12e26df2d16610760ae224daf87da1d253a9883bf230be2c53984fe99ea  /tmp/opencode.tar.gz' | sha256sum -c - && \\
    mkdir /opt/opencode && tar -xzf /tmp/opencode.tar.gz --strip-components=1 -C /opt/opencode && \\
    cd /opt/opencode && bun install --filter './packages/opencode' --frozen-lockfile --ignore-scripts && \\
    rm -rf /tmp/opencode.tar.gz /root/.bun/install/cache && chmod -R a+rX /opt/opencode
RUN printf '#!/bin/sh\\nexport OPENCODE_DISABLE_MODELS_FETCH=true OPENCODE_MODELS_PATH=/opt/studio/models.json\\nexec /usr/local/bin/bun --no-env-file /opt/opencode/packages/opencode/src/index.ts "$@"\\n' > /usr/local/bin/opencode && \\
    chmod 755 /usr/local/bin/opencode && chmod -R a+rX /opt/studio && \\
    opencode --version
LABEL soy.studio.profile="legacy-x64" soy.studio.bun="1.3.8" soy.studio.opencode="1.19.3"
USER 1000:1000
WORKDIR /workspace
`,
);
console.log('Prepared legacy-x64 Studio image context: ' + root);
