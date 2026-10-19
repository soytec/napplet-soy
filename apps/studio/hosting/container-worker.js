// Runs inside the pinned toolchain container; never imported by the controller.
import { mkdir, writeFile, readdir, lstat, readFile } from 'node:fs/promises';
import { write as writeDescriptor } from 'node:fs';
import { dirname, join } from 'node:path';
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
const { files, command } = await Bun.file('/input/input.json').json();
for (const [path, data] of Object.entries(files)) {
  await mkdir(dirname(join('/workspace', path)), { recursive: true });
  await writeFile(join('/workspace', path), Buffer.from(data, 'base64'), { flag: 'wx' });
}
const child = Bun.spawn(command, {
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
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
const code = await child.exited;
// Export recoverable edits even when verification or inference fails. The
// controller reports the exit status after validating and saving these files.
// The controller validates paths and bytes again. Do not follow symlinks or
// export sockets/devices, private run state, dependencies, or Git internals.
const result = Object.create(null);
let size = 0,
  count = 0;
let selected;
if (await Bun.file('/workspace/.git/HEAD').exists()) {
  const listing = Bun.spawn(
    [
      'git',
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
    { cwd: '/workspace', stdout: 'pipe', stderr: 'pipe' },
  );
  const text = await new Response(listing.stdout).text();
  if (await listing.exited) throw new Error('Could not select isolated source output.');
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
