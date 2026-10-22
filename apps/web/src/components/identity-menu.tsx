import type { AdminAccess } from '../lib/admin-client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { nip19 } from 'nostr-tools';
import { CreatorLink } from './creator-link';
import {
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Smartphone,
  Settings2,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverClose, PopoverContent } from './ui/popover';
import { LightningCode } from './lightning-code';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { defaultSignerRelays } from '../../../../packages/identity/src/signer';
import { CreateKeyPanel, KeyBackup } from './key-backup';
import { useStudio } from './studio-provider';
import { IntentHandlerSettings } from './intent-handler-settings';

import { WorkDot } from './work-provider';

export function IdentityMenu({
  open,
  setOpen,
  identity,
  children,
  adminAccess,
  refreshAdminAccess,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  identity: IdentityState;
  children: ReactNode;
  adminAccess: AdminAccess;
  refreshAdminAccess: () => Promise<void>;
}) {
  const studio = useStudio();
  const titleId = useId(),
    descriptionId = useId();
  type Method = 'extension' | 'remote' | 'key' | 'create';
  const [method, setMethod] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [editableRemember, setEditableRemember] = useState(false);
  const [error, setError] = useState('');
  const [uri, setUri] = useState('');
  const [auth, setAuth] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [showBackup, setShowBackup] = useState(false);
  const [relay, setRelay] = useState(defaultSignerRelays[0]);
  const [showRelay, setShowRelay] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [remember, setRemember] = useState(true);
  const rememberChoice = useRef(remember);
  const [rememberKey, setRememberKey] = useState(false);
  const attempt = useRef(0);
  function cancel() {
    attempt.current++;
    browserIdentity().cancel();
    setBusy(false);
    setEditableRemember(false);
    setUri('');
    setAuth('');
    setSecret('');
    setPassword('');
    setShowBackup(false);
    setAccepted(false);
    setError('');
  }
  function changeOpen(value: boolean) {
    if (!value) cancel();
    setOpen(value);
  }
  async function run(
    operation: (
      onAuth: (url: string) => Promise<void>,
      onPairing: (uri: string) => void,
    ) => Promise<void>,
    options: { editableRemember?: boolean } = {},
  ) {
    const current = ++attempt.current;
    setBusy(true);
    setEditableRemember(!!options.editableRemember);
    setError('');
    setUri('');
    setAuth('');
    try {
      await operation(
        async (url) => {
          if (current === attempt.current) setAuth(url);
        },
        (link) => {
          if (current === attempt.current) setUri(link);
        },
      );
      if (current === attempt.current) changeOpen(false);
    } catch (error) {
      if (current === attempt.current)
        setError(error instanceof Error ? error.message : 'Could not connect. Please retry.');
    } finally {
      if (current === attempt.current) {
        setBusy(false);
        setEditableRemember(false);
        setUri('');
        setAuth('');
      }
    }
  }
  function startRemotePairing(nextRelay = relay) {
    void run(
      (onAuth, onPairing) =>
        browserIdentity().pair(
          [nextRelay.trim()],
          onPairing,
          { onAuth },
          () => rememberChoice.current,
        ),
      { editableRemember: true },
    );
  }
  function selectMethod(value: Method) {
    cancel();
    setMethod(value);
    setShowRelay(false);
    if (value === 'remote') startRemotePairing();
  }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      {children}
      <PopoverContent
        className="identity-menu"
        aria-labelledby={titleId}
        aria-describedby={method ? undefined : descriptionId}
      >
        <div className="identity-menu-heading">
          <h2 id={titleId}>Account & settings</h2>
          <PopoverClose asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Close">
              <X size={15} />
            </Button>
          </PopoverClose>
        </div>
        {!method && (
          <p id={descriptionId} className="muted identity-menu-description">
            One identity for comments, likes, zaps and your creations. Remembered accounts survive
            reloads on this device for 30 days. Browsing and creating need no website account.
          </p>
        )}
        {identity.pubkey && (
          <div className="identity-current">
            <span className="muted">
              {identity.reconnect ? 'Selected through ' : 'Connected through '}
              {identity.method === 'key'
                ? 'a key in browser memory'
                : identity.method === 'remote'
                  ? 'a remote signer'
                  : 'your extension'}
            </span>
            <code className="public-key">{identity.pubkey}</code>
            <Button variant="outline" asChild>
              <Link
                to="/p/$pubkey"
                params={{ pubkey: nip19.npubEncode(identity.pubkey) }}
                search={{ page: 1, all: false }}
                onClick={() => changeOpen(false)}
              >
                View & edit your profile
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/manage" onClick={() => changeOpen(false)}>
                My work <WorkDot />
              </Link>
            </Button>
            {adminAccess === 'authorized' && (
              <Button variant="outline" asChild>
                <Link to="/admin" onClick={() => changeOpen(false)}>
                  <ShieldCheck size={16} /> Administration
                </Link>
              </Button>
            )}
            {adminAccess === 'checking' && (
              <span className="muted" role="status">
                Checking admin access…
              </span>
            )}
            {adminAccess === 'error' && (
              <Button variant="ghost" onClick={() => void refreshAdminAccess()}>
                Retry admin access check
              </Button>
            )}
            {identity.method === 'key' && !identity.reconnect && (
              <>
                <Button variant="outline" onClick={() => setShowBackup(!showBackup)}>
                  {showBackup ? 'Close backup' : 'Back up private key'}
                </Button>
                {open && showBackup && (
                  <KeyBackup
                    key={identity.pubkey}
                    pubkey={identity.pubkey}
                    exportBackup={(phrase, signal) =>
                      browserIdentity().backup(identity.pubkey!, phrase, signal)
                    }
                  />
                )}
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                cancel();
                void browserIdentity().disconnect();
              }}
            >
              Sign out
            </Button>
            <p className="muted">
              Sign out keeps remembered accounts here. Forget removes them from this browser.
            </p>
          </div>
        )}
        {identity.reconnect && (
          <Button
            onClick={() => run((onAuth) => browserIdentity().reconnect({ onAuth }))}
            disabled={busy}
          >
            Reconnect selected signer
          </Button>
        )}
        {identity.restoring && <p role="status">Restoring your selected account…</p>}
        {identity.warning && (
          <p role="alert" className="error-message">
            {identity.warning}
          </p>
        )}
        {!!identity.sessions?.length && (
          <div className="saved-sessions">
            <h3>Accounts on this device</h3>
            {identity.sessions.map((session) => (
              <div className="saved-session" key={session.id}>
                <div>
                  <CreatorLink pubkey={session.pubkey} linked={false} />
                  <span className="muted">
                    {session.method === 'key'
                      ? 'Private key'
                      : session.method === 'remote'
                        ? 'Remote signer'
                        : 'Extension'}{' '}
                    · {session.remembered ? 'Remembered' : 'This visit only'}
                    {session.id === identity.activeId ? ' · Selected' : ''}
                  </span>
                </div>
                <div className="identity-methods">
                  {session.id !== identity.activeId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Use account ${session.pubkey.slice(0, 10)}`}
                      onClick={() =>
                        run((onAuth) => browserIdentity().useSession(session.id, { onAuth }))
                      }
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Forget account ${session.pubkey.slice(0, 10)}`}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await browserIdentity().forget(session.id);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Forget
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="identity-methods" aria-label="Sign-in method">
          {(
            [
              ['extension', ShieldCheck, 'Extension'],
              ['remote', Smartphone, 'Remote signer'],
              ['key', KeyRound, 'Private key'],
              ['create', Plus, 'Create identity'],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              variant={method === value ? 'default' : 'outline'}
              aria-pressed={method === value}
              onClick={() => selectMethod(value)}
            >
              <Icon size={15} />
              {label}
            </Button>
          ))}
        </div>
        {method && (
          <label className="identity-consent">
            <input
              type="checkbox"
              checked={method === 'key' || method === 'create' ? rememberKey : remember}
              disabled={busy && !editableRemember}
              onChange={(event) => {
                if (method === 'key' || method === 'create') setRememberKey(event.target.checked);
                else {
                  rememberChoice.current = event.target.checked;
                  setRemember(event.target.checked);
                }
              }}
            />
            Remember this {method === 'key' || method === 'create' ? 'private key' : 'connection'}{' '}
            on this device
          </label>
        )}
        {method === 'extension' && (
          <Button disabled={busy} onClick={() => run(() => browserIdentity().extension(remember))}>
            Connect browser extension
          </Button>
        )}
        {method === 'remote' && (
          <>
            {uri && (
              <div className="identity-pairing">
                <LightningCode
                  value={uri}
                  label="Scan this Nostr Connect pairing code in your signer"
                  preserveCase
                />
                <p>Waiting for approval · up to 2 minutes</p>
                <p className="muted">Keep this one-time connection link private.</p>
                <div className="identity-methods">
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(uri)
                        .catch(() => setError('Copy unavailable. Select and copy the link below.'))
                    }
                  >
                    <Copy size={14} />
                    Copy connection link
                  </Button>
                  <Button asChild>
                    <a href={uri} rel="noreferrer">
                      Open signer <ExternalLink size={14} />
                    </a>
                  </Button>
                </div>
                <textarea aria-label="Connection link" readOnly value={uri} rows={3} />
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const link = secret;
                setSecret('');
                void run(
                  (onAuth) =>
                    browserIdentity().bunker(link, { onAuth }, () => rememberChoice.current),
                  { editableRemember: true },
                );
              }}
              className="identity-form"
            >
              <label className="identity-field">
                Bunker URI
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="bunker://…"
                />
              </label>
              <Button variant="outline" disabled={!secret.trim()}>
                Connect bunker
              </Button>
            </form>
            <Button
              variant="ghost"
              aria-expanded={showRelay}
              onClick={() => setShowRelay(!showRelay)}
            >
              {showRelay ? 'Hide signer relay' : 'Change signer relay'}
            </Button>
            {showRelay && (
              <form
                className="identity-form identity-relay-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  startRemotePairing(relay);
                }}
              >
                <label className="identity-field">
                  Signer relay
                  <input
                    type="url"
                    value={relay}
                    onChange={(e) => setRelay(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <Button variant="outline" disabled={!relay.trim()}>
                  Use signer relay
                </Button>
              </form>
            )}
            {!busy && !uri && (
              <Button variant="outline" onClick={() => startRemotePairing(relay)}>
                Create new connection code
              </Button>
            )}
          </>
        )}
        {open && method === 'create' && (
          <CreateKeyPanel remember={rememberKey} onConnected={() => changeOpen(false)} />
        )}
        {method === 'key' && (
          <form
            className="identity-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!accepted) return;
              const key = secret;
              const phrase = password;
              setSecret('');
              setPassword('');
              void run(() => browserIdentity().importKey(key, phrase, rememberKey));
            }}
          >
            <div className="identity-warning" role="note">
              <strong>Only paste a key you trust this website with.</strong>
              <p>
                A private key grants control of your Nostr identity. Extensions and remote signers
                keep it outside the website. Without Remember, imported keys stay in this page’s
                memory and are cleared on sign-out or refresh.
              </p>
            </div>
            <label className="identity-consent">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={busy}
              />
              I understand the risk of importing my private key.
            </label>
            <label className="identity-field">
              Private key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="nsec1… or hexadecimal key"
                maxLength={300}
                disabled={busy}
              />
            </label>
            <label className="identity-field">
              Recovery file
              <input
                type="file"
                accept=".ncryptsec,.nsec,.txt,text/plain"
                disabled={busy}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  const current = ++attempt.current;
                  setSecret('');
                  setPassword('');
                  setError('');
                  if (file.size > 320) {
                    setError(
                      'Choose a small text file containing one nsec or ncryptsec recovery key.',
                    );
                    return;
                  }
                  try {
                    const value = (await file.text()).trim();
                    if (current === attempt.current) setSecret(value);
                  } catch {
                    if (current === attempt.current) setError('Could not read this recovery file.');
                  }
                }}
              />
            </label>
            {secret.trim().startsWith('ncryptsec1') && (
              <label className="identity-field">
                Recovery passphrase
                <input
                  type="password"
                  autoComplete="off"
                  maxLength={1024}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            <Button
              disabled={
                busy ||
                !accepted ||
                !secret.trim() ||
                (secret.trim().startsWith('ncryptsec1') && !password)
              }
            >
              Use key for this session
            </Button>
          </form>
        )}
        {(identity.authorization || auth) && (
          <p role="status">
            <a href={identity.authorization || auth} target="_blank" rel="noopener noreferrer">
              Approve this request in your signer <ExternalLink size={14} />
            </a>
          </p>
        )}
        {busy && (
          <div className="identity-methods" role="status">
            <LoaderCircle className="animate-spin" size={16} />
            {method === 'key' ? 'Opening your identity…' : 'Waiting for your signer…'}
            <Button variant="outline" onClick={cancel}>
              Cancel connection
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {!busy && (
          <section className="identity-settings" aria-label="App settings">
            <h3>Settings</h3>
            {studio.client && (
              <Button
                variant="outline"
                onClick={() => {
                  changeOpen(false);
                  studio.openConnections();
                }}
              >
                <Settings2 size={16} /> AI connections
              </Button>
            )}
            <IntentHandlerSettings />
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
