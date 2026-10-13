import { expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { nip19 } from 'nostr-tools';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { NostrConnectProvider } from 'applesauce-signers/signers/nostr-connect-provider';
import { RelayPool } from 'applesauce-relay';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { checkpoint } from '../../packages/publish/src/git-source';
import { writeBinding } from '../../packages/publish/src/binding';
import { publishProject } from '../../packages/publish/src';
import { propose, proposalAction, pushSource } from '../../packages/collaboration/src/service';
import { readProposals, readRepository } from '../../packages/collaboration/src/protocol';
import {
  prepareSource,
  publishSource,
  sourceGit,
  sourceUrls,
} from '../../packages/grasp/src/client';
import { freezeSource, inspectProject } from '../../packages/publish/src/project';
import { sha256 } from '../../packages/protocol/src';
import { ProtocolClient } from '../../packages/client/src/nostr';
import { redactDiagnostic } from '../../packages/diagnostics/src';
import { stack } from './publish-stack';
import pins from '../fixtures/interoperability/pins.json';

test('forkless proposals: real CLI remote signer and independent ngit create, update, checkout and accept', async () => {
  expect(
    Bun.which('ngit'),
    'Install ngit 2.6.1 for the independent PR acceptance check',
  ).not.toBeNull();
  const services = await stack();
  const pool = new RelayPool();
  const permissions: string[][] = [],
    kinds: number[] = [];
  const key = new PrivateKeySigner(),
    ownerKey = new PrivateKeySigner();
  const provider = new NostrConnectProvider({
    upstream: key,
    signer: new PrivateKeySigner(),
    relays: [services.targets.relay],
    pool,
    onConnect: (_client, requested) => {
      permissions.push(requested);
      return true;
    },
    onSignEvent: (draft) => {
      kinds.push(draft.kind);
      return ![30617, 30618].includes(draft.kind);
    },
  });
  const client = new ProtocolClient(() => [services.targets.grasp.replace('http:', 'ws:') + '/']);
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
  const accountHome = join(services.directory, 'cli-accounts');
  const contributor = new Accounts('local', join(accountHome, 'accounts/local'), vault);
  const owner = new Accounts('local', join(services.directory, 'owner-accounts'), vault);
  const check = async () => ({ profile: 'fixture', browser: 'fixture' });
  async function command(
    args: string[],
    cwd: string,
    global = '/dev/null',
    input?: string,
    expectedCode = 0,
  ) {
    const child = Bun.spawn(args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: global === '/dev/null' ? join(services.directory, 'isolated-home') : dirname(global),
        GIT_CONFIG_GLOBAL: global,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        XDG_CONFIG_HOME: join(services.directory, 'ngit-config'),
        XDG_CACHE_HOME: join(services.directory, 'ngit-cache'),
        NGIT_RELAY_DEFAULT_SET: services.targets.grasp.replace('http:', 'ws:') + '/',
        NGIT_RELAY_ANNOUNCEMENT_INDEXER_SET: services.targets.grasp.replace('http:', 'ws:') + '/',
        NGIT_RELAY_BLASTER_SET: services.targets.grasp.replace('http:', 'ws:') + '/',
        NGIT_RELAY_SIGNER_FALLBACK_SET: services.targets.relay,
        NGIT_GRASP_DEFAULT_SET: services.targets.grasp,
        SPACE_ACCOUNT_HOME: accountHome,
        // Use the runner's installed browser cache, not a fresh isolated download.
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME!, '.cache/ms-playwright'),
      },
      stdin: input === undefined ? 'ignore' : new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    try {
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== expectedCode)
        throw new Error(`${args[0]} failed (${code}): ${redactDiagnostic(out + err, 2500)}`);
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
  function listedIds(output: string) {
    const rows = JSON.parse(output.slice(output.indexOf('[\n'))) as { id: string }[];
    return rows.map((row) => {
      const decoded = nip19.decode(row.id);
      if (decoded.type !== 'nevent')
        throw new Error('ngit did not return proposal event pointers.');
      return decoded.data.id;
    });
  }
  try {
    expect((await command(['ngit', '--version'], services.directory)).trim()).toBe(
      `ngit ${pins.ngitProposals}`,
    );
    await provider.start();
    await contributor.connect(await provider.getBunkerURI(), { timeoutMs: 5000 });
    await owner.import(nip19.nsecEncode(ownerKey.key));
    const original = join(services.directory, 'original');
    await mkdir(original);
    await Bun.write(
      join(original, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Forkless',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'forkless',
        license: 'MIT',
      }),
    );
    await Bun.write(
      join(original, 'index.html'),
      '<!doctype html><html><body><p>Original</p></body></html>',
    );
    await Bun.write(join(original, 'LICENSE'), 'MIT');
    await Bun.write(join(original, '.gitignore'), '.napplet-space/\n');
    await checkpoint(original, 'Original', await ownerKey.getPublicKey());
    await writeBinding(original, {
      version: 1,
      project: {
        creator: { pubkey: await ownerKey.getPublicKey(), network: 'local' },
        publish: { networks: { local: services.targets } },
      },
    });
    await publishProject({ directory: original, network: 'local', accounts: owner, check });
    const repo = await readRepository(client, `30617:${await ownerKey.getPublicKey()}:forkless`);
    const base = await sourceGit(original, ['rev-parse', 'HEAD']);
    const before = await sourceGit(original, ['ls-remote', '--heads', '--tags', repo.clones[0]]);
    const branch = join(services.directory, 'contributor');
    await sourceGit(services.directory, ['clone', repo.clones[0], branch]);
    await sourceGit(branch, ['checkout', '-b', 'pr/forkless']);
    await writeBinding(branch, {
      version: 1,
      project: {
        creator: { pubkey: await key.getPublicKey(), network: 'local' },
        previewId: crypto.randomUUID(),
        publish: { networks: { local: services.targets } },
      },
      upstream: {
        address: repo.address,
        relays: repo.relays,
        clone: repo.clones[0],
        commit: base,
        manifest: null,
      },
    });
    await Bun.write(join(branch, 'README.md'), 'A forkless proposal');
    await checkpoint(branch, 'A forkless proposal', await key.getPublicKey());
    permissions.length = 0;
    kinds.length = 0;
    const sourceCli = [process.execPath, resolve('apps/cli/src/index.ts')];
    const cli = process.env.SPACE_TEST_CLI ? [resolve(process.env.SPACE_TEST_CLI)] : sourceCli;
    const submitted = JSON.parse(
      await command(
        [...cli, 'propose', 'A forkless proposal', '--network', 'local', '--json'],
        branch,
      ),
    );
    expect(submitted.status).toBe('proposed');
    expect(kinds).toContain(1618);
    expect(kinds).not.toContain(30617);
    expect(kinds).not.toContain(30618);
    expect(permissions.flat()).not.toContain('sign_event:30617');
    expect(permissions.flat()).not.toContain('sign_event:30618');
    expect((await readProposals(client, repo))[0].clones).toEqual(repo.clones);
    expect(
      await client.query([{ kinds: [30617, 30618], authors: [await key.getPublicKey()] }]),
    ).toHaveLength(0);
    expect(await sourceGit(original, ['ls-remote', '--heads', '--tags', repo.clones[0]])).toBe(
      before,
    );
    const connects = permissions.length,
      signed = kinds.length;
    expect(
      JSON.parse(
        await command([...cli, 'propose', '--resume', '--network', 'local', '--json'], branch),
      ).revision,
    ).toBe(submitted.revision);
    expect(permissions).toHaveLength(connects);
    expect(kinds).toHaveLength(signed);
    await Bun.write(join(branch, 'README.md'), 'A revised forkless proposal');
    await checkpoint(branch, 'Revise proposal', await key.getPublicKey());
    let updated = await propose({
      directory: branch,
      network: 'local',
      accounts: contributor,
      check,
      description: 'Revised proposal',
    });
    expect(updated.proposal).toBe(submitted.proposal);
    expect(kinds).toContain(1619);
    // ngit test credentials are disposable and written privately outside all repositories.
    // Production transport never reads these configs and never handles an nsec.
    const contributorConfig = join(services.directory, 'ngit-contributor', '.gitconfig');
    const ownerConfig = join(services.directory, 'ngit-owner', '.gitconfig');
    for (const [path, signer] of [
      [contributorConfig, key],
      [ownerConfig, ownerKey],
    ] as const) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(
        path,
        `[user]\n name = Independent ngit fixture\n email = ngit@fixture.invalid\n[nostr]\n nsec = ${nip19.nsecEncode(signer.key)}\n repo-relay-only = true\n`,
        { mode: 0o600 },
      );
    }
    const remote = `nostr://http/${nip19.npubEncode(repo.pubkey)}/${encodeURIComponent(repo.relays[0])}/${repo.identifier}`;
    await sourceGit(original, ['remote', 'add', 'nostr', remote]);
    await sourceGit(branch, ['remote', 'add', 'nostr', remote]);
    await Bun.write(join(branch, 'README.md'), 'Update through independent ngit');
    await checkpoint(branch, 'Update through ngit', await key.getPublicKey());
    // Independent clients use second-resolution Nostr clocks. Give this revision
    // a distinct timestamp rather than exercising an unrelated timestamp tie.
    await Bun.sleep(
      Math.max(
        0,
        ((await readProposals(client, repo))[0].revision.created_at + 1) * 1000 - Date.now(),
      ),
    );
    await command(['git', 'push', 'nostr', 'pr/forkless'], branch, contributorConfig);
    expect(await readProposals(client, repo)).toHaveLength(1);
    expect((await readProposals(client, repo))[0].head).toBe(
      await sourceGit(branch, ['rev-parse', 'HEAD']),
    );
    await Bun.write(join(branch, 'README.md'), 'Continue through Soy');
    await checkpoint(branch, 'Continue through Soy', await key.getPublicKey());
    updated = await propose({
      directory: branch,
      network: 'local',
      accounts: contributor,
      check,
      description: 'Continue through Soy',
    });
    expect(updated.proposal).toBe(submitted.proposal);
    const list = await command(['ngit', 'pr', 'list', '--json'], original, ownerConfig);
    expect(listedIds(list)).toContain(submitted.proposal);
    const observer = join(services.directory, 'observer');
    await command(['git', 'clone', remote, observer], services.directory, ownerConfig);
    await command(['ngit', 'pr', 'checkout', submitted.proposal], observer, ownerConfig);
    expect(await sourceGit(observer, ['rev-parse', 'HEAD'])).toBe(updated.head);
    await command(['ngit', 'pr', 'checkout', submitted.proposal], original, ownerConfig);
    await sourceGit(original, ['checkout', 'main']);
    await command(['ngit', 'pr', 'merge', submitted.proposal], original, ownerConfig);
    expect(await sourceGit(original, ['merge-base', '--is-ancestor', updated.head, 'main'])).toBe(
      '',
    );
    await command(['git', 'push', 'nostr', 'main'], original, ownerConfig);
    expect(
      (await readProposals(client, repo)).find((p) => p.root.id === submitted.proposal)?.status,
    ).toBe('merged');
    // The reverse direction uses an actual independent ngit root, no preview extension.
    const external = join(services.directory, 'external');
    await command(['git', 'clone', remote, external], services.directory, contributorConfig);
    await sourceGit(external, ['checkout', '-b', 'pr/external']);
    await Bun.write(join(external, 'external.txt'), 'External contribution');
    await checkpoint(external, 'External contribution', await key.getPublicKey());
    await command(['git', 'push', '-u', 'origin', 'pr/external'], external, contributorConfig);
    const foreign = (await readProposals(client, repo)).find(
      (p) => p.title === 'External contribution',
    )!;
    expect(foreign).toBeDefined();
    expect(foreign.head).toBe(await sourceGit(external, ['rev-parse', 'HEAD']));
    expect(foreign.revision.tags.some((t) => t[0] === 'soy-preview')).toBe(false);
    await Bun.write(join(external, 'external.txt'), 'External revised contribution');
    await checkpoint(external, 'Revise externally', await key.getPublicKey());
    await Bun.sleep(Math.max(0, (foreign.revision.created_at + 1) * 1000 - Date.now()));
    await command(['git', 'push', 'origin', 'pr/external'], external, contributorConfig);
    const revised = (await readProposals(client, repo)).find((p) => p.root.id === foreign.root.id)!;
    expect(revised.revision.kind).toBe(1619);
    expect(revised.head).toBe(await sourceGit(external, ['rev-parse', 'HEAD']));
    await sourceGit(original, ['checkout', 'main']);
    await proposalAction({
      directory: original,
      network: 'local',
      accounts: owner,
      proposal: foreign.root.id,
      action: 'merge',
      revision: revised.revision.id,
      target: await sourceGit(original, ['rev-parse', 'HEAD']),
    });
    await expect(
      pushSource({
        directory: original,
        network: 'local',
        accounts: owner,
        checkpoint: async (phase) => {
          if (phase === 'git') throw new Error('Interrupted after Git publication');
        },
      }),
    ).rejects.toThrow('Interrupted after Git publication');
    const publishedTip = await sourceGit(original, ['rev-parse', 'HEAD']);
    expect(
      (await readProposals(client, repo)).find((p) => p.root.id === foreign.root.id)?.status,
    ).toBe('open');
    await pushSource({ directory: original, network: 'local', accounts: owner });
    expect(await sourceGit(original, ['rev-parse', 'HEAD'])).toBe(publishedTip);
    expect(
      listedIds(
        await command(
          ['ngit', 'pr', 'list', '--status', 'applied', '--json'],
          original,
          ownerConfig,
        ),
      ),
    ).toContain(foreign.root.id);
    expect(
      (await readdir(join(branch, '.napplet-space/proposals'))).filter((p) => p.endsWith('.json')),
    ).toHaveLength(1);
    expect(
      await client.query([{ kinds: [30617, 30618], authors: [await key.getPublicKey()] }]),
    ).toHaveLength(0);
    // An ngit root without a local Soy journal is adopted by branch and author.
    await sourceGit(external, ['checkout', '-b', 'pr/mixed']);
    await Bun.write(join(external, 'mixed.txt'), 'Start in ngit');
    await checkpoint(external, 'Mixed client proposal', await key.getPublicKey());
    await command(
      [
        'git',
        'push',
        '-o',
        'title=Mixed client proposal',
        '-o',
        'description=Start in ngit',
        '-u',
        'origin',
        'pr/mixed',
      ],
      external,
      contributorConfig,
    );
    const mixedRoot = (await readProposals(client, repo)).find((p) =>
      p.head === undefined
        ? false
        : p.root.tags.some((t) => t[0] === 'branch-name' && t[1] === 'mixed'),
    )!;
    expect(mixedRoot).toBeDefined();
    await writeBinding(external, {
      version: 1,
      project: {
        creator: { pubkey: await key.getPublicKey(), network: 'local' },
        previewId: crypto.randomUUID(),
        publish: { networks: { local: services.targets } },
      },
      upstream: {
        address: repo.address,
        relays: repo.relays,
        clone: repo.clones[0],
        commit: base,
        manifest: null,
      },
    });
    await Bun.write(join(external, 'mixed.txt'), 'Continue in Soy');
    await checkpoint(external, 'Continue mixed proposal', await key.getPublicKey());
    const adopted = await propose({
      directory: external,
      network: 'local',
      accounts: contributor,
      check,
      description: 'Continue mixed proposal',
    });
    expect(adopted.proposal).toBe(mixedRoot.root.id);
    expect(adopted.revision).not.toBe(mixedRoot.root.id);
    expect(await readProposals(client, repo)).toHaveLength(3);
    // A saved job exposes the real Git refusal through CLI JSON, and recovers
    // with the same signed event after its original host is restored.
    const files = (await readdir(join(external, '.napplet-space/proposals'))).filter((p) =>
      p.endsWith('.json'),
    );
    const jobPath = join(external, '.napplet-space/proposals', files[0]);
    const saved = await Bun.file(jobPath).json();
    const refusal = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('Hosting forbidden', { status: 403 }),
    });
    const signedCount = kinds.length;
    try {
      const event = await key.signEvent({
        kind: 1618,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Refused hosting fixture',
        tags: [
          ...saved.event.tags.filter((t: string[]) => !['E', 'P', 'clone'].includes(t[0])),
          ['subject', 'Refused hosting fixture'],
          ['branch-name', 'refused'],
          ['clone', `http://127.0.0.1:${refusal.port}/refused.git`],
        ],
      });
      const refused = {
        ...saved,
        event,
        root: event,
        commit: saved.commit,
        clones: [`http://127.0.0.1:${refusal.port}/refused.git`],
        done: false,
      };
      await Bun.write(jobPath, JSON.stringify(refused));
      const error = JSON.parse(
        await command(
          [...cli, 'propose', '--resume', '--network', 'local', '--json'],
          external,
          '/dev/null',
          undefined,
          1,
        ),
      ).error;
      expect(error.code).toBe('PROPOSAL_HOSTING');
      expect(JSON.stringify(error)).toContain('403');
      expect(JSON.stringify(error)).toContain(`127.0.0.1:${refusal.port}`);
      expect(kinds).toHaveLength(signedCount);
      expect((await Bun.file(jobPath).json()).event.id).toBe(event.id);
      expect(
        await client.query([{ kinds: [30617, 30618], authors: [await key.getPublicKey()] }]),
      ).toHaveLength(0);
    } finally {
      refusal.stop(true);
      await Bun.write(jobPath, JSON.stringify(saved));
    }
    expect(
      JSON.parse(
        await command([...cli, 'propose', '--resume', '--network', 'local', '--json'], external),
      ).revision,
    ).toBe(adopted.revision);
    // Preserve a real legacy fork-backed root and journal, without creating or
    // signing a repository while resuming it. Repository setup is fixture-only.
    const legacy = join(services.directory, 'legacy');
    await sourceGit(services.directory, ['clone', repo.clones[0], legacy]);
    await sourceGit(legacy, ['checkout', '-b', 'pr/legacy']);
    const legacyPreviewId = crypto.randomUUID();
    await writeBinding(legacy, {
      version: 1,
      project: {
        creator: { pubkey: await key.getPublicKey(), network: 'local' },
        previewId: legacyPreviewId,
        publish: { networks: { local: services.targets } },
      },
      upstream: {
        address: repo.address,
        relays: repo.relays,
        clone: repo.clones[0],
        commit: base,
        manifest: null,
      },
    });
    await Bun.write(join(legacy, 'legacy.txt'), 'Existing legacy job');
    await checkpoint(legacy, 'Legacy proposal', await key.getPublicKey());
    const legacyCommit = await sourceGit(legacy, ['rev-parse', 'HEAD']);
    const legacyKey = (
      await sha256(`${repo.address}:pr/legacy:${await key.getPublicKey()}:${legacyPreviewId}`)
    ).slice(0, 16);
    const folder = join(legacy, '.napplet-space/proposals', legacyKey, legacyCommit);
    await freezeSource(
      folder,
      (await inspectProject(legacy, 'local', await key.getPublicKey())).contents,
      Math.floor(Date.now() / 1000),
      { directory: legacy, commit: legacyCommit },
    );
    const source = await prepareSource({
      directory: join(folder, 'source'),
      identifier: 'proposal-legacy',
      title: 'Legacy fixture',
      origin: services.targets.grasp,
      signer: key,
      local: true,
      upstream: repo.address,
    });
    await publishSource({
      directory: join(folder, 'source'),
      origin: services.targets.grasp,
      publication: source,
      local: true,
    });
    const fork = sourceUrls(
      services.targets.grasp,
      await key.getPublicKey(),
      'proposal-legacy',
      true,
    ).clone;
    const legacyEvent = await key.signEvent({
      kind: 1618,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Legacy fixture',
      tags: [
        ['a', repo.address],
        ['p', repo.pubkey],
        ['subject', 'Legacy fixture'],
        ['branch-name', 'pr/legacy'],
        ['c', legacyCommit],
        ['clone', fork],
        ['merge-base', base],
      ],
    });
    const legacyPath = join(legacy, '.napplet-space/proposals', `${legacyKey}.json`);
    await Bun.write(
      legacyPath,
      JSON.stringify({
        version: 1,
        root: legacyEvent,
        event: legacyEvent,
        commit: legacyCommit,
        base,
        folder,
        source,
        targets: services.targets,
        repository: repo.address,
        relays: repo.relays,
        previous: null,
        releaseRefs: {},
        done: false,
      }),
    );
    const count = kinds.length;
    expect(
      JSON.parse(
        await command([...cli, 'propose', '--resume', '--network', 'local', '--json'], legacy),
      ).proposal,
    ).toBe(legacyEvent.id);
    expect(kinds).toHaveLength(count);
    expect(JSON.stringify((await Bun.file(legacyPath).json()).event)).toBe(
      JSON.stringify(legacyEvent),
    );
    const retainedJob = await Bun.file(legacyPath).json();
    await Bun.write(join(legacy, 'legacy.txt'), 'Transition legacy revision');
    await checkpoint(legacy, 'Transition legacy revision', await key.getPublicKey());
    const transitioned = await propose({
      directory: legacy,
      network: 'local',
      accounts: contributor,
      check,
      description: 'Transition legacy revision',
    });
    expect(transitioned.proposal).toBe(legacyEvent.id);
    expect(
      await Bun.file(
        join(legacy, '.napplet-space/proposals', legacyKey, `${legacyEvent.id}.json`),
      ).json(),
    ).toEqual(retainedJob);
    const retained = (await readProposals(client, repo)).find((p) => p.root.id === legacyEvent.id)!;
    expect(retained.root.tags.find((t) => t[0] === 'clone')?.[1]).toBe(fork);
    expect(retained.clones).toEqual(repo.clones);
    // A genuine encrypted NIP-46 timeout before journaling has different recovery.
    await sourceGit(legacy, ['checkout', '-b', 'pr/timeout']);
    await Bun.write(join(legacy, 'timeout.txt'), 'New preparation');
    await checkpoint(legacy, 'Timeout preparation', await key.getPublicKey());
    const preload = join(services.directory, 'short-signer-timeout.ts');
    await Bun.write(
      preload,
      `import { Accounts } from ${JSON.stringify(resolve('packages/identity/src/accounts.ts'))}; const open = Accounts.prototype.signer; Accounts.prototype.signer = function(options) { return open.call(this, {...options, timeoutMs: 500}); };`,
    );
    provider.onSignEvent = async (draft) =>
      draft.kind === 5129 ? new Promise<boolean>(() => {}) : true;
    const error = JSON.parse(
      await command(
        [
          process.execPath,
          '--preload',
          preload,
          sourceCli[1],
          'propose',
          'Timeout preparation',
          '--network',
          'local',
          '--json',
        ],
        legacy,
        '/dev/null',
        undefined,
        1,
      ),
    ).error;
    expect(error.code).toBe('SIGNER_TIMEOUT');
    expect(error.recovery).toContain('without --resume');
    expect(JSON.stringify(error)).not.toContain(nip19.nsecEncode(key.key));
    const absent = JSON.parse(
      await command(
        [...cli, 'propose', '--resume', '--network', 'local', '--json'],
        legacy,
        '/dev/null',
        undefined,
        1,
      ),
    ).error;
    expect(absent.code).toBe('PROPOSAL_NOT_SAVED');
  } finally {
    await provider.stop();
    pool.close();
    client.close();
    await services.close();
  }
}, 180000);
