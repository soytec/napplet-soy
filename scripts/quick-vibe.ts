import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { diagnose, DiagnosticError, formatDiagnostic } from '../packages/diagnostics/src';
import { StudioWorker } from '../apps/studio/worker-client';
import { localOwner } from '../apps/studio/store';
import { serveStudio } from '../apps/studio/server';
import { studioSoyli } from '../apps/studio/toolchain';

const root = resolve(import.meta.dir, '..');
const launcherPid = process.ppid;
const directory = resolve(process.env.QUICK_VIBE_HOME ?? join(root, '.local/studio'));
await mkdir(directory, { recursive: true, mode: 0o700 });
let worker: StudioWorker | undefined;
let server: Awaited<ReturnType<typeof serveStudio>> | undefined;
const runtime = join(directory, 'runtime.json');
try {
  // Only the old implementation used this PID file. Never run it alongside SQLite migration.
  if (await Bun.file(join(directory, 'studio.lock')).exists())
    throw new DiagnosticError('STUDIO_LOCK', 'An older studio lock is still present.', {
      recovery:
        'Stop the older studio before upgrading. If it crashed, verify its recorded process is gone before removing studio.lock.',
    });
  const executable =
    process.env.QUICK_VIBE_OPENCODE ??
    join(root, '.local/quick-vibe/tools/node_modules/.bin/opencode');
  if (!(await Bun.file(executable).exists()))
    throw new DiagnosticError(
      'STUDIO_AGENT_MISSING',
      'OpenCode is not installed at the configured path.',
      {
        recovery: 'Install opencode-ai@1.19.3 and set QUICK_VIBE_OPENCODE. See docs/QUICK-VIBE.md.',
      },
    );
  const soyli = studioSoyli(root, process.env.QUICK_VIBE_SOYLI);
  const key = process.env.DEEPSEEK_KEY ?? '';
  const model = process.env.QUICK_VIBE_MODEL ?? 'deepseek/deepseek-flash';
  worker = new StudioWorker({
    directory,
    owner: localOwner(),
    soyli,
    agent: {
      directory: join(directory, 'agent'),
      executable,
      model,
      key,
    },
  });
  const studio = await worker.start();
  server = await serveStudio(
    studio,
    Number(process.env.QUICK_VIBE_PORT ?? 4195),
    process.env.QUICK_VIBE_SHELL_ORIGIN ?? 'http://127.0.0.1:3000',
  );
  await writeFile(
    runtime,
    JSON.stringify({
      pid: process.pid,
      workerPid: worker.pid,
      owner: localOwner(),
      url: server.url.href,
    }),
    { mode: 0o600 },
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server!.stop(true);
    try {
      await worker!.close();
    } finally {
      const saved = JSON.parse(await readFile(runtime, 'utf8').catch(() => '{}'));
      if (saved.pid === process.pid) await rm(runtime, { force: true });
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  process.once('SIGHUP', () => void close());
  if (launcherPid > 1) {
    const timer = setInterval(() => {
      let gone = process.ppid !== launcherPid;
      try {
        process.kill(launcherPid, 0);
      } catch (e) {
        gone ||= (e as NodeJS.ErrnoException).code === 'ESRCH';
      }
      if (gone) void close();
    }, 500);
    timer.unref();
  }
  console.log(
    `Studio: ${process.env.QUICK_VIBE_SHELL_ORIGIN ?? 'http://127.0.0.1:3000'}/studio\nLocal execution service: ${server.url}\nLocal workspace: ${directory}\nModel: ${model}\nSupervised local worker: ${worker.pid}. Trusted projects only; this is not OS isolation. Ctrl+C stops owned processes.`,
  );
} catch (error) {
  await server?.stop(true);
  await worker?.close().catch(() => {});
  console.error(formatDiagnostic(diagnose(error, 'start Quick Vibe')));
  process.exitCode = 1;
}
