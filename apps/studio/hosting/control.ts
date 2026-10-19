import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NostrServerTransport, EncryptionMode } from '@contextvm/sdk';
import { DiagnosticError, diagnose } from '../../../packages/diagnostics/src';
import type { StudioSurface } from '../surface';
import { validSource } from '../navigation';

const id = z.uuid(),
  empty = z.object({}).strict();
const project = z.object({ id }).strict();
const operations = {
  list: empty,
  state: project,
  create: z
    .object({
      title: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1).max(10000),
      source: z.string().max(4096).refine(validSource).optional(),
    })
    .strict(),
  send: project.extend({ prompt: z.string().trim().min(1).max(10000) }).strict(),
  check: project,
  stop: project,
  files: project,
  file: project.extend({ path: z.string().max(1024) }).strict(),
  diff: project,
} as const;
type Operation = keyof typeof operations;
export const studioCall = z
  .object({
    requestId: id,
    operation: z.enum(Object.keys(operations) as [Operation, ...Operation[]]),
    input: z.unknown(),
  })
  .strict();

/** CVM caller identity chooses the entire private controller. Project IDs alone
 * never grant access. The factory must supply an isolated worker, not the local runner. */
export class OwnerStudios {
  private owners = new Map<string, Promise<StudioSurface>>();
  private replies = new Map<string, { hash: string; response: Promise<unknown> }>();
  private writer?: string;
  private mutation: Promise<void> = Promise.resolve();
  private limits = new Map<string, { since: number; count: number }>();
  constructor(
    private admitted: () => readonly string[],
    private open: (owner: string) => Promise<StudioSurface>,
  ) {}
  async call(actor: string, value: unknown) {
    if (!/^[a-f0-9]{64}$/.test(actor) || !this.admitted().includes(actor))
      throw new DiagnosticError('STUDIO_ACCESS', 'This account is not admitted to hosted Studio.');
    const now = Date.now();
    for (const [key, value] of this.limits) if (now - value.since >= 60000) this.limits.delete(key);
    const limit = this.limits.get(actor) ?? { since: now, count: 0 };
    if (++limit.count > 120)
      throw new DiagnosticError('STUDIO_RATE', 'Wait a minute before retrying.');
    this.limits.set(actor, limit);
    const request = studioCall.parse(value),
      input: any = operations[request.operation].parse(request.input);
    const mutable = ['create', 'send', 'check', 'stop'].includes(request.operation);
    const key = actor + ':' + request.requestId;
    const hash = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify({ operation: request.operation, input }))
      .digest('hex');
    const previous = mutable ? this.replies.get(key) : undefined;
    if (previous) {
      if (previous.hash !== hash)
        throw new DiagnosticError('STUDIO_REPLAY', 'Request ID already used for different input.');
      return previous.response;
    }
    if (mutable && this.replies.size >= 512)
      throw new DiagnosticError(
        'STUDIO_CAPACITY',
        'The controller reached its request journal capacity. An operator must restart it after active jobs finish.',
      );
    let owner = this.owners.get(actor);
    if (!owner) {
      if (this.owners.size >= 8)
        throw new DiagnosticError(
          'STUDIO_CAPACITY',
          'This beta host is at its active workspace capacity.',
        );
      owner = Promise.resolve()
        .then(() => this.open('nostr:' + actor))
        .catch((error) => {
          this.owners.delete(actor);
          throw error;
        });
      this.owners.set(actor, owner);
    }
    const response = (async () => {
      const studio = await owner!;
      const mutation = ['create', 'send', 'check'].includes(request.operation);
      let release: (() => void) | undefined;
      if (mutation) {
        const before = this.mutation;
        this.mutation = new Promise((resolve) => {
          release = resolve;
        });
        await before;
      }
      try {
        if (mutation) {
          if (this.writer && (await (await this.owners.get(this.writer)!).state()).busy)
            throw new DiagnosticError(
              'STUDIO_BUSY',
              'The host is finishing another build. Retry shortly.',
            );
          this.writer = actor;
        }
        let result: unknown;
        switch (request.operation) {
          case 'list':
            result = (await studio.state()).projects.map((p) => ({
              id: p.id,
              title: p.title,
              phase: p.phase,
              updatedAt: p.updatedAt,
            }));
            break;
          case 'state': {
            const state = await studio.state(),
              p = state.projects.find((p) => p.id === input.id);
            if (!p) throw new DiagnosticError('STUDIO_PROJECT', 'Project not found.');
            result = {
              project: {
                ...p,
                messages: p.messages.slice(-8),
                reasoning: p.reasoning?.slice(-2).map((r) => ({ ...r, text: r.text.slice(-8000) })),
                activity: p.activity.slice(-30),
              },
              busy: state.busy === p.id,
            };
            break;
          }
          case 'create':
            result = { id: await studio.create(input.title, input.prompt, input.source) };
            break;
          case 'send':
            await studio.send(input.id, input.prompt);
            result = { accepted: true };
            break;
          case 'check':
            await studio.check(input.id);
            result = { accepted: true };
            break;
          case 'stop':
            await studio.stop(input.id);
            result = { stopped: true };
            break;
          case 'files':
            result = await studio.files(input.id);
            break;
          case 'file':
            result = await studio.file(input.id, input.path);
            break;
          case 'diff':
            result = await studio.diff(input.id);
            break;
        }
        if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024)
          throw new DiagnosticError(
            'STUDIO_RESPONSE',
            'This result exceeds the control-channel limit. Fetch a smaller file or use the artifact channel.',
          );
        return result;
      } finally {
        try {
          if (mutation && this.writer === actor && !(await studio.state()).busy)
            this.writer = undefined;
        } finally {
          release?.();
        }
      }
    })();
    // Keep failed/ambiguous outcomes too; never repeat a spending request under the same ID.
    if (mutable) this.replies.set(key, { hash, response });
    return response;
  }
  async close() {
    await Promise.allSettled([...this.owners.values()].map(async (s) => (await s).close()));
  }
}

export function studioControlServer(registry: OwnerStudios) {
  const server = new McpServer({ name: 'soy-studio-control', version: '0.1.0' });
  server.registerTool(
    'soy_studio_call',
    {
      description:
        'Private creation workspace operations for the signed caller. Mutations require a unique request ID; retry that ID only with identical input.',
      inputSchema: studioCall,
    },
    async (args, extra) => {
      try {
        const actor = extra._meta?.clientPubkey;
        if (typeof actor !== 'string')
          throw new DiagnosticError('STUDIO_AUTH', 'Authenticated ContextVM transport required.');
        const value = await registry.call(actor, args);
        return { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        const diagnostic = diagnose(error, 'Studio control');
        // Private state/provider errors never become relay-visible error dumps.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: diagnostic.code,
                message: diagnostic.code.startsWith('STUDIO_')
                  ? diagnostic.message
                  : 'The workspace operation failed. Inspect the draft status before retrying.',
              }),
            },
          ],
        };
      }
    },
  );
  return server;
}

export async function connectStudioControl(
  registry: OwnerStudios,
  options: Pick<ConstructorParameters<typeof NostrServerTransport>[0], 'signer' | 'relayHandler'>,
) {
  const server = studioControlServer(registry);
  await server.connect(
    new NostrServerTransport({
      ...options,
      encryptionMode: EncryptionMode.REQUIRED,
      injectClientPubkey: true,
      isAnnouncedServer: false,
      publishRelayList: false,
      bootstrapRelayUrls: [],
      maxSessions: 64,
      oversizedTransfer: { enabled: false },
      logLevel: 'silent',
    }),
  );
  return server;
}
