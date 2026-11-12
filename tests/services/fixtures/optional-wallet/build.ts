import { resolve } from 'node:path';
const base = resolve('tests/services/fixtures/optional-wallet');
const bundle = await Bun.build({
  entrypoints: [base + '/app.tsx'],
  target: 'browser',
  plugins: [
    {
      name: 'isolated-wallet-services',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^@\/|nostr-provider$|browser-identity$|wallet-runtime$|zap-recipient$|protocol-social$|community-client$|\/network$|creator-link$|^radix-ui$/,
          },
          (args) => {
            if (args.path.includes('packages/')) return;
            if (
              /(nostr-provider|browser-identity|zap-recipient|protocol-social|community-client|\/network|creator-link)$/.test(
                args.path,
              )
            )
              return { path: base + '/environment.tsx' };
            if (/wallet-runtime$/.test(args.path)) return { path: base + '/runtime.ts' };
            return {
              path: Bun.resolveSync(
                args.path.startsWith('@/') ? './src/' + args.path.slice(2) : args.path,
                process.cwd() + '/apps/web',
              ),
            };
          },
        );
      },
    },
  ],
});
if (!bundle.success) throw new Error(bundle.logs.join('\n'));
process.stdout.write(await bundle.outputs[0].text());
