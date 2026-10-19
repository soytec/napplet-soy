import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { Accounts } from '../../packages/identity/src/accounts';
import { checkpoint } from '../../packages/publish/src/git-source';
import { writeBinding } from '../../packages/publish/src/binding';
import { publishProject } from '../../packages/publish/src';
import { sourceGit } from '../../packages/grasp/src/client';
import { ProtocolClient } from '../../packages/client/src/nostr';
import { readProposals, readRepository } from '../../packages/collaboration/src/protocol';
import { prepareProposal, proposeReviewed } from '../../apps/studio/proposal';
import { BrowserSigning } from '../../apps/studio/signing';
import { stack } from './publish-stack';

test('Studio prepares unsigned proposals, shares exact reviewed source through GRASP and resumes without a new listing', async () => {
  const services = await stack();
  const key = generateSecretKey(),
    pubkey = getPublicKey(key);
  const ownerKey = generateSecretKey(),
    ownerPubkey = getPublicKey(ownerKey);
  const vault = new Map<string, string>();
  const owner = new Accounts('local', join(services.directory, 'owner'), {
    get: async (id) => vault.get(id) ?? null,
    set: async (id, value) => {
      vault.set(id, value);
    },
    delete: async (id) => {
      vault.delete(id);
    },
  });
  const client = new ProtocolClient(() => [
    services.targets.relay,
    services.targets.grasp.replace('http:', 'ws:') + '/',
  ]);
  const bridge = new BrowserSigning(),
    session = bridge.connect(pubkey);
  const signal = new AbortController().signal;
  const kinds: number[] = [];
  const timer = setInterval(() => {
    const request = bridge.next(session.id);
    if (request) {
      kinds.push(request.template.kind);
      bridge.reply(session.id, request.id, finalizeEvent(structuredClone(request.template), key));
    }
  }, 5);
  const check = async () => ({ profile: 'fixture', browser: 'fixture' });
  try {
    await owner.import(nip19.nsecEncode(ownerKey));
    const original = join(services.directory, 'original');
    await mkdir(original);
    await Bun.write(
      join(original, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Studio Toy',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'studio-toy',
        license: 'MIT',
        description: 'Toy',
      }),
    );
    await Bun.write(
      join(original, 'index.html'),
      '<!doctype html><html><body>Original</body></html>',
    );
    await Bun.write(join(original, 'LICENSE'), 'MIT');
    await Bun.write(join(original, '.gitignore'), '.napplet-space/\n');
    await checkpoint(original, 'Original', ownerPubkey);
    await writeBinding(original, {
      version: 1,
      project: {
        creator: { pubkey: ownerPubkey, network: 'local' },
        publish: { networks: { local: services.targets } },
      },
    });
    await publishProject({ directory: original, network: 'local', accounts: owner, check });
    const repository = await readRepository(client, `30617:${ownerPubkey}:studio-toy`);
    const base = await sourceGit(original, ['rev-parse', 'HEAD']);
    const root = join(services.directory, 'remix');
    await sourceGit(services.directory, ['clone', repository.clones[0], root]);
    await sourceGit(root, ['checkout', '-b', 'pr/studio']);
    await writeBinding(root, {
      version: 1,
      project: {
        creator: { pubkey, network: 'local' },
        previewId: crypto.randomUUID(),
        publish: { networks: { local: services.targets } },
      },
      upstream: {
        address: repository.address,
        relays: repository.relays,
        clone: repository.clones[0],
        commit: base,
        manifest: null,
      },
    });
    await Bun.write(
      join(root, 'index.html'),
      '<!doctype html><html><body>Better toy</body></html>',
    );
    let verified = 0;
    const hooks = {
      verify: async () => {
        verified++;
      },
      checkpoint: async () => {
        await checkpoint(root, 'Reviewed contribution', pubkey);
        return sourceGit(root, ['rev-parse', 'HEAD']);
      },
    };
    const review = await prepareProposal(
      root,
      pubkey,
      { description: 'Improve the toy' },
      hooks,
      signal,
      'local',
    );
    expect(verified).toBe(1);
    expect(kinds).toHaveLength(0);
    expect(review.base).toBe(base);
    const accounts = bridge.accounts(session.id, signal);
    await expect(
      proposeReviewed(
        root,
        { ...review, fingerprint: 'wrong' },
        accounts,
        signal,
        false,
        'local',
        check,
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_CHANGED' });
    expect(kinds).toHaveLength(0);
    await expect(
      proposeReviewed(
        root,
        { ...review, pubkey: ownerPubkey },
        accounts,
        signal,
        false,
        'local',
        check,
      ),
    ).rejects.toMatchObject({ code: 'CREATOR_MISMATCH' });
    // Retry before the first signed journal safely starts the same reviewed proposal.
    const result = await proposeReviewed(root, review, accounts, signal, true, 'local', check);
    expect(result.head).toBe(review.commit);
    expect(result.nappletReleased).toBe(false);
    expect(kinds).toContain(1618);
    expect(kinds).toContain(5129);
    expect(kinds).not.toContain(35129);
    expect(kinds).not.toContain(30617);
    expect((await readProposals(client, repository))[0].head).toBe(review.commit);
    const signed = kinds.length;
    expect(
      (await proposeReviewed(root, review, accounts, signal, true, 'local', check)).revision,
    ).toBe(result.revision);
    expect(kinds).toHaveLength(signed);
    await expect(
      proposeReviewed(
        root,
        { ...review, description: 'Unreviewed text' },
        accounts,
        signal,
        true,
        'local',
        check,
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_CHANGED' });
    await Bun.write(join(root, 'index.html'), '<!doctype html><p>Unreviewed edit</p>');
    await expect(
      proposeReviewed(root, review, accounts, signal, false, 'local', check),
    ).rejects.toThrow();
    expect(kinds).toHaveLength(signed);
  } finally {
    clearInterval(timer);
    bridge.close();
    client.close();
    await services.close();
  }
}, 90000);
