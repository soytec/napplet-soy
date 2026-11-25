import { DiscoveryBackLink } from './discovery-navigation';
import { SaveButton } from './saved-napplets';
import { manifestArchetypes } from '../../../../packages/protocol/src/manifest';
import { SourceSection } from './source-section';
import { LinkedAssets } from './linked-assets';
import { CreatorLink } from './creator-link';
import { Genealogy } from './genealogy';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Button } from './ui/button';
import { Player } from './player';
import { ArchetypeLinks, TopicTags } from './topic-tags';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import { NameButton } from './name-button';
import { NappletSocial } from './social-panel';
import { RemixButton } from './remix-button';
import { NostrIdentifiers } from './nostr-identifiers';
import { usePlayRoute } from '@/lib/use-play-route';
import { publicDetailPath } from '../../../../packages/backend/src/public-model';

export function Detail({ napplet, pinned = false }: { napplet: Napplet; pinned?: boolean }) {
  const play = usePlayRoute();
  const store = useEventStore();
  useEffect(() => {
    store.add(napplet.current);
    store.add(napplet.snapshot);
  }, [store, napplet.snapshot.id]);
  return (
    <NappletSocial
      key={napplet.naddr}
      reference={napplet.naddr}
      manifest={pinned ? napplet.snapshot : napplet.current}
      title={napplet.title}
      relays={napplet.relays ?? []}
      sharePath={
        pinned
          ? `/r/${napplet.snapshot.id}`
          : publicDetailPath({ ...napplet, revisionId: napplet.snapshot.id }, true)
      }
    >
      {({ actions, feedback, discussion }) => (
        <section className="detail-page">
          <DiscoveryBackLink />
          <div className="detail-heading">
            <div>
              <span className="eyebrow">NAPPLET{pinned ? ' / PINNED RELEASE' : ''}</span>
              <h1>
                {napplet.title}
                <span className="coral">.</span>
              </h1>
              <CreatorLink pubkey={napplet.pubkey} />
              {actions}
            </div>
            <div className="detail-actions">
              <SaveButton
                item={{
                  ...napplet,
                  naddr: pinned ? null : napplet.naddr,
                  revisionId: napplet.snapshot.id,
                }}
              />
              <Button variant="outline" asChild>
                <Link to={play.playPath} state={play.state} resetScroll={false}>
                  Open player
                </Link>
              </Button>
              {napplet.naddr && <NameButton naddr={napplet.naddr} author={napplet.pubkey} />}
              <RemixButton revision={napplet.snapshot.id} title={napplet.title} />
            </div>
          </div>
          {feedback}
          <Player
            key={napplet.snapshot.id}
            napplet={napplet}
            pinned={pinned}
            immersive={play.immersive}
            detailPath={play.detailPath}
            onEnter={play.enter}
            onExit={play.exit}
          />
          <LinkedAssets manifest={pinned ? napplet.snapshot : napplet.current} />
          <div className="detail-info">
            <div>
              <h2>A little about this one</h2>
              <p>{napplet.description}</p>
              <ArchetypeLinks
                archetypes={pinned ? manifestArchetypes(napplet.snapshot) : napplet.archetypes}
              />
              <TopicTags topics={napplet.topics} />
              <div className="instructions">↳ {napplet.instructions}</div>
            </div>
            <aside>
              <div>
                <span>License</span>
                <strong>{napplet.license}</strong>
              </div>
              <div>
                <span>Package</span>
                <strong>{(napplet.bytes / 1024).toFixed(1)} KB · single HTML</strong>
              </div>
              <div>
                <span>Release</span>
                <Link to="/r/$snapshot" params={{ snapshot: napplet.snapshot.id }}>
                  {napplet.snapshot.id.slice(0, 12)}…
                </Link>
              </div>
              <NostrIdentifiers
                naddr={pinned ? null : napplet.naddr}
                release={napplet.snapshot}
                relays={napplet.relays ?? []}
              />
            </aside>
          </div>
          <Genealogy manifest={pinned ? napplet.snapshot : napplet.current} />
          <SourceSection
            manifest={pinned ? napplet.snapshot : napplet.current}
            revision={napplet.snapshot.id}
            hasArchive={napplet.snapshot.tags.some((tag) => tag[0] === 'source-archive')}
          />
          {discussion}
          <div className="collection-note">
            This example is bundled for local development and hasn’t been published to Nostr.
          </div>
        </section>
      )}
    </NappletSocial>
  );
}
