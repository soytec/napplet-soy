import {
  WEBMCP_PROFILE,
  descriptor,
  json,
  validate,
  ToolError,
  type Json,
  type ToolDescriptor,
  type Consumer,
} from './contract';
import { redactDiagnostic } from '../../../diagnostics/src';
type Sender = (message: Record<string, unknown>) => void;
type Entry = { id: string; name: string; descriptor: ToolDescriptor };
type Call = {
  id: string;
  tool: Entry;
  args: Json;
  consumer: Consumer;
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  timer?: ReturnType<typeof setTimeout>;
  cancelled?: boolean;
  progressAt?: number;
};
export class NappletTools {
  readonly instance = crypto.randomUUID().replaceAll('-', '');
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private grants = new Set<Consumer>();
  private active?: Call;
  private queue: Call[] = [];
  private closed = false;
  private sequence = 0;
  private changes = 0;
  private window = Date.now();
  private message = 'Tools are private until you allow access.';
  constructor(
    readonly title: string,
    readonly identity: string,
    private send: Sender,
    private timeoutMs = 120000,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    for (const listener of this.listeners) listener();
  }
  private emit(message: Record<string, unknown>) {
    this.send({ profile: WEBMCP_PROFILE, ...message });
  }
  snapshot() {
    return {
      instance: this.instance,
      title: this.title,
      identity: this.identity,
      closed: this.closed,
      grants: [...this.grants],
      tools: [...this.entries.values()].map((e) => structuredClone(e)),
      message: this.message,
      active: this.active
        ? {
            name: this.active.tool.descriptor.name,
            id: this.active.id,
            cancelled: !!this.active.cancelled,
          }
        : null,
      queued: this.queue.length,
    };
  }
  grant(consumer: Consumer, allowed: boolean) {
    if (this.closed) return;
    if (allowed) this.grants.add(consumer);
    else {
      this.grants.delete(consumer);
      this.cancelConsumer(consumer, 'permission-denied', 'Agent access revoked.');
    }
    this.message = allowed
      ? 'Agent access enabled for this document.'
      : 'Agent access revoked. Completed edits are not undone.';
    this.emit({ type: 'webmcp.changed', exposed: this.grants.size > 0 });
    this.changed();
  }
  handle(message: Record<string, unknown>) {
    if (this.closed || message.profile !== WEBMCP_PROFILE) return;
    const id = typeof message.id === 'string' && message.id.length <= 128 ? message.id : undefined;
    try {
      // Validate before interpreting even unsolicited progress/completion envelopes.
      json(message);
      if (message.type === 'webmcp.complete' || message.type === 'webmcp.progress') {
        const call = this.active;
        if (!call || message.callId !== call.id || message.registrationId !== call.tool.id) return;
        if (message.type === 'webmcp.progress') {
          if (
            !call.cancelled &&
            typeof message.text === 'string' &&
            Date.now() - (call.progressAt ?? 0) >= 100
          ) {
            call.progressAt = Date.now();
            this.message = redactDiagnostic(message.text, 240);
            this.changed();
          }
          return;
        }
        this.active = undefined;
        call.cleanup();
        if (!call.cancelled) {
          try {
            if (message.error) {
              const e = message.error as Record<string, unknown>;
              throw new ToolError(
                typeof e.code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(e.code)
                  ? e.code
                  : 'execution-error',
                redactDiagnostic(typeof e.message === 'string' ? e.message : 'Tool failed.', 800),
              );
            }
            const result = json(message.result);
            if (call.tool.descriptor.outputSchema)
              validate(call.tool.descriptor.outputSchema, result, 'result');
            call.resolve(result);
            this.message = `${call.tool.descriptor.name}: finished.`;
          } catch (error) {
            call.reject(error as Error);
            this.message = `${call.tool.descriptor.name}: failed. Inspect the tool result.`;
          }
        } else
          this.message =
            'Stopped. Inspect the document before retrying; completed edits may remain.';
        this.changed();
        this.pump();
        return;
      }
      if (!id) return;
      if (Date.now() - this.window > 60000) {
        this.window = Date.now();
        this.changes = 0;
      }
      if (++this.changes > 120)
        throw new ToolError('quota-exceeded', 'Too many registration changes. Wait a minute.');
      if (message.type === 'webmcp.register') {
        const d = descriptor(message.tool);
        if (this.entries.size >= 64)
          throw new ToolError('quota-exceeded', 'This document already has 64 tools.');
        if ([...this.entries.values()].some((e) => e.descriptor.name === d.name))
          throw new ToolError(
            'duplicate-tool',
            'Unregister the existing tool before replacing it.',
          );
        if (
          [...this.entries.values()].reduce(
            (sum, e) => sum + new TextEncoder().encode(JSON.stringify(e.descriptor)).length,
            new TextEncoder().encode(JSON.stringify(d)).length,
          ) >
          256 * 1024
        )
          throw new ToolError('quota-exceeded', 'Tool descriptors exceed the session budget.');
        // New tool semantics always require fresh approval, including replacements.
        if (this.grants.size) {
          this.grant('shell', false);
          this.grant('browser', false);
        }
        const registrationId = crypto.randomUUID(),
          e = { id: registrationId, name: `nap_${this.instance}_${d.name}`, descriptor: d };
        this.entries.set(registrationId, e);
        this.emit({
          type: 'webmcp.register.result',
          id,
          registrationId,
          name: e.name,
          exposed: false,
        });
        this.changed();
        return;
      }
      if (message.type === 'webmcp.unregister') {
        if (typeof message.registrationId !== 'string' || !this.entries.has(message.registrationId))
          throw new ToolError('unknown-tool', 'Tool is no longer registered.');
        this.entries.delete(message.registrationId);
        this.cancelWhere(
          (c) => c.tool.id === message.registrationId,
          'unknown-tool',
          'Tool withdrawn.',
        );
      } else if (message.type === 'webmcp.reset') {
        this.grant('shell', false);
        this.grant('browser', false);
        this.message = 'Document replaced. Allow agent access again to use its tools.';
      } else throw new ToolError('unsupported', 'Unsupported experimental tool operation.');
      this.emit({ type: `${message.type}.result`, id, ok: true });
      this.changed();
    } catch (error) {
      const e =
        error instanceof ToolError
          ? error
          : new ToolError('invalid-request', 'Invalid tool request.');
      if (id)
        this.emit({
          type: `${message.type}.result`,
          id,
          error: { code: e.code, message: e.message },
        });
      else if (
        this.active &&
        message.callId === this.active.id &&
        message.registrationId === this.active.tool.id
      ) {
        if (message.type === 'webmcp.complete') {
          const call = this.active;
          this.active = undefined;
          call.cleanup();
          if (!call.cancelled) call.reject(e);
          this.message = 'Tool returned invalid data. Inspect the document before continuing.';
          this.changed();
          this.pump();
        } else this.cancelWhere((c) => c === this.active, e.code, e.message);
      }
    }
  }
  invoke(
    registrationId: string,
    args: unknown,
    consumer: Consumer,
    signal?: AbortSignal,
  ): Promise<Json> {
    try {
      if (this.closed || !this.grants.has(consumer))
        throw new ToolError('permission-denied', 'Allow agent access to this document first.');
      if (signal?.aborted) throw new ToolError('cancelled', 'Tool call cancelled before dispatch.');
      if (this.active?.cancelled)
        throw new ToolError(
          'busy',
          'A stopped call has not settled. Inspect or reload the document; do not automatically retry it.',
        );
      const tool = this.entries.get(registrationId);
      if (!tool) throw new ToolError('unknown-tool', 'Tool is no longer registered.');
      const input = json(args);
      validate(tool.descriptor.inputSchema, input);
      if (this.queue.length >= 8)
        throw new ToolError('busy', 'The document already has eight queued calls.');
      return new Promise((resolve, reject) => {
        const call: Call = {
          id: crypto.randomUUID(),
          tool,
          args: input,
          consumer,
          resolve,
          reject,
          cleanup: () => {
            clearTimeout(call.timer);
            signal?.removeEventListener('abort', cancel);
          },
        };
        const cancel = () =>
          this.cancelWhere(
            (c) => c === call,
            'cancelled',
            'Tool call stopped; effects after dispatch may be unknown.',
          );
        signal?.addEventListener('abort', cancel, { once: true });
        this.queue.push(call);
        this.changed();
        this.pump();
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  private pump() {
    if (this.active || this.closed) return;
    const call = this.queue.shift();
    if (!call) return;
    if (!this.grants.has(call.consumer) || !this.entries.has(call.tool.id)) {
      call.cleanup();
      call.reject(new ToolError('permission-denied', 'Tool access was withdrawn.'));
      this.pump();
      return;
    }
    this.active = call;
    this.message = `Running ${call.tool.descriptor.name}…`;
    this.changed();
    call.timer = setTimeout(
      () =>
        this.cancelWhere(
          (c) => c === call,
          'timeout',
          'Tool timed out after dispatch. Inspect the document before retrying; its effect is unknown.',
        ),
      this.timeoutMs,
    );
    this.emit({
      type: 'webmcp.invoke',
      callId: call.id,
      registrationId: call.tool.id,
      sequence: ++this.sequence,
      arguments: call.args,
    });
  }
  private cancelWhere(match: (call: Call) => boolean, code: string, message: string) {
    this.queue = this.queue.filter((c) => {
      if (!match(c)) return true;
      c.cleanup();
      c.reject(new ToolError(code, message));
      return false;
    });
    const call = this.active;
    if (call && match(call) && !call.cancelled) {
      call.cancelled = true;
      call.cleanup();
      call.reject(new ToolError(code, message));
      this.emit({ type: 'webmcp.cancel', callId: call.id, registrationId: call.tool.id });
      // The cancelled callback may still be running. Hold the document until it acknowledges completion.
      for (const queued of this.queue) {
        queued.cleanup();
        queued.reject(
          new ToolError(
            'busy',
            'An earlier call was stopped. Inspect the document before continuing.',
          ),
        );
      }
      this.queue = [];
    }
    this.message = message;
    this.changed();
  }
  private cancelConsumer(consumer: Consumer, code: string, message: string) {
    this.cancelWhere((c) => c.consumer === consumer, code, message);
  }
  stop() {
    this.cancelWhere(
      () => true,
      'cancelled',
      'Stopped. Inspect the document before retrying; completed changes may remain.',
    );
  }
  close() {
    if (this.closed) return;
    this.stop();
    this.closed = true;
    this.entries.clear();
    this.grants.clear();
    this.active = undefined;
    this.message = 'Document closed.';
    this.changed();
    this.listeners.clear();
  }
}
