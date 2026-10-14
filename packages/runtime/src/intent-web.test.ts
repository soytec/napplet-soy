import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { publicNapplet, type PublicNapplet } from '../../backend/src/public-model';
import type { SignedEvent } from '../../protocol/src';
import { createWebIntentWorkspace } from '../../../apps/web/src/lib/intent-workspace-state';
import { intentCatalogId } from './intent-session';

const key = new Uint8Array(32).fill(75);
async function model(
  options: { kind?: number; time?: number; tags?: string[][]; name?: string } = {},
) {
  const manifest = finalizeEvent(
    {
      kind: options.kind ?? 35129,
      created_at: options.time ?? 100,
      content: 'An intent handler',
      tags: [
        ...(options.kind === 15129 ? [] : [['d', options.name ?? 'handler']]),
        ['x', 'a'.repeat(64)],
        ['server', 'https://blossom.example'],
        ...(options.tags ?? [
          ['z', 'test'],
          ['i', 'napplet:test/open'],
        ]),
      ],
    },
    key,
  );
  const result = await publicNapplet(manifest);
  if (result.availability !== 'host-required') result.availability = 'ready';
  return result;
}
const invoke = (payload: unknown, reuse = true, archetype = 'test') => ({
  type: 'intent.invoke',
  request: {
    archetype,
    action: 'open',
    convention: `napplet:${archetype}/open`,
    payload,
    behavior: { reuse },
  },
});
function fixture(initial: PublicNapplet[]) {
  let catalog = initial;
  const reads: SignedEvent[][] = [];
  const ui = createWebIntentWorkspace(async (_author, _search, known) => {
    reads.push(known ?? []);
    return catalog;
  });
  const { workspace } = ui;
  workspace.register({ id: 'source', contracts: [] });
  const source = workspace.attach('source', () => {});
  return {
    ...ui,
    source,
    reads,
    setCatalog: (value: PublicNapplet[]) => {
      catalog = value;
    },
    close: () => {
      source.close();
      for (const entry of catalog) workspace.dropPending(intentCatalogId(entry.manifest));
      const launch = ui.intentUi().launch;
      if (launch) ui.closeIntentLaunch(launch.key);
    },
  };
}

test('web replacement of the same handler preserves its accepted delivery and startup', async () => {
  const first = await model();
  const ui = fixture([first]);
  const id = intentCatalogId(first.manifest);
  const delivered: Record<string, unknown>[] = [];
  try {
    expect((await ui.source.handle(invoke('first'))).result).toMatchObject({ ok: true });
    await Bun.sleep(10);
    const oldKey = ui.intentUi().launch!.key;
    const oldTarget = ui.workspace.attach(id, (event) => delivered.push(event));
    oldTarget.ready();
    expect(delivered.filter((event) => event.type === 'intent.deliver')).toHaveLength(1);
    expect((await ui.source.handle(invoke('second', false))).result).toMatchObject({ ok: true });
    await Bun.sleep(10);
    expect(ui.intentUi().launch!.key).toBeGreaterThan(oldKey);
    expect(ui.intentUi().error).toBeUndefined();
    // Stale React cleanup cannot cancel the replacement surface.
    ui.closeIntentLaunch(oldKey);
    oldTarget.close();
    expect(delivered.filter((event) => event.type === 'intent.deliver')).toHaveLength(1);
    const nextTarget = ui.workspace.attach(id, (event) => delivered.push(event));
    nextTarget.ready();
    nextTarget.ready();
    expect(
      delivered.filter((event) => event.type === 'intent.deliver').map((event) => event.delivery),
    ).toEqual([
      {
        sender: 'source',
        archetype: 'test',
        action: 'open',
        convention: 'napplet:test/open',
        payload: 'first',
      },
      {
        sender: 'source',
        archetype: 'test',
        action: 'open',
        convention: 'napplet:test/open',
        payload: 'second',
      },
    ]);
    nextTarget.close();
  } finally {
    ui.close();
  }
});

test('web replacement by a different handler cancels only the old pending target', async () => {
  const first = await model();
  const next = await model({
    name: 'other',
    tags: [
      ['z', 'other'],
      ['i', 'napplet:other/open'],
    ],
  });
  const ui = fixture([first, next]);
  try {
    expect((await ui.source.handle(invoke('first'))).result).toMatchObject({ ok: true });
    await Bun.sleep(10);
    expect((await ui.source.handle(invoke('second', false, 'other'))).result).toMatchObject({
      ok: true,
    });
    await Bun.sleep(10);
    expect(ui.intentUi().error).toContain('previous pending handler request was cancelled');
    const oldEvents: Record<string, unknown>[] = [],
      newEvents: Record<string, unknown>[] = [];
    const oldTarget = ui.workspace.attach(intentCatalogId(first.manifest), (event) =>
      oldEvents.push(event),
    );
    const newTarget = ui.workspace.attach(intentCatalogId(next.manifest), (event) =>
      newEvents.push(event),
    );
    oldTarget.ready();
    newTarget.ready();
    expect(oldEvents.filter((event) => event.type === 'intent.deliver')).toHaveLength(0);
    expect(newEvents.filter((event) => event.type === 'intent.deliver')).toHaveLength(1);
    oldTarget.close();
    newTarget.close();
  } finally {
    ui.close();
  }
});

