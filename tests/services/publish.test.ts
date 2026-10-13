import { nip19 } from 'nostr-tools';
import { stack } from './publish-stack';
import { cliTestVault } from './cli-test-vault';
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, NativeVault, type Vault } from '../../packages/identity/src/accounts';
import {
  publishProject as publishCommitted,
  type PublishOptions,
} from '../../packages/publish/src';
import { Journal } from '../../packages/publish/src/journal';
import { checkPublication } from '../../apps/cli/src/publish-check';
import { diagnose } from '../../packages/diagnostics/src';
import {
  prepareSource,
  publishSource,
  sourceGit,
  sourceUrls,
} from '../../packages/grasp/src/client';
import { sha256, validateRelease } from '../../packages/protocol/src';
import { verifyEvent, type Filter, type NostrEvent } from 'nostr-tools';

// Existing transport tests checkpoint their edited fixture before publishing it.
async function publishProject(options: PublishOptions) {
  if (!options.resume && !options.dryRun) {
    await sourceGit(options.directory, ['init', '--initial-branch=main']);
    await Bun.write(join(options.directory, '.git/info/exclude'), '.napplet-space/\n');
    await sourceGit(options.directory, ['add', '--all', '--', '.']);
    if (await sourceGit(options.directory, ['status', '--porcelain']))
      await sourceGit(options.directory, ['commit', '-m', 'Fixture checkpoint']);
  }
  return publishCommitted(options);
}
// This independent reader uses the wire protocol directly, without our publishing or catalog adapters.
async function readRelay(url: string, filter: Filter): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url),
      events: NostrEvent[] = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Independent relay query timed out'));
    }, 8000);
    socket.onopen = () => socket.send(JSON.stringify(['REQ', 'independent', filter]));
    socket.onmessage = ({ data }) => {
      const [type, id, event] = JSON.parse(String(data));
      if (id !== 'independent') return;
      if (type === 'EVENT') {
        if (verifyEvent(event)) events.push(event);
      }
      if (type === 'EOSE') {
        clearTimeout(timer);
        socket.close();
        resolve(events);
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error('Independent relay query failed'));
    };
  });
}
test('publisher runs its sandbox check, survives interruption, retains Git release refs and exposes standard relay/Blossom bytes', async () => {
  const services = await stack();
  const values = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => values.get(id) ?? null,
    set: async (id, value) => {
      values.set(id, value);
    },
    delete: async (id) => {
      values.delete(id);
    },
  };
  try {
    const accounts = new Accounts('local', join(services.directory, 'accounts'), vault);
    const creator = await accounts.create();
    const create = Bun.spawn(
      [
        process.execPath,
        new URL('../../apps/cli/src/index.ts', import.meta.url).pathname,
        'new',
        'creation',
        '--template',
        'soft-orbit',
        '--identity',
        'later',
      ],
      { cwd: services.directory, stdout: 'pipe', stderr: 'pipe' },
    );
    const [created, output] = await Promise.all([
      create.exited,
      new Response(create.stderr).text(),
    ]);
    expect(created, output).toBe(0);
    const project = join(services.directory, 'creation');
    const options = {
      snapshot: true, // Exercise an explicitly paired publication and its interrupted retry.
      directory: project,
      network: 'local' as const,
      accounts,
      targets: services.targets,
      check: checkPublication,
    };
    let interrupted = false;
    await expect(
      publishProject({
        ...options,
        dependencies: {
          checkpoint: async (job) => {
            if (!interrupted && job.receipts.snapshot) {
              interrupted = true;
              throw new Error('Process interrupted after snapshot');
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    const journal = new Journal(project, 'local');
    const first = await journal.load((await journal.index()).active!);
    expect(first.check.browser).not.toBe('test');
    const resumed = await publishProject({ ...options, resume: true });
    expect(resumed).toMatchObject({
      status: 'announced_pending_index',
      snapshotId: first.snapshot!.id,
      currentId: first.current!.id,
    });
    const events = await readRelay(services.targets.relay, {
      kinds: [35129, 5129],
      authors: [creator.pubkey],
    });
    expect(events).toHaveLength(2);
    const descriptors = await readRelay(services.targets.relay, {
      kinds: [32267],
      authors: [creator.pubkey],
    });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].id).toBe(first.preview!.descriptor!.id);
    const previewBytes = await (
      await fetch(`${services.targets.blossom}/${first.preview!.hash}`)
    ).bytes();
    expect(await sha256(previewBytes)).toBe(first.preview!.hash);
    expect(descriptors[0].tags).toContainEqual([
      'image',
      `${services.targets.blossom}/${first.preview!.hash}`,
    ]);
    const release = await validateRelease(
      events.find((e) => e.kind === 35129),
      events.find((e) => e.kind === 5129),
    );
    const bytes = await (
      await fetch(`${services.targets.blossom}/${release.artifactHash}`)
    ).bytes();
    expect(await sha256(bytes)).toBe(release.artifactHash);
    const archive = await (await fetch(`${services.targets.blossom}/${first.archiveHash}`)).bytes();
    expect(await sha256(archive)).toBe(first.archiveHash);
    await Bun.write(join(services.directory, 'independent.tar'), archive);
    const unpack = join(services.directory, 'unpacked');
    await mkdir(unpack);
    const tar = Bun.spawn(
      ['tar', '-xf', join(services.directory, 'independent.tar'), '-C', unpack],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await tar.exited).toBe(0);
    expect(await Bun.file(join(unpack, 'index.html')).bytes()).toEqual(bytes);
    const source = sourceUrls(services.targets.grasp, creator.pubkey, first.plan.identifier, true);
    await sourceGit(services.directory, ['clone', source.clone, 'independent-clone']);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `refs/tags/release-${first.id.slice(0, 16)}`,
      ]),
    ).toBe(first.commit);
    const config = await Bun.file(join(project, 'napplet.json')).json();
    await Bun.write(
      join(project, 'napplet.json'),
      JSON.stringify({ ...config, title: 'Second release' }),
    );
    await publishProject(options);
    const second = await journal.load((await journal.index()).latest!);
    await sourceGit(join(services.directory, 'independent-clone'), ['fetch', '--tags', 'origin']);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), ['rev-parse', 'origin/main']),
    ).toBe(second.commit);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `${second.commit}^`,
      ]),
    ).toBe(first.commit);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `refs/tags/release-${first.id.slice(0, 16)}`,
      ]),
    ).toBe(first.commit);
    expect(
      await readRelay(services.targets.relay, { kinds: [5129], authors: [creator.pubkey] }),
    ).toHaveLength(2);
    expect(await publishProject(options)).toMatchObject({
      unchanged: true,
      currentId: second.current!.id,
    });
  } finally {
    await services.close();
  }
}, 120000);

