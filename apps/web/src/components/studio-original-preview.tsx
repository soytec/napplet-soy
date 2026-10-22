import { useEffect, useState } from 'react';
import { discoveryTarget } from '../../../../packages/protocol/src/discovery';
import { lookupProtocol } from '@/lib/protocol-catalog';
import { Player } from './player';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';

/** Published playback without running project tools, editing the draft or starting inference. */
export function StudioOriginalPreview({ source }: { source: string }) {
  const [napplet, setNapplet] = useState<PublicNapplet>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Import can pin the same event that the initial link already resolved.
    // Preserve its live game rather than restarting it when that metadata arrives.
    if (napplet?.revisionId === source) return;
    let live = true;
    setNapplet(undefined);
    setError('');
    void (async () => {
      const target = discoveryTarget(source);
      const found = await lookupProtocol(target);
      if (!found)
        throw new Error('The original napplet could not be found on the connected relays.');
      if (live) setNapplet(found);
    })().catch((reason) => {
      if (live)
        setError(reason instanceof Error ? reason.message : 'The original preview could not load.');
    });
    return () => {
      live = false;
    };
  }, [source, attempt]);
  return (
    <div className="studio-original-preview">
      {napplet ? (
        <Player key={napplet.revisionId} napplet={napplet} pinned autoPlay embedded />
      ) : (
        <div className="empty-preview" role={error ? 'alert' : 'status'}>
          <h2>{error ? 'Original preview unavailable' : 'Opening the original napplet…'}</h2>
          <p>{error || 'Loading its published version while your draft gets ready.'}</p>
          {error && (
            <>
              <p>You can keep working on your remix.</p>
              <button className="outline" onClick={() => setAttempt((n) => n + 1)}>
                Retry original preview
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
