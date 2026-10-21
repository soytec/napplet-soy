import { cp, chmod, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DiagnosticError, ToolOutput, diagnose, formatDiagnostic } from '../packages/diagnostics/src';

const root = resolve(import.meta.dir, '..');
const cwd = resolve(root, 'services/relay');
const env = { ...process.env, GOTOOLCHAIN: 'go1.25.0', CGO_ENABLED: '1' };
const version = 'v0.0.0-20260902034142-316ef6591fa2';

async function runGo(
  go: string,
  args: string[],
  context: { operation: string; recovery: string; captureJson?: boolean },
) {
  const metadata = { operation: context.operation, recovery: context.recovery, tool: 'go', target: cwd };
  const stdout = new ToolOutput(context.captureJson ? undefined : (text) => process.stdout.write(text));
  const stderr = new ToolOutput((text) => process.stderr.write(text));
  let child;
  try {
    child = Bun.spawn([go, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  } catch (cause) {
    throw new DiagnosticError('RELAY_GO', 'Could not start Go for the relay.', { ...metadata, cause });
  }
  const drain = async (stream: ReadableStream<Uint8Array>, output: ToolOutput) => {
    for await (const chunk of stream) output.push(chunk);
    output.finish();
  };
  const [json, , exitCode] = await Promise.all([
    context.captureJson
      ? new Response(child.stdout).text().then((text) => {
          stdout.push(new TextEncoder().encode(text));
          stdout.finish();
          return text;
        })
      : drain(child.stdout, stdout).then(() => ''),
    drain(child.stderr, stderr),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new DiagnosticError('RELAY_GO', `Go failed during ${context.operation}.`, {
      ...metadata,
      exitCode,
      detail: [stdout.text, stderr.text].filter(Boolean).join('\n'),
    });
  return json;
}

/** Apply checksum-guarded fixes in an isolated module copy. Never edit Go's shared module cache. */
export async function relayGo(args: string[]) {
  const go = Bun.which('go');
  if (!go)
    throw new Error(
      'The relay needs Go 1.21+ and a C compiler. Install Go, then rerun bun run dev:setup. Builds use pinned Go 1.25.0.',
    );
  const output = await runGo(go, ['mod', 'download', '-json', `fiatjaf.com/nostr@${version}`], {
    operation: 'relay dependency download',
    recovery: 'Address the Go download error above, check network access, then retry the relay command.',
    captureJson: true,
  });
  const module = JSON.parse(output) as { Dir: string };
  const directory = resolve(root, '.local/relay-build');
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(resolve(directory, 'build-'));
  try {
    const patchedModule = resolve(scratch, 'nostr');
    await cp(module.Dir, patchedModule, { recursive: true });
    const writable = Bun.spawn(['chmod', '-R', 'u+w', patchedModule]);
    if ((await writable.exited) !== 0)
      throw new Error('Could not prepare the isolated relay dependency copy.');
    const patches = [
      {
        file: 'event.go',
        sha256: '41f74d5ac62e18df2bd84c829e44ef71716482e45d462800e1c04613cde9afe1',
        apply: (source: string) =>
          source
            .replaceAll(
              'base := uintptr(unsafe.Pointer(unsafe.StringData(s)))',
              'base := unsafe.Pointer(unsafe.StringData(s))',
            )
            .replaceAll('unsafe.Pointer(base + uintptr(i))', 'unsafe.Add(base, i)'),
      },
      {
        file: 'eventstore/lmdb/query.go',
        sha256: '962207dffd965840af5f28f0236a944004101ab36fc1b53d51c3501b5f38d335',
        // LMDB yields incrementally, but the upstream batch allocation scales with the full query limit.
        apply: (source: string) =>
          source.replace(
            'batchSizePerQuery := internal.BatchSizePerNumberOfQueries(limit, len(queries))',
            'batchSizePerQuery := min(500, internal.BatchSizePerNumberOfQueries(limit, len(queries)))',
          ),
      },
      {
        file: 'khatru/listener.go',
        sha256: 'bcba2081da4b454012c2a8534ec4fbfbf8601409b805e31774c40fefbfaea7b0',
        // Unindexed listeners (no kinds or authors) share unsynchronized slice sets: a CLOSE
        // shifts the backing array while a broadcast iterates it. Guard them and copy on read.
        apply: (source: string) => {
          const edits: [string, string][] = [
            ['\t"iter"\n\t"sync"\n', '\t"iter"\n\t"slices"\n\t"sync"\n'],
            [
              '\tfallbackNothing set.Set[int]\n}',
              '\tfallbackNothing set.Set[int]\n\tfallbackMu      sync.Mutex\n}',
            ],
            [
              '\tif !indexed {\n\t\tif sub.filter.Tags != nil {\n\t\t\td.fallbackTags.Add(ssid)\n\t\t} else {\n\t\t\td.fallbackNothing.Add(ssid)\n\t\t}\n\t}',
              '\tif !indexed {\n\t\td.fallbackMu.Lock()\n\t\tif sub.filter.Tags != nil {\n\t\t\td.fallbackTags.Add(ssid)\n\t\t} else {\n\t\t\td.fallbackNothing.Add(ssid)\n\t\t}\n\t\td.fallbackMu.Unlock()\n\t}',
            ],
            [
              '\t\tif !indexed {\n\t\t\tif sub.filter.Tags != nil {\n\t\t\t\td.fallbackTags.Remove(ssid)\n\t\t\t} else {\n\t\t\t\td.fallbackNothing.Remove(ssid)\n\t\t\t}\n\t\t}',
              '\t\tif !indexed {\n\t\t\td.fallbackMu.Lock()\n\t\t\tif sub.filter.Tags != nil {\n\t\t\t\td.fallbackTags.Remove(ssid)\n\t\t\t} else {\n\t\t\t\td.fallbackNothing.Remove(ssid)\n\t\t\t}\n\t\t\td.fallbackMu.Unlock()\n\t\t}',
            ],
            ['range d.fallbackTags.Slice()', 'range d.fallbackSnapshot(d.fallbackTags)'],
            ['range d.fallbackNothing.Slice()', 'range d.fallbackSnapshot(d.fallbackNothing)'],
          ];
          for (const [from, to] of edits) {
            if (source.split(from).length !== 2)
              throw new Error(`Relay listener patch did not match exactly once: ${from.trim()}`);
            source = source.replace(from, to);
          }
          return `${source}\nfunc (d *dispatcher) fallbackSnapshot(s set.Set[int]) []int {\n\td.fallbackMu.Lock()\n\tdefer d.fallbackMu.Unlock()\n\treturn slices.Clone(s.Slice())\n}\n`;
        },
      },
    ];
    for (const patch of patches) {
      const path = resolve(module.Dir, patch.file);
      const source = await Bun.file(path).text();
      if (createHash('sha256').update(source).digest('hex') !== patch.sha256)
        throw new Error(
          `Pinned relay source changed: ${patch.file}. Review the compatibility patch before upgrading.`,
        );
      const patched = resolve(patchedModule, patch.file);
      await chmod(patched, 0o644);
      await Bun.write(patched, patch.apply(source));
    }
    const modfile = resolve(scratch, 'go.mod');
    await Bun.write(
      modfile,
      (await Bun.file(resolve(cwd, 'go.mod')).text()) +
        `\nreplace fiatjaf.com/nostr => ${JSON.stringify(patchedModule)}\n`,
    );
    await Bun.write(resolve(scratch, 'go.sum'), await Bun.file(resolve(cwd, 'go.sum')).bytes());
    await runGo(go, [args[0], '-modfile', modfile, ...args.slice(1)], {
      operation: `relay ${args[0]}`,
      recovery:
        args[0] === 'test'
          ? 'Fix the reported Go test or compiler failure, then rerun bun run test:relay before deploying.'
          : 'Address the reported Go build error, then rerun bun run relay:build.',
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    await relayGo(process.argv.slice(2));
  } catch (error) {
    console.error(formatDiagnostic(diagnose(error, 'relay')));
    process.exitCode = 1;
  }
}
