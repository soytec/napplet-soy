import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { localStudioClient, type StudioClient } from '../../../studio/local-client';
import { localStudioOrigin } from '../../../studio/navigation';
import { useLocation } from '@tanstack/react-router';
import { useBrowserBuild, type BrowserBuildController } from '../../../studio/browser-build-client';

import { useNostr } from './nostr-provider';
import { browserIdentity } from '@/lib/browser-identity';

const StudioConnections = lazy(() => import('./studio-connections'));
const StudioContext = createContext<{
  client?: StudioClient;
  mounted: boolean;
  reconnect: () => void;
  openConnections: () => void;
  browserBuild?: BrowserBuildController;
  setBrowserBuildAvailable: (available: boolean) => void;
}>({
  mounted: false,
  reconnect: () => {},
  openConnections: () => {},
  setBrowserBuildAvailable: () => {},
});

/** Shared settings and compiler session; route navigation never changes the saved drafts. */
export function StudioProvider({ children }: { children: ReactNode }) {
  const identity = useNostr();
  const [connectionAttempt, retry] = useState(0);
  const [client, setClient] = useState<StudioClient>();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [browserBuildAvailable, setBrowserBuildAvailable] = useState(false);
  const pathname = useLocation({ select: (location) => location.pathname });
  const inStudio = pathname === '/studio' || pathname.startsWith('/studio/');
  const browserBuild = useBrowserBuild(client, inStudio && browserBuildAvailable);
  useEffect(() => {
    if (!inStudio) browserBuild.setEnabled(false);
  }, [inStudio, browserBuild.setEnabled]);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let live = true;
    let dispose: (() => Promise<void>) | undefined;
    const pageHide = () => {
      void dispose?.();
    };
    window.addEventListener('pagehide', pageHide);
    setClient(undefined);
    setBrowserBuildAvailable(false);
    const origin = import.meta.env.DEV
      ? localStudioOrigin(window.location.origin, import.meta.env.VITE_QUICK_VIBE_PORT || '4195')
      : undefined;
    if (origin) setClient(localStudioClient(origin));
    else if (identity.pubkey) {
      const pubkey = identity.pubkey;
      void import('../../../studio/hosted-client').then(({ hostedStudioClient }) => {
        if (!live) return;
        const hosted = hostedStudioClient(window.location.origin, {
          pubkey,
          currentPubkey: () => browserIdentity().state.pubkey ?? undefined,
          sign: (key, template) => browserIdentity().sign(key, template),
        });
        dispose = hosted.close;
        setClient(hosted);
      });
    }
    setMounted(true);
    return () => {
      live = false;
      window.removeEventListener('pagehide', pageHide);
      void dispose?.();
    };
  }, [identity.pubkey, connectionAttempt]);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      const target = trigger.current?.isConnected
        ? trigger.current
        : document.getElementById('identity-button');
      target?.focus();
    });
  };
  return (
    <StudioContext.Provider
      value={{
        client,
        mounted,
        reconnect: () => retry((n) => n + 1),
        browserBuild,
        setBrowserBuildAvailable,
        openConnections: () => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        },
      }}
    >
      {children}
      {open && client && (
        <Suspense
          fallback={
            <p className="studio-settings-loading" role="status">
              Opening AI connections…
            </p>
          }
        >
          <StudioConnections client={client} close={close} />
        </Suspense>
      )}
    </StudioContext.Provider>
  );
}

export const useStudio = () => useContext(StudioContext);
