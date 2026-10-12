import { protocolClient, network } from '@/lib/network';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { EventStoreProvider } from 'applesauce-react/providers';
import { createNostrClient } from '../../../../packages/nostr/src/client';
import { enableWasmVerification } from '../../../../packages/protocol/src/verify';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { useAdminAccess, type AdminAccess } from '../lib/admin-client';
import { IdentityMenu } from './identity-menu';
import { communityMode } from '@/lib/community-mode';

if (typeof window !== 'undefined') void enableWasmVerification();

const Context = createContext<{
  pubkey: string | null;
  ready: boolean;
  needsReconnect: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  relayConfigured: boolean;
  adminAccess: AdminAccess;
  refreshAdminAccess: () => Promise<void>;
  community: ReturnType<typeof communityMode.getSnapshot>;
  setCommunityEnabled: (enabled: boolean) => void;
} | null>(null);
const relayUrls = (import.meta.env.VITE_NOSTR_RELAYS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);
export function NostrProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    typeof window === 'undefined' ? createNostrClient() : protocolClient(),
  );
  const [identity, setIdentity] = useState<IdentityState>({
    pubkey: null,
    method: null,
    reconnect: false,
  });
  const [open, setOpen] = useState(false);
  const admin = useAdminAccess(identity.pubkey, open);
  const [ready, setReady] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const community = useSyncExternalStore(
    communityMode.subscribe,
    communityMode.getSnapshot,
    communityMode.getServerSnapshot,
  );
  useEffect(() => {
    if (!identityLoaded && !identity.pubkey) return;
    communityMode.configure(identity.pubkey);
  }, [identity.pubkey, identityLoaded]);
  const connect = async () => {
    document
      .getElementById('identity-button')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    setOpen(true);
  };
  useEffect(() => {
    let alive = true;
    setReady(true);
    const manager = browserIdentity();
    setIdentity(manager.state);
    void manager.initialize().then(
      () => {
        if (alive) setIdentityLoaded(true);
      },
      () => {
        if (alive) setIdentityLoaded(true);
      },
    );
    const sync = () => {
      void manager.sync();
    };
    window.addEventListener('focus', sync);
    const unsubscribe = manager.subscribe(() => {
      setIdentity(manager.state);
      if (manager.state.authorization) void connect();
    });
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('focus', sync);
    };
  }, []);

  return (
    <Context.Provider
      value={{
        pubkey: identity.pubkey,
        adminAccess: admin.access,
        refreshAdminAccess: admin.refresh,
        ready,
        needsReconnect: identity.reconnect || !!identity.restoring,
        connect,
        disconnect: () => browserIdentity().disconnect(),
        relayConfigured: true,
        community,
        setCommunityEnabled: (enabled) => communityMode.setEnabled(enabled),
      }}
    >
      <EventStoreProvider eventStore={client.store}>
        <IdentityMenu
          community={community}
          setCommunityEnabled={(enabled) => communityMode.setEnabled(enabled)}
          adminAccess={admin.access}
          refreshAdminAccess={admin.refresh}
          open={open}
          setOpen={setOpen}
          identity={identity}
        >
          {children}
        </IdentityMenu>
      </EventStoreProvider>
    </Context.Provider>
  );
}
export function useNostr() {
  const value = useContext(Context);
  if (!value) throw new Error('NostrProvider missing');
  return value;
}
