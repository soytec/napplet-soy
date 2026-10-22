import { galleryEntries, gallerySocial, publishSocial } from '@/lib/protocol-social';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { asapScheduler, subscribeOn, Subscription, type Observable } from 'rxjs';
import { use$ } from 'applesauce-react/hooks';
import { Link } from '@tanstack/react-router';
import { Heart, MessageCircle, Zap, ChevronLeft, ChevronRight, LockKeyhole } from 'lucide-react';
import { Button } from './ui/button';
import { ActionButton } from './action-button';
import { useNostr } from './nostr-provider';
import { ZapButton } from './zap-button';
import { NappletCard } from './napplet-card';
import { jsonResponse, signForAccount } from '@/lib/community-client';
import {
  deletionTemplate,
  likeTemplate,
  socialScope,
} from '../../../../packages/protocol/src/social';
import type { GallerySearch, SignedEvent } from '../../../../packages/protocol/src';
import type { GalleryZapData } from '../../../../packages/client/src/gallery-social';
import { countTarget, likesMetric } from '../../../../packages/client/src/social-counts';
import { socialCounts } from '@/lib/social-counts';
import { publicLink, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import { protocolClient } from '@/lib/network';
import { readLikeState } from '../../../../packages/client/src/social';
import { useZapTotals, zapTotalsStore } from '@/lib/zap-totals';

type Rankings = Record<'liked' | 'commented', PublicNapplet[]> & { loading: boolean };
const Context = createContext<{
  data: GalleryZapData | null;
  rankings: Rankings;
  error: string;
  busy: boolean;
  active: string;
  phase: string;
  register: (id: string) => () => void;
  pending: { event: SignedEvent; napplet: PublicNapplet } | null;
  message: { id: string; text: string } | null;
  like: (napplet: PublicNapplet) => Promise<void>;
  retry: () => Promise<void>;
  dismiss: () => void;
} | null>(null);

export function GallerySocialProvider({
  search,
  children,
}: {
  search: GallerySearch;
  children: ReactNode;
}) {
  const { pubkey } = useNostr();
  const key = useRef(pubkey);
  key.current = pubkey;
  const [data, setData] = useState<GalleryZapData | null>(null);
  const [entries, setEntries] = useState<PublicNapplet[] | null>(null);
  const rankings = useCountRankings(entries);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [active, setActive] = useState('');
  const [phase, setPhase] = useState('');
  const [cards, setCards] = useState<Record<string, number>>({});
  const visible = useRef(cards);
  visible.current = cards;
  const register = useCallback((id: string) => {
    setCards((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }));
    return () => setCards((v) => ({ ...v, [id]: Math.max(0, (v[id] ?? 1) - 1) }));
  }, []);
  const [pending, setPending] = useState<{ event: SignedEvent; napplet: PublicNapplet } | null>(
    null,
  );
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => zapTotalsStore.onPayment(() => setRevision((v) => v + 1)), []);
  const query = new URLSearchParams({
    q: search.q,
    tag: search.tag,
    sort: search.sort,
    unavailable: String(!!search.unavailable),
    archetype: search.archetype ?? '',
    intent: search.intent ?? '',
    requiredDomain: search.requiredDomain ?? '',
    optionalDomain: search.optionalDomain ?? '',
    ...(pubkey ? { viewer: pubkey } : {}),
  }).toString();
  useEffect(() => {
    setData(null);
  }, [query]);
  useEffect(() => {
    let current = true;
    void galleryEntries(search).then(
      (value) => current && setEntries(value),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [query, revision]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let delay = 30000;
      try {
        if (document.visibilityState === 'hidden') return;
        const value = await gallerySocial(
          search,
          pubkey ?? undefined,
          controller.signal,
          (value) => {
            if (controller.signal.aborted) return;
            setData(value);
            setError('');
          },
          // Cards on screen get their zap totals and like state first.
          new Set(Object.keys(visible.current).filter((id) => visible.current[id] > 0)),
        );
        if (controller.signal.aborted) return;
        setData(value);
        setError('');
        delay = value.refreshing ? 5000 : 30000;
      } catch {
        if (!controller.signal.aborted) setError('Zap totals are temporarily unavailable.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, delay);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, revision]);
  const deliver = async (item: NonNullable<typeof pending>) => {
    if (key.current !== item.event.pubkey)
      throw new Error('Reconnect the signing account before retrying.');
    setPhase('Publishing…');
    await publishSocial(item.event, item.napplet.relays);
    setPending(null);
    setMessage(null);
    setRevision((v) => v + 1);
  };
  const like = async (napplet: PublicNapplet) => {
    if (!pubkey || busyRef.current || pending) return;
    busyRef.current = true;
    setActive(napplet.revisionId);
    setPhase('Preparing…');
    setBusy(true);
    setMessage(null);
    try {
      const state = await readLikeState(protocolClient(), napplet.manifest, pubkey, napplet.relays);
      if (key.current !== pubkey) throw new Error('Your connected account changed.');
      const own = (state.likes as SignedEvent[]).filter((e) => e.pubkey === pubkey);
      const template = own.length
        ? deletionTemplate(own)
        : likeTemplate(state.scope, state.manifest);
      template.created_at = Math.max(template.created_at, state.lastAction + 1);
      setPhase('Signing…');
      const event = await signForAccount(pubkey, template);
      if (key.current !== pubkey) throw new Error('Your connected account changed.');
      const item = { event, napplet };
      setPending(item);
      await deliver(item);
    } catch (error) {
      setMessage({ id: napplet.revisionId, text: (error as Error).message });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPhase('');
    }
  };
  return (
    <Context.Provider
      value={{
        data,
        rankings,
        error,
        busy,
        active,
        phase,
        register,
        pending,
        message,
        like,
        retry: async () => {
          if (!pending || busyRef.current) return;
          busyRef.current = true;
          setMessage(null);
          setBusy(true);
          try {
            await deliver(pending);
          } catch (error) {
            setMessage({ id: pending.napplet.revisionId, text: (error as Error).message });
          } finally {
            busyRef.current = false;
            setBusy(false);
            setPhase('');
          }
        },
        dismiss: () => {
          setPending(null);
          setRevision((v) => v + 1);
          setMessage(null);
        },
      }}
    >
      {children}
      {pending && !cards[pending.napplet.revisionId] && <GalleryPendingAction />}
    </Context.Provider>
  );
}

function GalleryPendingAction() {
  const social = useContext(Context),
    { pubkey } = useNostr();
  if (!social?.pending) return null;
  return (
    <aside className="gallery-pending" aria-label="Pending gallery action">
      <ActionButton
        size="sm"
        working={social.busy ? social.phase : undefined}
        error={social.message?.text}
        retryLabel={`Retry like · ${social.pending.napplet.title}`}
        disabled={social.pending.event.pubkey !== pubkey}
        onClick={() => void social.retry()}
        onCancel={social.dismiss}
      >
        Retry like · {social.pending.napplet.title}
      </ActionButton>
    </aside>
  );
}

const amount = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
export function GalleryCardSocial({
  napplet,
  children,
}: {
  napplet: PublicNapplet;
  children: ReactNode;
}) {
  const social = useContext(Context),
    { pubkey, ready } = useNostr();
  const zaps = useZapTotals(socialScope(napplet.manifest).key);
  const conversation = useNappletCounts(napplet);
  useEffect(() => social?.register(napplet.revisionId), [social?.register, napplet.revisionId]);
  if (!social)
    return (
      <div className="card-social" role="group" aria-label={`Social actions for ${napplet.title}`}>
        {children}
      </div>
    );
  const counts = { ...conversation, ...social.data?.counts[napplet.revisionId], ...zaps };
  const feedback = social.message?.id === napplet.revisionId ? social.message.text : undefined;
  const ownsPending = social.pending?.napplet.revisionId === napplet.revisionId;
  return (
    <>
      <div className="card-social" role="group" aria-label={`Social actions for ${napplet.title}`}>
        <ActionButton
          data-tone="coral"
          compact
          icon={<Heart size={15} fill={counts?.liked ? 'currentColor' : 'none'} />}
          working={social.busy && social.active === napplet.revisionId ? social.phase : undefined}
          error={feedback}
          retryLabel={counts?.liked ? 'Retry unlike' : 'Retry like'}
          onCancel={ownsPending ? social.dismiss : undefined}
          size="sm"
          variant="ghost"
          aria-pressed={!!counts?.liked}
          disabled={
            !pubkey ||
            social.busy ||
            (!!social.pending && (!ownsPending || social.pending.event.pubkey !== pubkey))
          }
          title={
            !pubkey ? 'Sign in to like' : counts?.liked ? 'Remove your like' : 'Like this napplet'
          }
          aria-label={`${counts?.liked ? 'Unlike' : 'Like'} ${napplet.title}: ${counts?.likeCount ?? 'unknown'} likes${!pubkey ? ' — sign in required' : ''}`}
          onClick={() => void (ownsPending ? social.retry() : social.like(napplet))}
        >
          {amount(counts?.likeCount)}
        </ActionButton>
        {pubkey ? (
          <Button asChild size="sm" variant="ghost" data-tone="mint">
            <Link
              {...publicLink(napplet)}
              hash="comments"
              aria-label={`Comment on ${napplet.title}: ${counts?.commentCount ?? 'unknown'} comments`}
            >
              <MessageCircle size={15} />
              {amount(counts?.commentCount)}
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="Sign in to comment"
            aria-label={`Comment on ${napplet.title}: ${counts?.commentCount ?? 'unknown'} comments — sign in required`}
          >
            <MessageCircle size={15} />
            {amount(counts?.commentCount)}
          </Button>
        )}
        <ZapButton
          reference={napplet.naddr ?? napplet.revisionId}
          data={{
            manifest: napplet.manifest,
            scope: socialScope(napplet.manifest),
            relays: napplet.relays,
          }}
          trigger={
            <Button
              size="sm"
              variant="ghost"
              disabled={!ready}
              className="card-zap"
              data-tone="gold"
              data-effect="zap"
              title={`${amount(counts?.zapCount)} zaps · ${amount(counts?.msats == null ? null : counts.msats / 1000)} sats`}
              aria-label={`Zap ${napplet.title}: ${counts?.zapCount ?? 'unknown'} zaps, ${counts?.msats == null ? 'unknown' : counts.msats / 1000} sats`}
            >
              <Zap size={15} />
              {amount(counts?.zapCount)}
              <span className="card-sats">
                {amount(counts?.msats == null ? null : counts.msats / 1000)} sats
              </span>
            </Button>
          }
        />
        {children}
      </div>
    </>
  );
}

export function SocialRankings({
  active,
  setActive,
}: {
  active: string | null;
  setActive: (id: string | null) => void;
}) {
  const social = useContext(Context),
    { pubkey } = useNostr();
  return (
    <div className="social-discovery">
      <div className="social-discovery-note">
        <p>
          From the conversation · counts from this client’s NIP-45 relay; zaps are verified
          receipts.
        </p>
        {!pubkey && (
          <span>
            <LockKeyhole size={12} /> Sign in to like or comment. Anyone can zap.
          </span>
        )}
      </div>
      {social?.error && (
        <p role="status" className="muted">
          {social.error}
        </p>
      )}
      {(['liked', 'zapped', 'commented'] as const).map((kind) => (
        <SocialRail
          key={kind}
          kind={kind}
          entries={(kind === 'zapped' ? social?.data?.zapped : social?.rankings[kind]) ?? []}
          loading={
            kind === 'zapped'
              ? (!social?.data && !social?.error) || !!social?.data?.refreshing
              : (social?.rankings.loading ?? true)
          }
          active={active}
          setActive={setActive}
        />
      ))}
    </div>
  );
}

function SocialRail({
  kind,
  entries,
  loading,
  active,
  setActive,
}: {
  kind: 'liked' | 'zapped' | 'commented';
  entries: PublicNapplet[];
  loading: boolean;
  active: string | null;
  setActive: (id: string | null) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const title = { liked: 'Most liked', zapped: 'Most zapped', commented: 'Most commented' }[kind];
  const Icon = { liked: Heart, zapped: Zap, commented: MessageCircle }[kind];
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () =>
      setEnds({
        start: element.scrollLeft < 2,
        end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [entries.length]);
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * rail.current.clientWidth * 0.85,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  return (
    <section className={`social-rail social-rail-${kind}`} aria-labelledby={`rail-${kind}`}>
      <div className="social-rail-heading">
        <h3 id={`rail-${kind}`}>
          <Icon size={17} />
          {title}
        </h3>
        {kind === 'zapped' && <span className="rail-caption">By sats received</span>}
        <div className="rail-controls">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Previous ${title.toLowerCase()}`}
            disabled={ends.start}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Next ${title.toLowerCase()}`}
            disabled={ends.end}
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      {entries.length ? (
        <div
          ref={rail}
          className="social-rail-track"
          tabIndex={0}
          role="region"
          aria-label={`${title} napplets`}
        >
          {entries.map((n) => {
            const id = `${kind}:${n.revisionId}`;
            return (
              <NappletCard
                key={n.revisionId}
                napplet={n}
                playing={active === id}
                onPlay={() => setActive(id)}
                onStop={() => {
                  if (active === id) setActive(null);
                }}
              />
            );
          })}
        </div>
      ) : (
        <p className="rail-empty">
          {loading
            ? 'Finding the conversation…'
            : `No ${kind === 'zapped' ? 'verified zaps' : kind === 'liked' ? 'likes' : 'comments'} found for this collection yet.`}
        </p>
      )}
    </section>
  );
}

const deferred = <T,>(source: Observable<T>) =>
  // Defer past use$'s synchronous render probe so abandoned renders start no relay work.
  source.pipe(subscribeOn(asapScheduler));

/** Raw NIP-45 totals for one card; undefined stays distinct from a counted zero. */
function useNappletCounts(napplet: PublicNapplet) {
  const target = useMemo(() => countTarget(napplet.manifest), [napplet.manifest]);
  const likes = use$(() => {
    const counts = socialCounts();
    return counts && deferred(counts.event(target).metric(likesMetric));
  }, [target]);
  const comments = use$(() => {
    const counts = socialCounts();
    return counts && deferred(counts.event(target).comments);
  }, [target]);
  return {
    ...(likes?.value !== undefined ? { likeCount: likes.value } : {}),
    ...(comments?.value !== undefined ? { commentCount: comments.value } : {}),
  };
}

/** Rank a gallery by COUNT answers; cards observing the same metrics share each request. */
function useCountRankings(entries: PublicNapplet[] | null): Rankings {
  const [rankings, setRankings] = useState<Rankings>({ liked: [], commented: [], loading: true });
  const key = entries?.map((n) => n.revisionId).join(',');
  useEffect(() => {
    const counts = socialCounts();
    if (!counts || !entries) return;
    const values = new Map<string, { likes?: number; comments?: number }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rank = (field: 'likes' | 'comments') =>
      entries
        .filter((n) => (values.get(n.revisionId)?.[field] ?? 0) > 0)
        .sort(
          (a, b) =>
            values.get(b.revisionId)![field]! - values.get(a.revisionId)![field]! ||
            b.manifest.created_at - a.manifest.created_at ||
            a.revisionId.localeCompare(b.revisionId),
        )
        .slice(0, 12);
    const publish = () => {
      timer = undefined;
      setRankings({
        liked: rank('likes'),
        commented: rank('comments'),
        loading: entries.some((n) => {
          const v = values.get(n.revisionId);
          return v?.likes === undefined || v.comments === undefined;
        }),
      });
    };
    const subscriptions = new Subscription();
    for (const n of entries) {
      const handle = counts.event(countTarget(n.manifest));
      for (const [field, metric] of [
        ['likes', handle.metric(likesMetric)],
        ['comments', handle.comments],
      ] as const)
        subscriptions.add(
          metric.subscribe((state) => {
            values.set(n.revisionId, { ...values.get(n.revisionId), [field]: state.value });
            // Coalesce hundreds of answers into a few renders.
            timer ??= setTimeout(publish, 100);
          }),
        );
    }
    publish();
    return () => {
      clearTimeout(timer);
      subscriptions.unsubscribe();
    };
  }, [key]);
  return rankings;
}
