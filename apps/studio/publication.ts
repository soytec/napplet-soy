import { z } from 'zod';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { projectSchema } from '../../packages/publish/src/config';
import { inspectProject, regularFile, type PublishPlan } from '../../packages/publish/src/project';
import { committedSource, inspectHistory } from '../../packages/publish/src/git-source';
import { publishProject, publicationStatus, type PublishOptions } from '../../packages/publish/src';
import { sha256 } from '../../packages/protocol/src';
import { prepareSharingIdentity } from '../cli/src/share-project';
import { checkPublication } from '../cli/src/publish-check';
import { pushSource } from '../../packages/collaboration/src/service';
import { PublicationRelays } from '../../packages/publish/src/relay';
import type { Network } from '../../packages/identity/src/signer';
import { DiagnosticError } from '../../packages/diagnostics/src';
import type { Diagnostic } from '../../packages/diagnostics/src';
import { run } from './process';
import { releaseConfig, releaseFile } from './release-baseline';

export const listingSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1000),
    topics: z.array(z.string().trim().min(1).max(80)).max(32),
    video: z.boolean(),
    portrait: z.boolean(),
    autoplay: z.boolean().optional(),
    keepMedia: z.boolean().optional(),
  })
  .strict();
export type Listing = z.infer<typeof listingSchema>;
export type ListingDetails = Listing & {
  recordingPlanned: boolean;
  updating: boolean;
  existingMedia: { image: boolean; video: boolean };
  reuseNotice?: string;
};

/** A default idle screencast is not a gameplay recipe. Passive apps are an explicit choice. */
export function requireRecordingPlan(config: z.infer<typeof projectSchema>, input: Listing) {
  if (
    !input.keepMedia &&
    input.video &&
    !input.autoplay &&
    !config.preview?.recording?.actions.length
  )
    throw new DiagnosticError('STUDIO_RECORDING_PLAN', 'The preview clip needs a recording plan.', {
      operation: 'prepare publication recording',
      recovery:
        'Ask the agent to configure preview.recording with a start action and timed inputs that demonstrate the core interaction at 960 × 600. Then prepare and watch the clip. For an app that starts and demonstrates itself without input, select “This app runs automatically” in Publish.',
    });
}
export type Media = {
  name: string;
  label: string;
  mime: 'image/png' | 'video/webm';
  hash: string;
  bytes: number;
  promotional: boolean;
  reused?: boolean;
};
export type ReleaseReview = {
  id: string;
  preparedAt: string;
  fingerprint: string;
  plan: PublishPlan;
  media: Media[];
  repository: { address: string | null; origin: string; hosted: boolean };
  previousCurrent?: import('../../packages/protocol/src').SignedEvent;
};
export type Published = Exclude<Awaited<ReturnType<typeof publishProject>>, { status: 'dry_run' }>;
export type PublicationState = {
  lastPublished?: ReleaseReview;
  progress?: import('./publication-progress').PublicationProgress;
  review?: ReleaseReview;
  preparationFailed?: boolean;
  attempt?: {
    review: ReleaseReview;
    stage: string;
    status: 'running' | 'failed' | 'published';
    result?: Published;
    error?: Diagnostic;
  };
};
export type PublicationHooks = {
  baseline?: string;
  env: NodeJS.ProcessEnv;
  verify: (signal: AbortSignal) => Promise<void>;
  checkpoint: (label: string, signal: AbortSignal) => Promise<string>;
  stage: (text: string) => Promise<void>;
  // Test seams retain actual Git/history/plan inspection.
  capture?: (
    root: string,
    pubkey: string,
    target: string,
    video: boolean,
    portrait: boolean,
    signal: AbortSignal,
  ) => Promise<void>;
};
export const reviewChanged = () =>
  new DiagnosticError('REVIEW_CHANGED', 'The project changed after review.', {
    recovery: 'Prepare and review the release again before publishing.',
  });

