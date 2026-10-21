import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNostr } from './nostr-provider';
import { queryCatalog } from '@/lib/protocol-catalog';
import { protocolClient } from '@/lib/network';
import {
  emptyWork,
  readWork,
  WorkReadState,
  type WorkData,
} from '../../../../packages/client/src/work';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';

const empty = {
  ...emptyWork(),
  publications: [] as PublicNapplet[],
  loading: false,
  error: '',
  unread: (_id: string) => false,
  count: 0,
  mark: (_ids: string[]) => {},
  refresh: () => {},
};
const Context = createContext(empty);
export function WorkProvider({ children }: { children: ReactNode }) {
  const { pubkey } = useNostr();
  const [snapshot, setSnapshot] = useState<{
    account: string;
    data: WorkData;
    publications: PublicNapplet[];
  }>();
  const [status, setStatus] = useState<{ account: string; loading: boolean; error: string }>();
  const [, updateRead] = useState(0);
  const [generation, refresh] = useState(0);
  const markers = useRef<{ account: string; value: WorkReadState } | undefined>(undefined);
  useEffect(() => {
    if (!pubkey) {
      markers.current = undefined;
      return;
    }
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {}
    markers.current = { account: pubkey, value: new WorkReadState(pubkey, storage) };
    updateRead((n) => n + 1);
    const changed = (event: StorageEvent) => {
      if (event.key === markers.current?.value.key || event.key === null) {
        markers.current = { account: pubkey, value: new WorkReadState(pubkey, storage) };
        updateRead((n) => n + 1);
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [pubkey]);
  useEffect(() => {
    if (!pubkey) return;
    let active = true,
      running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running || !active || document.hidden) return;
      running = true;
      setStatus({ account: pubkey, loading: true, error: '' });
      try {
        const publications = await queryCatalog(pubkey);
        if (!active) return;
        setSnapshot((previous) => ({
          account: pubkey,
          publications,
          data: previous?.account === pubkey ? previous.data : emptyWork(),
        }));
        const data = await readWork(
          protocolClient(),
          pubkey,
          publications.map((p) => ({
            manifest: p.manifest,
            title: p.title,
            href: `/n/${p.naddr}`,
            relays: p.relays,
          })),
          AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
          (data) => {
            if (active) setSnapshot({ account: pubkey, publications, data });
          },
        );
        if (active) {
          setSnapshot({ account: pubkey, publications, data });
          setStatus({ account: pubkey, loading: false, error: '' });
        }
      } catch (error) {
        if (active)
          setStatus({
            account: pubkey,
            loading: false,
            error: (error as Error).message || 'Activity could not be refreshed.',
          });
      } finally {
        running = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), 60000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [pubkey, generation]);
  const current = snapshot?.account === pubkey ? snapshot : undefined;
  const read = markers.current?.account === pubkey ? markers.current.value : undefined;
  const unread = (id: string) => !!read && read.unread(id);
  const data = current?.data ?? emptyWork();
  return (
    <Context.Provider
      value={{
        ...data,
        publications: current?.publications ?? [],
        loading: status?.account === pubkey && status.loading,
        error: status?.account === pubkey ? status.error : '',
        unread,
        count: data.activity.filter((a) => unread(a.id)).length,
        mark: (ids) => {
          if (markers.current?.account !== pubkey) return;
          markers.current.value.mark(ids);
          updateRead((n) => n + 1);
        },
        refresh: () => refresh((n) => n + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useWork = () => useContext(Context);
export function WorkDot() {
  const { count } = useWork();
  return count ? (
    <span
      className="work-dot"
      role="img"
      aria-label={`${count} unread activity items`}
      title={`${count} unread activity items`}
    />
  ) : null;
}
