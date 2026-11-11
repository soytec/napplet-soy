import { useSyncExternalStore } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Network } from 'lucide-react';
import { Button } from './ui/button';
import {
  fipsDashboardSnapshot,
  serverFipsDashboardSnapshot,
  subscribeFipsDashboard,
  type FipsDashboardSession,
} from '../../../../packages/runtime/src/fips/dashboard';
import { fipsEnabled, onFipsPolicyChange } from '../../../../packages/runtime/src/fips/policy';

export function fipsConnectionStatus(sessions: FipsDashboardSession[], enabled = true) {
  if (!enabled) return { label: 'Blocked', tone: 'muted' };
  if (
    sessions.some(
      (session) => session.stats.activeTransfers > 0 && session.transport.connectedPeers > 0,
    )
  )
    return { label: 'Transferring', tone: 'active' };
  if (sessions.some((session) => session.transport.connectedPeers > 0))
    return { label: 'Connected', tone: 'active' };
  if (sessions.some((session) => session.transport.openSeedSockets > 0))
    return { label: 'Seed connected', tone: 'active' };
  if (sessions.some((session) => session.state === 'approving'))
    return { label: 'Approval pending', tone: 'pending' };
  if (
    sessions.some((session) => session.state === 'connecting' || session.stats.activeTransfers > 0)
  )
    return { label: 'Connecting', tone: 'pending' };
  if (sessions.some((session) => session.state === 'error'))
    return { label: 'Needs attention', tone: 'error' };
  return { label: 'Idle', tone: 'muted' };
}

/** Public transport status belongs to the device, independently of its signing account. */
export function FipsIndicator({
  onNavigate,
  onInspect,
}: {
  onNavigate: () => void;
  onInspect: () => void;
}) {
  const { sessions } = useSyncExternalStore(
    subscribeFipsDashboard,
    fipsDashboardSnapshot,
    serverFipsDashboardSnapshot,
  );
  const enabled = useSyncExternalStore(onFipsPolicyChange, fipsEnabled, () => true);
  const status = fipsConnectionStatus(sessions, enabled);
  const peers = sessions.reduce((sum, session) => sum + session.transport.connectedPeers, 0);
  const seeds = sessions.reduce((sum, session) => sum + session.transport.openSeedSockets, 0);
  return (
    <div className="fips-indicator-row">
      <Link
        to="/manage"
        hash="fips"
        className="fips-indicator"
        onClick={onNavigate}
        aria-label={`FIPS: ${status.label}. Open FIPS dashboard`}
      >
        <Network size={18} aria-hidden="true" />
        <span className="fips-indicator-copy">
          <span className="fips-indicator-heading">
            FIPS <span className="fips-status-dot" data-tone={status.tone} />
            <span className="fips-indicator-state" role="status">
              {status.label}
            </span>
          </span>
          <small>
            {peers || seeds
              ? `${peers} ${peers === 1 ? 'peer' : 'peers'} · ${seeds} ${seeds === 1 ? 'seed connection' : 'seed connections'}`
              : 'No active connections'}
          </small>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
      <Button
        size="sm"
        variant="outline"
        onClick={onInspect}
        aria-label="Inspect FIPS connections"
        title="Inspect connections without leaving this page"
      >
        Inspect
      </Button>
    </div>
  );
}
