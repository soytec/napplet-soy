import { identityAddress, type SignedEvent } from './index';
import { legacySnapshotAddress, manifestIdentity } from './manifest';
export type SocialScope = {
  key: string;
  address: string | null;
  kind: number;
  author: string;
  eventId: string;
  eventKind: number;
};
export function oneTag(e: SignedEvent, key: string) {
  const tags = e.tags.filter((t) => t[0] === key);
  return tags.length === 1 ? tags[0][1] : undefined;
}
export function lastTag(e: SignedEvent, key: string) {
  return e.tags.filter((t) => t[0] === key).at(-1)?.[1];
}
/** Call with a verified napplet manifest. A foreign snapshot cannot claim its author's thread. */
export function socialScope(e: SignedEvent): SocialScope {
  const identity = manifestIdentity(e);
  const address = identity ? identityAddress(identity) : legacySnapshotAddress(e);
  return {
    key: address ?? e.id,
    address,
    kind: address ? Number(address.split(':')[0]) : e.kind,
    author: e.pubkey,
    eventId: e.id,
    eventKind: e.kind,
  };
}
export function commentTemplate(
  scope: SocialScope,
  content: string,
  parent?: SignedEvent,
  now = Math.floor(Date.now() / 1000),
) {
  const root = [
    [scope.address ? 'A' : 'E', scope.key],
    ['K', String(scope.kind)],
    ['P', scope.author],
  ];
  const tags = parent
    ? [...root, ['e', parent.id, '', parent.pubkey], ['k', '1111'], ['p', parent.pubkey]]
    : [
        ...root,
        [scope.address ? 'a' : 'e', scope.key],
        ['k', String(scope.kind)],
        ['p', scope.author],
        ...(scope.address && scope.kind === scope.eventKind ? [['e', scope.eventId]] : []),
      ];
  return { kind: 1111, created_at: now, content: content.trim(), tags };
}
export function likeTemplate(
  scope: SocialScope,
  manifest: SignedEvent,
  now = Math.floor(Date.now() / 1000),
) {
  return {
    kind: 7,
    created_at: now,
    content: '+',
    tags: [
      ['e', manifest.id],
      ['p', manifest.pubkey],
      ['k', String(manifest.kind)],
      ...(scope.address ? [['a', scope.address]] : []),
    ],
  };
}
/** An exact contribution/comment never inherits the containing napplet's recipient or address. */
export function eventScope(event: SignedEvent): SocialScope {
  return {
    key: event.id,
    address: null,
    kind: event.kind,
    author: event.pubkey,
    eventId: event.id,
    eventKind: event.kind,
  };
}
export const commentScope = eventScope;
export function commentLikeTemplate(comment: SignedEvent, now = Math.floor(Date.now() / 1000)) {
  return likeTemplate(commentScope(comment), comment, now);
}
export function validCommentLike(
  event: SignedEvent,
  scope: SocialScope,
  events: Map<string, SignedEvent>,
) {
  const comment = events.get(lastTag(event, 'e') ?? '');
  return (
    !!comment &&
    validComment(comment, scope, events) &&
    validLike(event, commentScope(comment), new Map([[comment.id, comment]]))
  );
}
export function deletionTemplate(events: SignedEvent[], now = Math.floor(Date.now() / 1000)) {
  return {
    kind: 5,
    created_at: Math.max(now, ...events.map((e) => e.created_at)),
    content: '',
    tags: [...events.map((e) => ['e', e.id]), ...new Set(events.map((e) => e.kind))].map((t) =>
      typeof t === 'number' ? ['k', String(t)] : t,
    ),
  };
}
export function rootComment(e: SignedEvent, scope: SocialScope) {
  return (
    e.kind === 1111 &&
    e.content.trim().length > 0 &&
    e.content.length <= 4000 &&
    oneTag(e, scope.address ? 'A' : 'E') === scope.key &&
    !e.tags.some((t) => t[0] === (scope.address ? 'E' : 'A')) &&
    oneTag(e, 'K') === String(scope.kind) &&
    e.tags.filter((t) => t[0] === 'P').length <= 1 &&
    (!oneTag(e, 'P') || oneTag(e, 'P') === scope.author)
  );
}
function tagsParentAuthor(e: SignedEvent, author: string) {
  // NIP-22 also uses p tags for profile mentions. The parent reference fixes
  // which author must be present; other mentions do not change that binding.
  return e.tags.some((t) => t[0] === 'p' && t[1] === author);
}
export function validComment(e: SignedEvent, scope: SocialScope, events: Map<string, SignedEvent>) {
  if (!rootComment(e, scope)) return false;
  const k = oneTag(e, 'k');
  if (k === String(scope.kind)) {
    if (oneTag(e, scope.address ? 'a' : 'e') !== scope.key || !tagsParentAuthor(e, scope.author))
      return false;
    if (scope.address && e.tags.some((t) => t[0] === 'e')) {
      const id = oneTag(e, 'e');
      if (!id || !/^[a-f0-9]{64}$/.test(id)) return false;
      const revision = events.get(id);
      // The signed root/parent address is sufficient when relays have pruned
      // a replaced revision. A known contradictory target is still rejected.
      return !revision || (revision.kind === scope.kind && socialScope(revision).key === scope.key);
    }
    return true;
  }
  if (k !== '1111') return false;
  const parent = events.get(oneTag(e, 'e') ?? '');
  return (
    !!parent &&
    rootComment(parent, scope) &&
    tagsParentAuthor(e, parent.pubkey) &&
    e.id !== parent.id &&
    parent.created_at <= e.created_at
  );
}
export function targetManifest(
  e: SignedEvent,
  scope: SocialScope,
  manifests: Map<string, SignedEvent>,
) {
  const target = manifests.get(lastTag(e, 'e') ?? '');
  if (!target) {
    // NIP-25/57 explicitly bind replaceable targets by address. Old named/root
    // events need not remain on relays. Never infer snapshot identity from a
    // missing event or its ancestry: those require the verified target.
    return (
      !!scope.address &&
      /^[a-f0-9]{64}$/.test(lastTag(e, 'e') ?? '') &&
      oneTag(e, 'a') === scope.address &&
      e.tags.filter((t) => t[0] === 'k').length <= 1 &&
      (!oneTag(e, 'k') || oneTag(e, 'k') === String(scope.kind)) &&
      lastTag(e, 'p') === scope.author
    );
  }
  return (
    !!target &&
    (scope.address === null
      ? target.kind === scope.kind && target.id === scope.key && target.pubkey === scope.author
      : [35129, 15129, 5129].includes(target.kind) && socialScope(target).key === scope.key) &&
    e.tags.filter((t) => t[0] === 'a').length <= 1 &&
    e.tags.filter((t) => t[0] === 'k').length <= 1 &&
    (!oneTag(e, 'a') || oneTag(e, 'a') === scope.address) &&
    (!oneTag(e, 'k') || oneTag(e, 'k') === String(target.kind))
  );
}
export function validLike(e: SignedEvent, scope: SocialScope, manifests: Map<string, SignedEvent>) {
  return (
    e.kind === 7 &&
    (e.content === '+' || e.content === '') &&
    lastTag(e, 'p') === scope.author &&
    targetManifest(e, scope, manifests)
  );
}
export function socialView(
  scope: SocialScope,
  raw: SignedEvent[],
  manifests: Map<string, SignedEvent>,
) {
  const events = new Map([...manifests, ...raw.map((e): [string, SignedEvent] => [e.id, e])]);
  const deleted = new Set<string>();
  for (const d of raw.filter((e) => e.kind === 5))
    for (const tag of d.tags.filter((t) => t[0] === 'e')) {
      const target = events.get(tag[1]);
      if (
        target &&
        target.pubkey === d.pubkey &&
        target.created_at <= d.created_at &&
        [7, 1111].includes(target.kind)
      )
        deleted.add(target.id);
    }
  const comments = raw
    .filter((e) => validComment(e, scope, events))
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const likes = raw.filter((e) => !deleted.has(e.id) && validLike(e, scope, manifests));
  const commentLikes = raw.filter((e) => !deleted.has(e.id) && validCommentLike(e, scope, events));
  return {
    comments: comments.map((e) => ({
      ...e,
      likes: commentLikes.filter((like) => lastTag(like, 'e') === e.id),
      likeCount: new Set(
        commentLikes.filter((like) => lastTag(like, 'e') === e.id).map((like) => like.pubkey),
      ).size,
      content: deleted.has(e.id) ? '' : e.content,
      deleted: deleted.has(e.id),
      parent: oneTag(e, 'k') === '1111' ? (oneTag(e, 'e') ?? null) : null,
    })),
    likes,
    likeCount: new Set(likes.map((e) => e.pubkey)).size,
  };
}
