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
import { prepareMerge, freezeMerge, submitMerge } from '../../apps/studio/merge';
import { shareReviewedRelease, type ReleaseReview } from '../../apps/studio/publication';
import { BrowserSigning } from '../../apps/studio/signing';
import { bindPublicationAccount } from '../../apps/studio/publication-account';
import { BrowserIdentity } from '../../apps/web/src/lib/browser-identity';
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
    const progress: string[] = [];
    const result = await proposeReviewed(
      root,
      review,
      accounts,
      signal,
      true,
      'local',
      check,
      (stage) => {
        progress.push(stage);
      },
    );
    expect(progress).toContain('check');
    expect(progress).toContain('upload');
    expect(progress.indexOf('sign')).toBeLessThan(progress.indexOf('relay'));
    expect(progress.indexOf('relay')).toBeLessThan(progress.indexOf('source'));
    expect(progress.at(-1)).toBe('verify');
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
    // Original authors can prepare a private merge, with no inference or publication.
    const manifest = (
      await client.query([{ kinds: [35129], authors: [ownerPubkey], '#d': ['studio-toy'] }])
    )[0];
    const mergeRoot = join(services.directory, 'merge-review');
    const mergeRequest = { proposal: result.proposal, revision: result.revision, manifest };
    await expect(
      prepareMerge(mergeRoot, mergeRequest, pubkey, signal, async () => {}, 'local'),
    ).rejects.toMatchObject({ code: 'STUDIO_MERGE_REVIEW' });
    const prepared = await prepareMerge(
      mergeRoot,
      mergeRequest,
      ownerPubkey,
      signal,
      async () => {},
      'local',
      services.targets,
    );
    expect(prepared.target).toBe(base);
    expect(prepared.candidate).toBe(await sourceGit(mergeRoot, ['rev-parse', 'HEAD']));
    expect(prepared.author).toBe(pubkey);
    expect(prepared.title).toBe('Improve the toy');
    expect(await Bun.file(join(mergeRoot, 'index.html')).text()).toContain('Better toy');
    expect((await readProposals(client, repository))[0].status).toBe('open');
    const mergedReview = await freezeMerge(mergeRoot, prepared, 'local');
    const ownerBridge = new BrowserSigning(),
      ownerSession = ownerBridge.connect(ownerPubkey);
    const identity = new BrowserIdentity('local');
    await identity.importKey(nip19.nsecEncode(ownerKey));
    const shellSigner = bindPublicationAccount({
      pubkey: ownerPubkey,
      currentPubkey: () => identity.state.pubkey,
      connect: async () => {},
      sign: (pubkey, template) => identity.sign(pubkey, template),
    });
    const mergeKinds: number[] = [];
    let declineMergeStatus = true;
    let signing = false;
    const ownerTimer = setInterval(async () => {
      if (signing) return;
      const request = ownerBridge.next(ownerSession.id);
      if (request) {
        signing = true;
        mergeKinds.push(request.template.kind);
        try {
          if (declineMergeStatus && request.template.kind === 1631)
            throw new Error('Simulated merge-status refusal');
          ownerBridge.reply(
            ownerSession.id,
            request.id,
            await shellSigner.signEvent(request.template),
          );
        } catch {
          ownerBridge.reply(ownerSession.id, request.id);
        } finally {
          signing = false;
        }
      }
    }, 5);
    try {
      const ownerAccounts = ownerBridge.accounts(ownerSession.id, signal);
      await expect(
        submitMerge(
          mergeRoot,
          { ...mergedReview, state: '0'.repeat(64) },
          ownerAccounts,
          signal,
          async () => {},
          'local',
        ),
      ).rejects.toThrow('target branch advanced');
      await expect(
        submitMerge(
          mergeRoot,
          { ...mergedReview, revision: '0'.repeat(64) },
          ownerAccounts,
          signal,
          async () => {},
          'local',
        ),
      ).rejects.toThrow('proposal changed');
      await expect(
        submitMerge(mergeRoot, mergedReview, accounts, signal, async () => {}, 'local'),
      ).rejects.toMatchObject({ code: 'STUDIO_MERGE_REVIEW' });
      await Bun.write(join(mergeRoot, 'index.html'), '<p>Unreviewed change</p>');
      await expect(
        submitMerge(mergeRoot, mergedReview, ownerAccounts, signal, async () => {}, 'local'),
      ).rejects.toThrow();
      expect(mergeKinds).toHaveLength(0);
      await sourceGit(mergeRoot, ['restore', 'index.html']);
      // A late refusal must be resumable from the same reviewed workspace.
      await expect(
        submitMerge(mergeRoot, mergedReview, ownerAccounts, signal, async () => {}, 'local'),
      ).rejects.toMatchObject({ code: 'STUDIO_SIGNER' });
      expect(identity.state.pubkey).toBe(ownerPubkey);
      declineMergeStatus = false;
      const delivered = await submitMerge(
        mergeRoot,
        mergedReview,
        ownerAccounts,
        signal,
        async () => {},
        'local',
      );
      expect(delivered.nappletReleased).toBe(false);
      expect(mergeKinds).toContain(30618);
      expect(mergeKinds).toContain(1631);
      expect(mergeKinds).not.toContain(35129);
      expect((await readProposals(client, repository))[0].status).toBe('merged');
      expect(
        await sourceGit(mergeRoot, [
          'ls-remote',
          repository.clones[0],
          `refs/heads/${prepared.branch}`,
        ]),
      ).toBe(`${mergedReview.commit}\trefs/heads/${prepared.branch}`);
      const signedMergeCount = mergeKinds.length;
      await submitMerge(mergeRoot, mergedReview, ownerAccounts, signal, async () => {}, 'local');
      expect(mergeKinds).toHaveLength(signedMergeCount);
      expect(
        (await client.query([{ kinds: [35129], authors: [ownerPubkey], '#d': ['studio-toy'] }]))[0]
          .id,
      ).toBe(manifest.id);
      // Separate publication preserves the author's existing listing coordinate.
      await expect(
        publishProject({ directory: mergeRoot, network: 'local', accounts: owner, check }),
      ).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
      const wrongListing = finalizeEvent(
        {
          ...manifest,
          tags: manifest.tags.map((t) => (t[0] === 'd' ? ['d', 'other-listing'] : t)),
        },
        ownerKey,
      );
      await expect(
        publishProject({
          directory: mergeRoot,
          network: 'local',
          accounts: owner,
          check,
          expectedCurrent: wrongListing,
        }),
      ).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
      // Studio's capture step creates another commit after merging; it must reach
      // GRASP under the explicit release confirmation before the manifest can use it.
      await Bun.write(
        join(mergeRoot, 'release-cover.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
          'base64',
        ),
      );
      const listing = await Bun.file(join(mergeRoot, 'napplet.json')).json();
      listing.preview = { image: 'release-cover.png' };
      await Bun.write(join(mergeRoot, 'napplet.json'), JSON.stringify(listing));
      await checkpoint(mergeRoot, 'Reviewed release media', ownerPubkey);
      const dryRelease = await publishProject({
        directory: mergeRoot,
        network: 'local',
        accounts: owner,
        check,
        dryRun: true,
      });
      if (dryRelease.status !== 'dry_run') throw new Error('Expected dry release');
      const releaseReview: ReleaseReview = {
        id: crypto.randomUUID(),
        preparedAt: new Date().toISOString(),
        fingerprint: dryRelease.fingerprint,
        plan: dryRelease.plan,
        repository: dryRelease.sourceRepository,
        media: [],
        previousCurrent: manifest,
      };
      await expect(
        shareReviewedRelease(
          mergeRoot,
          { ...releaseReview, previousCurrent: wrongListing },
          ownerAccounts,
          signal,
          () => {},
          'local',
        ),
      ).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
      await shareReviewedRelease(
        mergeRoot,
        releaseReview,
        ownerAccounts,
        signal,
        () => {},
        'local',
      );
      expect(
        await sourceGit(mergeRoot, [
          'ls-remote',
          repository.clones[0],
          `refs/heads/${prepared.branch}`,
        ]),
      ).toBe(`${releaseReview.plan.sourceCommit}\trefs/heads/${prepared.branch}`);
      await publishProject({
        directory: mergeRoot,
        network: 'local',
        accounts: owner,
        check,
        expectedCurrent: manifest,
      });
      const updated = (
        await client.query([{ kinds: [35129], authors: [ownerPubkey], '#d': ['studio-toy'] }])
      )[0];
      expect(updated.id).not.toBe(manifest.id);
      expect(updated.tags.find((t) => t[0] === 'source-commit')?.[1]).toBe(
        releaseReview.plan.sourceCommit,
      );
    } finally {
      clearInterval(ownerTimer);
      ownerBridge.close();
      shellSigner.close();
      await identity.disconnect();
    }
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
