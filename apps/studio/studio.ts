import { exportBrowserGit } from './browser-git-export';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  diagnose,
  DiagnosticError,
  formatDiagnostic,
  redactDiagnostic,
} from '../../packages/diagnostics/src';
import { regularFile, checkSource, inspectProject } from '../../packages/publish/src/project';
import { checkPublication } from '../cli/src/publish-check';
import { releaseBaseline } from './release-baseline';
import {
  ASSET_LOCK,
  readAssets,
  importAsset,
  assetBytes,
  MAX_ASSET_BYTES,
  type ManagedAsset,
} from '../../packages/assets/src';
import { materializePreview } from '../cli/src/frozen-preview';
import { studioPreviewHtml } from './preview-layout';
import { previewAssets } from '../cli/src/preview/assets';
import { startPreviewServer } from '../cli/src/preview/server';
import { run } from './process';
import { connectionInput, type Connections } from './connections';
import { defaultSteps } from './connections-model';
import { z } from 'zod';
import {
  taskInstructions,
  nativeCheckInstructions,
  inferenceTimeoutMs,
  type Agent,
  type AgentEvent,
} from './agent';
import { reasoningLimits, working, type Check, type Project, type StudioState } from './types';
import { recordWorkshop } from './workshop';
import { publishProgress } from './publication-progress';
import { BrowserSigning } from './signing';
import { StudioStore } from './store';
import { localSource } from './navigation';
import {
  listing,
  prepareRelease,
  publishReviewed,
  reviewedMedia,
  type Listing,
  type PublicationHooks,
} from './publication';
import { prepareProposal, proposeReviewed } from './proposal';
import { proposalProgress } from './proposal-progress';
import { mergeInput, prepareMerge, freezeMerge, submitMerge, mergeRuntimeContents } from './merge';
import { nip19 } from 'nostr-tools';
import { publicationStatus, type PublishOptions } from '../../packages/publish/src';
import { BrowserBuilds, browserBuildInput } from './browser-build';
import { builtConfiguration } from '../../packages/publish/src/artifact';
import { readBinding } from '../../packages/publish/src/binding';

export type StudioOptions = {
  directory: string;
  owner?: string;
  agent: Agent;
  connections?: Connections;
  sourcePolicy?: (source: string) => void;
  /** Operator-installed, pinned browser library profile; never project-supplied. */
  browserLibraryRoot?: string;
  soyli: string[];
  env: NodeJS.ProcessEnv;
  // The test seam substitutes the preview server, never the process/verification lifecycle.
  preview?: (directory: string) => Promise<{ url: string; stop: () => void }>;
  capture?: PublicationHooks['capture'];
  publicationDependencies?: PublishOptions['dependencies'];
  publicationCheck?: (
    contents: Map<string, Uint8Array>,
    signal?: AbortSignal,
  ) => ReturnType<PublishOptions['check']>;
  /** Hosted execution boundary. Scaffold/import and Git stay in the controller;
   * setup, builds and project scripts must use this adapter when configured. */
  projectCommand?: (
    root: string,
    args: string[],
    options: Omit<import('./process').RunOptions, 'cwd' | 'env'>,
  ) => Promise<string>;
};
const textDecoder = new TextDecoder();
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
export class Studio {
  readonly signing = new BrowserSigning();
  readonly browserBuilds = new BrowserBuilds();
  private projects: Project[] = [];
  private mutating = false;
  private active?: { id: string; controller: AbortController; promise: Promise<void> };
  private previews = new Map<string, { revision: string; url: string; stop: () => void }>();
  private previewOpening = new Map<string, Promise<string>>();
  private retiring = new Map<ReturnType<typeof setTimeout>, () => void>();
  private store?: StudioStore;
  constructor(private options: StudioOptions) {}

