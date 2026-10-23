import { WalletButton } from './wallet/wallet-button';
import { AppearanceControl } from '../../../../packages/runtime/src/appearance-control';
import { Link, useLocation } from '@tanstack/react-router';
import { ArrowUpRight, CircleAlert, CircleHelp, Radio, Sparkles, Terminal } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useNostr } from './nostr-provider';
import { PopoverTrigger } from './ui/popover';
import { ProfileAvatar } from './creator-link';
import { useProfile } from '@/lib/profiles';
import { shortPubkey } from '../../../../packages/protocol/src/profile';
import { StudioLink } from './studio-link';
import { WorkDot } from './work-provider';

function ConnectedIdentity({
  pubkey,
  needsReconnect,
}: {
  pubkey: string;
  needsReconnect: boolean;
}) {
  const profile = useProfile(pubkey);
  const name =
    profile?.name && profile.name !== shortPubkey(pubkey) ? profile.name : `${pubkey.slice(0, 6)}…`;
  return (
    <span className="identity-button-account" title={`${name} · ${pubkey}`}>
      <ProfileAvatar key={pubkey} profile={profile} name={name} />
      <span className="identity-button-name">{name}</span>
      {needsReconnect && <CircleAlert size={14} aria-label="Unlock or reconnect your signer" />}
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { pubkey, ready, relayConfigured, needsReconnect } = useNostr();
  const pathname = useLocation({ select: (location) => location.pathname });
  const studio = pathname === '/studio' || pathname.startsWith('/studio/');
  const workspace = /^\/studio\/[a-f0-9-]{36}$/.test(pathname);
  return (
    <div
      className={`site-shell${studio ? ' studio-shell' : ''}${workspace ? ' studio-workspace-shell' : ''}`}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="napplet.soy home">
          <img
            className="brand-mark"
            src="/brand/soy-mascot.png"
            width={1254}
            height={1254}
            alt=""
          />
          <span className="brand-wordmark">napplet.soy</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link
            to="/"
            search={{ tag: '', sort: 'curated', q: '' }}
            hash="explore"
            activeProps={{ className: 'nav-active' }}
          >
            Explore
          </Link>
          <Link to="/manage" activeProps={{ className: 'nav-active' }}>
            Manage <WorkDot />
          </Link>
          <Link to="/docs" activeProps={{ className: 'nav-active' }}>
            Docs
          </Link>
        </nav>
        <div className="header-create-actions" aria-label="Create a napplet">
          <StudioLink
            path="/create"
            className="header-create-button browser"
            data-tone="mint"
            data-effect="create"
          >
            <Sparkles size={16} /> Create in browser
          </StudioLink>
          <Link
            to="/create"
            hash="local-soyli"
            className="header-create-button"
            data-tone="lilac"
            data-effect="source"
          >
            <Terminal size={16} /> Use soyLI locally
          </Link>
        </div>
        <div className="header-actions">
          <AppearanceControl />
          <Button asChild variant="ghost" size="icon" className="about-link">
            <Link to="/about" aria-label="About napplet.soy" title="About napplet.soy">
              <CircleHelp size={19} />
            </Link>
          </Button>
          <WalletButton />
          <PopoverTrigger asChild>
            <Button
              id="identity-button"
              variant="outline"
              className="connect-button"
              disabled={!ready}
              title={
                pubkey && needsReconnect
                  ? 'Account selected — unlock or reconnect your signer'
                  : 'Account & settings'
              }
            >
              {pubkey ? (
                <ConnectedIdentity pubkey={pubkey} needsReconnect={needsReconnect} />
              ) : (
                'Connect'
              )}
              <WorkDot />
            </Button>
          </PopoverTrigger>
        </div>
      </header>
      <main id="main">{children}</main>
      {!studio && (
        <footer className="site-footer">
          <span>
            <img
              className="footer-brand-mark"
              src="/brand/soy-mascot.png"
              width={1254}
              height={1254}
              alt=""
            />{' '}
            Small creations. Wide-open possibilities.
          </span>
          <div>
            <Link to="/manage" hash="relays" className="network-label">
              <Radio size={12} />
              Network settings
            </Link>
            <Link to="/admin">Administration</Link>
            <Link to="/docs">soyLI docs</Link>
            <Link to="/about">About</Link>
            <a href="https://github.com/napplet/naps" target="_blank" rel="noreferrer">
              The protocol <ArrowUpRight size={13} />
            </a>
          </div>
        </footer>
      )}
    </div>
  );
}
