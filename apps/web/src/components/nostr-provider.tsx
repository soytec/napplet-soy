import { protocolClient, network } from '@/lib/network';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EventStoreProvider } from 'applesauce-react/providers';
import { createNostrClient } from '../../../../packages/nostr/src/client';
import { enableWasmVerification } from '../../../../packages/protocol/src/verify';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { useAdminAccess, type AdminAccess } from '../lib/admin-client';
import { IdentityMenu } from './identity-menu';
import { StudioProvider } from './studio-provider';
import { WorkProvider } from './work-provider';

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
  const connect = async () => {
    document
      .getElementById('identity-button')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    setOpen(true);
  };
  useEffect(() => {
    setReady(true);
    const manager = browserIdentity();
    setIdentity(manager.state);
    void manager.initialize();
    const sync = () => {
      void manager.sync();
    };
    window.addEventListener('focus', sync);
    const unsubscribe = manager.subscribe(() => {
      setIdentity(manager.state);
      if (manager.state.authorization) void connect();
    });
    return () => {
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
      }}
    >
      <EventStoreProvider eventStore={client.store}>
        {/* Studio consumes identity; the account menu consumes Studio settings. */}
        <StudioProvider>
          <WorkProvider>
            <IdentityMenu
              adminAccess={admin.access}
              refreshAdminAccess={admin.refresh}
              open={open}
              setOpen={setOpen}
              identity={identity}
            >
              {children}
            </IdentityMenu>
          </WorkProvider>
        </StudioProvider>
      </EventStoreProvider>
    </Context.Provider>
  );
}
export function useNostr() {
  const value = useContext(Context);
  if (!value) throw new Error('NostrProvider missing');
  return value;
}