export async function listing(root: string, baseline?: string): Promise<ListingDetails> {
  const current = projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await regularFile(root, 'napplet.json', 16384))),
  );
  let config = current,
    reuseNotice: string | undefined;
  if (baseline) {
    try {
      config = await releaseConfig(root, baseline);
    } catch {
      reuseNotice =
        'The previous release could not be loaded. Showing your draft listing instead; retry or capture new media.';
    }
  }
  let canKeep = !reuseNotice && !!config.preview?.image;
  if (baseline && canKeep) {
    try {
      await releaseFile(root, baseline, config.preview!.image!, 5 * 1024 * 1024);
      if (config.preview?.video)
        await releaseFile(root, baseline, config.preview.video.file, 5 * 1024 * 1024);
    } catch {
      canKeep = false;
      reuseNotice = 'The previous release media could not be loaded. Retry, or capture new media.';
    }
  }
  return {
    title: config.title ?? config.name,
    description: config.description,
    topics: config.topics,
    video: baseline ? !!config.preview?.video : true,
    portrait: false,
    autoplay: false,
    keepMedia: !!baseline && canKeep,
    updating: !!baseline,
    existingMedia: {
      image: !!config.preview?.image && canKeep,
      video: !!config.preview?.video && canKeep,
    },
    reuseNotice,
    recordingPlanned: !!current.preview?.recording?.actions.length,
  };
}

