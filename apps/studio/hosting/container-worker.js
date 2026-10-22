// Runs inside the pinned toolchain container; never imported by the controller.
import { mkdir, writeFile, readdir, lstat, readFile } from 'node:fs/promises';
import { write as writeDescriptor } from 'node:fs';
import { readlinkSync, readdirSync, readFileSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { constants } from 'node:os';
import { promisify } from 'node:util';
import { basename, dirname, join } from 'node:path';

// Only the disposable container's private PID namespace may be swept. Never do
// this when the worker is relocated for a local test or invoked on the host.
async function stopContainerChildren() {
  if (process.platform !== 'linux' || process.ppid !== 1) return;
  if (basename(readlinkSync('/proc/1/exe')) !== 'docker-init') return;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    let remaining = false;
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry) || Number(entry) === 1 || Number(entry) === process.pid) continue;
      try {
        const uid = /^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${entry}/status`, 'utf8'))?.[1];
        if (Number(uid) !== process.getuid()) continue;
        remaining = true;
        process.kill(Number(entry), 'SIGKILL');
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      }
    }
    if (!remaining) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Isolated child processes did not stop before source recovery.');
}
async function protocolLine(line) {
  const bytes = Buffer.from(line + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    const written = await new Promise((resolve, reject) => {
      writeDescriptor(1, bytes, offset, bytes.length - offset, null, (error, count) => {
        if (error?.code === 'EAGAIN' || error?.code === 'EINTR') resolve(0);
        else if (error) reject(error);
        else resolve(count);
      });
    });
    if (written === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    else offset += written;
  }
}
const { files, command } = JSON.parse(await readFile('/input/input.json', 'utf8'));
for (const [path, data] of Object.entries(files)) {
  await mkdir(dirname(join('/workspace', path)), { recursive: true });
  await writeFile(join('/workspace', path), Buffer.from(data, 'base64'), { flag: 'wx' });
}
const child = spawn(command[0], command.slice(1), {
  cwd: '/workspace',
  env: {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp/home',
    TMPDIR: '/tmp',
    GIT_TERMINAL_PROMPT: '0',
    SPACE_TOOLCHAIN_CACHE: '/opt/toolchains',
    PLAYWRIGHT_BROWSERS_PATH: '/opt/browsers',
    PLAYWRIGHT_SKIP_BROWSER_GC: '1',
  },
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const code = await new Promise((resolve) => {
  child.once('error', (error) => {
    // Do not print arbitrary arguments/environment from an OS exception.
    console.error('Could not start isolated command: ' + (error.code ?? 'UNKNOWN'));
    resolve(127);
  });
  child.once('exit', (status, signal) => resolve(status ?? 128 + (constants.signals[signal] ?? 1)));
});
// A failed browser/tool may leave descendants (including detached groups) alive.
// Stop them before source export needs threads or a new Git process. Docker init
// reaps orphaned children; Node keeps recovery independent of a child Bun crash.
if (child.pid) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
await stopContainerChildren();
// Export recoverable edits even when verification or inference fails. The
// controller reports the exit status after validating and saving these files.
// The controller validates paths and bytes again. Do not follow symlinks or
// export sockets/devices, private run state, dependencies, or Git internals.
const result = Object.create(null);
let size = 0,
  count = 0;
let selected;
if (
  await lstat('/workspace/.git/HEAD').then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  )
) {
  const { stdout: text } = await promisify(execFile)(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    { cwd: '/workspace', maxBuffer: 4 * 1024 * 1024, timeout: 10000 },
  );
  selected = new Set(text.split('\0').filter(Boolean));
}
async function walk(directory, prefix = '') {
  for (const name of await readdir(directory)) {
    if (
      ['node_modules', '.git', '.napplet-space', '.env'].includes(name) ||
      name.startsWith('.env.')
    )
      continue;
    const path = join(directory, name),
      relative = prefix + name,
      info = await lstat(path);
    if (
      selected &&
      !relative.startsWith('dist/') &&
      relative !== 'dist' &&
      ![...selected].some((p) => p === relative || p.startsWith(relative + '/'))
    )
      continue;
    if (info.isDirectory()) await walk(path, relative + '/');
    else {
      if (!info.isFile() || info.nlink !== 1)
        throw new Error('Job output must contain ordinary files.');
      if (++count > 2048 || (size += info.size) > 32 * 1024 * 1024)
        throw new Error('Job output exceeds its source budget.');
      result[relative] = (await readFile(path)).toString('base64');
    }
  }
}
await walk('/workspace');
// Chunking keeps each protocol line below the process output bound.
for (const [path, data] of Object.entries(result)) {
  for (let at = 0; at < data.length || at === 0; at += 256 * 1024)
    // Child tools can leave the inherited stdout descriptor non-blocking. In the
    // legacy Bun runtime console.log can then drop the tail of a large line.
    // Advance by bytes actually written and retry backpressure. Bun 1.3.8's
    // Bun.write(stdout) also misbehaves on this descriptor, so use fs.write.
    await protocolLine(
      'SOY_JOB_FILE:' +
        JSON.stringify({
          path,
          data: data.slice(at, at + 256 * 1024),
          final: at + 256 * 1024 >= data.length,
        }),
    );
}
await protocolLine('SOY_JOB_STATUS:' + code);
await protocolLine('SOY_JOB_DONE');
