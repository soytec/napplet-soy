import React from 'react';
import { createRoot } from 'react-dom/client';
import { useCountRankings } from '../../apps/web/src/lib/use-count-rankings';
import { rankingNotice } from '../../apps/web/src/lib/count-rankings';
import { configureClient } from '../../apps/web/src/lib/network';
import type { PublicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';

configureClient({ relays: [`ws://${location.host}`], blossom: [], rules: [], featured: [] });
const entries = fixtures.slice(0, 2).map((entry, index) => ({
  manifest: entry.current,
  revisionId: entry.current.id,
  title: `Game ${index + 1}`,
})) as PublicNapplet[];
function App() {
  const rankings = useCountRankings(entries);
  return (
    <>
      {(['liked', 'commented'] as const).map((kind) => (
        <section key={kind} aria-label={kind}>
          <output data-state>{rankings.status[kind]}</output>
          <p role="status">{rankingNotice(rankings.status[kind])}</p>
          <ul>
            {rankings[kind].map((entry) => (
              <li key={entry.revisionId}>{entry.title}</li>
            ))}
          </ul>
        </section>
      ))}
      <button onClick={rankings.retry}>Retry counts</button>
      <output>{rankings.retryError}</output>
    </>
  );
}
createRoot(document.getElementById('app')!).render(<App />);
