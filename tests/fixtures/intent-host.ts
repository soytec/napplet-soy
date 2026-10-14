import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { createFrameSession, frameSessionPrelude } from '../../packages/runtime/src/frame-session';
import { nappletPrelude, SHELL_PRELUDE } from '../../packages/runtime/src/prelude';
import { preparePlayback } from '../../packages/runtime/src/playback';
import { verifiedDocument, PLAYER_SANDBOX } from '../../packages/runtime/src';
import { attachNappletHost } from '../../packages/runtime/src/host';
import { IntentWorkspace } from '../../packages/runtime/src/intent-session';

declare const NAPPLET_TEST_SHIM: string;
const key = generateSecretKey();
const entries = new Map<
  string,
  { manifest: ReturnType<typeof finalizeEvent>; bytes: Uint8Array; hash: string }
>();
const frames = new Map<
  string,
  {
    frame: HTMLIFrameElement;
    session: ReturnType<typeof createFrameSession>;
    host: ReturnType<typeof attachNappletHost>;
  }
>();
const wire: string[] = [];
const deferred = new Set<string>();
const workspace = new IntentWorkspace({
  choose: async (availability) => availability.candidates[0]?.id ?? null,
  launch: async (entry) => {
    await create(entry.id, true, deferred.has(entry.id));
  },
  startupTimeoutMs: 5000,
  failed: (_entry, error) => {
    throw error;
  },
});
window.addEventListener('message', (event) => {
  if ([...frames.values()].some(({ frame }) => frame.contentWindow === event.source))
    wire.push(event.data?.type ?? 'unknown');
});
async function install(name: string, receiver = false, required = false) {
  const html = `<h1>${name}</h1><script>
    window.deliveries = [];
    window.receive = () => window.napplet.intent.onDelivery(value => window.deliveries.push(value));
  </script>`;
  const bytes = new TextEncoder().encode(html),
    hash = await sha256(bytes);
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Independent readiness fixture',
      tags: [
        ['d', name],
        ['x', hash],
        ...(receiver
          ? [
              ['z', 'profile'],
              ['i', 'napplet:profile/open', 'pubkey'],
            ]
          : []),
        ...(required ? [['R', 'intent']] : []),
      ],
    },
    key,
  );
  const entry = await workspace.install(manifest, name);
  entries.set(entry.id, { manifest, bytes, hash });
  return entry.id;
}
async function create(id: string, supported: boolean, deferReady = false) {
  const entry = entries.get(id)!;
  const session = createFrameSession(supported);
  const release = await preparePlayback(entry.manifest, entry.hash, session.domains);
  let prelude = nappletPrelude(NAPPLET_TEST_SHIM, undefined, session).replace(SHELL_PRELUDE, '');
  if (deferReady) prelude = prelude.replace(frameSessionPrelude(session), '');
  const html = await verifiedDocument(entry.bytes, entry.hash, prelude);
  const frame = document.createElement('iframe');
  frame.id = id;
  frame.title = entry.manifest.tags.find((tag) => tag[0] === 'd')![1];
  frame.sandbox.value = PLAYER_SANDBOX;
  frame.srcdoc = html;
  document.body.append(frame);
  const host = attachNappletHost({
    session,
    frame,
    identity: release.hostIdentity,
    manifestId: entry.manifest.id,
    relays: [],
    pubkey: null,
    prompt: () => {},
    files: () => {},
    ...(supported ? { intent: { workspace, catalogId: id } } : {}),
  });
  frames.set(id, { frame, host, session });
  return id;
}
Object.assign(window, {
  intentHarness: {
    install,
    create,
    defer: (id: string) => deferred.add(id),
    wire,
    close: (id: string) => {
      frames.get(id)?.host.close();
      frames.get(id)?.frame.remove();
      frames.delete(id);
    },
    arm: (id: string) => frameSessionPrelude(frames.get(id)!.session),
    session: (id: string) => frames.get(id)!.session.id,
  },
});
