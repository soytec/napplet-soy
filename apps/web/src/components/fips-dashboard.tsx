import { useId, useState, useSyncExternalStore } from 'react';
import { Network, Unplug, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { fipsConnectionStatus } from './fips-indicator';
import {
  clearRecentSessions,
  clearSessionCache,
  disconnectAll,
  disconnectSession,
  fipsDashboardSnapshot,
  revokeGrant,
  serverFipsDashboardSnapshot,
  subscribeFipsDashboard,
  type FipsDashboardSession,
} from '../../../../packages/runtime/src/fips/dashboard';
import {
  fipsEnabled,
  onFipsPolicyChange,
  setFipsEnabled,
} from '../../../../packages/runtime/src/fips/policy';

function bytes(value: number) {
  if (value < 1024) return `${value.toLocaleString()} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value / 1024,
    index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}

const date = (timestamp: number) => new Date(timestamp).toLocaleString();

function Session({
  session,
  recent = false,
  notice,
}: {
  session: FipsDashboardSession;
  recent?: boolean;
  notice: (message: string) => void;
}) {
  const status = recent ? { label: 'Closed', tone: 'muted' } : fipsConnectionStatus([session]);
  const { stats, transport } = session;
  return (
    <article className="fips-session" aria-label={`${session.title} FIPS session`}>
      <div className="fips-section-heading">
        <div>
          <h4>{session.title}</h4>
          <p className="fips-caption">
            {recent && session.endedAt
              ? `Closed ${date(session.endedAt)}`
              : `Started ${date(session.startedAt)}`}
          </p>
        </div>
        <span className="fips-state">
          <span className="fips-status-dot" data-tone={status.tone} />
          {status.label}
        </span>
      </div>
      <dl className="fips-session-summary">
        <div>
          <dt>Connected peers</dt>
          <dd>{transport.connectedPeers}</dd>
        </div>
        <div>
          <dt>Open seed connections</dt>
          <dd>{transport.openSeedSockets}</dd>
        </div>
        <div>
          <dt>Received payload</dt>
          <dd>{bytes(stats.fipsBytes)}</dd>
        </div>
        <div>
          <dt>Verified cache</dt>
          <dd>{bytes(session.cacheBytes)}</dd>
        </div>
      </dl>
      {session.lastError && (
        <p className="fips-error" role="alert">
          {session.lastError}
        </p>
      )}
      <details className="fips-details">
        <summary>
          Transfer details
          {session.grants.length > 0
            ? ` & ${session.grants.length} approved ${session.grants.length === 1 ? 'root' : 'roots'}`
            : ''}
        </summary>
        {session.address && (
          <p className="fips-caption fips-break">
            Napplet: <code>{session.address}</code>
          </p>
        )}
        <dl className="fips-details-list">
          <div>
            <dt>Active / queued transfers</dt>
            <dd>
              {stats.activeTransfers} / {stats.queuedTransfers}
            </dd>
          </div>
          <div>
            <dt>Network requests</dt>
            <dd>{stats.networkRequests.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Verified blocks / cache hits</dt>
            <dd>
              {stats.verifiedBlobs.toLocaleString()} / {stats.cacheHits.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Cached blocks</dt>
            <dd>{session.cacheEntries.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Retries / provider failovers</dt>
            <dd>
              {stats.retries.toLocaleString()} / {stats.failovers.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Failed / cancelled requests</dt>
            <dd>
              {stats.errors.toLocaleString()} / {stats.cancelledRequests.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Connection attempts / reconnects</dt>
            <dd>
              {transport.connectionAttempts.toLocaleString()} /{' '}
              {transport.reconnects.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Transport received / sent</dt>
            <dd>
              {bytes(transport.wireBytesReceived)} / {bytes(transport.wireBytesSent)}
            </dd>
          </div>
        </dl>
        <p className="fips-caption">
          Payload counts resource bytes received; verified blocks passed hash checks. Transport
          bytes also include connection traffic.
        </p>
        {session.grants.length ? (
          <div className="fips-roots">
            {session.grants.map((grant) => (
              <section
                className="fips-root"
                key={grant.id}
                aria-label={`Approved root ${grant.root}`}
              >
                <div className="fips-section-heading">
                  <h5>Approved resource root</h5>
                  {!recent && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        revokeGrant(session.id, grant.id);
                        notice('Root access revoked. Its pending requests were cancelled.');
                      }}
                    >
                      Revoke root
                    </Button>
                  )}
                </div>
                <code className="fips-root-key">{grant.root}</code>
                <p className="fips-caption">
                  {bytes(grant.bytes)} available · Expires {date(grant.expires * 1000)}
                </p>
                <p className="fips-caption">
                  Map operations (RPC): {grant.operationsAllowed ? 'approved' : 'not approved'}
                </p>
                <ul className="fips-providers">
                  {grant.providers.map((provider, index) => (
                    <li key={`${provider.peerId}-${index}`}>
                      <span>Provider</span> <code>{provider.peerId}</code>
                      <span>Seeds</span>
                      {provider.seeds.map((seed) => (
                        <code key={seed}>{seed}</code>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="fips-caption">No approved resource roots.</p>
        )}
      </details>
      {!recent && (
        <div className="fips-actions">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              disconnectSession(session.id);
              notice('Session disconnected. New resource access needs approval again.');
            }}
          >
            <Unplug size={14} /> Disconnect session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!session.cacheEntries}
            onClick={() => {
              clearSessionCache(session.id);
              notice('Verified cache cleared. Future reads can download those blocks again.');
            }}
          >
            <Trash2 size={14} /> Clear cache
          </Button>
        </div>
      )}
    </article>
  );
}

export function FipsDashboard() {
  const snapshot = useSyncExternalStore(
    subscribeFipsDashboard,
    fipsDashboardSnapshot,
    serverFipsDashboardSnapshot,
  );
  const enabled = useSyncExternalStore(onFipsPolicyChange, fipsEnabled, () => true);
  const [notice, setNotice] = useState('');
  const [temporary, setTemporary] = useState(false);
  const accessId = useId();
  const status = fipsConnectionStatus(snapshot.sessions, enabled);
  const peers = snapshot.sessions.reduce(
    (sum, session) => sum + session.transport.connectedPeers,
    0,
  );
  const seeds = snapshot.sessions.reduce(
    (sum, session) => sum + session.transport.openSeedSockets,
    0,
  );
  return (
    <section className="fips-dashboard" aria-label="FIPS dashboard">
      <div className="fips-section-heading fips-dashboard-heading">
        <h2>
          <Network size={22} aria-hidden="true" /> FIPS connections
        </h2>
        <span className="fips-experimental">Experimental</span>
      </div>
      <p>
        Read public resources directly from peers, without signing in. Connections and recent
        activity below belong to this browser tab.
      </p>
      <div className="fips-overview">
        <span className="fips-state" role="status">
          <span className="fips-status-dot" data-tone={status.tone} />
          {status.label}
        </span>
        <span>
          {peers} connected {peers === 1 ? 'peer' : 'peers'}
        </span>
        <span>
          {seeds} open seed {seeds === 1 ? 'connection' : 'connections'}
        </span>
      </div>
      <section className="fips-access" aria-labelledby={`${accessId}-heading`}>
        <div>
          <h3 id={`${accessId}-heading`}>Resource access</h3>
          <p>
            Each new set of roots and providers needs your approval. Peer and seed connections can
            reveal your IP address.
          </p>
        </div>
        <div className="fips-access-control">
          <label htmlFor={accessId}>Resource connections</label>
          <select
            id={accessId}
            value={enabled ? 'ask' : 'block'}
            onChange={(event) => {
              const allow = event.target.value === 'ask';
              setTemporary(!setFipsEnabled(allow));
              setNotice(
                allow
                  ? 'FIPS will ask before connecting. No connection starts until a napplet requests access and you approve it.'
                  : 'FIPS is blocked. Active grants and connections have been closed.',
              );
            }}
          >
            <option value="ask">Ask before connecting</option>
            <option value="block">Block</option>
          </select>
        </div>
        <p className="fips-caption fips-access-note">
          Changing this setting closes active resource grants and connections. The choice applies to
          this site in this browser; already delivered bytes cannot be recalled.
        </p>
        {temporary && (
          <p className="fips-caption" role="status">
            Browser storage is unavailable. Saved for this page only.
          </p>
        )}
      </section>
      {notice && (
        <p className="fips-notice" role="status">
          {notice}
        </p>
      )}
      <section className="fips-session-section" aria-label="Active FIPS sessions">
        <div className="fips-section-heading">
          <h3>
            Active sessions <span className="fips-count">{snapshot.sessions.length}</span>
          </h3>
          <Button
            size="sm"
            variant="outline"
            disabled={!snapshot.sessions.length}
            onClick={() => {
              disconnectAll();
              setNotice(
                'All FIPS sessions disconnected. Future resource access needs approval again.',
              );
            }}
          >
            <Unplug size={14} /> Disconnect all
          </Button>
        </div>
        {snapshot.sessions.length ? (
          snapshot.sessions.map((session) => (
            <Session key={session.id} session={session} notice={setNotice} />
          ))
        ) : (
          <p className="fips-empty">
            No active FIPS sessions. Connections start only when you approve a resource request from
            a running napplet.
          </p>
        )}
      </section>
      <section className="fips-session-section" aria-label="Recent FIPS sessions">
        <div className="fips-section-heading">
          <h3>
            Recent sessions <span className="fips-count">{snapshot.recentSessions.length}</span>
          </h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={!snapshot.recentSessions.length}
            onClick={() => {
              clearRecentSessions();
              setNotice('Recent session history cleared for this tab.');
            }}
          >
            <Trash2 size={14} /> Clear history
          </Button>
        </div>
        <p className="fips-caption">
          Stopping a napplet or leaving its page closes its session. Recent activity stays in memory
          until this tab reloads; it is not saved to your account.
        </p>
        {snapshot.recentSessions.length ? (
          snapshot.recentSessions.map((session) => (
            <Session key={session.id} session={session} recent notice={setNotice} />
          ))
        ) : (
          <p className="fips-empty">No recent FIPS activity in this tab.</p>
        )}
      </section>
    </section>
  );
}
