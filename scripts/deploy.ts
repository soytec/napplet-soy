import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeTarget } from '../packages/moderation/src/policy';

export function validateWebPort(input = '3000') {
  if (
    !/^\d{4,5}$/.test(input) ||
    Number(input) < 1024 ||
    Number(input) > 65534 ||
    [3477, 3478, 19346, 19347, 19348, 19349, 19350, 19351, 19352].includes(Number(input))
  )
    throw new Error('--web-port must leave two free unprivileged ports outside the service ports.');
  return Number(input);
}

export function validateTarget(host: string | undefined, domain: string | undefined) {
  if (!host || !/^(?:[a-z_][a-z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host))
    throw new Error('--host must be an SSH host or user@host (SSH config aliases work).');
  if (
    !domain ||
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  )
    throw new Error('--domain must be a DNS hostname, without a scheme or path.');
  return { host, domain };
}
export function validateBlossomDomain(domain: string, input = `blossom.${domain}`) {
  validateTarget('validation', input);
  if (input === domain)
    throw new Error('--blossom-domain must be separate from the website hostname.');
  return input;
}
export function validateGitDomain(domain: string, blossom: string, input = `git.${domain}`) {
  validateTarget('validation', input);
  if (input === domain || input === blossom)
    throw new Error('--git-domain must be separate from the website and Blossom hostnames.');
  return input;
}
export function validateRelayDomain(
  domain: string,
  blossom: string,
  git: string,
  input = `relay.${domain}`,
) {
  validateTarget('validation', input);
  if ([domain, `www.${domain}`, blossom, git].includes(input))
    throw new Error('--relay-domain must be separate from the other service hostnames.');
  return input;
}
async function run(args: string[], stdin?: string) {
  const child = Bun.spawn(args, {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: stdin === undefined ? 'inherit' : new Blob([stdin]),
  });
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${args[0]}`);
}

// Keep the upload and archive regression check on the same packaging path.
export async function createDeploymentArchive(archive: string) {
  await run([
    'tar',
    '--no-xattrs',
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=.output',
    '--exclude=.tanstack',
    '--exclude=.env',
    '--exclude=.env.*',
    '--exclude=.local',
    '-czf',
    archive,
    'package.json',
    'LICENSE',
    'bun.lock',
    'tsconfig.json',
    'docs/BACKEND-CREATOR.md',
    'docs/DYNAMIC-BACKENDS.md',
    'docs/DYNAMIC-BACKENDS-CREATOR.md',
    'docs/SHARED-DATA.md',
    'docs/OUTBOX.md',
    'docs/RUNTIME-ACTIONS.md',
    'docs/CONTROLLERS.md',
    'docs/MOBILE.md',
    'docs/WASM.md',
    'docs/VISUAL-DESIGN.md',
    'docs/NIP5D-CREATOR.md',
    'apps',
    'packages',
    'scripts',
    'infra',
    'services',
    'tests/services',
    'tests/fixtures',
  ]);
}
if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: 'string' },
      domain: { type: 'string' },
      'blossom-domain': { type: 'string' },
      'git-domain': { type: 'string' },
      'relay-domain': { type: 'string' },
      'shared-caddy': { type: 'boolean' },
      'web-port': { type: 'string' },
      'admin-pubkey': { type: 'string' },
      'legacy-cpu': { type: 'boolean' },
      preflight: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: bun run deploy --host root@your-vps --domain napplet.example --admin-pubkey npub-or-hex [--shared-caddy] [--web-port 3040] [--legacy-cpu] [--preflight]\n\n--shared-caddy reuses the stock caddy.service and /etc/caddy/Caddyfile, preserving existing sites. Other proxies need explicit integration. The default web port is 3040 when sharing, 3000 otherwise; the next port is used for candidate checks.\n--legacy-cpu selects Bun 1.3.8 and source-built image libraries for older Linux x64 virtual CPUs. All runtime and application checks still run.\n--preflight reports capacity, listening ports and service details without changing anything.\nPoint the website, www, relay, blossom and git hostnames to this VPS. Root or passwordless sudo and systemd on Debian/Ubuntu are required.',
    );
    process.exit(0);
  }
  try {
    const { host, domain } = validateTarget(values.host, values.domain);
    const blossomDomain = validateBlossomDomain(domain, values['blossom-domain']);
    const gitDomain = validateGitDomain(domain, blossomDomain, values['git-domain']);
    const relayDomain = validateRelayDomain(
      domain,
      blossomDomain,
      gitDomain,
      values['relay-domain'],
    );
    const sshOptions = [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=yes',
    ];
    const cpuCheck = await Bun.file(new URL('./deploy-cpu-check.sh', import.meta.url)).text();
    const runtimeProfile = values['legacy-cpu'] ? 'legacy-x64' : 'standard';
    if (values.preflight) {
      await run(
        [
          'ssh',
          ...sshOptions,
          host,
          'if [ "$(id -u)" = 0 ]; then exec bash -s; else exec sudo -n bash -s; fi',
        ],
        `${cpuCheck}\nnapplet_runtime_profile=${runtimeProfile}\n${await Bun.file(new URL('./deploy-preflight.sh', import.meta.url)).text()}`,
      );
      process.exit(0);
    }
    const webPort = validateWebPort(
      values['web-port'] ?? (values['shared-caddy'] ? '3040' : '3000'),
    );
    const admin = normalizeTarget('pubkey', values['admin-pubkey'] ?? '');
    // Check unattended access and CPU capabilities before building or uploading.
    await run(
      [
        'ssh',
        ...sshOptions,
        host,
        'if [ "$(id -u)" = 0 ]; then exec bash -s; else exec sudo -n bash -s; fi',
      ],
      `${cpuCheck}\nnapplet_check_cpu "$(uname -s)" "$(uname -m)" /proc/cpuinfo ${runtimeProfile}\n`,
    );
    const release = `${new Date().toISOString().replace(/[-:TZ.]/g, '')}-${process.pid}`;
    const staging = await mkdtemp(join(tmpdir(), 'napplet-deploy-'));
    const archive = join(staging, `napplet-${release}.tar.gz`);
    try {
      await run(['bun', 'run', 'check']);
      await run(['bun', 'run', 'test:relay']);
      await run(['bun', 'run', 'test:blossom']);
      await run(['bun', 'run', 'test:grasp']);
      await createDeploymentArchive(archive);
      await run(['scp', ...sshOptions, archive, `${host}:/tmp/napplet-${release}.tar.gz`]);
      const script = await Bun.file(new URL('./deploy-remote.sh', import.meta.url)).text();
      // Arguments have an allowlisted alphabet; never interpolate arbitrary input into a remote shell.
      await run(
        [
          'ssh',
          ...sshOptions,
          host,
          `if [ "$(id -u)" = 0 ]; then exec bash -s -- ${release} ${domain} ${blossomDomain} ${gitDomain} ${values['shared-caddy'] ? 'shared' : 'dedicated'} ${webPort} ${admin} ${runtimeProfile} ${relayDomain}; else exec sudo -n bash -s -- ${release} ${domain} ${blossomDomain} ${gitDomain} ${values['shared-caddy'] ? 'shared' : 'dedicated'} ${webPort} ${admin} ${runtimeProfile} ${relayDomain}; fi`,
        ],
        `${cpuCheck}\n${script}`,
      );
      console.log(`\nRelease ${release} is running behind Caddy at https://${domain}`);
      console.log(`Blossom storage: https://${blossomDomain}`);
      console.log(`Nostr relay: wss://${relayDomain}`);
      console.log(`Git source hosting: https://${gitDomain}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