for (const kind of [35129, 15129]) {
  for (const change of ['removed', 'role', 'unsupported'] as const) {
    test(`web discovery reconciles ${kind} ${change} contracts before matching and rejects stale resurrection`, async () => {
      const original = await model({ kind });
      const tags =
        change === 'removed'
          ? [['z', 'test']]
          : change === 'role'
            ? [
                ['z', 'other'],
                ['i', 'napplet:other/open'],
              ]
            : [
                ['z', 'test'],
                ['i', 'napplet:test/open'],
                ['R', 'unsupported-domain'],
              ];
      const replacement = await model({ kind, time: 101, tags });
      const ui = fixture([original]);
      const read = () => ui.source.handle({ type: 'intent.available', archetype: 'test' });
      try {
        expect((await read()).availability).toMatchObject({ available: true });
        ui.setCatalog([replacement]);
        expect((await read()).availability).toMatchObject({ available: false });
        expect(ui.reads.at(-1)?.map((event) => event.id)).toContain(original.manifest.id);
        // Partial reads are not deletion, and old replies cannot restore old contracts.
        ui.setCatalog([]);
        await read();
        ui.setCatalog([original]);
        expect((await read()).availability).toMatchObject({ available: false });
        expect((await ui.source.handle(invoke('stale'))).result).toMatchObject({ ok: false });
        expect(ui.intentUi().launch).toBeUndefined();
        if (change === 'role') {
          expect((await ui.source.handle(invoke('new role', true, 'other'))).result).toMatchObject({
            ok: true,
          });
          await Bun.sleep(10);
          expect(ui.intentUi().launch?.napplet.manifest.id).toBe(replacement.manifest.id);
        }
      } finally {
        ui.close();
      }
    });
  }
}

test('empty and invalid catalog observations retain a verified handler', async () => {
  const original = await model();
  const ui = fixture([original]);
  const read = () => ui.source.handle({ type: 'intent.available', archetype: 'test' });
  try {
    expect((await read()).availability).toMatchObject({ available: true });
    ui.setCatalog([]);
    expect((await read()).availability).toMatchObject({ available: true });
    const newer = await model({ time: 101, tags: [] });
    ui.setCatalog([{ ...newer, manifest: { ...newer.manifest, sig: '0'.repeat(128) } }]);
    expect((await read()).availability).toMatchObject({ available: true });
  } finally {
    ui.close();
  }
});

test('same-timestamp revisions use Nostr event-id ordering and unavailable observations can recover', async () => {
  const a = await model();
  const b = await model({
    tags: [
      ['z', 'other'],
      ['i', 'napplet:other/open'],
    ],
  });
  const [winner, loser] = [a, b].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  const role = winner.manifest.tags.find((tag) => tag[0] === 'z')![1];
  const ui = fixture([loser, winner]);
  const read = () => ui.source.handle({ type: 'intent.handlers' });
  const id = intentCatalogId(winner.manifest);
  try {
    await read();
    expect(ui.workspace.entry(id)?.manifest?.id).toBe(winner.manifest.id);
    ui.setCatalog([loser]);
    await read();
    expect(ui.workspace.entry(id)?.manifest?.id).toBe(winner.manifest.id);
    ui.setCatalog([{ ...winner, availability: 'unavailable' }]);
    await read();
    expect(ui.workspace.available(role).available).toBe(false);
    ui.setCatalog([loser]);
    await read();
    expect(ui.workspace.available(role).available).toBe(false);
    ui.setCatalog([winner]);
    await read();
    expect(ui.workspace.available(role).available).toBe(true);
    expect(ui.workspace.entry(id)?.manifest?.id).toBe(winner.manifest.id);
  } finally {
    ui.close();
  }
});

test('discovery cannot downgrade a newer manifest installed by the player', async () => {
  const original = await model();
  const replacement = await model({ time: 101, tags: [] });
  const ui = fixture([original]);
  const read = () => ui.source.handle({ type: 'intent.available', archetype: 'test' });
  try {
    await read();
    await ui.workspace.install(replacement.manifest, replacement.title);
    expect((await read()).availability).toMatchObject({ available: false });
    expect(ui.workspace.entry(intentCatalogId(original.manifest))?.manifest?.id).toBe(
      replacement.manifest.id,
    );
  } finally {
    ui.close();
  }
});
