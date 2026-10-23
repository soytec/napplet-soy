import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ProtocolClient } from '../../packages/client/src/nostr';
import {
  readProposals,
  readRepository,
  readRepositoryState,
  repositoryRef,
  tag,
} from '../../packages/collaboration/src/protocol';
import { cloneRevision } from '../../packages/collaboration/src/git';
import {
  collaborationContext,
  proposalAction,
  pushSource,
} from '../../packages/collaboration/src/service';
import { sourceGit } from '../../packages/grasp/src/client';
import { validateManifest } from '../../packages/protocol/src/manifest';
import { type SignedEvent, verifiedEvent } from '../../packages/protocol/src';
import { defaultTargets, projectSchema, type Targets } from '../../packages/publish/src/config';
import { writeBinding } from '../../packages/publish/src/binding';
import { committedSource } from '../../packages/publish/src/git-source';
import { inspectProject } from '../../packages/publish/src/project';
import { DiagnosticError } from '../../packages/diagnostics/src';
import type { PublishOptions } from '../../packages/publish/src';
import type { Network } from '../../packages/identity/src/signer';

export const mergeInput = z
  .object({
    proposal: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    manifest: z.unknown(),
  })
  .strict();
export type MergeReview = {
  id: string;
  pubkey: string;
  proposal: string;
  /** Signed root author; optional for review workspaces saved before this field existed. */
  author?: string;
  title?: string;
  revision: string;
  repository: string;
  branch: string;
  target: string;
  state: string;
  head: string;
  /** Private candidate pinned before project code executes, distinct from the upstream diff base. */
  candidate?: string;
  commit?: string;
  fingerprint?: string;
  manifest: SignedEvent;
};
export type MergeState = {
  status: 'preparing' | 'review' | 'publishing' | 'failed' | 'merged';
  review?: MergeReview;
  detail: string;
};
const refuse = (message: string) =>
  new DiagnosticError('STUDIO_MERGE_REVIEW', message, {
    operation: 'review proposal merge',
    recovery:
      'Return to the original napplet and prepare a fresh review. No new napplet was published.',
  });
export function mergeAccount(pubkey: string): NonNullable<PublishOptions['accounts']> {
  return {
    current: async () => ({ id: 'studio-merge', pubkey, type: 'remote', status: 'ready' }),
    signer: async () => {
      throw refuse('Preparing a review cannot sign or publish.');
    },
  };
}

