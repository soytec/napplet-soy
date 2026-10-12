import { readSocial, publishSocial, socialSnapshot } from '@/lib/protocol-social';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Heart, MessageCircle, Reply, Trash2, RefreshCw, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { ActionButton } from './action-button';
import { CreatorLink } from './creator-link';
import { RichComment } from './rich-comment';
import { useNostr } from './nostr-provider';
import { useLocation } from '@tanstack/react-router';
import { ZapButton } from './zap-button';
import { CardShare } from './card-share';
import { shareMedia } from '../../../../packages/client/src/share-note';
import { manifestTopics } from '../../../../packages/protocol/src/topics';
import { manifestDescription } from '../../../../packages/protocol/src/manifest';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
import { jsonResponse, signForAccount, type Template } from '@/lib/community-client';
import {
  commentTemplate,
  socialScope,
  commentScope,
  likeTemplate,
  commentLikeTemplate,
  deletionTemplate,
  type SocialScope,
} from '../../../../packages/protocol/src/social';
import type { SignedEvent } from '../../../../packages/protocol/src';
import { resolveZapEndpoint, zapTotals } from '../../../../packages/client/src/zaps';
import { protocolClient } from '@/lib/network';
import { readLikeState } from '../../../../packages/client/src/social';
import { useZapTotals, zapTotalsStore } from '@/lib/zap-totals';
import { communityMode } from '@/lib/community-mode';
type Comment = SignedEvent & {
  deleted: boolean;
  parent: string | null;
  likes: SignedEvent[];
  likeCount: number;
};
type SocialData = {
  scope: SocialScope;
  manifest: SignedEvent;
  relays: string[];
  comments: Comment[];
  likes: SignedEvent[];
  likeCount: number;
  profiles: Record<string, { name: string }>;
  lastActions: Record<string, number>;
};
const short = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
/** One conversation owner supplies the page toolbar and discussion without duplicate requests. */
export function NappletSocial({
  reference,
  title,
  manifest,
  relays,
  presentation,
  children,
}: {
  reference: string;
  title: string;
  manifest: SignedEvent;
  relays: string[];
  presentation?: Pick<PublicNapplet, 'description' | 'metadata' | 'video' | 'preview'>;
  children: (slots: {
    actions: ReactNode;
    feedback: ReactNode;
    discussion: ReactNode;
  }) => ReactNode;
}) {
  const hash = useLocation({ select: (location) => location.hash });
  const { pubkey, connect, ready, community } = useNostr();
  const scopeKey = socialScope(manifest).key;
  const nappletZaps = useZapTotals(scopeKey);
  const currentKey = useRef(pubkey);
  currentKey.current = pubkey;
  const [rawData, setRawData] = useState<SocialData | null>(null),
    [dataModeKey, setDataModeKey] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [content, setContent] = useState(''),
    [parent, setParent] = useState<Comment | null>(null),
    [pending, setPending] = useState<SignedEvent | null>(null);
  const modeKey = `${community.enabled}:${community.savedAt}`;
  const data = dataModeKey === modeKey ? rawData : null;
  const setData = (value: SocialData | null) => {
    const current = communityMode.getSnapshot();
    setDataModeKey(`${current.enabled}:${current.savedAt}`);
    setRawData(value);
  };
  const [action, setAction] = useState('');
  const [phase, setPhase] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState('');
  const busyRef = useRef(false);
  const activeRefresh = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = async (signal?: AbortSignal) => {
    activeRefresh.current?.abort();
    const controller = new AbortController();
    activeRefresh.current = controller;
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    setRefreshing(true);
    setRefreshError('');
    try {
      const value = await readSocial(manifest, relays, signal, (value) => {
        if (!signal?.aborted) setData(value);
      });
      if (!signal?.aborted) setData(value);
      if (!signal?.aborted) {
        const targets = [manifest, ...value.comments.filter((c) => !c.deleted)];
        const endpoints = new Map<string, ReturnType<typeof resolveZapEndpoint>>();
        await Promise.all(
          targets.map(async (target) => {
            // Comment counts are hydrated by their own scope, not added to the creator.
            const targetScope = target.kind === 1111 ? commentScope(target) : value.scope;
            const events =
              target.kind !== 1111
                ? value.events
                : value.events.filter(
                    (e) =>
                      e.kind !== 9735 || e.tags.some((t) => t[0] === 'e' && t[1] === target.id),
                  );
            if (!events.some((e) => e.kind === 9735)) {
              zapTotalsStore.observe(targetScope.key, []);
              return;
            }
            try {
              if (!endpoints.has(target.pubkey))
                endpoints.set(
                  target.pubkey,
                  resolveZapEndpoint(target.pubkey, value.events, undefined, signal),
                );
              const totals = await zapTotals(
                { ...value, scope: targetScope, manifest: target },
                { ...value, events },
                await endpoints.get(target.pubkey)!,
                target.kind === 1111 ? new Map([[target.id, target]]) : value.manifests,
              );
              if (!signal?.aborted) zapTotalsStore.observe(targetScope.key, totals.receipts);
            } catch {
              /* Existing counts survive temporary provider failures. */
            }
          }),
        );
      }
    } catch (error) {
      if (!signal?.aborted) setRefreshError((error as Error).message);
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    busyRef.current = false;
    setBusy(false);
    setPhase('');
    setData(null);
    setPending(null);
    setParent(null);
    setContent('');
    setMessage('');
    setAction('');
    setSuccess('');
    void refresh(controller.signal);
    return () => {
      generation.current++;
      controller.abort();
      activeRefresh.current?.abort();
    };
    // Display references can acquire new relay hints without changing signed identity.
  }, [scopeKey, manifest.id]);
  useEffect(() => {
    void socialSnapshot(manifest, relays).then((value) => setData(value));
  }, [community.enabled, community.savedAt, community.ready, manifest.id]);
  useEffect(() => {
    if (hash !== 'comments') return;
    const target = document.getElementById(pubkey ? 'napplet-comment' : 'comment-connect');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [hash, pubkey]);
  const deliver = async (event: SignedEvent, turn: number) => {
    if (turn !== generation.current) return;
    if (currentKey.current !== event.pubkey)
      throw new Error('Connect the signing account again before sending.');
    setPhase('Publishing…');
    await publishSocial(event, relays);
    if (turn !== generation.current) return;
    const snapshot = await socialSnapshot(manifest, relays);
    if (turn !== generation.current) return;
    setData(snapshot);
    setPending(null);
    if (event.kind === 1111) {
      setContent('');
      setParent(null);
      setSuccess('Posted');
    }
    // A failed read after acknowledgement must never offer to publish again.
    void refresh();
  };
  const write = async (input: Template | (() => Promise<Template>), id: string) => {
    if (!pubkey || busyRef.current || (pending && action !== id)) return;
    const turn = generation.current;
    busyRef.current = true;
    setAction(id);
    setBusy(true);
    setMessage('');
    setSuccess('');
    try {
      if (pending) await deliver(pending, turn);
      else {
        setPhase('Preparing…');
        const template = typeof input === 'function' ? await input() : input;
        if (turn !== generation.current) return;
        if (currentKey.current !== pubkey) throw new Error('Your connected account changed.');
        setPhase('Signing…');
        const event = await signForAccount(pubkey, {
          ...template,
          created_at: Math.max(template.created_at, (data?.lastActions[pubkey] ?? 0) + 1),
        });
        if (turn !== generation.current) return;
        if (currentKey.current !== pubkey) throw new Error('Your connected account changed.');
        setPending(event);
        await deliver(event, turn);
      }
    } catch (error) {
      if (turn === generation.current) setMessage((error as Error).message);
    } finally {
      if (turn === generation.current) {
        busyRef.current = false;
        setBusy(false);
        setPhase('');
      }
    }
  };
  const toggleLike = () =>
    write(async () => {
      const state = await readLikeState(protocolClient(), manifest, pubkey!, relays);
      const own = state.likes.filter((e) => e.pubkey === pubkey);
      const template = own.length ? deletionTemplate(own) : likeTemplate(state.scope, manifest);
      template.created_at = Math.max(template.created_at, state.lastAction + 1);
      return template;
    }, 'napplet-like');
  const control = (id: string, retryLabel: string) => ({
    working: action === id && busy ? phase : undefined,
    error: action === id ? message : undefined,
    retryLabel,
    disabled: !pubkey || busy || (!!pending && (action !== id || pending.pubkey !== pubkey)),
    onCancel:
      action === id && pending
        ? () => {
            setPending(null);
            setMessage('');
            setSuccess('');
            void refresh();
          }
        : undefined,
  });
  const ownLikes = data?.likes.filter((e) => e.pubkey === pubkey) ?? [];
  const actions = (
    <div className="napplet-social-actions" role="group" aria-label={`Social actions for ${title}`}>
      <ActionButton
        data-tone="coral"
        {...control('napplet-like', ownLikes.length ? 'Retry unlike' : 'Retry like')}
        compact
        icon={<Heart size={17} fill={ownLikes.length ? 'currentColor' : 'none'} />}
        variant="ghost"
        size="sm"
        aria-label={`${ownLikes.length ? 'Unlike' : 'Like'} ${title}: ${data?.likeCount ?? 'unknown'} likes${!pubkey ? ' — sign in required' : ''}`}
        title={
          !pubkey
            ? 'Sign in to like'
            : !data
              ? 'Social actions are unavailable until the conversation loads'
              : ownLikes.length
                ? 'Remove your like'
                : 'Like this napplet'
        }
        aria-pressed={!!ownLikes.length}
        disabled={!data || control('napplet-like', '').disabled}
        onClick={() => void toggleLike()}
      >
        {data?.likeCount.toLocaleString() ?? '—'}
      </ActionButton>
      <CardShare
        title={title}
        path={reference.startsWith('naddr1') ? `/n/${reference}` : `/r/${reference}`}
        note={() => ({
          title,
          description: presentation?.description ?? manifestDescription(manifest),
          topics: manifestTopics(manifest),
          media: shareMedia({ ...presentation, manifest }),
        })}
      />
      <ZapButton
        reference={reference}
        data={data ?? { manifest, scope: socialScope(manifest), relays }}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            disabled={!ready}
            data-tone="gold"
            data-effect="zap"
            title="Zap this napplet"
            aria-label={`Zap ${title}`}
          >
            <Zap size={17} />
            {!community.enabled && nappletZaps && (
              <span>
                {nappletZaps.zapCount} · {(nappletZaps.msats / 1000).toLocaleString()} sats
              </span>
            )}
          </Button>
        }
      />
    </div>
  );
  const discussion = (
    <section id="comments" className="social-panel" aria-labelledby="conversation-title">
      <div className="social-heading">
        <div>
          <span className="eyebrow">PASS IT AROUND</span>
          <h2 id="conversation-title">Small creation, open conversation.</h2>
        </div>
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={15} />}
          working={refreshing ? 'Refreshing…' : undefined}
          error={refreshError}
          retryLabel="Retry refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </ActionButton>
      </div>
      {data && (
        <>
          <div className="social-actions">
            <ActionButton
              data-tone="coral"
              {...control('napplet-like', ownLikes.length ? 'Retry unlike' : 'Retry like')}
              compact
              icon={<Heart size={16} fill={ownLikes.length ? 'currentColor' : 'none'} />}
              variant={ownLikes.length ? 'default' : 'outline'}
              aria-pressed={!!ownLikes.length}
              onClick={() => void toggleLike()}
            >
              {data.likeCount} {data.likeCount === 1 ? 'like' : 'likes'}
            </ActionButton>
            <ZapButton data={data} reference={reference} />
            <span className="comment-count">
              <MessageCircle size={16} />
              {data.comments.filter((e) => !e.deleted).length}{' '}
              {data.comments.filter((e) => !e.deleted).length === 1 ? 'comment' : 'comments'}
            </span>
          </div>
        </>
      )}
      {pubkey ? (
        <form
          className="community-form comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            void write(
              commentTemplate(socialScope(manifest), content, parent ?? undefined),
              'comment',
            );
          }}
        >
          {parent && (
            <div className="reply-context">
              Replying to {data?.profiles[parent.pubkey]?.name ?? short(parent.pubkey)}
              <Button
                size="xs"
                variant="ghost"
                type="button"
                disabled={busy || !!pending}
                onClick={() => setParent(null)}
              >
                Cancel reply
              </Button>
            </div>
          )}
          <label htmlFor="napplet-comment">
            {parent ? 'Your reply' : 'Leave a little note'}
            <textarea
              id="napplet-comment"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (action === 'comment' && !pending) {
                  setMessage('');
                  setSuccess('');
                }
              }}
              maxLength={4000}
              placeholder="What did you make of this one?"
              required
              disabled={!pubkey || busy || !!pending}
            />
          </label>
          <div className="comment-submit">
            <span className="muted">
              Signed by {data?.profiles[pubkey]?.name ?? short(pubkey)} · posted publicly on Nostr
            </span>
            <ActionButton
              data-tone="mint"
              {...control('comment', parent ? 'Retry reply' : 'Retry comment')}
              disabled={control('comment', '').disabled || !content.trim()}
              success={action === 'comment' ? success : undefined}
            >
              {parent ? 'Post reply' : 'Post comment'}
            </ActionButton>
          </div>
        </form>
      ) : (
        <div className="social-connect">
          <p>Bring your Nostr identity to the conversation.</p>
          <ActionButton
            id="comment-connect"
            error={action === 'connect' ? message : undefined}
            retryLabel="Retry connection"
            variant="outline"
            onClick={() => {
              setAction('connect');
              setMessage('');
              void connect().catch((error) => setMessage(error.message));
            }}
          >
            Connect to comment or like
          </ActionButton>
        </div>
      )}
      {data ? (
        <>
          <div className="comment-list">
            {data.comments.length === 0 ? (
              <p className="muted">
                {refreshing
                  ? 'Looking for recent comments…'
                  : 'No comments found yet. Be the first to leave one.'}
              </p>
            ) : (
              data.comments.map((comment) => {
                const repliedTo = comment.parent
                  ? data.comments.find((e) => e.id === comment.parent)
                  : null;
                const commentLikes = comment.likes?.filter((e) => e.pubkey === pubkey) ?? [];
                return (
                  <article key={comment.id} className="comment" id={`comment-${comment.id}`}>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <CreatorLink pubkey={comment.pubkey} />
                        <time dateTime={new Date(comment.created_at * 1000).toISOString()}>
                          {new Date(comment.created_at * 1000).toLocaleDateString()}
                        </time>
                      </div>
                      {comment.parent && (
                        <a className="reply-reference" href={`#comment-${comment.parent}`}>
                          ↳ Reply to{' '}
                          {repliedTo
                            ? (data.profiles[repliedTo.pubkey]?.name ?? short(repliedTo.pubkey))
                            : 'an earlier comment'}
                        </a>
                      )}
                      {comment.deleted ? (
                        <p className="muted">Comment deleted by its author.</p>
                      ) : (
                        <RichComment event={comment} reference={reference} />
                      )}
                      <div className="comment-tools">
                        {!comment.deleted && (
                          <>
                            <ActionButton
                              {...control(
                                `like:${comment.id}`,
                                commentLikes.length ? 'Retry unlike' : 'Retry like',
                              )}
                              compact
                              icon={
                                <Heart
                                  size={13}
                                  fill={commentLikes.length ? 'currentColor' : 'none'}
                                />
                              }
                              size="xs"
                              variant="ghost"
                              data-tone="coral"
                              aria-label={`Like comment by ${data.profiles[comment.pubkey]?.name ?? short(comment.pubkey)}`}
                              aria-pressed={commentLikes.length > 0}
                              onClick={() =>
                                write(
                                  commentLikes.length
                                    ? deletionTemplate(commentLikes)
                                    : commentLikeTemplate(comment),
                                  `like:${comment.id}`,
                                )
                              }
                            >
                              {comment.likeCount ?? 0}
                            </ActionButton>
                            <ZapButton data={data} reference={reference} commentTarget={comment} />
                          </>
                        )}

                        {!comment.deleted && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!pubkey || busy || !!pending}
                            onClick={() => {
                              setParent(comment);
                              document.getElementById('napplet-comment')?.focus();
                            }}
                          >
                            <Reply size={13} />
                            Reply
                          </Button>
                        )}
                        {pubkey === comment.pubkey && !comment.deleted && (
                          <ActionButton
                            {...control(`delete:${comment.id}`, 'Retry delete')}
                            icon={<Trash2 size={13} />}
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              write(deletionTemplate([comment]), `delete:${comment.id}`)
                            }
                          >
                            Delete
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <p className="social-footnote">
            Showing recent events available from this client’s relays. Counts may differ across
            clients. Updates appear on refresh; deletion requests cannot recall copies held
            elsewhere.
          </p>
        </>
      ) : (
        <p className="muted" role="status">
          Looking for recent comments…
        </p>
      )}
    </section>
  );
  return children({
    actions,
    feedback: null,
    discussion,
  });
}
