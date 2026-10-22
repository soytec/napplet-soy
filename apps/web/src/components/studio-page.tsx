import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useNostr } from './nostr-provider';
import { browserIdentity } from '@/lib/browser-identity';
import { StudioApp } from '../../../studio/ui';
import { studioRoute } from '../../../studio/navigation';
import { useStudio } from './studio-provider';

export function StudioPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const identity = useNostr();
  const { client, mounted, openConnections, browserBuild, setBrowserBuildAvailable, reconnect } =
    useStudio();
  const route = useMemo(
    () => studioRoute(new URL(location.href, 'http://shell.local')),
    [location.href],
  );
  if (!mounted) return <p role="status">Opening Studio…</p>;
  if (!client && !import.meta.env.DEV && identity.pubkey)
    return <p role="status">Opening your Studio…</p>;
  if (!client && !import.meta.env.DEV)
    return (
      <section className="create-page">
        <h1>Your Studio</h1>
        <p>Connect your account to open your private drafts and AI connections.</p>
        <button onClick={() => void identity.connect()}>Connect account</button>
      </section>
    );
  if (!client || !browserBuild)
    return (
      <section className="create-page">
        <span className="eyebrow">YOUR IDEAS, A PLACE TO GROW</span>
        <h1>Studio · local beta</h1>
        <p>
          Browser creation is currently available in the local development build. Start the Studio
          worker with <code>bun run studio</code> alongside the shell.
        </p>
        <p>
          Hosted access is still being built. Your local drafts stay on the computer running Studio.
        </p>
        <p>
          <a href="https://github.com/soytec/napplet-soy/blob/main/docs/QUICK-VIBE.md#start">
            Local Studio setup and requirements →
          </a>
        </p>
        <Link to="/create" hash="local-soyli">
          Use soyLI locally →
        </Link>
      </section>
    );
  return (
    <StudioApp
      key={client.mode === 'hosted' ? identity.pubkey : 'local'}
      reconnect={reconnect}
      client={client}
      browserBuild={browserBuild}
      setBrowserBuildAvailable={setBrowserBuildAvailable}
      openConnections={openConnections}
      route={route}
      navigate={(href) => {
        void navigate({ href });
      }}
      account={{
        pubkey: identity.pubkey,
        connect: identity.connect,
        currentPubkey: () => browserIdentity().state.pubkey,
        sign: (pubkey, template) => browserIdentity().sign(pubkey, template),
      }}
    />
  );
}
