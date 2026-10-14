import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { ProtocolClient } from '../../packages/client/src/nostr';
import {
  prepareSource,
  publishSource,
  sourceGit,
  sourceUrls,
} from '../../packages/grasp/src/client';
import { checkpoint } from '../../packages/publish/src/git-source';
import { writeBinding } from '../../packages/publish/src/binding';
import { propose, proposalAction, pushSource } from '../../packages/collaboration/src/service';
import {
  readProposals,
  readRepository,
  readRepositoryState,
  tag,
} from '../../packages/collaboration/src/protocol';
import { stack } from './publish-stack';

async function acceptance(newerRevision: boolean) {
  const services = await stack();
  const ownerKey = new PrivateKeySigner(),
    maintainerKey = new PrivateKeySigner();
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
  const owner = new Accounts('local', join(services.directory, 'owner'), vault);
  const maintainer = new Accounts('local', join(services.directory, 'maintainer'), vault);
  const contributor = new Accounts(
    'local',
    join(services.directory, 'contributor/accounts/local'),
    vault,
  );
  const client = new ProtocolClient(() => [services.targets.grasp.replace('http:', 'ws:') + '/']);
  try {
    const alice = await owner.import(nip19.nsecEncode(ownerKey.key));
    const charlie = await maintainer.import(nip19.nsecEncode(maintainerKey.key));
    const bob = await contributor.create();
    const original = join(services.directory, 'original');
    await mkdir(original);
    await Bun.write(
      join(original, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Branches',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'branches',
        license: 'MIT',
      }),
    );
    await Bun.write(join(original, 'index.html'), '<p>Original</p>');
    await Bun.write(join(original, 'LICENSE'), 'MIT');
    await Bun.write(join(original, '.gitignore'), '.napplet-space/\n');
    const base = (await checkpoint(original, 'Original', alice.pubkey)).commit;
    const source = await prepareSource({
      directory: original,
      identifier: 'branches',
      title: 'Branches',
      origin: services.targets.grasp,
      local: true,
      signer: ownerKey,
    });
    await publishSource({
      directory: original,
      origin: services.targets.grasp,
      local: true,
      publication: source,
    });
    const urls = sourceUrls(services.targets.grasp, alice.pubkey, 'branches', true);
    const state = await ownerKey.signEvent({
      kind: 30618,
      created_at: source.state.created_at + 1,
      content: '',
      tags: [
        ['d', 'branches'],
        ['refs/heads/main', base],
        ['refs/heads/develop', base],
        ['refs/tags/v1', base],
        ['HEAD', 'ref: refs/heads/develop'],
      ],
    });
    await client.publish(state);
    await sourceGit(original, [
      'push',
      urls.clone,
      `${base}:refs/heads/develop`,
      `${base}:refs/tags/v1`,
    ]);
    // Listing another key is an invitation. A reciprocal announcement confirms it.
    const announcement = await ownerKey.signEvent({
      kind: 30617,
      created_at: source.announcement.created_at + 1,
      content: '',
      tags: [
        ...source.announcement.tags.map((t) =>
          t[0] === 'clone'
            ? [
                'clone',
                'ssh://git@example.org/branches.git',
                'git@example.org:branches.git',
                'git://example.org/branches.git',
                'file:///not-a-host',
                ...t.slice(1),
              ]
            : t,
        ),
        ['maintainers', charlie.pubkey],
      ],
    });
    await client.publish(announcement);
    const repo = await readRepository(client, `30617:${alice.pubkey}:branches`);
    expect((await readRepositoryState(client, repo)).authors).not.toContain(charlie.pubkey);
    const maintainerUrls = sourceUrls(services.targets.grasp, charlie.pubkey, 'branches', true);
    const acknowledged = await maintainerKey.signEvent({
      kind: 30617,
      created_at: announcement.created_at,
      content: '',
      tags: [
        ['d', 'branches'],
        ['name', 'Branches'],
        ['clone', maintainerUrls.clone],
        ['relays', maintainerUrls.relay],
        ['r', base, 'euc'],
        ['maintainers', alice.pubkey],
      ],
    });
    await client.publish(acknowledged);
    await sourceGit(original, [
      'push',
      maintainerUrls.clone,
      `${base}:refs/heads/main`,
      `${base}:refs/heads/develop`,
      `${base}:refs/tags/v1`,
    ]);
    expect((await readRepositoryState(client, repo)).authors).toContain(charlie.pubkey);
    const binding = {
      address: repo.address,
      relays: repo.relays,
      clone: urls.clone,
      commit: base,
      manifest: null,
    };
    await writeBinding(original, {
      version: 1,
      project: {
        creator: { pubkey: alice.pubkey, network: 'local' },
        publish: { networks: { local: services.targets } },
      },
      upstream: binding,
    });
    const branch = join(services.directory, 'change');
    await sourceGit(services.directory, ['clone', urls.clone, branch]);
    expect(await sourceGit(branch, ['symbolic-ref', '--short', 'HEAD'])).toBe('develop');
    await sourceGit(branch, ['checkout', '-b', 'pr/change']);
    await writeBinding(branch, {
      version: 1,
      project: {
        creator: { pubkey: bob.pubkey, network: 'local' },
        previewId: crypto.randomUUID(),
        // Contributor repository hosting is unrelated to upstream PR hosting.
        publish: { networks: { local: { ...services.targets, grasp: 'http://127.0.0.1:1' } } },
      },
      upstream: binding,
    });
    await Bun.write(join(branch, 'index.html'), '<p>Improved</p>');
    await checkpoint(branch, 'Improve develop', bob.pubkey);
    const proposal = await propose({
      directory: branch,
      network: 'local',
      accounts: contributor,
      description: 'Improve develop',
      check: async () => ({ profile: 'fixture', browser: 'fixture' }),
    });
    await expect(
      proposalAction({
        directory: original,
        network: 'local',
        accounts: maintainer,
        proposal: proposal.proposal,
        action: 'merge',
        revision: proposal.revision,
        target: base,
      }),
    ).rejects.toThrow('target branch develop');
    await sourceGit(original, ['checkout', '-b', 'develop', base]);
    await proposalAction({
      directory: original,
      network: 'local',
      accounts: maintainer,
      proposal: proposal.proposal,
      action: 'merge',
      revision: proposal.revision,
      target: base,
    });
    let merged = await sourceGit(original, ['rev-parse', 'HEAD']);
    const accounts = {
      current: () => maintainer.current(),
      signer: async (options: Parameters<Accounts['signer']>[0]) => {
        expect(options?.kinds).toEqual([30618, 1631]);
        return maintainer.signer(options);
      },
    };
    await expect(
      pushSource({
        directory: original,
        network: 'local',
        accounts,
        checkpoint: async (phase) => {
          if (phase === 'git') throw new Error('Interrupted after Git publication');
        },
      }),
    ).rejects.toThrow('Interrupted after Git publication');
    let reviewed = proposal;
    if (newerRevision) {
      await Bun.write(join(branch, 'index.html'), '<p>Later unmerged revision</p>');
      await checkpoint(branch, 'Later revision', bob.pubkey);
      reviewed = await propose({
        directory: branch,
        network: 'local',
        accounts: contributor,
        description: 'Later revision',
        check: async () => ({ profile: 'fixture', browser: 'fixture' }),
      });
      expect(reviewed.revision).not.toBe(proposal.revision);
    }
    // Recovery needs no signing permission, even if a newer revision is skipped.
    const recovered = await pushSource({
      directory: original,
      network: 'local',
      accounts: {
        current: () => maintainer.current(),
        signer: async () => {
          throw new Error('Recovery must not sign');
        },
      },
    });
    expect(recovered.supersededProposals).toEqual(newerRevision ? [proposal.proposal] : []);
    expect(await sourceGit(original, ['rev-parse', 'HEAD'])).toBe(merged);
    if (newerRevision) {
      expect((await readProposals(client, repo))[0].status).toBe('open');
      expect(await client.query([{ kinds: [1631], '#e': [proposal.proposal] }])).toHaveLength(0);
      await proposalAction({
        directory: original,
        network: 'local',
        accounts: maintainer,
        proposal: reviewed.proposal,
        action: 'merge',
        revision: reviewed.revision,
        target: merged,
      });
      merged = await sourceGit(original, ['rev-parse', 'HEAD']);
      await pushSource({ directory: original, network: 'local', accounts });
    }
    const published = (await readRepositoryState(client, repo)).state!;
    expect(published.pubkey).toBe(charlie.pubkey);
    expect(tag(published, 'refs/heads/main')).toBe(base);
    expect(tag(published, 'refs/tags/v1')).toBe(base);
    expect(tag(published, 'refs/heads/develop')).toBe(merged);
    expect(tag(published, 'HEAD')).toBe('ref: refs/heads/develop');
    expect(await sourceGit(original, ['ls-remote', urls.clone, 'refs/heads/main'])).toBe(
      `${base}\trefs/heads/main`,
    );
    expect(await sourceGit(original, ['ls-remote', urls.clone, 'refs/tags/v1'])).toBe(
      `${base}\trefs/tags/v1`,
    );
    expect(await sourceGit(original, ['ls-remote', urls.clone, 'refs/heads/develop'])).toBe(
      `${merged}\trefs/heads/develop`,
    );
    expect((await readRepository(client, repo.address)).event.id).toBe(announcement.id);
    const accepted = (await readProposals(client, repo))[0];
    expect(accepted.status).toBe('merged');
    expect(accepted.statusEvent?.tags).toContainEqual(['e', reviewed.revision, '', 'reply']);
    if (!newerRevision) {
      // Exercise the actionable exhausted-alternatives diagnostic through soyli itself.
      await sourceGit(branch, ['checkout', '-b', 'pr/unsupported-host']);
      const secret = 'clone-fixture-password';
      const announcementRelay = new ProtocolClient(() => [services.targets.relay]);
      await announcementRelay.publish(
        await ownerKey.signEvent({
          kind: 30617,
          created_at: Math.max(Math.floor(Date.now() / 1000), announcement.created_at + 1),
          content: '',
          tags: [
            ...announcement.tags.filter((t) => t[0] !== 'clone'),
            [
              'clone',
              'ssh://git@example.org/branches.git',
              `https://user:${secret}@example.org/repo`,
            ],
          ],
        }),
      );
      announcementRelay.close();
      for (const json of [false, true]) {
        const child = Bun.spawn(
          [
            process.execPath,
            new URL('../../apps/cli/src/index.ts', import.meta.url).pathname,
            'propose',
            'Unsupported host',
            '--network',
            'local',
            ...(json ? ['--json'] : []),
          ],
          {
            cwd: branch,
            env: {
              PATH: process.env.PATH,
              SPACE_ACCOUNT_HOME: join(services.directory, 'contributor'),
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [code, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, out + err).toBe(1);
        expect(out + err).toContain('GIT_CLONE_URLS');
        expect(out + err).toContain('loopback HTTP');
        expect(out + err).not.toContain(secret);
        if (json) expect(JSON.parse(out).error.operation).toBe('select Git hosts');
      }
    }
  } finally {
    client.close();
    await services.close();
  }
}

for (const newerRevision of [false, true])
  test(
    `forkless acceptance preserves refs and resumes ${newerRevision ? 'without accepting a newer revision' : 'the reviewed revision'}`,
    () => acceptance(newerRevision),
    60000,
  );
