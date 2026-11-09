import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  Minimize,
  Grid2X2,
  Heart,
  History,
  Keyboard,
  LogOut,
  Menu,
  MessageCircle,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import type { GallerySearch } from '../../../../packages/protocol/src';
import { matchesGallery } from '../../../../packages/protocol/src/topics';
import { socialScope } from '../../../../packages/protocol/src/social';
import {
  hasPublicPreview,
  publicPoster,
  publicPreviewVideo,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
import type { GalleryZapData } from '../../../../packages/client/src/gallery-social';
import type { getBrowseGallery } from '@/lib/catalog.functions';
import {
  availableCatalog,
  browseProtocol,
  lookupProtocol,
  queryCatalog,
  seedCatalog,
} from '@/lib/protocol-catalog';
import { galleryEntries, gallerySocial } from '@/lib/protocol-social';
import { useProtocolRefresh } from '@/lib/use-protocol-refresh';
import { useGamegridInput } from '@/lib/use-gamegrid-input';
import { useNostr } from './nostr-provider';
import { useWallet } from './wallet/wallet-provider';
import { PopoverTrigger } from './ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { PreviewCover } from './preview-cover';
import { Player } from './player';
import { ZapButton } from './zap-button';
import { GamegridKeyboard } from './gamegrid-keyboard';
import { GamegridSelect } from './gamegrid-select';
import { useCountRankings } from '@/lib/use-count-rankings';
import { rankingNotice } from '@/lib/count-rankings';

const WalletPanel = lazy(() =>
  import('./wallet/wallet-panel').then((module) => ({ default: module.WalletPanel })),
);
export type GamegridSearch = {
  q: string;
  section:
    'discover' | 'featured' | 'liked' | 'zapped' | 'commented' | 'new' | 'games' | 'continue';
  page: number;
};
type GalleryData = Awaited<ReturnType<typeof getBrowseGallery>>;
type RecentGame = { id: string; naddr: string | null; title: string };
const HISTORY_KEY = 'napplet.gamegrid.recent.v1';
const sections = [
  { id: 'discover', short: 'Discover', icon: Grid2X2 },
  { id: 'featured', short: 'Featured', icon: Sparkles },
  { id: 'liked', short: 'Most liked', icon: Heart },
  { id: 'zapped', short: 'Most zapped', icon: Zap },
  { id: 'commented', short: 'Most commented', icon: MessageCircle },
  { id: 'new', short: 'New', icon: Sparkles },
  { id: 'games', short: 'All games', icon: Grid2X2 },
  { id: 'continue', short: 'Continue', icon: History },
] as const;

export function gamegridCatalogSearch(search: GamegridSearch): GallerySearch {
  return {
    q: search.q,
    tag: 'game',
    sort: 'new',
    page: search.section === 'games' ? search.page : 1,
    unavailable: false,
  };
}

function readHistory(): RecentGame[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .filter((item): item is RecentGame => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.id !== 'string' ||
          !/^[a-f0-9]{64}$/.test(item.id) ||
          typeof item.title !== 'string' ||
          item.title.length > 256 ||
          !(
            item.naddr === null ||
            (typeof item.naddr === 'string' &&
              /^naddr1[a-z0-9]+$/.test(item.naddr) &&
              item.naddr.length <= 4096)
          ) ||
          seen.has(item.id)
        )
          return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 12);
  } catch {
    return [];
  }
}