/** Private checkout only. Current branch and proposal are pinned before any project code runs. */
export async function prepareMerge(
  root: string,
  input: z.infer<typeof mergeInput>,
  pubkey: string,
  signal: AbortSignal,
  progress: (detail: string) => Promise<void>,
  network: Network = 'public',
  defaults: Targets = defaultTargets(network),
): Promise<MergeReview> {
  const manifest = verifiedEvent(input.manifest);
  await validateManifest(manifest);
  if (manifest.pubkey !== pubkey)
    throw refuse('Connect the original napplet author to manage this release.');
  if (manifest.kind !== 35129)
    throw refuse(
      'Browser release management currently requires a named napplet. Use soyLI for this manifest kind.',
    );
  const source = tag(manifest, 'source');
  if (!source?.startsWith('nostr://'))
    throw refuse('This napplet has no NIP-34 source repository.');
  const client = new ProtocolClient(() => [
    defaults.relay,
    defaults.grasp.replace(/^http/, 'ws') + '/',
    ...defaults.mirrors,
  ]);
  try {
    await progress(
      'Checking the original author, repository authority and latest proposal revision.',
    );
    const repository = await readRepository(client, source);
    const { state, authors } = await readRepositoryState(client, repository);
    if (!authors.includes(pubkey) || !state)
      throw refuse('Your account cannot update this repository’s signed state.');
    const proposal = (await readProposals(client, repository, input.proposal)).find(
      (p) => p.root.id === input.proposal,
    );
    if (
      !proposal ||
      proposal.revision.id !== input.revision ||
      !proposal.head ||
      proposal.patch ||
      !['open', 'draft'].includes(proposal.status)
    )
      throw refuse('The proposal changed, is closed, or requires an external patch review.');
    const branch =
      tag(proposal.revision, 'target-branch') ??
      tag(proposal.root, 'target-branch') ??
      tag(state, 'HEAD')?.replace(/^ref: refs\/heads\//, '');
    const target = branch && tag(state, `refs/heads/${branch}`);
    if (!branch || !/^[a-f0-9]{40}$/.test(target ?? ''))
      throw refuse('The signed repository state has no valid target branch.');
    await mkdir(root, { recursive: true });
    await sourceGit(root, ['check-ref-format', `refs/heads/${branch}`]);
    signal.throwIfAborted();
    await progress(`Loading the current ${branch} branch and the exact proposed source.`);
    const clone = await cloneRevision(root, repository, target!, network === 'local');
    await sourceGit(root, ['checkout', '-B', branch, target!]);
    // Keep publication identity local, outside the contributor's source changes.
    const config = projectSchema.parse(await Bun.file(join(root, 'napplet.json')).json());
    await writeBinding(root, {
      version: 1,
      project: {
        creator: { pubkey, network },
        identifier: tag(manifest, 'd'),
        previewId: config.previewId,
        publish: {
          ...config.publish,
          repository: source,
          networks: {
            ...config.publish?.networks,
            [network]: { ...defaults, ...config.publish?.networks?.[network], repository: source },
          },
        },
      },
      upstream: {
        address: repository.address,
        relays: repository.relays,
        clone,
        commit: target!,
        manifest,
      },
    });
    await progress('Checking for conflicts and preparing a private merge candidate.');
    signal.throwIfAborted();
    await proposalAction({
      directory: root,
      network,
      accounts: mergeAccount(pubkey),
      signal,
      proposal: input.proposal,
      revision: input.revision,
      target: target!,
      action: 'merge',
    });
    return {
      id: crypto.randomUUID(),
      pubkey,
      proposal: input.proposal,
      revision: input.revision,
      repository: repository.address,
      author: proposal.root.pubkey,
      title: proposal.title,
      branch,
      target: target!,
      state: state.id,
      head: proposal.head,
      candidate: await sourceGit(root, ['rev-parse', 'HEAD']),
      manifest,
    };
  } finally {
    client.close();
  }
}

/** Review runtime code without treating inherited listing media as a new release.
 * This copy is never written back; publication still validates the original media. */
export function mergeRuntimeContents(contents: Map<string, Uint8Array>) {
  const copy = new Map(contents);
  const config = JSON.parse(new TextDecoder().decode(copy.get('napplet.json')));
  if (config.preview) {
    delete config.preview.video;
    // A capture milestone may require live data (e.g. a radio station row).
    // The private offline check still enforces the host handshake and script errors.
    delete config.preview.readySelector;
  }
  copy.set('napplet.json', new TextEncoder().encode(JSON.stringify(config)));
  return copy;
}

export async function freezeMerge(root: string, review: MergeReview, network: Network = 'public') {
  return {
    ...review,
    commit: await committedSource(root),
    fingerprint: (await inspectProject(root, network, review.pubkey)).fingerprint,
  };
}

/** Revalidates review and remote authority; pushSource's durable journal owns delivery/retry. */
export async function submitMerge(
  root: string,
  review: MergeReview,
  accounts: NonNullable<PublishOptions['accounts']>,
  signal: AbortSignal,
  progress: (detail: string) => Promise<void>,
  network: Network = 'public',
) {
  if ((await accounts.current())?.pubkey !== review.pubkey)
    throw refuse('The signed-in account changed.');
  if (
    !review.commit ||
    !review.fingerprint ||
    (await committedSource(root)) !== review.commit ||
    (await inspectProject(root, network, review.pubkey)).fingerprint !== review.fingerprint
  )
    throw refuse('The source or build changed after this merge was reviewed.');
  const context = await collaborationContext({ directory: root, network, accounts, signal });
  try {
    await progress('Rechecking the reviewed source, proposal revision and upstream branch.');
    const repository = await readRepository(context.client, review.repository);
    const proposal = (await readProposals(context.client, repository, review.proposal)).find(
      (p) => p.root.id === review.proposal,
    );
    const { state, authors } = await readRepositoryState(context.client, repository);
    if (!state || !authors.includes(review.pubkey)) throw refuse('Repository authority changed.');
    const remoteHead = tag(state, `refs/heads/${review.branch}`);
    if (state.id !== review.state && remoteHead !== review.commit)
      throw refuse('The target branch advanced. Prepare a new merge review.');
    if (
      !proposal ||
      proposal.revision.id !== review.revision ||
      proposal.head !== review.head ||
      (!['open', 'draft'].includes(proposal.status) &&
        !(proposal.status === 'merged' && remoteHead === review.commit))
    )
      throw refuse('The proposal changed after review.');
    if (repositoryRef(tag(review.manifest, 'source')!).address !== repository.address)
      throw refuse('The source repository changed.');
    signal.throwIfAborted();
    await progress(
      'Approve the repository update and merge status in your selected signer. Sharing the reviewed Git revision.',
    );
    return await pushSource({
      directory: root,
      network,
      accounts,
      resumeCompleted: true,
      expectedCommit: review.commit,
      signal,
      checkpoint: async (stage) => {
        await progress(
          stage === 'git'
            ? 'The source branch is available. Publishing and verifying the proposal’s merged status.'
            : 'The merged status is confirmed.',
        );
      },
    });
  } finally {
    context.client.close();
  }
}
