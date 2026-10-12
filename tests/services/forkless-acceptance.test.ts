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

test('forkless acceptance publishes a non-main default through a confirmed maintainer and preserves unrelated refs', async () => {
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
  const contributor = new Accounts('local', join(services.directory, 'contributor'), vault);
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
      tags: [...source.announcement.tags, ['maintainers', charlie.pubkey]],
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
      clone: repo.clones[0],
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
    const merged = await sourceGit(original, ['rev-parse', 'HEAD']);
    const accounts = {
      current: () => maintainer.current(),
      signer: async (options: Parameters<Accounts['signer']>[0]) => {
        expect(options?.kinds).toEqual([30618, 1631]);
        return maintainer.signer(options);
      },
    };
    await pushSource({ directory: original, network: 'local', accounts });
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
    expect((await readProposals(client, repo))[0].status).toBe('merged');
  } finally {
    client.close();
    await services.close();
  }
}, 60000);