function GameCard({
  napplet,
  index,
  sats,
  launch,
  previews,
  previewGroup,
}: {
  napplet: PublicNapplet;
  index: number;
  sats?: number | null;
  launch: (napplet: PublicNapplet) => void;
  previews: boolean;
  previewGroup: object;
}) {
  const { ready } = useNostr();
  const playable = napplet.availability === 'ready';
  return (
    <button
      type="button"
      className="gg-card"
      data-game-id={napplet.revisionId}
      disabled={!ready || !playable}
      aria-label={`${playable ? 'Play' : 'Unavailable'} ${napplet.title}`}
      onClick={() => launch(napplet)}
    >
      <PreviewCover
        revision={napplet.revisionId}
        title={napplet.title}
        video={publicPreviewVideo(napplet)}
        mode="auto"
        enabled={previews}
        previewGroup={previewGroup}
      >
        <img
          src={publicPoster(napplet)}
          className={!hasPublicPreview(napplet) ? 'generated-poster' : ''}
          alt=""
          width={720}
          height={450}
          loading={index < 4 ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
        />
        {sats != null && (
          <span className="gg-card-zaps">
            <Zap size={13} fill="currentColor" />
            {Math.floor(sats / 1000).toLocaleString()} sats
          </span>
        )}
      </PreviewCover>
      <span className="gg-card-info">
        <strong>{napplet.title}</strong>
        <span className="gg-card-hint">
          {playable ? (
            <>
              <kbd>A</kbd> Play <small>Start / Select · Menu</small>
            </>
          ) : (
            'Currently unavailable'
          )}
        </span>
      </span>
    </button>
  );
}

export function Gamegrid({
  initial,
  search,
  update,
}: {
  initial: GalleryData;
  search: GamegridSearch;
  update: (patch: Partial<GamegridSearch>) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    collectionField = useRef<HTMLSelectElement>(null),
    searchField = useRef<HTMLInputElement>(null);
  const returnTo = useRef<{ node: HTMLElement | null; scroll: number }>({ node: null, scroll: 0 });
  const { pubkey, ready, connect } = useNostr();
  const wallet = useWallet();
  const [draft, setDraft] = useState(search.q),
    [refreshVersion, setRefreshVersion] = useState(0);
  const [playing, setPlaying] = useState<PublicNapplet | null>(null),
    [menuOpen, setMenuOpen] = useState(false),
    [walletOpen, setWalletOpen] = useState(false);
  const [textField, setTextField] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [selectField, setSelectField] = useState<HTMLSelectElement | null>(null);
  const [recent, setRecent] = useState<RecentGame[]>([]),
    [recentEntries, setRecentEntries] = useState<PublicNapplet[]>([]),
    [recentLoading, setRecentLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState(''),
    [playerNotice, setPlayerNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [playerRevision, setPlayerRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const previewGroup = useRef({});
  const [rankingEntries, setRankingEntries] = useState<PublicNapplet[] | null>(null);
  const rankings = useCountRankings(rankingEntries);
  const [zaps, setZaps] = useState<GalleryZapData | null>(null),
    [zapError, setZapError] = useState(''),
    [zapRetry, setZapRetry] = useState(0);
  const seeded = useRef<GalleryData | null>(null);
  if (typeof window !== 'undefined' && seeded.current !== initial) {
    seeded.current = initial;
    seedCatalog([...initial.featured, ...initial.napplets]);
  }
  const catalogSearch = gamegridCatalogSearch(search);
  const refresh = useProtocolRefresh(
    'gamegrid',
    () => queryCatalog(),
    () => setRefreshVersion((value) => value + 1),
  );
  const catalog = refreshVersion ? browseProtocol(catalogSearch) : initial;
  const currentSection = sections.find((section) => section.id === search.section)!;

  useEffect(() => setDraft(search.q), [search.q]);
  useEffect(() => setRecent(readHistory()), []);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    let active = true;
    setRankingEntries(null);
    void galleryEntries(catalogSearch)
      .then((entries) => {
        if (active) setRankingEntries(entries);
      })
      .catch(() => {
        if (active) setRankingEntries([]);
      });
    return () => {
      active = false;
    };
  }, [search.q, refreshVersion]);
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [search.q, search.section, search.page]);

  useEffect(() => {
    if (search.section !== 'continue') return;
    let active = true;
    setRecentLoading(true);
    const known = availableCatalog();
    const entries: Array<PublicNapplet | undefined> = [];
    let next = 0;
    void Promise.all(
      Array.from({ length: Math.min(3, recent.length) }, async () => {
        while (next < recent.length && active) {
          const index = next++,
            item = recent[index];
          try {
            const found =
              known.find((entry) =>
                item.naddr ? entry.naddr === item.naddr : entry.revisionId === item.id,
              ) ??
              (await lookupProtocol(
                item.naddr
                  ? { type: 'address', naddr: item.naddr }
                  : { type: 'snapshot', id: item.id },
              ));
            if (found?.topics.includes('game')) entries[index] = found;
          } catch {
            /* A removed or unreachable recent game remains optional history. */
          }
        }
      }),
    ).then(() => {
      if (active) {
        setRecentEntries(entries.filter((entry): entry is PublicNapplet => !!entry));
        setRecentLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [search.section, recent, refreshVersion]);

  useEffect(() => {
    if (search.section !== 'zapped' && search.section !== 'discover') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setZaps(null);
    setZapError('');
    const load = async () => {
      try {
        const data = await gallerySocial(
          catalogSearch,
          pubkey ?? undefined,
          controller.signal,
          (value) => {
            if (!controller.signal.aborted) setZaps(value);
          },
          new Set(catalog.napplets.map((entry) => entry.revisionId)),
        );
        if (!controller.signal.aborted) {
          setZaps(data);
          setZapError('');
        }
      } catch {
        if (!controller.signal.aborted) setZapError('Couldn’t refresh verified zap totals.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 30000);
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search.section, search.q, pubkey, refreshVersion, zapRetry]);

  const leaveGame = () => {
    setMenuOpen(false);
    setWalletOpen(false);
    setPlaying(null);
    setPlayerNotice('');
    setPlayerRevision(0);
    requestAnimationFrame(() => {
      if (viewport.current) viewport.current.scrollTop = returnTo.current.scroll;
      if (returnTo.current.node?.isConnected) returnTo.current.node.focus({ preventScroll: true });
    });
  };
  const input = useGamegridInput({
    root,
    playing: !!playing,
    onMenu: () => setMenuOpen(true),
    onBack: () => {
      if (playing) setMenuOpen(true);
      else if (search.q) update({ q: '' });
      else if (search.section !== 'discover') update({ section: 'discover' });
      else setMenuOpen(true);
    },
    onText: setTextField,
    onSelect: setSelectField,
    onSection: (direction) => {
      const index = sections.findIndex((section) => section.id === search.section);
      update({ section: sections[(index + direction + sections.length) % sections.length].id });
    },
    onSearch: () => setSearchOpen(true),
  });
  const resume = () => {
    setMenuOpen(false);
    if (playing) input.resumeWhenNeutral();
  };
  const launch = (napplet: PublicNapplet) => {
    returnTo.current = {
      node: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scroll: viewport.current?.scrollTop ?? 0,
    };
    const next = [
      { id: napplet.revisionId, naddr: napplet.naddr, title: napplet.title },
      ...recent.filter((item) =>
        napplet.naddr ? item.naddr !== napplet.naddr : item.id !== napplet.revisionId,
      ),
    ].slice(0, 12);
    setRecent(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setHistoryNotice('');
    } catch {
      setHistoryNotice('Recent games could not be saved on this browser.');
    }
    setPlaying(napplet);
    setMenuOpen(false);
    setPlayerNotice('');
    input.resumeWhenNeutral();
  };
  const matching = (entries: PublicNapplet[]) =>
    entries.filter((entry) => matchesGallery(entry, catalogSearch));
  const collections = [
    {
      id: 'featured',
      title: 'Featured',
      icon: Sparkles,
      layout: 'lead',
      entries: matching(catalog.featured),
      loading: false,
      empty: 'No featured games in this collection yet.',
    },
    {
      id: 'liked',
      title: 'Most liked',
      icon: Heart,
      layout: 'lead-right',
      entries: matching(rankings.liked),
      loading: rankings.status.liked === 'loading',
      notice: rankings.retryError || rankingNotice(rankings.status.liked),
      empty: 'No likes counted for this collection yet.',
    },
    {
      id: 'zapped',
      title: 'Most zapped',
      icon: Zap,
      layout: 'equal',
      entries: matching(zaps?.zapped ?? []),
      loading: !zaps && !zapError,
      empty: zapError || 'No verified zaps for this collection yet.',
    },
    {
      id: 'commented',
      title: 'Most commented',
      icon: MessageCircle,
      layout: 'lead',
      entries: matching(rankings.commented),
      loading: rankings.status.commented === 'loading',
      notice: rankings.retryError || rankingNotice(rankings.status.commented),
      empty: 'No comments counted for this collection yet.',
    },
    {
      id: 'new',
      title: 'New arrivals',
      icon: History,
      layout: 'equal',
      entries: catalog.napplets,
      loading: false,
      empty: 'No games found.',
    },
    {
      id: 'games',
      title: 'All games',
      icon: Grid2X2,
      layout: 'equal',
      entries: catalog.napplets,
      loading: false,
      empty: 'No games found.',
    },
    {
      id: 'continue',
      title: 'Continue playing',
      icon: History,
      layout: 'equal',
      entries: matching(recentEntries),
      loading: recentLoading,
      empty: 'Games you open will appear here.',
    },
  ];
  const visibleCollections =
    search.section === 'discover'
      ? collections.slice(0, 5)
      : collections.filter((collection) => collection.id === search.section);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
      setPlayerNotice('');
    } catch {
      setPlayerNotice(
        'Use your browser’s fullscreen shortcut. Gamegrid already fills this window.',
      );
    }
  };

  return (
    <div className="gamegrid" ref={root} data-playing={!!playing}>
      <h1 className="sr-only">Gamegrid</h1>
      <div className="gg-viewport" ref={viewport} data-gamegrid-scroll data-gamegrid-nav="grid">
        {search.q &&
        catalog.matches === 0 &&
        !visibleCollections.some((collection) => collection.entries.length) ? (
          <div className="gg-empty" role="status">
            <h2>No games found.</h2>
            <p>Try a different title or tag.</p>
            <button className="gg-primary" onClick={() => update({ q: '', section: 'discover' })}>
              Clear search
              <ArrowRight size={17} />
            </button>
          </div>
        ) : (
          visibleCollections.map((collection) => {
            const entries =
              search.section === 'discover'
                ? collection.entries.slice(0, collection.layout === 'equal' ? 8 : 7)
                : collection.entries;
            return (
              <section className="gg-section" key={collection.id} aria-label={collection.title}>
                <h2 className="gg-section-title">
                  <collection.icon size={15} />
                  {collection.title}
                </h2>
                {collection.notice && (
                  <p className="gg-ranking-notice" role="status">
                    {collection.notice} <button onClick={rankings.retry}>Retry counts</button>
                  </p>
                )}
                {entries.length ? (
                  <div
                    className={`gg-grid gg-grid-${collection.layout}`}
                    data-lead={entries.length === 7}
                  >
                    {entries.map((entry, index) => (
                      <GameCard
                        key={entry.revisionId}
                        napplet={entry}
                        index={index}
                        launch={launch}
                        previews={!playing && !menuOpen && !walletOpen && !searchOpen}
                        previewGroup={previewGroup.current}
                        sats={
                          collection.id === 'zapped'
                            ? zaps?.counts[entry.revisionId]?.msats
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : !collection.notice ? (
                  <div className="gg-section-empty" role="status">
                    <p>{collection.loading ? 'Finding games…' : collection.empty}</p>
                    {!collection.loading && search.section !== 'discover' && (
                      <button onClick={() => update({ q: '', section: 'discover' })}>
                        {search.q ? 'Clear search' : 'Discover games'}
                        <ArrowRight size={17} />
                      </button>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
      <header className="gg-hud" data-gamegrid-nav="toolbar" aria-label="Gamegrid controls">
        <div className="gg-collection-control">
          <currentSection.icon size={17} aria-hidden="true" />
          <select
            ref={collectionField}
            aria-label="Game collection"
            title="A chooses a collection · LB / RB switches collection"
            value={search.section}
            onChange={(event) =>
              update({ section: event.target.value as GamegridSearch['section'] })
            }
          >
            {sections.map(({ id, short }) => (
              <option key={id} value={id}>
                {short}
              </option>
            ))}
          </select>
        </div>
        <span className="gg-hud-divider" aria-hidden="true" />
        <button
          type="button"
          className="gg-hud-button"
          aria-label="Search games"
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          data-active={!!search.q}
          title={search.q ? `Search: ${search.q}` : 'Search games'}
          onClick={() => setSearchOpen(true)}
        >
          <Search size={19} />
          {search.q && <span className="gg-query">{search.q}</span>}
        </button>
        <button
          type="button"
          className="gg-hud-button"
          aria-label="Open wallet"
          title={wallet.runtime ? `Wallet · ${wallet.balance.toLocaleString()} sats` : 'Wallet'}
          onClick={() => setWalletOpen(true)}
        >
          <Wallet size={19} />
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            id="identity-button"
            className="gg-hud-button"
            disabled={!ready}
            aria-label={pubkey ? 'Account' : 'Connect account'}
            title={pubkey ? 'Account' : 'Connect account'}
            data-connected={!!pubkey}
            onClick={() => void connect()}
          >
            <UserRound size={19} />
          </button>
        </PopoverTrigger>
        {search.section === 'continue' && recent.length > 0 && (
          <button
            type="button"
            className="gg-hud-button"
            aria-label="Clear recent games"
            title="Clear recent games"
            onClick={() => {
              setRecent([]);
              setRecentEntries([]);
              try {
                localStorage.removeItem(HISTORY_KEY);
              } catch {
                setHistoryNotice('Recent games could not be cleared from browser storage.');
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        )}
        <span className="gg-hud-divider" aria-hidden="true" />
        <button
          type="button"
          className="gg-hud-button"
          aria-label="Open Gamegrid menu"
          title="Start / Select · Menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={19} />
        </button>
        <Link
          to="/"
          className="gg-hud-button"
          aria-label="Exit Gamegrid"
          title="Back to napplet.soy"
        >
          <LogOut size={18} />
        </Link>
        <span className="gg-hud-tip" role="status">
          {input.status}
        </span>
      </header>
      <div className="gg-alerts">
        {refresh}
        {historyNotice && (
          <p className="gg-notice" role="status">
            {historyNotice}
          </p>
        )}
        {zapError && (
          <p className="gg-notice" role="status">
            {zapError}
            <button onClick={() => setZapRetry((value) => value + 1)}>Retry</button>
          </p>
        )}
      </div>
      {search.section === 'games' && catalog.pages > 1 && (
        <nav className="gg-pagination" data-gamegrid-nav="footer" aria-label="Game pages">
          <button
            aria-label="Previous game page"
            disabled={catalog.page <= 1}
            onClick={() => update({ page: catalog.page - 1 })}
          >
            <ArrowLeft size={18} />
          </button>
          <span>
            {catalog.page} / {catalog.pages}
          </span>
          <button
            aria-label="Next game page"
            disabled={catalog.page >= catalog.pages}
            onClick={() => update({ page: catalog.page + 1 })}
          >
            <ArrowRight size={18} />
          </button>
        </nav>
      )}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="gg-search-dialog">
          <DialogTitle>Find a game</DialogTitle>
          <DialogDescription>Search by title, description or tag.</DialogDescription>
          <form
            className="gg-search"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: draft.trim() });
              setSearchOpen(false);
            }}
          >
            <div className="gg-search-field">
              <Search size={20} aria-hidden="true" />
              <input
                ref={searchField}
                aria-label="Search games"
                placeholder="Search games"
                value={draft}
                maxLength={100}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="button"
                aria-label="Open search keyboard"
                onClick={() => {
                  if (searchField.current) setTextField(searchField.current);
                }}
              >
                <Keyboard size={22} />
              </button>
            </div>
            <div className="gg-search-actions">
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  update({ q: '' });
                  setSearchOpen(false);
                }}
              >
                <X size={16} />
                Clear search
              </button>
              <button className="gg-primary" type="submit">
                Search
                <ArrowRight size={17} />
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {playing && (
        <Player
          key={`${playing.revisionId}:${playerRevision}`}
          napplet={playing}
          autoPlay
          immersive
          returnLabel="Back to Gamegrid"
          onExit={leaveGame}
          onStop={leaveGame}
          onLoadError={(error) => {
            setPlayerNotice(error.message);
            setMenuOpen(true);
          }}
        />
      )}
      <Dialog
        open={menuOpen}
        onOpenChange={(open) => {
          if (open) setMenuOpen(true);
          else resume();
        }}
      >
        <DialogContent className="gg-menu-dialog">
          <span className="gg-eyebrow">GAMEGRID</span>
          <DialogTitle>{playing?.title ?? 'Gamegrid menu'}</DialogTitle>
          <DialogDescription>
            {playing
              ? 'Some games may keep running while this is open.'
              : 'Your games, account and wallet.'}
          </DialogDescription>
          {playerNotice && (
            <p role="alert" className="gg-notice">
              {playerNotice}
            </p>
          )}
          <div className="gg-menu-actions">
            <button className="gg-primary" onClick={resume}>
              {playing ? <Play size={20} fill="currentColor" /> : <Grid2X2 size={20} />}
              {playing ? 'Resume game' : 'Back to games'}
            </button>
            {playing && (
              <>
                <button
                  onClick={() => {
                    setPlayerRevision((value) => value + 1);
                    setPlayerNotice('');
                    resume();
                  }}
                >
                  <RotateCcw size={20} />
                  Restart game
                </button>
                <ZapButton
                  data={{
                    manifest: playing.manifest,
                    scope: socialScope(playing.manifest),
                    relays: playing.relays,
                  }}
                  reference={playing.naddr ?? playing.revisionId}
                  trigger={
                    <button>
                      <Zap size={20} />
                      Zap the creator
                    </button>
                  }
                />
              </>
            )}
            {!playing && (
              <>
                <button
                  onClick={() => {
                    if (collectionField.current) setSelectField(collectionField.current);
                  }}
                >
                  <Grid2X2 size={20} />
                  Collections · {currentSection.short}
                </button>
                <button onClick={() => setSearchOpen(true)}>
                  <Search size={20} />
                  Search games
                </button>
              </>
            )}
            <button onClick={() => setWalletOpen(true)}>
              <Wallet size={20} />
              Wallet
            </button>
            <button disabled={!ready} onClick={() => void connect()}>
              <UserRound size={20} />
              {pubkey ? 'Account & settings' : 'Connect account'}
            </button>
            <button aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Minimize size={20} /> : <Expand size={20} />}
              {fullscreen ? 'Exit browser fullscreen' : 'Enter browser fullscreen'}
            </button>
            {playing ? (
              <button onClick={leaveGame}>
                <Grid2X2 size={20} />
                Back to Gamegrid
              </button>
            ) : (
              <Link to="/">
                <LogOut size={20} />
                Exit to napplet.soy
              </Link>
            )}
          </div>
          <p className="gg-menu-hint">
            A select · B back · Start / Select menu
            {!playing && (
              <>
                <br />
                LB / RB collections · Y search · Right stick scroll
              </>
            )}
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent className="gg-wallet-dialog">
          <DialogTitle>Your wallet</DialogTitle>
          <DialogDescription>The same wallet you use across napplet.soy.</DialogDescription>
          <Suspense fallback={<p role="status">Opening wallet tools…</p>}>
            <WalletPanel full />
          </Suspense>
        </DialogContent>
      </Dialog>
      {textField && <GamegridKeyboard field={textField} close={() => setTextField(null)} />}
      {selectField && <GamegridSelect field={selectField} close={() => setSelectField(null)} />}
    </div>
  );
}
