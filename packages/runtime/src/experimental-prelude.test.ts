import { test, expect } from 'bun:test';
import { runInNewContext } from 'node:vm';

// Exercise the real patched bundle, not a second application-owned transport.
async function fixture() {
  const sent: any[] = [],
    deltas: any[] = [];
  let receive!: (message: unknown) => void;
  class Port {
    onmessage?: (event: MessageEvent) => void;
    postMessage(m: any) {
      sent.push(m);
    }
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      receive = (m) => this.port1.onmessage?.(new MessageEvent('message', { data: m }));
    }
  }
  const window: any = {
    parent: { postMessage: (_m: unknown, _origin: string, _ports: unknown[]) => {} },
  };
  const shim = await Bun.file(
    Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir),
  ).text();
  runInNewContext(`${shim}\nNappletShimPrelude.install({domains:['llm']});`, {
    window,
    MessageChannel: Channel,
    MessagePort: Port,
    MessageEvent,
    TextDecoder,
    TextEncoder,
    crypto,
    setTimeout,
    clearTimeout,
  });
  return { api: window.napplet.llm, sent, deltas, reply: (m: unknown) => receive(m) };
}

test('LLM-C01/C09/C18: private-port binding delivers interleaved blocks and ignores late/foreign results', async () => {
  const f = await fixture();
  const selected = f.api.select({ tools: true });
  f.reply({ type: 'llm.select.result', id: f.sent[0].id, model: { handle: 'fixture' } });
  expect(await selected).toEqual({ handle: 'fixture' });
  const pending = f.api.generate(
    { handle: 'fixture' },
    { onDelta: (d: unknown) => f.deltas.push(d) },
  );
  const id = pending.requestId;
  const blocks = [
    { event: 'start', block: 'thinking', blockIndex: 0 },
    { event: 'start', block: 'toolCall', blockIndex: 1, toolCallId: 'call1', name: 'lookup' },
    { event: 'delta', block: 'thinking', blockIndex: 0, text: 'Checking.' },
    { event: 'delta', block: 'toolCall', blockIndex: 1, text: '{}' },
    { event: 'end', block: 'toolCall', blockIndex: 1 },
    { event: 'end', block: 'thinking', blockIndex: 0 },
  ];
  f.reply({ type: 'llm.delta', requestId: 'foreign', sequence: 0, ...blocks[0] });
  blocks.forEach((b, sequence) => f.reply({ type: 'llm.delta', requestId: id, sequence, ...b }));
  const result = {
    content: [
      { type: 'thinking', text: 'Checking.' },
      { type: 'toolCall', toolCallId: 'call1', name: 'lookup', arguments: {} },
    ],
    finish: 'toolUse',
  };
  f.reply({ type: 'llm.generate.result', id, result });
  expect(await pending).toEqual(result);
  f.reply({ type: 'llm.delta', requestId: id, sequence: 6, ...blocks[0] });
  expect(f.deltas).toEqual(blocks.map((b, sequence) => ({ requestId: id, sequence, ...b })));
});

test('LLM binding does not dispatch pre-aborted work, cancels an active call and suppresses out-of-order deltas', async () => {
  const f = await fixture(),
    controller = new AbortController();
  const pending = f.api.generate(
    {},
    { signal: controller.signal, onDelta: (d: unknown) => f.deltas.push(d) },
  );
  const failure = pending.catch((e: unknown) => e);
  const id = pending.requestId;
  f.reply({
    type: 'llm.delta',
    requestId: id,
    sequence: 1,
    event: 'start',
    block: 'text',
    blockIndex: 0,
  });
  f.reply({
    type: 'llm.delta',
    requestId: id,
    sequence: 0,
    event: 'start',
    block: 'text',
    blockIndex: 0,
  });
  expect(f.deltas).toEqual([]);
  controller.abort();
  expect(f.sent[1]).toMatchObject({ type: 'llm.cancel', requestId: id });
  f.reply({ type: 'llm.cancel.result', id: f.sent[1].id, cancelled: true });
  f.reply({ type: 'llm.generate.result', id, error: { code: 'cancelled', message: 'Cancelled' } });
  expect(await failure).toMatchObject({ code: 'cancelled' });
  await expect(f.api.generate({}, { signal: controller.signal })).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect(f.sent).toHaveLength(2);
});