  async initialize() {
    await mkdir(join(this.options.directory, 'projects'), { recursive: true, mode: 0o700 });
    this.store = new StudioStore(this.options.directory, this.options.owner);
    try {
      this.projects = this.store.load();
      const interrupted = new Set(
        this.store
          .jobs()
          .filter((job) => job.status === 'running')
          .map((job) => job.projectId),
      );
      for (const project of this.projects) {
        if (!/^[a-f0-9-]{36}$/.test(project.id)) throw new Error('Invalid saved project ID.');
        delete project.previewUrl;
        if (project.initialized) await this.rememberSourceRevision(project);
        const publication = project.publication?.attempt;
        if (publication?.status === 'published' && !publication.result?.websiteReady) {
          const old = 'Published; awaiting website indexing';
          const current = 'Published; website availability unconfirmed';
          if (publication.stage === old) publication.stage = current;
          if (project.stage === old) project.stage = current;
        }
        if (project.proposal?.attempt?.status === 'running')
          project.proposal.attempt.status = 'failed';
        if (project.merge && ['preparing', 'publishing'].includes(project.merge.status))
          project.merge.status = 'failed';
        if (project.publication?.attempt?.status === 'running') {
          project.publication.attempt.status = 'failed';
          project.publication.attempt.stage =
            'Interrupted. Reconnect the same signer and resume the saved release.';
        }
        if (working(project.phase) || interrupted.has(project.id)) {
          project.phase = 'stopped';
          project.stage = 'Interrupted; your files and conversation are saved.';
          this.message(
            project,
            'system',
            'The studio restarted during this turn. Inspect the changes, then continue or run checks.',
          );
        }
      }
      this.store.recover(this.projects);
    } catch (error) {
      this.store.close();
      throw error;
    }
  }
  project(id: string) {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new DiagnosticError('STUDIO_PROJECT', 'Project not found.');
    return project;
  }
  workspace(id: string) {
    this.project(id);
    return join(this.options.directory, 'projects', id, 'workspace');
  }
  private async save() {
    // SQLite writes are synchronous: persist before returning or launching any work.
    this.store!.save(this.projects);
  }
  private message(p: Project, role: 'user' | 'assistant' | 'system', text: string) {
    p.messages.push({
      id: crypto.randomUUID(),
      role,
      text: text.slice(0, 20000),
      at: new Date().toISOString(),
    });
    p.updatedAt = new Date().toISOString();
  }
  private activity(p: Project, text: string) {
    const safe = redactDiagnostic(text, 400);
    recordWorkshop(p, { id: crypto.randomUUID(), type: 'activity', text: safe });
    p.activity.push(safe);
    p.activity = p.activity.slice(-100);
  }
  private async stage(p: Project, phase: Project['phase'], stage: string) {
    if (p.stage !== stage) this.activity(p, stage);
    p.phase = phase;
    p.stage = stage;
    if (phase === 'checking' && p.publication?.progress?.step === 0)
      p.publication.progress = { ...p.publication.progress, detail: stage, at: Date.now() };
    await this.save();
  }
  async state(): Promise<StudioState> {
    return structuredClone({
      projects: this.projects,
      model: this.options.agent.model,
      browserBuilds: !this.options.projectCommand || !!this.options.browserLibraryRoot,
      browserGit: !this.options.projectCommand,
      connections: this.options.connections?.state(),
      busy: this.active?.id ?? (this.mutating ? 'settings' : undefined),
      jobs: this.store!.jobs(),
    });
  }
  private available() {
    if (this.active || this.mutating)
      throw new DiagnosticError(
        'STUDIO_BUSY',
        'A turn is already running. Stop it or wait for it to finish.',
      );
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    this.available();
    this.mutating = true;
    try {
      return await work();
    } finally {
      this.mutating = false;
    }
  }
  async connectionAction(action: string, input: unknown) {
    const connections = this.options.connections;
    if (!connections)
      throw new DiagnosticError('STUDIO_CONNECTION', 'Connection settings are not configured.');
    return this.exclusive(async () => {
      if (action === 'models') return connections.models(input);
      if (action === 'model') return connections.setModel(input);
      if (action === 'save') {
        const parsed = connectionInput.safeParse(input);
        if (!parsed.success)
          throw new DiagnosticError(
            'STUDIO_CONNECTION',
            'Check the connection name, endpoint, model and step limit (10–100).',
          );
        return connections.save(parsed.data);
      }
      const { id } = z.object({ id: z.uuid() }).strict().parse(input);
      if (action === 'select') return connections.select(id);
      if (action === 'remove') return connections.remove(id);
      if (action === 'test') return connections.test(id);
      throw new DiagnosticError('STUDIO_CONNECTION', 'Unknown connection operation.');
    });
  }
  async assets(id: string): Promise<ManagedAsset[]> {
    return (await readAssets(this.workspace(id))).assets;
  }
  async assetMedia(id: string, name: string) {
    const asset = (await this.assets(id)).find((a) => a.id === name);
    if (!asset) throw new DiagnosticError('STUDIO_ASSET', 'Asset not found.');
    return { bytes: await assetBytes(this.workspace(id), asset), mime: asset.mime };
  }
  async importAsset(id: string, input: unknown, bytes: Uint8Array) {
    return this.exclusive(async () => {
      const p = this.project(id);
      this.editable(p);
      if (!p.initialized)
        throw new DiagnosticError(
          'STUDIO_ASSET',
          'Let the project finish setting up before adding assets.',
        );
      const metadata = z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
          license: z.string().trim().min(1).max(160),
          source: z.string().max(500),
          storage: z.enum(['embedded', 'external']),
        })
        .strict()
        .parse(input);
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_ASSET_BYTES)
        throw new DiagnosticError('STUDIO_ASSET', 'Choose a nonempty file up to 10 MiB.');
      // Invalidate before touching source; failed imports cannot leave an approved stale review.
      if (p.publication) delete p.publication.review;
      if (p.proposal) delete p.proposal.review;
      await this.save();
      await importAsset(this.workspace(id), { ...metadata, bytes });
      this.message(
        p,
        'system',
        `Added asset “${metadata.id}” to this draft. It will be shared with the source when you publish. Ask your maker to use it, then review the next preview.`,
      );
      await this.save();
      return this.assets(id);
    });
  }
  private launch(p: Project, job: (signal: AbortSignal) => Promise<void>) {
    this.available();
    const jobId = this.store!.begin(this.projects, p.id);
    const controller = new AbortController();
    // Reserve before any async work, so double clicks cannot start two writers.
    const active = { id: p.id, controller, promise: Promise.resolve() };
    this.active = active;
    const timeout = setTimeout(
      () => controller.abort(new Error('The studio turn reached its 20-minute limit.')),
      20 * 60_000,
    );
    active.promise = (async () => {
      try {
        await this.save();
        await job(controller.signal);
      } catch (error) {
        p.phase = controller.signal.aborted ? 'stopped' : 'failed';
        p.stage = controller.signal.aborted ? 'Stopped. Your work is saved.' : 'Needs attention';
        p.error = diagnose(
          controller.signal.aborted
            ? new DiagnosticError('CANCELLED', 'The turn was stopped.', {
                recovery: 'Send another message to continue, or run checks on the current files.',
              })
            : error,
          'local studio turn',
        );
        this.message(p, 'system', formatDiagnostic(p.error));
      } finally {
        clearTimeout(timeout);
        p.updatedAt = new Date().toISOString();
        try {
          this.store!.finish(
            this.projects,
            jobId,
            controller.signal.aborted ? 'cancelled' : p.phase === 'failed' ? 'failed' : 'completed',
          );
        } finally {
          if (this.active === active) this.active = undefined;
        }
      }
    })();
    // Errors persisting state remain visible in the terminal, never unhandled rejections.
    void active.promise.catch((error) =>
      console.error(formatDiagnostic(diagnose(error, 'save studio state'))),
    );
  }
  async create(title: string, prompt: string, source?: string, browserSession?: string) {
    this.available();
    if (browserSession) {
      z.uuid().parse(browserSession);
      if (this.options.projectCommand && !this.options.browserLibraryRoot)
        throw new DiagnosticError(
          'STUDIO_BROWSER_PROFILE',
          'Browser builds are currently a local Studio experiment.',
        );
    }
    if (source) this.options.sourcePolicy?.(source);
    if (this.projects.length >= 20) throw new Error('This local studio is limited to 20 drafts.');
    const p: Project = {
      id: crypto.randomUUID(),
      title,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: 'preparing',
      stage: source ? 'Loading the original source' : 'Creating your workspace',
      messages: [],
      activity: [],
      checks: [],
      checkpoints: [],
      estimatedCost: 0,
      steps: 0,
    };
    this.message(p, 'user', prompt);
    this.projects.unshift(p);
    this.launch(p, (signal) => this.turn(p, prompt, signal, browserSession));
    return p.id;
  }
  private editable(p: Project) {
    if (p.merge && p.merge.status !== 'merged')
      throw new DiagnosticError(
        'STUDIO_MERGE_PENDING',
        'This workspace is a pinned merge review.',
        {
          recovery:
            'Finish the reviewed merge before editing or publishing. For a changed proposal, prepare a fresh review from the original napplet.',
        },
      );
  }
  async reviewMerge(session: string, raw: unknown) {
    this.available();
    const input = mergeInput.parse(raw),
      pubkey = this.signing.pubkey(session);
    const p: Project = {
      id: crypto.randomUUID(),
      title: 'Proposal merge review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: 'preparing',
      stage: 'Preparing a private merge review',
      messages: [],
      activity: [],
      checks: [],
      checkpoints: [],
      estimatedCost: 0,
      steps: 0,
      merge: { status: 'preparing', detail: 'Checking the original author and source.' },
    };
    this.projects.unshift(p);
    this.launch(p, async (signal) => {
      try {
        const review = await prepareMerge(
          this.workspace(p.id),
          input,
          pubkey,
          signal,
          async (detail) => {
            p.merge!.detail = detail;
            await this.stage(p, 'preparing', detail);
          },
        );
        p.merge!.review = review;
        p.initialized = true;
        p.baseline = review.target;
        p.source =
          'nostr:' +
          nip19.naddrEncode({
            kind: 35129,
            pubkey,
            identifier: review.manifest.tags.find((t) => t[0] === 'd')![1],
          });
        p.title =
          'Review: ' + (review.manifest.tags.find((t) => t[0] === 'title')?.[1] ?? 'proposal');
        await this.prepare(p, signal);
        p.merge!.detail = 'Building and checking the actual merged source in isolation.';
        await this.verify(p, signal);
        p.merge!.review = await freezeMerge(this.workspace(p.id), review);
        p.merge!.status = 'review';
        p.merge!.detail =
          'Play the merged build and inspect Changes, then confirm the source update.';
        this.message(
          p,
          'system',
          'This is a private merge candidate rebuilt from the proposal and current target branch. Review its changes and play it before confirming. The upstream and published napplet have not changed.',
        );
        await this.stage(p, 'ready', 'Merge ready for your review');
      } catch (error) {
        p.merge!.status = 'failed';
        throw error;
      } finally {
        this.signing.end(session);
      }
    });
    return p.id;
  }
  async mergeProposal(id: string, session: string, reviewId: string) {
    this.available();
    const p = this.project(id),
      review = p.merge?.review;
    if (
      !review?.commit ||
      review.id !== reviewId ||
      !p.preview ||
      !['review', 'failed'].includes(p.merge!.status)
    )
      throw new Error('Prepare and play the checked merge candidate first.');
    if (this.signing.pubkey(session) !== review.pubkey)
      throw new Error('Connect the original author account.');
    p.error = undefined;
    p.merge!.status = 'publishing';
    p.phase = 'publishing';
    this.launch(p, async (signal) => {
      try {
        const result = await submitMerge(
          this.workspace(id),
          review,
          this.signing.accounts(session, signal),
          signal,
          async (detail) => {
            p.merge!.detail = detail;
            await this.stage(p, 'publishing', detail);
          },
        );
        p.merge!.status = 'merged';
        p.merge!.detail = result.supersededProposals.length
          ? 'Source updated. A newer proposal revision arrived during delivery; its status was not changed. Review it from My work.'
          : 'Source merged and proposal status confirmed. Use Publish to update the original napplet when ready.';
        this.message(p, 'system', p.merge!.detail);
        await this.stage(p, 'ready', 'Source merged · release not published');
      } catch (error) {
        p.merge!.status = 'failed';
        throw error;
      } finally {
        this.signing.end(session);
      }
    });
  }
  async send(id: string, prompt: string, browserSession?: string, reviewPublication = false) {
    this.available();
    const p = this.project(id);
    this.editable(p);
    this.message(p, 'user', prompt);
    delete p.publicationIntent;
    if (
      !reviewPublication &&
      /^(?:(?:okay[,!]?\s+)?let[’']?s\s+)?(?:publish(?:\s+(?:this|it|the napplet))?|prepare(?:\s+(?:this|it))?\s+(?:for\s+)?(?:publication|release))(?:[.!])?$/i.test(
        prompt.trim(),
      )
    ) {
      p.publicationIntent = crypto.randomUUID();
      this.message(
        p,
        'system',
        'Open Publish to prepare your listing, screenshots and clip. You can review everything before signing.',
      );
      await this.save();
      return;
    }
    if (p.publication) delete p.publication.review;
    if (p.publication) delete p.publication.progress;
    if (p.proposal) delete p.proposal.review;
    p.error = undefined;
    p.phase = 'preparing';
    p.stage = 'Resuming your workspace';
    this.launch(p, async (signal) => {
      await this.turn(p, prompt, signal, browserSession);
      if (reviewPublication) {
        signal.throwIfAborted();
        p.publicationIntent = crypto.randomUUID();
        this.message(
          p,
          'system',
          'The maker finished and project checks passed. Publish is open again: prepare the release to capture the updated gameplay recipe, then watch the clip before publishing. No new clip has been captured yet.',
        );
        await this.save();
      }
    });
  }
  async stop(id: string) {
    this.project(id);
    const active = this.active;
    if (active?.id !== id) return;
    active.controller.abort();
    await active.promise;
  }
  async close() {
    if (this.active) await this.stop(this.active.id);
    this.signing.close();
    await Promise.allSettled(this.previewOpening.values());
    for (const preview of this.previews.values()) preview.stop();
    this.previews.clear();
    for (const [timer, stop] of this.retiring) {
      clearTimeout(timer);
      stop();
    }
    this.retiring.clear();
    this.store?.close();
  }
  private command(
    p: Project,
    command: string[],
    signal: AbortSignal,
    operation: string,
    cwd = this.workspace(p.id),
    activity = true,
  ) {
    const options = {
      signal,
      operation,
      includeStderr: activity,
      onLine: activity
        ? (line: string) => {
            if (line.trim()) this.activity(p, line);
          }
        : undefined,
    };
    if (this.options.projectCommand && this.options.soyli.every((v, i) => command[i] === v)) {
      const args = command.slice(this.options.soyli.length);
      if (!['new', 'remix'].includes(args[0]))
        return this.options.projectCommand(cwd, args, options);
      if (!args.includes('--no-install'))
        throw new Error('Hosted scaffolds must not execute setup on the controller.');
    }
    return run(command, { ...options, cwd, env: this.options.env });
  }
  private git(p: Project, args: string[], signal: AbortSignal) {
    return this.command(
      p,
      ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      signal,
      'inspect draft Git history',
      undefined,
      false,
    );
  }
  private async rememberSourceRevision(p: Project) {
    if (!p.source || p.sourceRevision) return;
    try {
      p.sourceRevision = (await readBinding(this.workspace(p.id)))?.project.remix?.revision;
    } catch {
      // Optional preview metadata cannot prevent opening a saved workspace.
      // Source/publication operations still validate the binding and report errors.
    }
  }
  private async prepare(p: Project, signal: AbortSignal) {
    if (p.source) this.options.sourcePolicy?.(p.source);
    const root = join(this.options.directory, 'projects', p.id);
    await mkdir(root, { recursive: true });
    if (!p.initialized) {
      if (await exists(join(this.workspace(p.id), 'napplet.json'))) {
        await this.git(p, ['rev-parse', 'HEAD'], signal);
      } else {
        await this.command(
          p,
          [
            ...this.options.soyli,
            ...(p.source ? ['remix', p.source, 'workspace'] : ['new', 'workspace']),
            ...(p.source && localSource(p.source) ? ['--network', 'local'] : []),
            '--identity',
            'later',
            '--no-install',
          ],
          signal,
          p.source ? 'load exact remix source with soyLI' : 'create soyLI project',
          root,
        );
      }
      p.initialized = true;
      p.baseline = (await this.git(p, ['rev-parse', 'HEAD'], signal)).trim();
      await this.rememberSourceRevision(p);
      await this.save();
    }
    if (!p.setup) {
      await this.stage(p, 'preparing', 'Installing the project’s pinned tools');
      await this.command(p, [...this.options.soyli, 'setup'], signal, 'set up soyLI project');
      p.setup = true;
      await this.save();
    }
  }
  private async protectedFiles(p: Project, signal: AbortSignal) {
    const review = p.merge?.review;
    const mergeBase = p.merge?.status === 'merged' ? review?.commit : review?.candidate;
    if (p.merge && !mergeBase)
      throw new DiagnosticError(
        'STUDIO_MERGE_REVIEW',
        'This saved merge review has no pinned candidate.',
        {
          recovery:
            'Return to the proposal and prepare a fresh review. The upstream was not changed.',
        },
      );
    return (
      await this.git(
        p,
        [
          'diff',
          mergeBase ?? p.baseline ?? 'HEAD',
          '--',
          'package.json',
          '*lock*',
          'vite.config.*',
          'tsconfig*',
          'AGENTS.md',
          'CLAUDE.md',
          'docs',
          'tests',
          '.agents',
          '.claude',
        ],
        signal,
      )
    ).trim();
  }
  private async invoke(p: Project, prompt: string, signal: AbortSignal, browserSession?: string) {
    const connection = this.options.agent.sessionKey
      ? this.options.agent.sessionKey + (browserSession ? ':browser' : '')
      : undefined;
    if (connection && p.connectionKey !== connection) {
      delete p.session;
      p.connectionKey = connection;
      this.activity(
        p,
        'Starting a new agent session for this connection. The project and chat history are preserved.',
      );
    }
    p.turnSteps = 0;
    p.turnLimit = this.options.agent.stepLimit ?? defaultSteps;
    p.turnStartedAt = new Date().toISOString();
    p.budgetReached = false;
    p.timeLimitReached = false;
    delete p.agentFinishReason;
    p.turnTimeLimitMs = inferenceTimeoutMs;
    p.reasoning = [];
    p.reasoningOlder = false;
    p.workshop = [];
    await this.stage(p, 'editing', 'Making your changes');
    let saveError: unknown;
    const emit = (event: AgentEvent) => {
      if (event.type === 'limit') p.budgetReached = true;
      if (event.type === 'session') p.session = event.id;
      if (event.type === 'text')
        this.message(p, 'assistant', this.options.connections?.scrub(event.text) ?? event.text);
      if (event.type === 'reasoning') {
        const text = this.options.connections?.scrub(event.text) ?? event.text;
        const block = {
          id: event.id?.slice(0, 128) || crypto.randomUUID(),
          text: redactDiagnostic(text, reasoningLimits.characters),
          truncated: event.truncated || text.length > reasoningLimits.characters,
        };
        const blocks = p.reasoning!;
        const previous = blocks.findIndex((b) => b.id === block.id);
        if (previous >= 0) blocks[previous] = block;
        else blocks.push(block);
        if (blocks.length > reasoningLimits.blocks) {
          blocks.splice(0, blocks.length - reasoningLimits.blocks);
          p.reasoningOlder = true;
        }
        recordWorkshop(p, { id: block.id, type: 'reasoning' });
      }
      if (event.type === 'activity') this.activity(p, event.text);
      if (event.type === 'usage') {
        p.agentFinishReason = event.finishReason;
        p.estimatedCost += event.cost;
        p.steps++;
        p.turnSteps = (p.turnSteps ?? 0) + 1;
        if (p.turnSteps >= (p.turnLimit ?? defaultSteps)) p.budgetReached = true;
      }
      void this.save().catch((error) => {
        saveError = error;
      });
    };
    await this.options.agent.run(
      this.workspace(p.id),
      (browserSession
        ? taskInstructions.replace(
            nativeCheckInstructions,
            'This turn uses the experimental browser compiler. Use studio_check after your first playable edit and after fixes to get real TypeScript and build diagnostics. Wait for its result before editing again. Repair those errors in this turn, then finish your reply. Do not run soyli, package scripts, host build tools, tests or a dev server. Studio independently checks again at the end. Full soyLI/conformance verification is deferred to Publish. Never claim those full checks passed.',
          )
        : taskInstructions) +
        (connection && !p.session
          ? 'Recent conversation for continuity (the working files are authoritative):\n' +
            p.messages
              .slice(-6)
              .map((m) => `${m.role}: ${m.text.slice(0, 2000)}`)
              .join('\n') +
            '\nCurrent request:\n'
          : '') +
        prompt,
      p.session,
      signal,
      emit,
      {
        browserBuild: !!browserSession,
        check: browserSession
          ? async (checkSignal) => {
              const checking = checkSignal ? AbortSignal.any([signal, checkSignal]) : signal;
              try {
                await this.verify(p, checking, browserSession, false);
                return 'Browser TypeScript and build passed. Full soyLI/conformance checks remain pending. Finish this playable slice; Studio will independently verify and open the preview.';
              } catch (error) {
                checking.throwIfAborted();
                return formatDiagnostic(diagnose(error));
              } finally {
                if (!checking.aborted) await this.stage(p, 'editing', 'Making your changes');
              }
            }
          : undefined,
      },
    );
    if (saveError) throw saveError;
  }
  private async turn(p: Project, prompt: string, signal: AbortSignal, browserSession?: string) {
    await this.prepare(p, signal);
    if (browserSession) {
      if (this.options.projectCommand && !this.options.browserLibraryRoot)
        throw new DiagnosticError(
          'STUDIO_BROWSER_PROFILE',
          'Browser builds are currently a local Studio experiment.',
        );
      await browserBuildInput(this.workspace(p.id), false);
    }
    // Local checkpoint includes prior unfinished work so inspection/recovery is lossless.
    await this.checkpoint(p, 'Before studio turn', signal);
    const invoke = async (request: string) => {
      try {
        await this.invoke(p, request, signal, browserSession);
      } catch (error) {
        signal.throwIfAborted();
        if ((error as DiagnosticError).code !== 'STUDIO_TIMEOUT') throw error;
        p.timeLimitReached = true;
        // A cutoff before any edit must not present the untouched starter as delivery.
        if (!(await this.git(p, ['status', '--porcelain'], signal)).trim()) throw error;
        this.message(
          p,
          'system',
          'The maker reached its 10-minute time limit. Your edits and session are saved. Checking the current files without starting another AI turn.',
        );
        await this.save();
      }
    };
    await invoke(prompt);
    try {
      await this.verify(p, signal, browserSession);
    } catch (error) {
      signal.throwIfAborted();
      if (p.timeLimitReached) throw error;
      if (['STUDIO_GUARDRAIL', 'STUDIO_NO_CHANGES'].includes((error as DiagnosticError).code))
        throw error;
      if (browserSession && (error as DiagnosticError).code !== 'STUDIO_BROWSER_DIAGNOSTICS')
        throw error;
      this.message(p, 'system', 'The independent checks found a problem. Trying one repair pass.');
      await invoke(
        `Repair the failure from the independent verification below. Preserve the requested features. Do not weaken tests or change protected configuration.\n${formatDiagnostic(diagnose(error))}`,
      );
      await this.verify(p, signal, browserSession);
    }
  }
  private async requireImplementation(p: Project, signal: AbortSignal) {
    if (!p.source && p.baseline) {
      // A generated fresh app must differ from the starter itself, not merely
      // its README/listing. This also catches previously mis-promoted starters.
      // Read-only follow-ups to an implemented app and imported remixes remain valid.
      const changed = await this.git(
        p,
        ['diff', '--name-only', p.baseline, '--', 'src', 'index.html'],
        signal,
      );
      const added = await this.git(
        p,
        ['ls-files', '--others', '--exclude-standard', '--', 'src', 'index.html'],
        signal,
      );
      if (!changed.trim() && !added.trim())
        throw new DiagnosticError(
          'STUDIO_NO_CHANGES',
          'The maker did not change the starter app.',
          {
            operation: 'verify maker delivery',
            recovery:
              'Your draft and conversation are saved. Ask the maker to implement the app before creating a preview. No additional inference was started.',
          },
        );
    }
  }
  private async checkpoint(p: Project, label: string, signal: AbortSignal) {
    await this.git(p, ['add', '--all'], signal);
    await this.git(
      p,
      [
        '-c',
        'user.name=Quick Vibe (local)',
        '-c',
        'user.email=quick-vibe@localhost',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        label,
      ],
      signal,
    );
    return (await this.git(p, ['rev-parse', 'HEAD'], signal)).trim();
  }
  private async verify(p: Project, signal: AbortSignal, browserSession?: string, promote = true) {
    await this.stage(p, 'checking', 'Checking the build and sandbox');
    p.checks = [];
    if (await this.protectedFiles(p, signal))
      throw new DiagnosticError(
        'STUDIO_GUARDRAIL',
        p.merge && p.merge.status !== 'merged'
          ? 'Protected source changed after the merge candidate was pinned.'
          : 'The agent changed protected guidance, dependencies or checks.',
        {
          recovery:
            p.merge && p.merge.status !== 'merged'
              ? 'Return to the proposal and prepare a fresh review. The upstream was not changed.'
              : 'Inspect Changes and restore the affected files before continuing. No preview was promoted.',
        },
      );
    await this.requireImplementation(p, signal);
    if (browserSession) {
      if (this.options.projectCommand && !this.options.browserLibraryRoot)
        throw new DiagnosticError(
          'STUDIO_BROWSER_PROFILE',
          'Browser builds are currently a local Studio experiment.',
        );
      const input = await browserBuildInput(
        this.workspace(p.id),
        true,
        this.options.browserLibraryRoot,
      );
      const check: Check = { name: 'Browser TypeScript & build', state: 'running' };
      p.checks.push(check);
      await this.stage(p, 'checking', 'Building in your browser — keep this tab open');
      try {
        const result = await this.browserBuilds.run(browserSession, input, signal);
        signal.throwIfAborted();
        if (result.errorKind === 'worker')
          throw new DiagnosticError(
            'STUDIO_BROWSER_WORKER',
            'The browser compiler could not run.',
            {
              detail: result.error,
              operation: 'browser compiler worker',
              recovery:
                'Retry with the tab open, or turn off Browser builds to use soyLI. No inference was retried automatically.',
            },
          );
        if ((await browserBuildInput(this.workspace(p.id), false)).revision !== input.revision)
          throw new DiagnosticError(
            'STUDIO_BROWSER_STALE',
            'Source changed while the browser was building. Run checks again.',
          );
        if (result.error)
          throw new DiagnosticError(
            'STUDIO_BROWSER_DIAGNOSTICS',
            'The browser found a build or type error.',
            { detail: result.error, operation: 'browser TypeScript/build' },
          );
        await builtConfiguration(new TextEncoder().encode(result.html!));
        check.state = 'passed';
        check.detail = `TypeScript: ${Math.round(result.typecheckMs)} ms; bundle: ${Math.round(result.buildMs)} ms. Source ${input.revision.slice(0, 12)}. Full soyLI/conformance checks run when preparing publication.`;
        if (promote) await this.promotePreview(p, signal, result.html);
        return;
      } catch (error) {
        check.state = 'failed';
        check.detail = formatDiagnostic(diagnose(error));
        throw error;
      } finally {
        await this.save();
      }
    }
    for (const [name, args] of [
      ['Build & project checks', ['run', 'verify']],
      ['soyLI sandbox', ['check']],
      ['Upstream conformance', ['run', 'test:conformance']],
    ] as const) {
      const check: Check = { name, state: 'running' };
      p.checks.push(check);
      p.stage = name;
      if (p.publication?.progress?.step === 0)
        p.publication.progress = { ...p.publication.progress, detail: name, at: Date.now() };
      if (p.proposal?.progress?.step === 0)
        p.proposal.progress = { ...p.proposal.progress, detail: name, at: Date.now() };
      await this.save();
      try {
        let result: string;
        if (name === 'soyLI sandbox' && p.merge) {
          if (this.options.projectCommand && !this.options.publicationCheck)
            throw new DiagnosticError(
              'STUDIO_ISOLATION',
              'The isolated sandbox checker is not configured.',
            );
          const { contents } = await inspectProject(
            this.workspace(p.id),
            'public',
            p.merge.review!.pubkey,
          );
          const input = mergeRuntimeContents(contents);
          const checked = this.options.publicationCheck
            ? await this.options.publicationCheck(input, signal)
            : await checkPublication(input, false, undefined, false, signal);
          result = `Merged runtime checked with ${checked.profile}. Listing media is checked separately when publishing.\n${checked.warnings?.join('\n') ?? 'Interaction and independent-host compatibility not measured by this check.'}`;
        } else result = await this.command(p, [...this.options.soyli, ...args], signal, name);
        check.state = 'passed';
        const skipped = result
          .split('\n')
          .filter((line) => /skip|not measured|not verified|not-run|coverage|warnings/i.test(line))
          .map((line) => redactDiagnostic(line))
          .slice(-12)
          .join('\n');
        check.detail = skipped || 'Completed successfully.';
      } catch (error) {
        check.state = 'failed';
        check.detail = formatDiagnostic(diagnose(error));
        throw error;
      } finally {
        await this.save();
      }
    }
    await this.promotePreview(p, signal);
  }
  private async promotePreview(p: Project, signal: AbortSignal, browserHtml?: string) {
    signal.throwIfAborted();
    const commit = await this.checkpoint(
      p,
      browserHtml === undefined
        ? 'Studio: verified preview'
        : 'Studio: browser preview (full checks pending)',
      signal,
    );
    const destination = join(this.options.directory, 'projects', p.id, 'previews', commit);
    const root = this.workspace(p.id);
    const configBytes = await regularFile(root, 'napplet.json', 16384);
    const config = JSON.parse(textDecoder.decode(configBytes));
    if (config.backend?.modules?.length)
      throw new DiagnosticError(
        'STUDIO_BACKEND',
        'This local studio does not yet supervise dynamic backend modules.',
        {
          recovery:
            'Continue this project with soyli dev in the workspace. Your source is preserved.',
        },
      );
    const contents = new Map<string, Uint8Array>([
      ['napplet.json', configBytes],
      [
        config.entry,
        browserHtml === undefined
          ? await regularFile(root, config.entry, 25 * 1024 * 1024)
          : new TextEncoder().encode(browserHtml),
      ],
    ]);
    if (await exists(join(root, ASSET_LOCK))) {
      contents.set(ASSET_LOCK, await regularFile(root, ASSET_LOCK, 1024 * 1024));
      for (const asset of (await readAssets(root)).assets)
        contents.set(asset.path, await regularFile(root, asset.path, 100 * 1024 * 1024));
    }
    await materializePreview(destination, contents);
    signal.throwIfAborted();
    // Start successfully before switching the saved pointer or stopping the old preview.
    const preview = await this.openPreview(destination);
    if (signal.aborted) {
      preview.stop();
      signal.throwIfAborted();
    }
    const previous = this.previews.get(p.id);
    if (previous) {
      // The UI polls once per second. Keep its old iframe alive until it swaps in
      // the new URL, rather than flashing a disconnected preview during promotion.
      const timer = setTimeout(() => {
        previous.stop();
        this.retiring.delete(timer);
      }, 5000);
      timer.unref();
      this.retiring.set(timer, previous.stop);
    }
    this.previews.set(p.id, { ...preview, revision: commit });
    p.preview = commit;
    p.previewValidation = browserHtml === undefined ? 'full' : 'browser';
    p.previewUrl = preview.url;
    p.checkpoints.push({
      commit,
      at: new Date().toISOString(),
      label: `${browserHtml === undefined ? 'Preview' : 'Browser preview'} ${p.checkpoints.length + 1}`,
    });
    p.error = undefined;
    this.message(
      p,
      'system',
      browserHtml !== undefined
        ? 'Your browser compiled and type-checked this preview. Full soyLI, guidance and conformance checks have not run; Publish runs them before release review. Try the controls and report any problems.'
        : p.budgetReached
          ? 'Build and configured checks passed; skipped and unmeasured cases are listed below. Gameplay, audio coordination and compatibility with other shells still need review. The agent reached its step limit, so some requested work may remain. Play the preview and send a follow-up to continue. No additional inference starts automatically.'
          : 'Build and configured checks passed; skipped and unmeasured cases are listed below. Your preview is ready to try. Check gameplay and sound; compatibility with other shells still needs review. Media capture and publication are separate steps in Publish.',
    );
    if (p.timeLimitReached)
      this.message(
        p,
        'system',
        'The saved code passed these checks and is ready to try. The maker ran out of time, so some requested features may be unfinished. Send a follow-up to continue the same draft.',
      );
    await this.stage(
      p,
      'ready',
      browserHtml === undefined ? 'Ready to play' : 'Browser preview ready · full checks pending',
    );
  }
  private async openPreview(directory: string) {
    if (this.options.preview) return this.options.preview(directory);
    const assets = await previewAssets();
    const html = studioPreviewHtml(assets.html);
    const server = startPreviewServer(
      pathToFileURL(directory + '/'),
      0,
      false,
      { ...assets, html },
      { network: 'public', readOnly: true },
    );
    return {
      url: server.url.href,
      stop: () => {
        void server.stop(true);
      },
    };
  }
  async preview(id: string) {
    const p = this.project(id);
    if (!p.preview) throw new Error('This project has no passing preview yet.');
    const cached = this.previews.get(id);
    if (cached?.revision === p.preview) return cached.url;
    const revision = p.preview;
    const key = `${id}:${revision}`;
    const pending = this.previewOpening.get(key);
    if (pending) return pending;
    const opening: Promise<string> = (async () => {
      const opened = await this.openPreview(
        join(this.options.directory, 'projects', id, 'previews', revision),
      );
      if (p.preview !== revision) {
        opened.stop();
        return this.preview(id);
      }
      this.previews.get(id)?.stop();
      this.previews.set(id, { ...opened, revision });
      p.previewUrl = opened.url;
      return opened.url;
    })().finally(() => this.previewOpening.delete(key));
    this.previewOpening.set(key, opening);
    return opening;
  }
  async check(id: string, browserSession?: string) {
    this.available();
    const p = this.project(id);
    this.editable(p);
    if (p.publication) delete p.publication.review;
    if (p.proposal) delete p.proposal.review;
    p.error = undefined;
    p.phase = 'checking';
    this.launch(p, async (signal) => {
      await this.prepare(p, signal);
      await this.verify(p, signal, browserSession);
    });
  }
  async restore(id: string, commit: string) {
    this.available();
    const p = this.project(id);
    this.editable(p);
    if (p.publication) delete p.publication.review;
    if (p.proposal) delete p.proposal.review;
    if (!p.checkpoints.some((c) => c.commit === commit))
      throw new Error('Choose a saved preview checkpoint.');
    p.error = undefined;
    p.phase = 'checking';
    p.stage = 'Restoring a saved preview';
    this.launch(p, async (signal) => {
      await this.checkpoint(p, 'Backup before restoring preview', signal);
      await this.git(
        p,
        ['restore', '--source', commit, '--staged', '--worktree', '--', '.'],
        signal,
      );
      // Old agent context can describe reverted files; start a new session with the saved chat as context.
      delete p.session;
      this.message(
        p,
        'system',
        `Restored ${commit.slice(0, 8)}. The preceding work is backed up in local Git history.`,
      );
      await this.verify(p, signal);
    });
  }
  private publicationStorage(id: string) {
    return join(this.options.directory, 'projects', id, 'publications');
  }
  async prepareProposal(id: string, session: string, input: unknown) {
    this.available();
    const p = this.project(id),
      pubkey = this.signing.pubkey(session);
    this.editable(p);
    p.proposal ??= {};
    delete p.proposal.review;
    p.error = undefined;
    p.phase = 'preparing_release';
    p.stage = 'Preparing your proposal';
    p.proposal.progress = proposalProgress('check', 'Checking your source, build and sandbox.');
    this.launch(p, async (signal) => {
      p.proposal!.review = await prepareProposal(
        this.workspace(id),
        pubkey,
        input,
        {
          verify: () => this.verify(p, signal),
          checkpoint: () => this.checkpoint(p, 'Studio: proposal candidate', signal),
        },
        signal,
      );
      this.message(
        p,
        'system',
        'Your proposal is ready for review. Confirm its source revision and upstream repository before submitting.',
      );
      p.proposal!.progress = {
        step: 1,
        detail: 'Play the preview and review your changes. Nothing is shared until you confirm.',
        at: Date.now(),
      };
      await this.stage(p, 'ready', 'Proposal ready for review');
    });
  }
  async propose(id: string, session: string, reviewId: string, resume: boolean) {
    this.available();
    const p = this.project(id);
    const review = resume ? p.proposal?.attempt?.review : p.proposal?.review;
    if (!review || review.id !== reviewId)
      throw new Error('Prepare and review this proposal first.');
    if (this.signing.pubkey(session) !== review.pubkey)
      throw new Error('Connect the account shown in this proposal.');
    p.error = undefined;
    p.phase = 'publishing';
    p.stage = 'Submitting your proposal';
    p.proposal!.attempt = { review, status: 'running' };
    p.proposal!.progress = proposalProgress('check', 'Rechecking the reviewed revision.');
    this.launch(p, async (signal) => {
      try {
        const result = await proposeReviewed(
          this.workspace(id),
          review,
          this.signing.accounts(session, signal),
          signal,
          resume,
          'public',
          this.options.publicationCheck &&
            ((contents) => this.options.publicationCheck!(contents, signal)),
          async (stage, detail) => {
            p.proposal!.progress = proposalProgress(stage, detail);
            await this.stage(p, 'publishing', detail);
          },
        );
        p.proposal!.attempt = { review, status: 'proposed', result };
        p.proposal!.progress = {
          step: 6,
          complete: true,
          detail: 'The proposal and its exact source revision were fetched back successfully.',
          at: Date.now(),
        };
        this.message(
          p,
          'system',
          `Proposed changes. Proposal ID: ${result.proposal}. Your changes and playable build are shared; no new napplet listing was created.`,
        );
        await this.stage(p, 'ready', 'Proposal submitted');
      } catch (error) {
        p.proposal!.attempt = {
          review,
          status: 'failed',
          error: diagnose(error, 'submit reviewed proposal'),
        };
        throw error;
      } finally {
        this.signing.end(session);
      }
    });
  }
  async listing(id: string) {
    return listing(this.workspace(id), releaseBaseline(this.project(id)));
  }
  async preparePublication(id: string, session: string, input: Listing) {
    this.available();
    const p = this.project(id);
    this.editable(p);
    const pubkey = this.signing.pubkey(session);
    p.publication ??= {};
    delete p.publication.review;
    delete p.publicationIntent;
    p.publication.preparationFailed = false;
    p.error = undefined;
    p.phase = 'preparing_release';
    p.stage = 'Preparing your release';
    p.publication.progress = {
      step: 0,
      detail: 'Checking the build, sandbox and conformance before preparing release media.',
      hint: 'Your existing playable preview stays available.',
      at: Date.now(),
    };
    this.launch(p, async (signal) => {
      let review;
      try {
        review = await prepareRelease(
          this.workspace(id),
          this.publicationStorage(id),
          pubkey,
          input,
          signal,
          {
            baseline: releaseBaseline(p),
            env: this.options.env,
            capture: this.options.capture,
            verify: (signal) => this.verify(p, signal),
            checkpoint: (label, signal) => this.checkpoint(p, label, signal),
            stage: (label) => {
              p.publication!.progress = {
                step: 1,
                detail: label,
                hint: input.keepMedia
                  ? 'Reusing the previous release media; the updated app still passes its project checks.'
                  : 'Running the saved gameplay inputs against the actual build.',
                at: Date.now(),
              };
              return this.stage(p, 'preparing_release', label);
            },
          },
        );
      } catch (error) {
        p.publication!.preparationFailed = true;
        throw error;
      }
      if (p.merge?.status === 'merged') review.previousCurrent = p.merge.review?.manifest;
      p.publication!.review = review;
      p.publication!.progress = {
        step: 2,
        detail: input.keepMedia
          ? 'Review the update and confirm the existing media still represents it.'
          : 'Review your listing and watch the captured clip.',
        hint: 'Nothing is published until you confirm.',
        at: Date.now(),
      };
      p.title = review.plan.title;
      this.message(
        p,
        'system',
        input.keepMedia
          ? 'Your update is ready. The previous listing media is retained. Check that it still represents this version, then confirm Publish update. Nothing has been uploaded or signed.'
          : 'Your release candidate is ready. Review the listing and actual captures, then confirm Publish. Nothing has been uploaded or signed.',
      );
      await this.stage(p, 'ready', 'Release ready for review');
    });
  }
  async publish(id: string, session: string, reviewId: string, resume: boolean) {
    this.available();
    const p = this.project(id);
    const review = resume ? p.publication?.attempt?.review : p.publication?.review;
    if (!review || review.id !== reviewId)
      throw new Error('Prepare and review this release first.');
    if (this.signing.pubkey(session) !== review.plan.pubkey)
      throw new DiagnosticError(
        'CREATOR_MISMATCH',
        'Connect the publishing account shown in this review.',
      );
    p.publication ??= {};
    if (p.publication.attempt?.status === 'published')
      p.publication.lastPublished = p.publication.attempt.review;
    p.publication.preparationFailed = false;
    const attempt = { review, stage: 'Starting publication', status: 'running' as const };
    p.publication.attempt = attempt;
    p.error = undefined;
    p.phase = 'publishing';
    p.publication.progress = publishProgress('check');
    this.launch(p, async (signal) => {
      let persistenceFailure: unknown;
      try {
        const result = await publishReviewed(
          this.workspace(id),
          review,
          this.signing.accounts(session, signal),
          signal,
          (stage) => {
            p.publication!.attempt!.stage = stage;
            p.stage = `Publishing: ${stage}`;
            p.publication!.progress = publishProgress(stage);
            void this.save().catch((error) => {
              persistenceFailure = error;
            });
          },
          resume,
          this.options.publicationDependencies,
          this.options.publicationCheck &&
            ((contents) => this.options.publicationCheck!(contents, signal)),
        );
        if (persistenceFailure)
          throw new DiagnosticError(
            'STUDIO_SAVE',
            'The publisher finished but studio progress could not be saved.',
            {
              cause: persistenceFailure,
              recovery:
                'The soyLI journal preserves the release. Check disk space and resume to recover its result.',
            },
          );
        p.publication!.attempt = {
          review,
          status: 'published',
          stage: result.websiteReady
            ? 'Available on napplet.soy'
            : 'Published; website availability unconfirmed',
          result,
        };
        p.publication!.progress = publishProgress('website');
        p.publication!.lastPublished = review;
        this.message(
          p,
          'system',
          result.websiteReady
            ? `Published: ${result.url}`
            : `Published to relays: ${result.url}\nWebsite availability is not confirmed. The link may already work; recheck availability without rebuilding or republishing.`,
        );
        await this.stage(p, 'ready', p.publication!.attempt.stage);
      } catch (error) {
        p.publication!.attempt = {
          review,
          status: 'failed',
          stage: 'Publication needs attention',
          error: diagnose(error, 'publish reviewed release'),
        };
        throw error;
      } finally {
        this.signing.end(session);
      }
    });
  }
  async refreshPublication(id: string) {
    this.available();
    const p = this.project(id),
      attempt = p.publication?.attempt;
    if (!attempt?.result) throw new Error('No published release to check.');
    p.error = undefined;
    p.phase = 'publishing';
    this.launch(p, async (signal) => {
      await this.stage(p, 'publishing', 'Checking website availability');
      p.publication!.progress = publishProgress('website');
      const result = await publicationStatus(this.workspace(id), 'public', {
        creator: attempt.review.plan.pubkey,
        refresh: true,
        waitForWebsite: false,
        signal,
      });
      if (result.status === 'not_started' || result.jobId !== attempt.result!.jobId)
        throw new DiagnosticError(
          'REVIEW_CHANGED',
          'The saved publication changed outside the studio.',
          {
            recovery: 'Inspect soyli status in the workspace before preparing another release.',
          },
        );
      attempt.result = result;
      attempt.stage = result.websiteReady
        ? 'Available on napplet.soy'
        : 'Published; website availability unconfirmed';
      await this.stage(p, 'ready', attempt.stage);
    });
  }
  async publicationMedia(id: string, reviewId: string, name: string) {
    const p = this.project(id);
    const review = [p.publication?.review, p.publication?.attempt?.review].find(
      (r) => r?.id === reviewId,
    );
    if (!review) throw new Error('Unknown release review.');
    return reviewedMedia(this.publicationStorage(id), review, name);
  }
  async fixPublication(id: string) {
    const p = this.project(id);
    const error = p.error;
    if (!error || !p.publication?.preparationFailed)
      throw new Error(
        'Publication and signer errors should be retried in Publish. For source changes, describe the change in chat.',
      );
    await this.send(
      id,
      `Fix this release preparation failure, preserving the intended behavior. Do not publish or change accounts.\n${formatDiagnostic(error)}`,
    );
  }
  async browserGit(id: string) {
    if (this.options.projectCommand)
      throw new Error('Browser Git is currently a local Studio experiment.');
    return this.exclusive(async () => {
      const project = this.project(id);
      if (!project.initialized) throw new Error('Wait for Studio to prepare this draft first.');
      return exportBrowserGit(this.workspace(id));
    });
  }
  async files(id: string) {
    const p = this.project(id);
    if (!p.initialized) return [];
    const paths = (
      await this.git(
        p,
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        AbortSignal.timeout(5000),
      )
    )
      .split('\0')
      .filter(Boolean);
    return [...new Set(paths)]
      .filter(
        (path) =>
          !path.startsWith('.') &&
          !path
            .split('/')
            .some((part) => /^(node_modules|\.env.*|\.git|\.napplet-space)$/.test(part)),
      )
      .sort()
      .slice(0, 1024);
  }
  async file(id: string, path: string) {
    if (!(await this.files(id)).includes(path)) throw new Error('Choose a project source file.');
    const bytes = await regularFile(this.workspace(id), path, 256 * 1024);
    checkSource(path, bytes);
    if (bytes.includes(0)) throw new Error('Binary file; inspect it in the workspace.');
    return textDecoder.decode(bytes);
  }
  async diff(id: string) {
    const p = this.project(id);
    if (!p.baseline) return 'The workspace is being prepared.';
    const signal = AbortSignal.timeout(5000);
    const diff = await this.git(
      p,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        p.baseline,
        '--',
        '.',
        ':!.napplet-space',
        ':!.env*',
      ],
      signal,
    );
    const untracked = await this.git(p, ['ls-files', '--others', '--exclude-standard'], signal);
    return diff + (untracked.trim() ? '\nNew files (inspect in Files):\n' + untracked : '');
  }
}
