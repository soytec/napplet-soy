import { useSyncExternalStore } from 'react';
import {
  webmcpEnabled,
  setWebmcpEnabled,
  subscribeWebmcp,
} from '../../../../packages/runtime/src/webmcp/preference';
export function WebmcpSwitch() {
  const enabled = useSyncExternalStore(subscribeWebmcp, webmcpEnabled, () => true);
  return (
    <div className="wallet-preference">
      <label className="wallet-switch">
        <span>WebMCP · agent tools</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(e) => setWebmcpEnabled(e.target.checked)}
        />
      </label>
      <small className="muted">
        {enabled
          ? 'Available in this browser. Each napplet still needs your approval to expose its tools.'
          : 'Off. Agent access is revoked for all open napplets in this browser.'}
      </small>
    </div>
  );
}