export async function prepareRelease(
  root: string,
  storage: string,
  pubkey: string,
  input: Listing,
  signal: AbortSignal,
  hooks: PublicationHooks,
): Promise<ReleaseReview> {
  const original = await regularFile(root, 'napplet.json', 16384);
  try {
    return await prepareReleaseCandidate(root, storage, pubkey, input, signal, hooks);
  } catch (error) {
    // Failed verification/capture must not erase the user's selected release media.
    try {
      const config = projectSchema.parse(
        JSON.parse(new TextDecoder().decode(await regularFile(root, 'napplet.json', 16384))),
      );
      const prior = projectSchema.parse(JSON.parse(new TextDecoder().decode(original)));
      if (
        JSON.stringify([config.preview?.image, config.preview?.video]) !==
        JSON.stringify([prior.preview?.image, prior.preview?.video])
      ) {
        config.preview = {
          ...config.preview,
          image: prior.preview?.image,
          video: prior.preview?.video,
        };
        await writeFile(join(root, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
      }
    } catch (restoreError) {
      throw new DiagnosticError(
        'STUDIO_RELEASE_RESTORE',
        'Release preparation failed, and its previous media selections could not be restored.',
        {
          operation: 'prepare release',
          cause: new AggregateError([error, restoreError]),
          recovery:
            'Your source is saved. Review the causes below, then retry preparation using the previous release.',
        },
      );
    }
    throw error;
  }
}

async function prepareReleaseCandidate(
  root: string,
  storage: string,
  pubkey: string,
  input: Listing,
  signal: AbortSignal,
  hooks: PublicationHooks,
): Promise<ReleaseReview> {
  input = listingSchema.parse(input);
  const config = projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await regularFile(root, 'napplet.json', 16384))),
  );
  if (config.backend?.modules?.length)
    throw new DiagnosticError(
      'STUDIO_BACKEND',
      'Backend deployment is not supported in this studio yet.',
    );
  requireRecordingPlan(config, input);
  const id = crypto.randomUUID();
  const media: Media[] = [];
  let keptVideo: NonNullable<NonNullable<typeof config.preview>['video']> | undefined;
  if (input.keepMedia) {
    if (!hooks.baseline)
      throw new DiagnosticError(
        'STUDIO_RELEASE_MEDIA',
        'There is no previous release to reuse. Capture media for this first publication.',
      );
    const prior = await releaseConfig(root, hooks.baseline);
    if (!prior.preview?.image)
      throw new DiagnosticError(
        'STUDIO_RELEASE_MEDIA',
        'The previous release has no selected cover. Capture new media for this update.',
      );
    for (const clip of prior.preview.video ? [false, true] : [false]) {
      const bytes = await releaseFile(
        root,
        hooks.baseline,
        clip ? prior.preview.video!.file : prior.preview.image,
        5 * 1024 * 1024,
      );
      const hash = await sha256(bytes);
      const name = `studio-${id.slice(0, 8)}-kept.${clip ? 'webm' : 'png'}`;
      await writeFile(join(root, name), bytes, { flag: 'wx' });
      media.push({
        name,
        hash,
        bytes: bytes.length,
        label: `Existing listing ${clip ? 'clip' : 'cover'}`,
        mime: clip ? 'video/webm' : 'image/png',
        promotional: false,
        reused: true,
      });
      if (clip) keptVideo = { file: name, artifactHash: prior.preview.video!.artifactHash };
      else config.preview = { ...config.preview, image: name };
    }
  }
  // Changes remain in ordinary Git; private credentials/chat never enter this tree.
  config.title = input.title;
  config.description = input.description;
  config.topics = input.topics;
  // Keep a selected cover during runtime verification; it is replaced only after capture succeeds.
  config.preview = { ...config.preview, video: undefined };
  await writeFile(join(root, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
  await prepareSharingIdentity(root, 'public', pubkey);
  await hooks.verify(signal);
  requireRecordingPlan(
    projectSchema.parse(
      JSON.parse(new TextDecoder().decode(await regularFile(root, 'napplet.json', 16384))),
    ),
    input,
  );
  const before = await inspectProject(root, 'public', pubkey);
  const capture =
    hooks.capture ??
    (async (root, pubkey, target, video, portrait, signal) => {
      await run(
        [
          process.execPath,
          new URL('./capture.ts', import.meta.url).pathname,
          root,
          pubkey,
          target,
          String(video),
          String(portrait),
        ],
        {
          cwd: root,
          env: hooks.env,
          signal,
          operation: 'capture publication media',
          timeoutMs: 180000,
        },
      );
    });
  if (input.keepMedia) {
    await hooks.stage('Keeping the previous release cover and clip');
    for (const item of media) {
      if ((await sha256(await regularFile(root, item.name, 5 * 1024 * 1024))) !== item.hash)
        throw reviewChanged();
    }
    if (keptVideo)
      config.preview!.video = {
        ...keptVideo,
        reviewedFor: {
          artifactHash: before.plan.artifactHash,
          videoHash: media.find((m) => m.mime === 'video/webm')!.hash,
        },
      };
  }
  for (const portrait of input.keepMedia ? [] : input.portrait ? [false, true] : [false]) {
    await hooks.stage(portrait ? 'Capturing portrait media' : 'Capturing your cover and clip');
    const target = join(storage, id, portrait ? 'portrait' : 'landscape');
    await capture(root, pubkey, target, input.video, portrait, signal);
    if ((await inspectProject(root, 'public', pubkey)).fingerprint !== before.fingerprint)
      throw reviewChanged();
  }
  for (const portrait of input.keepMedia ? [] : input.portrait ? [false, true] : [false]) {
    const target = join(storage, id, portrait ? 'portrait' : 'landscape');
    for (const clip of input.video ? [false, true] : [false]) {
      const name = `studio-${id.slice(0, 8)}-${portrait ? 'portrait' : 'cover'}.${clip ? 'webm' : 'png'}`;
      const bytes = await regularFile(target, clip ? 'clip.webm' : 'cover.png', 5 * 1024 * 1024);
      await writeFile(join(root, name), bytes, { flag: 'wx' });
      media.push({
        name,
        label: `${portrait ? 'Portrait' : 'Listing'} ${clip ? 'clip' : 'cover'}`,
        mime: clip ? 'video/webm' : 'image/png',
        hash: await sha256(bytes),
        bytes: bytes.length,
        promotional: portrait,
      });
      if (!portrait) {
        if (clip) config.preview!.video = { file: name, artifactHash: before.plan.artifactHash };
        else config.preview!.image = name;
      }
    }
  }
  await writeFile(join(root, 'napplet.json'), JSON.stringify(config, null, 2) + '\n');
  await hooks.checkpoint(
    input.keepMedia
      ? 'Studio: update with reviewed existing media'
      : 'Studio: publication candidate and media',
    signal,
  );
  await inspectHistory(root, await committedSource(root));
  const account = {
    id: crypto.randomUUID(),
    pubkey,
    type: 'remote' as const,
    status: 'ready' as const,
  };
  const dry = await publishProject({
    directory: root,
    network: 'public',
    dryRun: true,
    signal,
    accounts: {
      current: async () => account,
      signer: async () => {
        throw new Error('Preparation cannot sign.');
      },
    },
    check: async () => {
      throw new Error('Dry run cannot publish.');
    },
  });
  if (dry.status !== 'dry_run') throw new Error('Expected publication plan.');
  if (dry.plan.artifactHash !== before.plan.artifactHash) throw reviewChanged();
  // Keep reviewed media outside the editable project too, for reliable retry/review.
  await mkdir(join(storage, id, 'review'), { recursive: true });
  for (const item of media)
    await writeFile(
      join(storage, id, 'review', item.name),
      await regularFile(root, item.name, 5 * 1024 * 1024),
      { flag: 'wx' },
    );
  return {
    id,
    preparedAt: new Date().toISOString(),
    fingerprint: dry.fingerprint,
    plan: dry.plan,
    repository: dry.sourceRepository,
    media,
  };
}

export async function reviewedMedia(storage: string, review: ReleaseReview, name: string) {
  const item = review.media.find((m) => m.name === name);
  if (!item) throw new Error('Unknown review media.');
  const bytes = await regularFile(join(storage, review.id, 'review'), name, 5 * 1024 * 1024);
  if ((await sha256(bytes)) !== item.hash) throw reviewChanged();
  return { bytes, mime: item.mime };
}

/** Share the post-merge release/media checkpoint under its own Git lock, before
 * the publisher takes its journal lock and revalidates source reachability. */
export async function shareReviewedRelease(
  root: string,
  review: ReleaseReview,
  accounts: NonNullable<PublishOptions['accounts']>,
  signal: AbortSignal,
  progress: (stage: string) => void,
  network: Network = 'public',
) {
  if (!review.previousCurrent || !review.repository.address) throw reviewChanged();
  if ((await accounts.current())?.pubkey !== review.plan.pubkey) throw reviewChanged();
  const dry = await publishProject({
    directory: root,
    network,
    dryRun: true,
    accounts,
    signal,
    check: async () => {
      throw reviewChanged();
    },
  });
  if (
    dry.status !== 'dry_run' ||
    dry.fingerprint !== review.fingerprint ||
    dry.sourceRepository.address !== review.repository.address ||
    dry.plan.sourceCommit !== review.plan.sourceCommit
  )
    throw reviewChanged();
  const previous = await publicationStatus(root, network, { creator: review.plan.pubkey });
  const expected =
    previous.status === 'not_started' ? review.previousCurrent.id : previous.currentId;
  const relays = new PublicationRelays(signal);
  try {
    const current = await relays.latest(
      review.plan.targets.relay,
      review.plan.pubkey,
      review.plan.identifier,
      35129,
    );
    if (current?.id !== expected)
      throw new DiagnosticError('REMOTE_CONFLICT', 'The original napplet changed after review.', {
        operation: 'prepare reviewed release source',
        recovery: 'Review the current original release again. No release-media commit was shared.',
      });
  } finally {
    relays.close();
  }
  progress('prepare-source');
  await pushSource({
    directory: root,
    network,
    accounts,
    signal,
    resumeCompleted: true,
    expectedCommit: review.plan.sourceCommit,
  });
}

export async function publishReviewed(
  root: string,
  review: ReleaseReview,
  accounts: NonNullable<PublishOptions['accounts']>,
  signal: AbortSignal,
  progress: (stage: string) => void,
  resume = false,
  dependencies?: PublishOptions['dependencies'],
  checker: PublishOptions['check'] = (contents) =>
    checkPublication(contents, false, undefined, false, signal),
) {
  if ((await accounts.current())?.pubkey !== review.plan.pubkey)
    throw new DiagnosticError(
      'CREATOR_MISMATCH',
      'Connect the account shown on this release review.',
    );
  // A retry before freeze is a fresh attempt; after freeze it uses the original journal.
  const saved = resume
    ? await publicationStatus(root, 'public', { creator: review.plan.pubkey })
    : null;
  const frozen =
    saved &&
    saved.status !== 'not_started' &&
    saved.sourceCommit === review.plan.sourceCommit &&
    saved.artifactHash === review.plan.artifactHash;
  if (!frozen) {
    await committedSource(root);
    if (
      (await inspectProject(root, 'public', review.plan.pubkey)).fingerprint !== review.fingerprint
    )
      throw reviewChanged();
    if (review.previousCurrent && review.repository.address)
      await shareReviewedRelease(root, review, accounts, signal, progress);
  }
  const result = await publishProject({
    directory: root,
    network: 'public',
    accounts,
    signal,
    expectedFingerprint: review.fingerprint,
    expectedRepository: review.repository.address,
    expectedCurrent: review.previousCurrent,
    resume: !!frozen,
    requirePreview: true,
    progress,
    dependencies,
    check: checker,
  });
  if (result.status === 'dry_run') throw new Error('Expected publication result.');
  return result;
}
