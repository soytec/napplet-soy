import { test, expect } from 'bun:test';
import { EXPERIMENTAL_PRELUDE } from './experimental-prelude';

test('LLM-C01/C09: injected binding correlates results, rejects foreign/late/out-of-order deltas and handles abort', async () => {
  let receive!: (e: unknown) => void;
  const sent: any[] = [],
    deltas: string[] = [];
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  const window: any = {
    parent,
    napplet: {},
    addEventListener: (_: string, fn: typeof receive) => (receive = fn),
  };
  new Function('window', 'crypto', EXPERIMENTAL_PRELUDE)(window, crypto);
  const reply = (data: unknown, source: unknown = parent) => receive({ source, data });
  const selected = window.napplet.llm.select({ json: true });
  reply({ type: 'llm.select.result', id: sent[0].id, model: { handle: 'fixture' } });
  expect(await selected).toEqual({ handle: 'fixture' });
  const controller = new AbortController();
  const pending = window.napplet.llm.generate(
    { handle: 'fixture' },
    { onDelta: (t: string) => deltas.push(t), signal: controller.signal },
  );
  const id = sent[1].id;
  reply({ type: 'llm.delta', requestId: id, sequence: 0, text: 'foreign' }, {});
  reply({ type: 'llm.delta', requestId: id, sequence: 1, text: 'gap' });
  reply({ type: 'llm.delta', requestId: id, sequence: 0, text: 'hello' });
  reply({ type: 'llm.delta', requestId: id, sequence: 0, text: 'duplicate' });
  reply({ type: 'llm.generate.result', id, result: { text: 'hello world', finish: 'stop' } });
  expect(await pending).toEqual({ text: 'hello world', finish: 'stop' });
  controller.abort();
  reply({ type: 'llm.delta', requestId: id, sequence: 1, text: 'late' });
  expect(deltas).toEqual(['hello']);
  expect(sent).toHaveLength(2);
  const stop = new AbortController();
  const cancelled = window.napplet.llm.generate({}, { signal: stop.signal });
  const rejected = cancelled.catch((error: unknown) => error);
  const cancelledId = sent[2].id;
  stop.abort();
  expect(await rejected).toMatchObject({ code: 'cancelled' });
  expect(sent[3]).toMatchObject({ type: 'llm.cancel', requestId: cancelledId });
  reply({ type: 'llm.cancel.result', id: sent[3].id, cancelled: true });
  reply({
    type: 'llm.generate.result',
    id: cancelledId,
    result: { text: 'ignored', finish: 'stop' },
  });
  const before = sent.length;
  await expect(window.napplet.llm.generate({}, { signal: stop.signal })).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect(sent).toHaveLength(before);
});
