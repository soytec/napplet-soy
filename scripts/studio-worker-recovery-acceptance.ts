/** Disposable offline Docker regression; no inference, credentials or live drafts. */
import { strict as assert } from 'node:assert';
import { ContainerJobs, containerLimits } from '../apps/studio/hosting/container';

const [image, profile = 'legacy-x64'] = process.argv.slice(2);
if (
  process.platform !== 'linux' ||
  !/^sha256:[a-f0-9]{64}$/.test(image ?? '') ||
  !['standard', 'legacy-x64'].includes(profile)
)
  throw new Error(
    'Usage on Linux: bun scripts/studio-worker-recovery-acceptance.ts sha256:<image> [profile]',
  );
const jobs = new ContainerJobs(image!, undefined, profile as 'standard' | 'legacy-x64');
const options = {
  operation: 'verify isolated worker recovery under thread pressure',
  signal: AbortSignal.timeout(120000),
  timeoutMs: 30000,
};
// Reproduced the reported Bun 1.3.8 crash (exit 132, bmalloc pthread_create
// failure at 0x5D9BC6F). Saturate the configured limit, including after it grows.
// The shell exits with children still alive, as failed browser checks can do.
const pressure = await jobs.run(
  {},
  [
    '/bin/sh',
    '-c',
    `
  git init -q
  printf 'ignored.txt\n' > .gitignore
  printf private > ignored.txt
  mkdir -p src
  dd if=/dev/zero of=src/recovered.bin bs=1048576 count=12 2>/dev/null
  i=0
  while [ "$i" -lt ${containerLimits.pids + 32} ]; do
    setsid sleep 60 &
    i=$((i+1))
  done
  exit 23
`,
  ],
  options,
);
assert(pressure.failure, 'Process exhaustion must not be reported as success');
assert.equal(Buffer.byteLength(pressure.files['src/recovered.bin']!, 'base64'), 12 * 1024 * 1024);
assert(!pressure.files['ignored.txt'], 'Recovery must still respect Git source selection');
assert(!pressure.output.includes('SOY_JOB_FILE:'), 'File frames must stay out of diagnostics');
console.log('ACCEPTANCE_THREAD_PRESSURE_RECOVERY_PASSED');

const crashed = await jobs.run(
  {},
  ['/bin/sh', '-c', 'printf saved > recovered.txt; kill -ILL $$'],
  options,
);
assert.equal(crashed.failure?.context.exitCode, 132, 'Preserve the child runtime signal');
assert.equal(Buffer.from(crashed.files['recovered.txt']!, 'base64').toString(), 'saved');
console.log('ACCEPTANCE_RUNTIME_CRASH_RECOVERY_PASSED');

const next = await jobs.run({}, ['/bin/sh', '-c', 'printf ready > next.txt'], options);
assert(!next.failure);
assert.equal(Buffer.from(next.files['next.txt']!, 'base64').toString(), 'ready');
console.log('ACCEPTANCE_RECOVERY_REUSE_PASSED');
