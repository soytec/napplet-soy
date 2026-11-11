import { FipsResourceSession } from './session';
import { FIPS_PROFILE, FIPS_TIMEOUT_MS } from './contract';
import { fipsEnabled, onFipsPolicyChange } from './policy';
import { redactDiagnostic } from '../../../diagnostics/src';
import { clearRecentSessions, fipsDashboardError, registerFipsDashboardSession } from './dashboard';

/** Private-port adapter; independent of React, Atlas discovery and the ordinary resource quota. */
export function fipsHost(options: {
  send: (message: Record<string, unknown>, transfers?: Transferable[]) => void;
  approve: (description: string, signal: AbortSignal) => Promise<boolean>;
  localSeeds?: string[];
  title?: string;
  address?: string;
}) {
  let session: FipsResourceSession;
  let closed = false;
  const pending = new Map<string, AbortController>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let dashboard: ReturnType<typeof registerFipsDashboardSession> | undefined;
  let lastError: string | undefined;
  const sendStats = () => {
    if (!closed)
      options.send({
        type: 'resource.fips.changed',
        profile: FIPS_PROFILE,
        stats: session.stats(),
      });
    dashboard?.update();
  };
  const create = () =>
    new FipsResourceSession({ ...options, enabled: fipsEnabled, changed: sendStats });
  session = create();
  const endDashboard = (retainRecent = true) => {
    const current = dashboard;
    dashboard = undefined;
    current?.end(retainRecent);
  };
  const reset = (reason: string) => {
    for (const [id, abort] of pending) {
      reply(id, { error: reason });
      abort.abort();
    }
    pending.clear();
    clearInterval(timer);
    timer = undefined;
    session.close();
    endDashboard();
    lastError = undefined;
    session = create();
    sendStats();
  };
  const unsubscribe = onFipsPolicyChange(() => {
    reset('Resource permissions changed; approve the roots again');
  });
  const reply = (id: string, fields: Record<string, unknown>, transfers?: Transferable[]) => {
    if (!closed)
      options.send(
        { type: 'resource.fips.result', profile: FIPS_PROFILE, id, ...fields },
        transfers,
      );
  };
  return {
    handle(message: Record<string, unknown>) {
      if (
        closed ||
        message.type !== 'resource.fips' ||
        message.profile !== FIPS_PROFILE ||
        typeof message.id !== 'string' ||
        !message.id ||
        message.id.length > 128
      )
        return;
      const id = message.id,
        action = message.action;
      if (action === 'cancel') {
        pending.get(id)?.abort();
        return;
      }
      if (pending.has(id)) return;
      const fields: Record<string, string[]> = {
        info: [],
        open: ['roots'],
        bytes: ['grant', 'hash'],
        request: ['grant', 'operation'],
        release: ['grant'],
      };
      if (typeof action !== 'string' || !fields[action]) return;
      dashboard ??= registerFipsDashboardSession(options, {
        snapshot: () => {
          const state = session.dashboardSnapshot();
          return {
            ...state,
            ...(lastError
              ? { lastError, state: state.state === 'idle' ? 'error' : state.state }
              : {}),
          };
        },
        disconnect: () => reset('Resource session disconnected; approve the roots again'),
        revokeGrant: (grant) => session.release(grant),
        clearCache: () => session.clearCache(),
      });
      try {
        if (
          JSON.stringify(message).length > 65536 ||
          Object.keys(message).some(
            (k) => !['type', 'profile', 'id', 'action', ...fields[action]!].includes(k),
          )
        )
          throw new Error('Invalid experimental resource request');
        if (
          ['bytes', 'request', 'release'].includes(action) &&
          (typeof message.grant !== 'string' || message.grant.length > 128)
        )
          throw new Error('Invalid resource grant');
        if (action === 'bytes' && typeof message.hash !== 'string')
          throw new Error('Invalid block hash');
        if (pending.size >= 128) throw new Error('Resource queue is full; retry missing reads');
      } catch (error) {
        lastError = fipsDashboardError(error, action);
        dashboard.update();
        reply(id, { error: error instanceof Error ? error.message : 'Invalid request' });
        return;
      }
      const abort = new AbortController(),
        current = session;
      pending.set(id, abort);
      if (!timer) timer = setInterval(sendStats, 500);
      void (async () => {
        try {
          let value: unknown;
          const transfers: Transferable[] = [];
          if (action === 'info')
            value = {
              profile: FIPS_PROFILE,
              enabled: fipsEnabled(),
              timeoutMs: FIPS_TIMEOUT_MS,
              stats: current.stats(),
            };
          else if (action === 'open') value = await current.open(message.roots, abort.signal);
          else if (action === 'bytes') {
            const bytes = await current.bytes(
              message.grant as string,
              message.hash as string,
              abort.signal,
            );
            value = new Uint8Array(bytes).buffer;
            transfers.push(value as ArrayBuffer);
          } else if (action === 'release') current.release(message.grant as string);
          else {
            const response = await current.request(
              message.grant as string,
              message.operation as never,
              abort.signal,
            );
            value = response;
            if (response.bytes) {
              const bytes = new Uint8Array(response.bytes);
              value = { ...response, bytes };
              transfers.push(bytes.buffer);
            }
          }
          if (!abort.signal.aborted && current === session) {
            if (['open', 'bytes', 'request'].includes(action)) lastError = undefined;
            reply(id, { value }, transfers);
          } else if (action === 'open' && Array.isArray(value))
            for (const grant of value) current.release(grant);
        } catch (error) {
          if (!abort.signal.aborted && current === session) {
            lastError = fipsDashboardError(error, action);
            reply(id, {
              error: redactDiagnostic(
                error instanceof Error ? error.message : 'Resource operation failed',
                800,
              ),
            });
          }
        } finally {
          if (pending.get(id) === abort) pending.delete(id);
          if (!pending.size) {
            clearInterval(timer);
            timer = undefined;
          }
          sendStats();
        }
      })();
    },
    close(retainRecent = true) {
      if (closed) return;
      // Settle old account requests before suppressing late transport completions.
      for (const [id, abort] of pending) {
        reply(id, {
          error: 'Resource session closed; reconnect after the account or frame changed',
        });
        abort.abort();
      }
      closed = true;
      pending.clear();
      clearInterval(timer);
      unsubscribe();
      session.close();
      endDashboard(retainRecent);
      if (!retainRecent) clearRecentSessions();
    },
  };
}
