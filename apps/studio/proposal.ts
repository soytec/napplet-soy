import { z } from 'zod';
import { collaborationContext, propose } from '../../packages/collaboration/src/service';
import { readRepository, tag } from '../../packages/collaboration/src/protocol';
import { committedSource, inspectHistory } from '../../packages/publish/src/git-source';
import { inspectProject, regularFile } from '../../packages/publish/src/project';
import { projectSchema } from '../../packages/publish/src/config';
import { readBinding } from '../../packages/publish/src/binding';
import { sourceGit } from '../../packages/grasp/src/client';
import { DiagnosticError, type Diagnostic } from '../../packages/diagnostics/src';
import { prepareSharingIdentity } from '../cli/src/share-project';
import { checkPublication } from '../cli/src/publish-check';
import type { PublishOptions } from '../../packages/publish/src';
import type { Network } from '../../packages/identity/src/signer';

export const proposalInput = z.object({ description: z.string().trim().min(1).max(8000) }).strict();
export type ProposalReview = {
  id: string;
  pubkey: string;
  description: string;
  commit: string;
  base: string;
  fingerprint: string;
  artifactHash: string;
  repository: string;
  name: string;
  clones: string[];
  relays: string[];
  preparedAt: string;
};
export type ProposalState = {
  review?: ProposalReview;
  attempt?: {
    review: ProposalReview;
    status: 'running' | 'failed' | 'proposed';
    result?: Awaited<ReturnType<typeof propose>>;
    error?: Diagnostic;
  };
};

export async function prepareProposal(
  root: string,
  pubkey: string,
  input: unknown,
  hooks: { verify: () => Promise<void>; checkpoint: () => Promise<string> },
  signal: AbortSignal,
  network: Network = 'public',
): Promise<ProposalReview> {
  const { description } = proposalInput.parse(input);
  if (!(await readBinding(root))?.upstream)
    throw new DiagnosticError(
      'STUDIO_UPSTREAM',
      'Remix a napplet with Git source before proposing changes.',
    );
  await prepareSharingIdentity(root, network, pubkey);
  await hooks.verify();
  const commit = await hooks.checkpoint();
  await inspectHistory(root, commit);
  const inspected = await inspectProject(root, network, pubkey);
  if (
    projectSchema.parse(
      JSON.parse(new TextDecoder().decode(await regularFile(root, 'napplet.json', 16384))),
    ).backend?.modules?.length
  )
    throw new DiagnosticError(
      'STUDIO_BACKEND',
      'Use soyLI for projects with dynamic backend modules.',
    );
  const context = await collaborationContext({
    directory: root,
    network,
    signal,
    accounts: {
      current: async () => ({ id: 'studio-review', pubkey, type: 'remote', status: 'ready' }),
      signer: async () => {
        throw new Error('Review cannot sign.');
      },
    },
  });
  try {
    const repo = await readRepository(context.client, context.binding!.upstream!.address);
    const base = await sourceGit(root, ['merge-base', context.binding!.upstream!.commit, commit]);
    if (base === commit)
      throw new DiagnosticError('STUDIO_NO_CHANGES', 'There are no changes to propose.');
    signal.throwIfAborted();
    if (
      (await committedSource(root)) !== commit ||
      (await inspectProject(root, network, pubkey)).fingerprint !== inspected.fingerprint
    )
      throw new DiagnosticError(
        'REVIEW_CHANGED',
        'The project changed while preparing its proposal.',
      );
    return {
      id: crypto.randomUUID(),
      pubkey,
      description,
      commit,
      base,
      fingerprint: inspected.fingerprint,
      artifactHash: inspected.plan.artifactHash,
      repository: repo.address,
      name: tag(repo.event, 'name') ?? repo.identifier,
      clones: repo.clones,
      relays: repo.relays,
      preparedAt: new Date().toISOString(),
    };
  } finally {
    context.client.close();
  }
}

export async function proposeReviewed(
  root: string,
  review: ProposalReview,
  accounts: NonNullable<PublishOptions['accounts']>,
  signal: AbortSignal,
  resume = false,
  network: Network = 'public',
  check: PublishOptions['check'] = (contents) =>
    checkPublication(contents, false, undefined, false, signal),
) {
  if ((await accounts.current())?.pubkey !== review.pubkey)
    throw new DiagnosticError(
      'CREATOR_MISMATCH',
      'Connect the account shown in this proposal review.',
    );
  const options = {
    directory: root,
    network,
    accounts,
    signal,
    resume,
    description: review.description,
    expectedReview: review,
    check,
  };
  try {
    return await propose(options);
  } catch (error) {
    // A refusal before signing saves no proposal journal. The same reviewed,
    // unchanged source may be tried again; all other failures retain their cause.
    if (resume && error instanceof DiagnosticError && error.code === 'PROPOSAL_NOT_SAVED')
      return propose({ ...options, resume: false });
    throw error;
  }
}
