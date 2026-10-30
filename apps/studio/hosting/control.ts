import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NostrServerTransport, EncryptionMode } from '@contextvm/sdk';
import { DiagnosticError, diagnose } from '../../../packages/diagnostics/src';
import type { StudioSurface } from '../surface';
import { dispatchStudio } from '../dispatch';
import { StudioTransfers } from './transfers';
import { StudioRequests } from './requests';
import type { HostedPreviews } from './previews';

export const studioCall = z
  .object({
    requestId: z.uuid(),
    createdAt: z.number().int(),
    path: z.string().min(1).max(4096),
    body: z.unknown().optional(),
    upload: z.uuid().optional(),
  })
  .strict();

/** Authentication selects the private controller. No request may choose its owner,
 * disk path, worker image or executable. All UI operations share local validation. */
export class OwnerStudios {
  private stopped = false;
  private owners = new Map<string, Promise<StudioSurface>>();
  private closing = new Map<string, Promise<void>>();
  private limits = new Map<string, { since: number; count: number }>();
  readonly transfers: StudioTransfers;
  readonly requests: StudioRequests;
  constructor(
    private admitted: () => readonly string[],
    private open: (owner: string) => Promise<StudioSurface>,
    private options: {
      resolveOwner?: (actor: string) => string;
      transfers?: StudioTransfers;
      requests?: StudioRequests;
      previews?: HostedPreviews;
      beforeMutation?: (owner: string) => Promise<void>;
    } = {},
  ) {
    this.transfers = options.transfers ?? new StudioTransfers();
    this.requests = options.requests ?? new StudioRequests();
  }
  async call(actor: string, value: unknown) {
    if (this.stopped)
      throw new DiagnosticError('STUDIO_CLOSED', 'Studio is restarting. Reconnect shortly.');
    const account = this.options.resolveOwner ? this.options.resolveOwner(actor) : actor;
    if (
      !/^[a-f0-9]{64}$/.test(account) ||
      !(this.admitted().includes('*') || this.admitted().includes(account))
    )
      throw new DiagnosticError('STUDIO_ACCESS', 'This account is not admitted to hosted Studio.');
    const now = Date.now();
    for (const [key, value] of this.limits) if (now - value.since >= 60000) this.limits.delete(key);
    const limit = this.limits.get(account) ?? { since: now, count: 0 };
    if (++limit.count > 240)
      throw new DiagnosticError('STUDIO_RATE', 'Wait a minute before retrying.');
    this.limits.set(account, limit);
    const request = studioCall.parse(value);
    if (Buffer.byteLength(JSON.stringify(request)) > 16000)
      throw new DiagnosticError(
        'STUDIO_REQUEST',
        'Use the private transfer channel for large inputs.',
      );
    await this.closing.get(account);
    if (this.stopped || (this.options.resolveOwner && this.options.resolveOwner(actor) !== account))
      throw new DiagnosticError('STUDIO_AUTH', 'Reconnect Studio.');
    let owner = this.owners.get(account);
    if (!owner) {
      if (this.owners.size >= 64)
        throw new DiagnosticError(
          'STUDIO_CAPACITY',
          'This host is at its workspace capacity. Try later.',
        );
      owner = Promise.resolve()
        .then(() => this.open('nostr:' + account))
        .catch((error) => {
          this.owners.delete(account);
          throw error;
        });
      this.owners.set(account, owner);
    }
    const execute = async () => {
      try {
        const studio = await owner!;
        if (this.options.resolveOwner && this.options.resolveOwner(actor) !== account)
          throw new DiagnosticError('STUDIO_AUTH', 'Reconnect Studio.');
        if (
          (request.body !== undefined || request.upload) &&
          !/^(?:signers(?:\/|$)|browser-builds\/|connections\/(?:remove|test|models|llm-start|llm-read|llm-cancel)|projects\/[^/]+\/(?:stop|refresh-publication))/.test(
            request.path,
          )
        )
          await this.options.beforeMutation?.(account);
        let body = request.body;
        let response: Response;
        if (request.upload) {
          const transfer = this.transfers.get(account, request.upload);
          if (/^projects\/[a-f0-9-]{36}\/assets$/.test(request.path)) {
            response = Response.json(
              await studio.importAsset(request.path.split('/')[1], body, transfer.bytes),
            );
          } else {
            if (
              body !== undefined ||
              transfer.bytes.length >
                (/^browser-builds\/[a-f0-9-]{36}$/.test(request.path)
                  ? 9 * 1024 * 1024
                  : /^signers\/[a-f0-9-]{36}$/.test(request.path)
                    ? 128 * 1024
                    : request.path === 'connections/llm-start'
                      ? 8 * 1024 * 1024
                      : 16384)
            )
              throw new DiagnosticError('STUDIO_REQUEST', 'Unsupported uploaded operation.');
            body = JSON.parse(new TextDecoder().decode(transfer.bytes));
            if (request.path === 'signers' && (body as { pubkey?: string })?.pubkey !== account)
              throw new DiagnosticError(
                'STUDIO_ACCOUNT',
                'Publication must use the selected shell account.',
              );
            response = await dispatchStudio(studio, request.path, body);
          }
          this.transfers.remove(account, request.upload);
        } else {
          if (
            request.path === 'signers' &&
            body !== undefined &&
            (body as { pubkey?: string })?.pubkey !== account
          )
            throw new DiagnosticError(
              'STUDIO_ACCOUNT',
              'Publication must use the selected shell account.',
            );
          response = await dispatchStudio(studio, request.path, body);
        }
        if (
          this.options.previews &&
          /^projects\/[a-f0-9-]{36}\/preview$/.test(request.path) &&
          response.ok
        ) {
          const preview = await response.json();
          response = Response.json({
            url: this.options.previews.grant(account, actor, preview.url),
          });
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const mime = response.headers.get('content-type') ?? 'application/octet-stream';
        if (bytes.length > 10000 || !mime.startsWith('application/json'))
          return { status: response.status, transfer: this.transfers.put(account, bytes, mime) };
        return { status: response.status, value: JSON.parse(new TextDecoder().decode(bytes)) };
      } catch (error) {
        const d = diagnose(error, 'Studio control');
        return {
          status: 400,
          value: {
            error: d.code.startsWith('STUDIO_')
              ? d.message
              : 'The workspace operation failed. Inspect the draft status before retrying.',
            code: d.code,
          },
        };
      }
    };
    if (request.body === undefined && !request.upload) return execute();
    const hash = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify({ path: request.path, body: request.body, upload: request.upload }))
      .digest('hex');
    return this.requests.run(account, request.requestId, request.createdAt, hash, execute);
  }
  async deactivate(account: string) {
    const existing = this.closing.get(account);
    if (existing) return existing;
    const owner = this.owners.get(account);
    if (!owner) return;
    const closing = (async () => {
      try {
        await (await owner).close();
      } finally {
        if (this.owners.get(account) === owner) this.owners.delete(account);
        this.closing.delete(account);
      }
    })();
    this.closing.set(account, closing);
    return closing;
  }
  async close() {
    this.stopped = true;
    await Promise.allSettled([...this.owners.values()].map(async (s) => (await s).close()));
    await this.requests.drain();
    this.requests.close();
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
      maxSessions: 256,
      oversizedTransfer: { enabled: false },
      logLevel: 'silent',
    }),
  );
  return server;
}
