import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicationDialog } from '../../../apps/studio/publication-ui';
import type { Project } from '../../../apps/studio/types';

const first = new URLSearchParams(location.search).has('first');
const initial = await fetch(`/state?first=${first}`).then((r) => r.json());
function Fixture() {
  const [project, setProject] = useState<Project>(initial);
  const [busy, setBusy] = useState(false);
  const pubkey = 'a'.repeat(64);
  const session = { id: 'fixture-signer', pubkey };
  const api = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch('/api', {
      method: 'POST',
      body: JSON.stringify({ first, path, body }),
    });
    const result = await response.json();
    if (path.endsWith('/prepare-publication'))
      setProject({ ...project, publication: { review: result } });
    return result;
  };
  return (
    <main className="studio-surface">
      <PublicationDialog
        project={project}
        busy={busy}
        api={api}
        media={async (path) =>
          (await fetch(path.includes('.webm') ? '/clip.webm' : '/cover.png')).blob()
        }
        action={async (fn) => {
          setBusy(true);
          try {
            await fn();
          } finally {
            setBusy(false);
          }
        }}
        signer={{
          pubkey,
          session,
          status: 'Using your signed-in shell account',
          connect: async () => session,
        }}
        close={() => {}}
        chat={() => {
          throw new Error('Unexpected chat for this update');
        }}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
