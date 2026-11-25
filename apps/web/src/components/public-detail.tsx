import { DiscoveryBackLink } from './discovery-navigation';
import { LifecycleManager } from './lifecycle-manager';
import { useProtocolRefresh } from '@/lib/use-protocol-refresh';
import { seedCatalog, findManifest } from '@/lib/protocol-catalog';
import { SaveButton } from './saved-napplets';
import { SourceSection } from './source-section';
import { LinkedAssets } from './linked-assets';
import { CreatorLink } from './creator-link';
import { Genealogy } from './genealogy';
import { Link } from '@tanstack/react-router';
import { Code2 } from 'lucide-react';
import { useEffect } from 'react';
import { useEventStore } from 'applesauce-react/hooks';
import { Player } from './player';
import { ArchetypeLinks, TopicTags } from './topic-tags';
import { Button } from './ui/button';
import {
  publicDetailPath,
  publicPoster,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import { NameButton } from './name-button';
import { NappletSocial } from './social-panel';
import { RemixButton } from './remix-button';
import { NostrIdentifiers } from './nostr-identifiers';
import { usePlayRoute } from '@/lib/use-play-route';
import { socialScope } from '../../../../packages/protocol/src/social';

export function PublicDetail({
  napplet,
  pinned = false,
}: {
  napplet: PublicNapplet;
  pinned?: boolean;
}) {
  const play = usePlayRoute();
  const reference = pinned ? napplet.revisionId : (napplet.naddr ?? napplet.revisionId);
  // Relay hints may change during hydration; they do not create a new conversation.
  const scope = socialScope(napplet.manifest).key;
  const refresh = useProtocolRefresh(reference, () => findManifest(reference));
  if (typeof window !== 'undefined') seedCatalog([napplet]);
  const store = useEventStore();
  const artifactUrl = (() => {
    for (const server of napplet.manifest.tags.filter((t) => t[0] === 'server').map((t) => t[1])) {
      try {
        const url = new URL(`${server.replace(/\/$/, '')}/${napplet.artifactHash}`);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
          return url.href;
      } catch {}
    }
    return undefined;
  })();
  useEffect(() => {
    store.add(napplet.manifest);
  }, [store, napplet.revisionId]);
  return (
    <NappletSocial
      key={scope}
      reference={napplet.naddr ?? napplet.revisionId}
      manifest={napplet.manifest}
      title={napplet.title}
      relays={napplet.relays ?? []}
      presentation={napplet}
      sharePath={pinned ? `/r/${napplet.revisionId}` : publicDetailPath(napplet, true)}
    >
      {({ actions, feedback, discussion }) => (
        <section className="detail-page">
          <DiscoveryBackLink />
          {refresh}
          <div className="detail-heading">
            <div>
              <span className="eyebrow">
                NAPPLET{pinned || napplet.manifest.kind === 5129 ? ' / PINNED RELEASE' : ''}
              </span>
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
                  revisionId: napplet.revisionId,
                }}
              />
              <Button variant="outline" asChild>
                <Link
                  to={
                    play.immersive && napplet.availability !== 'ready'
                      ? play.detailPath
                      : play.playPath
                  }
                  state={play.state}
                  resetScroll={false}
                >
                  {play.immersive && napplet.availability !== 'ready'
                    ? 'Back to details'
                    : 'Open player'}
                </Link>
              </Button>
              {napplet.naddr && <NameButton naddr={napplet.naddr} author={napplet.pubkey} />}
              <LifecycleManager
                manifest={napplet.manifest}
                relays={napplet.relays}
                metadata={napplet.metadata}
              />
              <RemixButton revision={napplet.revisionId} title={napplet.title} />
            </div>
          </div>
          {feedback}
          {napplet.availability === 'ready' ? (
            <Player
              key={napplet.revisionId}
              napplet={napplet}
              immersive={play.immersive}
              detailPath={play.detailPath}
              onEnter={play.enter}
              onExit={play.exit}
            />
          ) : (
            <div className="public-preview">
              <img src={publicPoster(napplet)} alt="" />
              <div>
                <h2>
                  {napplet.availability === 'host-required'
                    ? 'This one needs more capabilities.'
                    : 'The creation is currently unavailable.'}
                </h2>
                <p>
                  {napplet.availability === 'host-required'
                    ? `Not supported here yet: ${missingDomains(napplet.domains).join(', ')}.`
                    : 'Its download could not be verified from the listed servers. Please try again after the catalog refreshes.'}
                </p>
              </div>
            </div>
          )}
          <LinkedAssets
            metadata={napplet.metadata}
            manifest={napplet.manifest}
            preview={napplet.preview}
            video={napplet.video}
          />
          <div className="detail-info">
            <div>
              <h2>A little about this one</h2>
              <p>{napplet.description || 'The author has not added a description.'}</p>
              <ArchetypeLinks archetypes={napplet.archetypes} />
              <TopicTags topics={napplet.topics} />
            </div>
            <aside>
              {napplet.sourceUrl && (
                <a href={napplet.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <Code2 size={17} />
                  Original source <span>↗</span>
                </a>
              )}
              {napplet.availability === 'ready' && artifactUrl && (
                <a href={artifactUrl} target="_blank" rel="noopener noreferrer">
                  Download HTML <span>↓</span>
                </a>
              )}
              <div>
                <span>Manifest</span>
                <strong>Kind {napplet.manifest.kind} · signed</strong>
              </div>
              <div>
                <span>License</span>
                <strong>See original source</strong>
              </div>
              <div>
                <span>Package</span>
                <strong>
                  {napplet.bytes === null
                    ? 'Not cached'
                    : `${(napplet.bytes / 1024).toFixed(1)} KB · single HTML`}
                </strong>
              </div>
              <NostrIdentifiers
                naddr={pinned ? null : napplet.naddr}
                release={napplet.manifest}
                relays={napplet.relays ?? []}
              />
            </aside>
          </div>
          <Genealogy manifest={napplet.manifest} />
          <SourceSection
            manifest={napplet.manifest}
            revision={napplet.revisionId}
            hasArchive={napplet.manifest.tags.some((tag) => tag[0] === 'source-archive')}
          />
          {discussion}
          <div className="collection-note">
            {napplet.availability === 'ready' &&
              'Playback supports session files, resources and Nostr reads. Uploads and supported social/list changes require your connected identity and approval. '}
            Discovered on Nostr. The author’s signature and artifact hashes are checked
            independently of the relay and Blossom server.
          </div>
        </section>
      )}
    </NappletSocial>
  );
}