test.skipIf(process.env.SPACE_TEST_NATIVE_KEYSTORE !== '1')(
  'actual CLI creates a temporary native identity, publishes to local services, and repeats without a new release',
  async () => {
    const services = await stack();
    const accountHome = join(services.directory, 'account-home');
    const accounts = new Accounts(
      'local',
      join(accountHome, 'accounts/local'),
      cliTestVault('space.napplet.creator.local'),
    );
    const cli = process.env.SPACE_TEST_CLI
      ? [process.env.SPACE_TEST_CLI]
      : [process.execPath, new URL('../../apps/cli/src/index.ts', import.meta.url).pathname];
    const run = async (args: string[]) => {
      const child = Bun.spawn([...cli, ...args, '--network', 'local', '--json'], {
        cwd: services.directory,
        env: {
          PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
          SPACE_ACCOUNT_HOME: accountHome,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe('');
        expect(code, stdout).toBe(0);
        return JSON.parse(stdout);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await run(['account', 'create']);
      const created = await run(['new', 'cli-creation', '--template', 'soft-orbit']);
      const flags = [
        '--project',
        created.directory,
        '--relay',
        services.targets.relay,
        '--blossom',
        services.targets.blossom,
        '--grasp',
        services.targets.grasp,
        '--site',
        services.targets.site,
      ];
      expect((await run(['publish', ...flags, '--dry-run'])).status).toBe('dry_run');
      await run(['checkpoint', 'Initial creation', '--project', created.directory]);
      const first = await run(['publish', ...flags]);
      expect(first.status).toBe('announced_pending_index');
      expect((await run(['publish', ...flags])).currentId).toBe(first.currentId);
      expect((await run(['status', '--project', created.directory])).currentId).toBe(
        first.currentId,
      );
      expect(
        await readRelay(services.targets.relay, {
          kinds: [5129],
          authors: [created.account.pubkey],
        }),
      ).toHaveLength(1);
      // Kill a real process after Git publication, then resume with the shipped CLI.
      const config = await Bun.file(join(created.directory, 'napplet.json')).json();
      await Bun.write(
        join(created.directory, 'napplet.json'),
        JSON.stringify({ ...config, title: 'After process termination' }),
      );
      await run(['checkpoint', 'Update title', '--project', created.directory]);
      const worker = join(services.directory, 'crash-worker.ts');
      await Bun.write(
        worker,
        [
          `import { publishProject } from ${JSON.stringify(new URL('../../packages/publish/src/index.ts', import.meta.url).pathname)};`,
          `import { checkPublication } from ${JSON.stringify(new URL('../../apps/cli/src/publish-check.ts', import.meta.url).pathname)};`,
          `await publishProject({ directory: process.argv[2], network: 'local', targets: JSON.parse(process.argv[3]), check: checkPublication, dependencies: { checkpoint: async (job) => { if (job.receipts.source) { console.log('checkpoint'); await new Promise(() => {}); } } } });`,
        ].join('\n'),
      );
      const crashing = Bun.spawn(
        [
          process.env.SPACE_TEST_CLI || process.execPath,
          worker,
          created.directory,
          JSON.stringify(services.targets),
        ],
        {
          cwd: services.directory,
          env: {
            BUN_BE_BUN: process.env.SPACE_TEST_CLI ? '1' : undefined,
            PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
            SPACE_ACCOUNT_HOME: accountHome,
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const deadline = setTimeout(() => crashing.kill('SIGKILL'), 30000);
      const reader = crashing.stdout.getReader();
      try {
        const output = await reader.read();
        if (output.done) throw new Error(await new Response(crashing.stderr).text());
        expect(new TextDecoder().decode(output.value)).toContain('checkpoint');
        const competing = Bun.spawn(
          [
            ...cli,
            'publish',
            '--project',
            created.directory,
            '--network',
            'local',
            '--resume',
            '--json',
          ],
          {
            cwd: services.directory,
            env: {
              PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
              SPACE_ACCOUNT_HOME: accountHome,
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [competingCode, competingOutput] = await Promise.all([
          competing.exited,
          new Response(competing.stdout).text(),
        ]);
        expect(competingCode).toBe(1);
        expect(JSON.parse(competingOutput).error.code).toBe('PUBLISH_BUSY');
        crashing.kill('SIGKILL');
        await crashing.exited;
      } finally {
        clearTimeout(deadline);
        reader.releaseLock();
        if (crashing.exitCode === null) {
          crashing.kill('SIGKILL');
          await crashing.exited;
        }
      }
      const pending = await run(['status', '--project', created.directory]);
      expect(pending.status).toBe('prepared');
      const resumed = await run(['publish', '--project', created.directory, '--resume']);
      expect(resumed).toMatchObject({
        status: 'announced_pending_index',
        jobId: pending.jobId,
        currentId: pending.currentId,
        snapshotId: pending.snapshotId,
      });
    } finally {
      for (const account of await accounts.list()) {
        await accounts.vault.delete(account.id);
        expect(await accounts.vault.get(account.id)).toBeNull();
      }
      await services.close();
    }
  },
  120000,
);

test('collaboration: two creators publish, propose, review the exact Git tip, merge and release separately', async () => {
  const services = await stack();
  const { checkpoint } = await import('../../packages/publish/src/git-source');
  const { writeBinding, readBinding } = await import('../../packages/publish/src/binding');
  const { loadRemix, createRemix } = await import('../../packages/remix/src');
  const { propose, proposalAction, pushSource } =
    await import('../../packages/collaboration/src/service');
  const { readRepository, readProposals, validatePreview, tag } =
    await import('../../packages/collaboration/src/protocol');
  const { ProtocolClient } = await import('../../packages/client/src/nostr');
  const { nip19 } = await import('nostr-tools');
  const client = new ProtocolClient(() => [
    services.targets.relay,
    services.targets.grasp.replace('http:', 'ws:') + '/',
  ]);
  const store = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => store.get(id) ?? null,
    set: async (id, value) => {
      store.set(id, value);
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
  try {
    const owner = new Accounts('local', join(services.directory, 'owner'), vault),
      contributor = new Accounts('local', join(services.directory, 'contributor'), vault);
    const alice = await owner.create(),
      bob = await contributor.create();
    expect(alice.pubkey).not.toBe(bob.pubkey);
    const original = join(services.directory, 'original');
    await mkdir(original);
    await Bun.write(
      join(original, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Together',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'together',
        license: 'MIT',
      }),
    );
    await Bun.write(join(original, 'index.html'), '<p>One idea</p>');
    await Bun.write(join(original, 'LICENSE'), 'MIT');
    await Bun.write(join(original, '.gitignore'), '.napplet-space/\n');
    await checkpoint(original, 'First real source commit', alice.pubkey);
    await writeBinding(original, {
      version: 1,
      project: {
        creator: { pubkey: alice.pubkey, network: 'local' },
        publish: { networks: { local: services.targets } },
      },
    });
    const check = async () => ({ profile: 'integration', browser: 'fixture' });
    const first = await publishProject({
      directory: original,
      network: 'local',
      accounts: owner,
      check,
    });
    const sourceTip = await sourceGit(original, ['rev-parse', 'HEAD']);
    expect(first.status).toBe('announced_pending_index');
    const latestOwner = await new Journal(original, 'local').index(),
      originalJob = await new Journal(original, 'local').load(latestOwner.latest!);
    expect(originalJob.commit).toBe(sourceTip);
    const link = nip19.neventEncode({
      id: originalJob.current!.id,
      relays: [services.targets.relay],
    });
    const loaded = await loadRemix(link, 'local', AbortSignal.timeout(15000));
    const remix = await createRemix(services.directory, 'change', loaded);
    expect(remix.source).toBe('git');
    expect(await sourceGit(remix.directory, ['rev-parse', 'HEAD'])).toBe(sourceTip);
    expect(await sourceGit(remix.directory, ['status', '--porcelain'])).toBe('');
    expect(await Bun.file(join(remix.directory, 'napplet.json')).text()).toBe(
      await Bun.file(join(original, 'napplet.json')).text(),
    );
    const binding = (await readBinding(remix.directory))!;
    binding.project.creator = { pubkey: bob.pubkey, network: 'local' };
    binding.project.publish = { networks: { local: services.targets } };
    await writeBinding(remix.directory, binding);
    await Bun.write(join(remix.directory, 'index.html'), '<p>Two ideas</p>');
    await checkpoint(remix.directory, 'A second idea', bob.pubkey);
    const own = await publishProject({
      directory: remix.directory,
      network: 'local',
      accounts: contributor,
      check,
    });
    expect(own.status).toBe('announced_pending_index');
    const options = {
      directory: remix.directory,
      network: 'local' as const,
      accounts: {
        current: () => contributor.current(),
        signer: async (input: Parameters<Accounts['signer']>[0]) => {
          expect(input?.kinds).not.toContain(30617);
          expect(input?.kinds).not.toContain(30618);
          return contributor.signer(input);
        },
      },
      check,
      description: 'Try a second idea',
    };
    const proposed = await propose(options);
    const repo = await readRepository(client, binding.upstream!.address);
    const found = (await readProposals(client, repo))[0];
    expect(found.root.id).toBe(proposed.proposal);
    expect(found.head).toBe(await sourceGit(remix.directory, ['rev-parse', 'HEAD']));
    const descriptor = await fetch(tag(found.revision, 'soy-preview')!).then((r) => r.bytes());
    const preview = await validatePreview(descriptor, found.revision);
    expect(preview.commit).toBe(found.head!);
    expect(preview.manifest.content.trim()).not.toBe('');
    expect(preview.manifest.tags.filter((t) => t[0] === 'x')).toEqual([
      ['x', preview.artifactHash],
    ]);
    expect(
      preview.manifest.tags.some((t) => ['path', 'requires', 'description', 'd'].includes(t[0])),
    ).toBe(false);
    // An upstream clone retains its default branch; fetch the PR's exact c commit.
    const observer = join(services.directory, 'observer');
    await sourceGit(services.directory, ['clone', found.clones[0], observer]);
    expect(await sourceGit(observer, ['rev-parse', 'HEAD'])).toBe(sourceTip);
    await sourceGit(observer, ['fetch', found.clones[0], found.head!]);
    expect(await sourceGit(observer, ['rev-parse', 'FETCH_HEAD'])).toBe(found.head!);
    expect(await sourceGit(observer, ['log', '-1', '--format=%an', found.head!])).toBe(bob.pubkey);
    expect((await propose({ ...options, resume: true })).proposal).toBe(proposed.proposal);
    await Bun.write(join(remix.directory, 'README.md'), '# Both ideas\n');
    await checkpoint(remix.directory, 'Explain the idea', bob.pubkey);
    const updated = await propose({ ...options, description: 'Document it too' });
    expect(updated.proposal).toBe(proposed.proposal);
    expect(updated.revision).not.toBe(proposed.revision);
    await expect(
      proposalAction({
        directory: original,
        network: 'local',
        accounts: owner,
        proposal: proposed.proposal,
        action: 'merge',
        revision: proposed.revision,
        target: sourceTip,
      }),
    ).rejects.toThrow('Pin');
    const merged = await proposalAction({
      directory: original,
      network: 'local',
      accounts: owner,
      proposal: proposed.proposal,
      action: 'merge',
      revision: updated.revision,
      target: sourceTip,
    });
    expect(merged).toMatchObject({ state: 'merged_locally', released: false, pushed: false });
    expect(await sourceGit(original, ['log', '-1', '--format=%an'])).toBe(alice.pubkey);
    expect((await readProposals(client, repo))[0].status).toBe('open');
    await pushSource({ directory: original, network: 'local', accounts: owner });
    expect((await readProposals(client, repo))[0].status).toBe('merged');
    const released = await publishProject({
      directory: original,
      network: 'local',
      accounts: owner,
      check,
    });
    expect(released.status).toBe('announced_pending_index');
    expect(await sourceGit(original, ['merge-base', '--is-ancestor', updated.head, 'HEAD'])).toBe(
      '',
    );

    // Propose before a personal napplet exists; interrupt after Git and retry identical bytes.
    const authorIndex = await new Journal(original, 'local').index();
    const authorJob = await new Journal(original, 'local').load(authorIndex.latest!);
    const second = await createRemix(
      services.directory,
      'proposal-first',
      await loadRemix(
        nip19.neventEncode({ id: authorJob.current!.id, relays: [services.targets.relay] }),
        'local',
        AbortSignal.timeout(15000),
      ),
    );
    const secondBinding = (await readBinding(second.directory))!;
    secondBinding.project.creator = { pubkey: bob.pubkey, network: 'local' };
    secondBinding.project.publish = { networks: { local: services.targets } };
    await writeBinding(second.directory, secondBinding);
    await Bun.write(join(second.directory, 'index.html'), '<p>A third idea</p>');
    await checkpoint(second.directory, 'Third idea', bob.pubkey);
    const secondOptions = { ...options, directory: second.directory, description: 'Third idea' };
    let checks = 0;
    await expect(
      propose({
        ...secondOptions,
        check: async () => {
          checks++;
          return check();
        },
        checkpoint: async (phase) => {
          if (phase === 'source') throw new Error('Simulated interruption after Git push');
        },
      }),
    ).rejects.toMatchObject({ cause: { message: 'Simulated interruption after Git push' } });
    const recovered = await propose({
      ...secondOptions,
      resume: true,
      check: async () => {
        checks++;
        return check();
      },
    });
    expect(checks).toBe(1);
    expect(recovered.proposal).not.toBe(proposed.proposal);
    expect((await new Journal(second.directory, 'local').index()).latest).toBeNull();
    expect(
      await readRelay(services.targets.grasp.replace('http:', 'ws:') + '/', {
        ids: [recovered.proposal],
      }),
    ).toHaveLength(1);
    await proposalAction({
      directory: original,
      network: 'local',
      accounts: owner,
      proposal: recovered.proposal,
      action: 'comment',
      text: 'Please tune the controls',
    });
    await proposalAction({
      directory: original,
      network: 'local',
      accounts: owner,
      proposal: recovered.proposal,
      action: 'close',
      text: 'Later',
    });
    expect(
      (await readProposals(client, repo)).find((p) => p.root.id === recovered.proposal)?.status,
    ).toBe('closed');
    await Bun.write(join(second.directory, 'README.md'), 'A third proposal update');
    await checkpoint(second.directory, 'Document third idea', bob.pubkey);
    await expect(propose(secondOptions)).rejects.toThrow('Reopen');
    await proposalAction({
      directory: original,
      network: 'local',
      accounts: owner,
      proposal: recovered.proposal,
      action: 'reopen',
    });
    expect(
      (await readProposals(client, repo)).find((p) => p.root.id === recovered.proposal)?.status,
    ).toBe('open');

    // Browser acceptance uses the same one-command review entry point.
    const { review } = await import('../../apps/cli/src/review');
    const { browserEngine } = await import('../../apps/cli/src/browser');
    const browser = await (await browserEngine()).chromium.launch({ headless: true });
    const lifetime = new AbortController();
    try {
      await review({
        directory: original,
        network: 'local',
        accounts: owner,
        reference: recovered.proposal,
        noOpen: true,
        signal: lifetime.signal,
        ready: async ({ url }) => {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
          await page.goto(url);
          await page.getByRole('heading', { name: 'Third idea', exact: true }).waitFor();
          await page.locator('[data-tab="diff"]').click();
          await page.waitForFunction(() =>
            document.querySelector('#content')?.textContent?.includes('A third idea'),
          );
          await page.locator('[data-tab="proposed"]').click();
          await page.waitForFunction(() =>
            document.querySelector('#content iframe')?.getAttribute('src'),
          );
          await page.frameLocator('#content iframe').locator('iframe').waitFor();
          expect(
            await page.frameLocator('#content iframe').locator('iframe').getAttribute('sandbox'),
          ).toBe('allow-scripts');
          await page.screenshot({
            path: join(import.meta.dir, '../../.local/collaboration-review.png'),
            fullPage: true,
          });
          const status = await page.evaluate(
            async () =>
              (
                await fetch('/action', {
                  method: 'POST',
                  headers: { 'x-review-token': 'wrong' },
                  body: '{}',
                })
              ).status,
          );
          expect(status).toBe(403);
          await page.setViewportSize({ width: 390, height: 844 });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          lifetime.abort();
        },
      });
    } finally {
      lifetime.abort();
      await browser.close();
    }

    // Explicit source rebuild also works for single-file projects, without package scripts.
    const rebuiltLifetime = new AbortController();
    await review({
      directory: original,
      network: 'local',
      accounts: owner,
      reference: recovered.proposal,
      rebuild: true,
      noOpen: true,
      signal: rebuiltLifetime.signal,
      ready: async ({ url }) => {
        const u = new URL(url),
          token = u.hash.slice(1);
        const response = await fetch(`${u.origin}/play`, {
          method: 'POST',
          headers: { 'x-review-token': token },
          body: JSON.stringify({ id: recovered.proposal, revision: recovered.revision }),
        });
        expect(response.status).toBe(200);
        expect((await fetch((await response.json()).url)).status).toBe(200);
        rebuiltLifetime.abort();
      },
    });

    let reviewedRevision = recovered.revision;
    // The production web bundle reads the same proposal and Blossom attachment directly.
    const { initializePolicy } = await import('../../packages/moderation/src/policy');
    const policy = join(services.directory, 'web-policy.json');
    initializePolicy(policy);
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const webPort = probe.port;
    probe.stop(true);
    const origin = `http://127.0.0.1:${webPort}`;
    const web = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      cwd: join(import.meta.dir, '../..'),
      env: {
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: String(webPort),
        SPACE_SITE_ORIGIN: origin,
        SPACE_INDEX_RELAYS: [
          services.targets.relay,
          services.targets.grasp.replace('http:', 'ws:') + '/',
        ].join(','),
        SPACE_INDEX_DIR: join(services.directory, 'web-index'),
        SPACE_INDEX_LOCAL_BLOSSOM: services.targets.blossom,
        SPACE_PUBLICDEV: '0',
        SPACE_MODERATION_FILE: policy,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const webOut = new Response(web.stdout).text(),
      webErr = new Response(web.stderr).text();
    const webBrowser = await (await browserEngine()).chromium.launch({ headless: true });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(origin)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await Bun.sleep(100);
      }
      if (!ready) throw new Error('Web proposal test server did not start');
      const page = await webBrowser.newPage({ viewport: { width: 1365, height: 1000 } }),
        errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}/proposals/${recovered.proposal}`);
      await page.getByRole('button', { name: 'Play proposed', exact: true }).waitFor();
      const beforeUpdate = await page.locator('.proposal-toolbar select').inputValue();
      const newer = await propose(secondOptions);
      expect(newer.revision).not.toBe(beforeUpdate);
      reviewedRevision = newer.revision;
      await page.getByRole('button', { name: 'Refresh proposals' }).click();
      await page.getByText('A newer revision is available.', { exact: false }).waitFor();
      expect(await page.locator('.proposal-toolbar select').inputValue()).toBe(beforeUpdate);
      await page.getByRole('button', { name: 'Play proposed', exact: true }).click();
      await page.locator('.proposal-review iframe').waitFor();
      expect(await page.locator('.proposal-review iframe').getAttribute('sandbox')).toBe(
        'allow-scripts',
      );
      await page
        .frameLocator('.proposal-review iframe')
        .getByText('A third idea', { exact: true })
        .waitFor();
      expect(errors).toEqual([]);
      await page.screenshot({
        path: join(import.meta.dir, '../../.local/collaboration-web.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await webBrowser.close();
      web.kill('SIGTERM');
      await web.exited;
      await Promise.all([webOut, webErr]);
    }
    // The same proposal-first checkout can later release its independent napplet.
    const independent = await publishProject({
      directory: second.directory,
      network: 'local',
      accounts: contributor,
      check,
    });
    expect(independent.status).toBe('announced_pending_index');
    const reviewedTarget = await sourceGit(original, ['rev-parse', 'HEAD']);
    await Bun.write(join(original, 'index.html'), '<p>A different third idea</p>');
    await expect(
      proposalAction({
        directory: original,
        network: 'local',
        accounts: owner,
        proposal: recovered.proposal,
        action: 'merge',
        revision: reviewedRevision,
        target: reviewedTarget,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_DIRTY' });
    const checkpointResult = await checkpoint(original, 'A conflicting owner change', alice.pubkey);
    await expect(
      proposalAction({
        directory: original,
        network: 'local',
        accounts: owner,
        proposal: recovered.proposal,
        action: 'merge',
        revision: reviewedRevision,
        target: checkpointResult.commit,
      }),
    ).rejects.toThrow('Merge conflicts');
    expect(await sourceGit(original, ['rev-parse', 'HEAD'])).toBe(checkpointResult.commit);
    expect(await sourceGit(original, ['status', '--porcelain'])).toBe('');
  } finally {
    client.close();
    await services.close();
  }
}, 120000);

test('a project with its own NIP-34 remote releases against it; soyLI signs and pushes no second repository', async () => {
  const services = await stack();
  const values = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => values.get(id) ?? null,
    set: async (id, value) => {
      values.set(id, value);
    },
    delete: async (id) => {
      values.delete(id);
    },
  };
  try {
    const accountHome = join(services.directory, 'account-home');
    const accounts = new Accounts('local', join(accountHome, 'accounts/local'), vault);
    const creator = await accounts.create();
    const cli = new URL('../../apps/cli/src/index.ts', import.meta.url).pathname;
    const create = Bun.spawn(
      [process.execPath, cli, 'new', 'own-repo', '--template', 'soft-orbit', '--identity', 'later'],
      { cwd: services.directory, stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await create.exited).toBe(0);
    const project = join(services.directory, 'own-repo');
    await sourceGit(project, ['init', '--initial-branch=main']);
    await Bun.write(join(project, '.git/info/exclude'), '.napplet-space/\n');
    await sourceGit(project, ['add', '--all', '--', '.']);
    if (await sourceGit(project, ['status', '--porcelain']))
      await sourceGit(project, ['commit', '-m', 'Initial creation']);

    // The creator's existing repository, announced and pushed as ngit would.
    const urls = sourceUrls(services.targets.grasp, creator.pubkey, 'my-project', true);
    let signer = await accounts.signer();
    const own = await prepareSource({
      directory: project,
      identifier: 'my-project',
      title: 'My project',
      origin: services.targets.grasp,
      local: true,
      signer,
    });
    await signer.close();
    await publishSource({
      directory: project,
      origin: services.targets.grasp,
      local: true,
      publication: own,
    });
    await sourceGit(project, [
      'remote',
      'add',
      'origin',
      `nostr://${nip19.npubEncode(creator.pubkey)}/my-project`,
    ]);
    const options = {
      directory: project,
      network: 'local' as const,
      accounts,
      targets: { ...services.targets, mirrors: [...services.targets.mirrors, urls.relay] },
      check: checkPublication,
    };
    const result = await publishCommitted(options);
    expect(result).toMatchObject({
      status: 'announced_pending_index',
      sourceRepository: { address: `30617:${creator.pubkey}:my-project`, hosted: false },
    });
    const [current] = await readRelay(services.targets.relay, {
      kinds: [35129],
      authors: [creator.pubkey],
    });
    expect(current.tags).toContainEqual(['source', urls.portable]);
    const repositories = await readRelay(urls.relay, {
      kinds: [30617, 30618],
      authors: [creator.pubkey],
    });
    // Exactly the creator's own announcement and state, unchanged.
    expect(repositories.map((e) => e.id).sort()).toEqual(
      [own.announcement.id, own.state.id].sort(),
    );

    // A new commit that has not been pushed is refused before anything is signed.
    await Bun.write(join(project, 'index.html'), '<!doctype html><title>Two</title><p>Two</p>');
    await sourceGit(project, ['commit', '-am', 'Unpushed change']);
    const failure = await publishCommitted(options).catch((e) => e);
    const diagnostic = diagnose(failure);
    expect(diagnostic.code, JSON.stringify(diagnostic)).toBe('SOURCE_NOT_PUSHED');
    expect(diagnostic.recovery).toContain(await sourceGit(project, ['rev-parse', 'HEAD']));
    expect(
      await readRelay(services.targets.relay, { kinds: [35129, 5129], authors: [creator.pubkey] }),
    ).toHaveLength(1);

    // The real entrypoint reports an unreadable nostr:// remote with its cause, without secrets.
    await sourceGit(project, ['remote', 'add', 'broken', 'nostr://unreachable.invalid/project']);
    const child = Bun.spawn(
      [process.execPath, cli, 'publish', '--project', project, '--network', 'local', '--dry-run'],
      {
        cwd: services.directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: accountHome },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = stdout + stderr;
    expect(code).not.toBe(0);
    expect(output).toContain('REPOSITORY_REMOTE');
    expect(output).toContain('Git remote broken could not be read');
    expect(output).toContain('unreachable.invalid');
    expect(output).toContain('publish.repository');
    expect(output).not.toContain(accountHome);
    expect(output).not.toContain(creator.pubkey);
  } finally {
    await services.close();
  }
}, 120000);
