/** Isolate browser resolution from Node/server imports made by other service tests. */
const build = await Bun.build({
  entrypoints: [new URL('./intent-host.ts', import.meta.url).pathname],
  target: 'browser',
  conditions: ['browser'],
  format: 'esm',
  define: {
    NAPPLET_TEST_SHIM: JSON.stringify(
      await Bun.file(Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir)).text(),
    ),
  },
});
if (!build.success) throw new Error(build.logs.join('\n'));
process.stdout.write(await build.outputs[0].text());
