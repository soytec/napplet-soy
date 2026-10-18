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

const StudioConnections = lazy(() => import('./studio-connections'));
const StudioContext = createContext<{
  client?: StudioClient;
  mounted: boolean;
  openConnections: () => void;
}>({ mounted: false, openConnections: () => {} });

/** The shell owns connection settings; opening another page never changes the worker or drafts. */
export function StudioProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<StudioClient>();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const origin = import.meta.env.DEV
      ? localStudioOrigin(window.location.origin, import.meta.env.VITE_QUICK_VIBE_PORT || '4195')
      : undefined;
    if (origin) setClient(localStudioClient(origin));
    setMounted(true);
  }, []);
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
