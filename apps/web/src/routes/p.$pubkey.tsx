import { nativeMediaUrl } from '../../../../packages/client/src/bytes';
import { useProtocolRefresh } from '@/lib/use-protocol-refresh';
import { readProfile, queryCatalog, seedCatalog } from '@/lib/protocol-catalog';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Copy, Eye, Zap } from 'lucide-react';
import { getProfilePage } from '@/lib/profile.functions';
import { useProfiles } from '@/lib/profiles';
import { profilePath, profilePubkey } from '../../../../packages/protocol/src/profile';
import { ProfileAvatar } from '@/components/creator-link';
import { useNostr } from '@/components/nostr-provider';
import { NappletCard } from '@/components/napplet-card';
import { GallerySocialProvider } from '@/components/gallery-social';
import { Button } from '@/components/ui/button';
import { OG_VERSION } from '../../../../packages/backend/src/public-model';

export const Route = createFileRoute('/p/$pubkey')({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Math.max(1, Math.min(10000, Math.floor(Number(search.page) || 1))),
    all: search.all === true || search.all === 'true',
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    let pubkey: string;
    try {
      pubkey = profilePubkey(params.pubkey);
    } catch {
      throw notFound();
    }
    const data = await getProfilePage({ data: { pubkey, ...deps } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData: data }) => {
    if (!data) return { meta: [{ title: 'Creator not found — napplet.soy' }] };
    const p = data.profile,
      title = `${p.name} — napplet.soy`,
      description = p.about || 'Explore this Nostr creator’s napplets. Play, inspect, and remix.';
    const url = `${data.siteOrigin}${profilePath(p.pubkey)}`,
      image = `${data.siteOrigin}/api/profile-og?pubkey=${p.pubkey}&v=${OG_VERSION}-${p.eventId ?? 'missing'}`;
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:type', content: 'profile' },
        { property: 'og:title', content: p.name },
        { property: 'og:description', content: description },
        { property: 'og:url', content: url },
        { property: 'og:image', content: image },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: `${p.name} on napplet.soy` },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: p.name },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
        { name: 'twitter:image:alt', content: `${p.name} on napplet.soy` },
      ],
      links: [{ rel: 'canonical', href: url }],
    };
  },
  component: CreatorProfile,
});
function CreatorProfile() {
  const data = Route.useLoaderData(),
    cache = useProfiles(),
    search = Route.useSearch();
  const p = data.profile;
  if (typeof window !== 'undefined') seedCatalog(data.entries);
  const identity = useNostr();
  const refresh = useProtocolRefresh(p.pubkey, () =>
    Promise.all([readProfile(p.pubkey), queryCatalog(p.pubkey)]),
  );
  const banner = nativeMediaUrl(p.banner);
  const [active, setActive] = useState<string | null>(null),
    [copied, setCopied] = useState('');
  useEffect(() => {
    cache.seed(p);
    setActive(null);
  }, [cache, p.pubkey, p.eventId, data.page, data.all]);
  return (
    <section className="creator-profile" key={p.pubkey}>
      <Link to="/" className="back-link">
        <ArrowLeft size={14} />
        Back to the playground
      </Link>
      <header className={`profile-header${banner ? ' has-banner' : ''}`}>
        {banner && (
          <img
            className="profile-banner"
            src={banner}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.hidden = true;
            }}
          />
        )}
        <div className="profile-intro">
          <ProfileAvatar profile={p} name={p.name} large />
          <div>
            <span className="eyebrow">A CREATOR ON NOSTR</span>
            <h1>
              {p.name}
              <span className="coral">.</span>
            </h1>
            {p.username && p.username !== p.name && <p className="muted">{p.username}</p>}
          </div>
        </div>
        {p.about && <p className="profile-bio">{p.about}</p>}
        <div className="profile-links">
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer nofollow ugc">
              {new URL(p.website).hostname}
              <ArrowUpRight size={15} />
            </a>
          )}
          {p.lightning && (
            <span title="Creator-provided Lightning address">
              <Zap size={15} />
              <span>{p.lightning}</span>
            </span>
          )}
          {p.nip05 && (
            <span title="Creator-provided NIP-05 address; not verified by this client">
              {p.nip05}
              <small>unverified</small>
            </span>
          )}
        </div>
        <div className="profile-public-key">
          <code>{p.npub}</code>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Copy public key"
            onClick={() =>
              navigator.clipboard
                .writeText(p.npub)
                .then(() => setCopied('Public key copied.'))
                .catch(() => setCopied('Select the public key above to copy it.'))
            }
          >
            <Copy size={15} />
          </Button>
        </div>
        {copied && (
          <p role="status" className="muted">
            {copied}
          </p>
        )}
        {p.state === 'missing' && (
          <p className="profile-note">
            No profile found on our configured relays yet. Their public key still identifies every
            creation below.
          </p>
        )}
        {p.state === 'invalid' && (
          <p className="profile-note">
            The latest signed profile has unreadable metadata. Showing its public key instead.
          </p>
        )}
        {data.warning && (
          <p role="status" className="profile-note">
            {data.warning}
          </p>
        )}
      </header>
      {refresh}
      {identity.pubkey === p.pubkey && (
        <Button variant="outline" asChild>
          <Link to="/manage" hash="profile">
            Edit your profile
          </Link>
        </Button>
      )}
      <section className="profile-creations" aria-label="Creator’s napplets">
        <div className="explore-top">
          <div>
            <h2>
              Made by this creator <span className="muted">{data.total}</span>
            </h2>
            <p>Creations discovered by this client. Every one is an invitation to remix.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/p/$pubkey"
              params={{ pubkey: p.npub }}
              search={{ page: 1, all: !search.all }}
              resetScroll={false}
              aria-pressed={search.all}
            >
              <Eye size={14} />
              {search.all ? 'Hide unavailable' : 'Show unavailable'}
              {data.hidden ? ` (${data.hidden})` : ''}
            </Link>
          </Button>
        </div>
        <GallerySocialProvider search={{ q: '', tag: '', sort: 'new', unavailable: search.all }}>
          <div className="napplet-grid">
            {data.entries.map((n, index) => (
              <NappletCard
                key={n.revisionId}
                napplet={n}
                index={index}
                playing={active === n.revisionId}
                onPlay={() => setActive(n.revisionId)}
                onStop={() => setActive(null)}
              />
            ))}
          </div>
        </GallerySocialProvider>
        {!data.entries.length && (
          <div className="empty-results">
            <h3>Room for a little weird.</h3>
            <p>
              {data.hidden
                ? 'Use Show unavailable to see the other discovered creations.'
                : 'No napplets discovered for this public key yet.'}
            </p>
          </div>
        )}
        {data.pages > 1 && (
          <nav className="gallery-pagination" aria-label="Creator napplet pages">
            {data.page > 1 ? (
              <Link
                to="/p/$pubkey"
                params={{ pubkey: p.npub }}
                search={{ ...search, page: data.page - 1 }}
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {data.page} of {data.pages}
            </span>
            {data.page < data.pages ? (
              <Link
                to="/p/$pubkey"
                params={{ pubkey: p.npub }}
                search={{ ...search, page: data.page + 1 }}
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </section>
  );
}
