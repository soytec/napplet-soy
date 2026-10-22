import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useNostr } from '@/components/nostr-provider';
import { Button } from '@/components/ui/button';
import { LifecycleManager } from '@/components/lifecycle-manager';
import { savedLifecycles, saveLifecycle } from '@/lib/lifecycle';
import { useWork, WorkDot } from '@/components/work-provider';
import { WorkOverview } from '@/components/work-overview';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
import {
  lifecycleUrl,
  nappletKey,
  parseReceipt,
  listingRemoved,
  type LifecycleReceipt,
} from '../../../../packages/lifecycle/src';

export const Route = createFileRoute('/manage')({
  head: () => ({
    meta: [{ title: 'My work — napplet.soy' }, { name: 'robots', content: 'noindex' }],
  }),
  component: Manage,
});
function Manage() {
  const { pubkey, connect } = useNostr();
  const work = useWork();
  const items = work.publications;
  const loading = work.loading;
  const [view, setView] = useState<'creations' | 'proposals' | 'activity'>('creations');
  const [records, setRecords] = useState<LifecycleReceipt[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (!pubkey) {
      setRecords([]);
      return;
    }
    setError('');
    const update = () => {
      try {
        setRecords(savedLifecycles(pubkey));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    update();
    window.addEventListener('napplet-lifecycle', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('napplet-lifecycle', update);
      window.removeEventListener('storage', update);
    };
  }, [pubkey]);
  const rows = new Map<string, { n?: PublicNapplet; record?: LifecycleReceipt }>(
    items.map((n) => [
      nappletKey(n.manifest),
      { n, record: undefined as LifecycleReceipt | undefined },
    ]),
  );
  for (const record of records) {
    if (record.plan.author !== pubkey) continue;
    const found = rows.get(record.plan.key);
    rows.set(record.plan.key, { n: found?.n, record });
  }
  return (
    <section className="detail-page work-page">
      <span className="eyebrow">YOUR WORKSPACE</span>
      <h1>
        My work<span className="coral">.</span>
      </h1>
      <p>Your creations, contributions and conversations, in one place.</p>
      {!pubkey ? (
        <Button onClick={() => void connect()}>Sign in to see your work</Button>
      ) : (
        <>
          <div className="work-navigation" role="group" aria-label="My work sections">
            <Button
              variant={view === 'creations' ? 'default' : 'outline'}
              onClick={() => setView('creations')}
              aria-pressed={view === 'creations'}
            >
              Creations
            </Button>
            <Button
              variant={view === 'proposals' ? 'default' : 'outline'}
              onClick={() => setView('proposals')}
              aria-pressed={view === 'proposals'}
            >
              Proposals (
              {work.proposals.filter((p) => p.incoming && p.proposal.status === 'open').length}{' '}
              incoming)
            </Button>
            <Button
              variant={view === 'activity' ? 'default' : 'outline'}
              onClick={() => setView('activity')}
              aria-pressed={view === 'activity'}
            >
              Activity <WorkDot />
            </Button>
            <Button variant="ghost" disabled={loading} onClick={work.refresh}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
          {work.error && <p role="alert">{work.error} Your last loaded activity is retained.</p>}
          {work.warnings.map((w) => (
            <p key={w} className="muted">
              {w}
            </p>
          ))}
          <WorkOverview view={view} />
          {view === 'creations' && (
            <>
              <h2>Published napplets</h2>
              <details className="work-recovery">
                <summary>Publication recovery records</summary>
                <label className="back-link">
                  Restore a saved recovery record{' '}
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={async (e) => {
                      try {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 4 * 1024 * 1024)
                          throw new Error('Recovery record exceeds 4 MiB.');
                        const r = parseReceipt(JSON.parse(await f.text()));
                        if (r.plan.author !== pubkey)
                          throw new Error('Select the author identity for this record.');
                        saveLifecycle(r);
                        setError('');
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              </details>
              {loading && <p role="status">Finding your publications…</p>}
              <div className="manage-list">
                {[...rows].map(([key, { n, record }]) => (
                  <article className="manage-entry" key={key}>
                    <div>
                      <h2>{record?.plan.title ?? n!.title}</h2>
                      <p>
                        {record
                          ? listingRemoved(record)
                            ? 'Unpublished · recovery record saved'
                            : record.operation === 'republish'
                              ? 'Republished or in progress'
                              : 'Saved operation'
                          : 'Published on Nostr'}
                      </p>
                      <div className="work-entry-actions">
                        <Link to={record ? lifecycleUrl(record.plan) : `/n/${n!.naddr}`}>
                          Open napplet
                        </Link>
                        <Link
                          to={record ? lifecycleUrl(record.plan) : `/n/${n!.naddr}`}
                          hash="proposals"
                        >
                          Review proposals (
                          {
                            work.proposals.filter(
                              (p) =>
                                p.publication?.manifest.id === n?.manifest.id &&
                                ['open', 'draft'].includes(p.proposal.status),
                            ).length
                          }
                          )
                        </Link>
                      </div>
                    </div>
                    <LifecycleManager
                      manifest={record?.plan.manifest ?? n!.manifest}
                      relays={record?.plan.relays ?? n!.relays}
                      metadata={record?.plan.metadata ?? n!.metadata}
                      saved={record}
                    />
                  </article>
                ))}
              </div>
              {!loading && !rows.size && (
                <p>No publications or saved recovery records found for this identity.</p>
              )}
              <p className="muted">
                An unpublished listing may no longer be available from relays. Keep the recovery
                record or your soyLI project to republish from another device.
              </p>
            </>
          )}
        </>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
