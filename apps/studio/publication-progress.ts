import type { Project } from './types';

export const publicationSteps = [
  'Check project',
  'Capture media',
  'Review release',
  'Sign release',
  'Share source',
  'Upload files',
  'Publish to relays',
  'Verify website',
] as const;
export type PublicationProgress = { step: number; detail: string; hint: string; at: number };

/** Steps describe completed milestones, not an estimate of remaining wall-clock time. */
export function publishProgress(stage: string): PublicationProgress {
  const step =
    stage === 'website'
      ? 7
      : /^(current|snapshot|descriptor|mirror|outbox)/.test(stage)
        ? 6
        : stage === 'upload'
          ? 5
          : stage === 'source'
            ? 4
            : 3;
  const detail =
    (
      {
        check: 'Rechecking the reviewed source and release settings.',
        'prepare-source':
          'Signing and sharing the reviewed release-media commit with the original Git repository.',
        sandbox: 'Verifying the frozen build in the sandbox.',
        freeze: 'Freezing the reviewed source and Git history.',
        sign: 'Signing the release with your shell account.',
        source: 'Sharing the exact source revision through GRASP.',
        upload: 'Uploading and verifying the app, source archive and preview media on Blossom.',
        current: 'Publishing the napplet manifest to the primary relay.',
        snapshot: 'Publishing the version snapshot.',
        descriptor: 'Publishing media references.',
        website: 'Waiting for napplet.soy to index this release and verify its download.',
      } as Record<string, string>
    )[stage] ?? 'Distributing the signed release to additional relays.';
  return {
    step,
    detail,
    hint:
      step === 7
        ? 'Relay publication has succeeded. This check never republishes your napplet.'
        : 'Keep this tab open. Approve requests from your shell signer when prompted.',
    at: Date.now(),
  };
}

export function publicationProgress(project: Project) {
  const pub = project.publication;
  if (!pub) return;
  const progress = pub.progress;
  const result = pub.attempt?.status === 'published' ? pub.attempt.result : undefined;
  // An old published version must not complete a new preparation/review.
  const newerReview = pub.review && pub.review.id !== pub.attempt?.review.id;
  const currentResult = !newerReview && (!progress || progress.step === 7) ? result : undefined;
  const complete = !!currentResult?.websiteReady;
  const fallback = currentResult
    ? publishProgress('website')
    : pub.review
      ? {
          step: 2,
          detail: 'Review your listing and watch the captured clip.',
          hint: 'Nothing is published until you confirm.',
          at: 0,
        }
      : pub.attempt
        ? publishProgress(pub.attempt.stage)
        : undefined;
  if (!progress && !fallback) return;
  const active = progress ?? fallback!;
  const failed = project.phase === 'failed' || project.phase === 'stopped';
  return {
    ...active,
    complete,
    failed,
    completed: complete ? publicationSteps.length : active.step,
    detail: complete
      ? 'The website confirmed this exact release and its verified download.'
      : failed
        ? (project.error?.message ?? project.stage)
        : active.detail,
    hint: complete
      ? 'Your napplet is ready to open and play.'
      : failed
        ? 'Your work is saved. Review the error below before retrying.'
        : active.hint,
  };
}
