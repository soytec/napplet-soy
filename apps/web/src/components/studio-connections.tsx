import { useEffect, useState } from 'react';
import { ConnectionsDialog } from '../../../studio/connections-ui';
import type { StudioClient } from '../../../studio/local-client';
import type { StudioState } from '../../../studio/types';
import '../../../studio/style.css';

export default function StudioConnections({
  client,
  close,
}: {
  client: StudioClient;
  close: () => void;
}) {
  const [state, setState] = useState<StudioState>();
  const [error, setError] = useState('');
  const refresh = async () => {
    setState(await client.api<StudioState>('state'));
    setError('');
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.api<StudioState>('state');
        if (live) {
          setState(next);
          setError('');
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client]);
  return (
    <div className="studio-surface studio-settings">
      <ConnectionsDialog
        state={state?.connections ?? { connections: [] }}
        busy={!!state?.busy}
        loading={!state}
        loadError={error}
        api={client.api}
        refresh={refresh}
        close={close}
      />
    </div>
  );
}
