import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { presentShellDialog, shellActivity } from '../shell-ui';
import { nativeModelContext, projectBrowserTools } from './native';
import type { NappletTools } from './session';

/** Shared website / soyLI preview UI. No credentials or app content enter notifications. */
export function AgentToolsControl({ session }: { session: NappletTools | null }) {
  const [state, setState] = useState(session?.snapshot());
  const [open, setOpen] = useState(false);
  const [browserStatus, setBrowserStatus] = useState('');
  const [selected, setSelected] = useState('');
  const [argumentsText, setArgumentsText] = useState('{}');
  const [result, setResult] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const call = useRef<AbortController | null>(null);
  const native = !!nativeModelContext();
  useEffect(() => {
    setState(session?.snapshot());
    setResult('');
    setSelected('');
    setOpen(false);
    if (!session) return;
    const unsub = session.subscribe(() => setState(session.snapshot()));
    const api = nativeModelContext();
    const unproject = api ? projectBrowserTools(session, api, setBrowserStatus) : () => {};
    return () => {
      unsub();
      unproject();
      call.current?.abort();
    };
  }, [session]);
  useEffect(() => {
    if (!open || !dialog.current) return;
    return presentShellDialog(dialog.current);
  }, [open]);
  useEffect(() => {
    if (!state?.active || state.active.cancelled) return;
    const activity = shellActivity(`Agent working in ${state.title}: ${state.active.name}.`);
    return () => activity.dismiss();
  }, [state?.active?.id, state?.active?.cancelled]);
  if (!session || !state || state.closed || !state.tools.length) return null;
  const target = state.tools.find((t) => t.id === selected) ?? state.tools[0];
  async function invoke() {
    if (!target) return;
    const controller = new AbortController();
    call.current = controller;
    setResult('Running…');
    try {
      const args = JSON.parse(argumentsText);
      const output = await session!.invoke(target.id, args, 'shell', controller.signal);
      setResult(JSON.stringify(output, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Tool call failed.');
    } finally {
      if (call.current === controller) call.current = null;
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Agent tools"
        title="Allow and inspect agent access to this document"
      >
        {state.active ? '◌ Working' : '⌘ Agent tools'}
      </button>
      {open &&
        createPortal(
          <dialog
            aria-label={`Agent tools for ${state.title}`}
            ref={dialog}
            onCancel={() => setOpen(false)}
            onClose={(event) => {
              if (!event.currentTarget.open) setOpen(false);
            }}
            style={{
              width: 'min(600px,calc(100vw - 24px))',
              padding: 24,
              border: '1px solid var(--border,#829389)',
              borderRadius: 14,
              background: 'var(--card,white)',
              color: 'var(--foreground,#1e2924)',
              font: '14px/1.5 var(--font-sans,system-ui)',
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <h2 style={{ fontSize: 21, fontWeight: 700 }}>Agent tools · {state.title}</h2>
              <button type="button" aria-label="Close agent tools" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <p style={{ overflowWrap: 'anywhere', fontSize: 12, opacity: 0.7 }}>
              {state.identity} · instance {state.instance.slice(0, 8)}
            </p>
            <p>
              Allow tools to read and change this document. Results may reach an agent’s provider.
              File, payment and signing approvals still apply.
            </p>
            <div style={{ display: 'grid', gap: 10, margin: '16px 0' }}>
              <label>
                <input
                  type="checkbox"
                  checked={state.grants.includes('shell')}
                  onChange={(e) => session.grant('shell', e.target.checked)}
                />{' '}
                Allow shell tool access for this document
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={state.grants.includes('browser')}
                  disabled={!native}
                  onChange={(e) => session.grant('browser', e.target.checked)}
                />{' '}
                Expose tools to browser agents
              </label>
              <small>
                {native
                  ? browserStatus || 'Browser WebMCP is available.'
                  : 'This browser has no compatible native WebMCP API. The internal tool inspector still works.'}
              </small>
            </div>
            <p role="status" aria-live="polite">
              {state.message} {state.queued ? `${state.queued} queued.` : ''}
            </p>
            <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
              <button
                type="button"
                disabled={!state.active && !state.queued}
                onClick={() => session.stop()}
              >
                Stop calls
              </button>
              <button
                type="button"
                disabled={!state.grants.length}
                onClick={() => {
                  session.grant('shell', false);
                  session.grant('browser', false);
                }}
              >
                Revoke access
              </button>
            </div>
            <details>
              <summary>{state.tools.length} tools · inspect and try a call</summary>
              <p>
                Tools and their guidance are supplied by this napplet. Review arguments before
                executing. This inspector uses the same dispatcher as a shell agent.
              </p>
              <label style={{ display: 'block' }}>
                Tool
                <select
                  aria-label="Agent tool"
                  value={target?.id}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setResult('');
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: 8,
                    background: 'var(--background,white)',
                    color: 'inherit',
                  }}
                >
                  {state.tools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.descriptor.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>{target?.descriptor.description}</p>
              <details>
                <summary>Argument schema</summary>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    maxHeight: 180,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(target?.descriptor.inputSchema, null, 2)}
                </pre>
              </details>
              <label style={{ display: 'block' }}>
                JSON arguments
                <textarea
                  aria-label="Tool arguments"
                  value={argumentsText}
                  onChange={(e) => setArgumentsText(e.target.value)}
                  rows={3}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: 8,
                    background: 'var(--background,white)',
                    color: 'inherit',
                    fontFamily: 'monospace',
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!state.grants.includes('shell') || !!state.active}
                onClick={() => void invoke()}
                style={{ margin: '10px 0' }}
              >
                Run tool
              </button>
              {result && (
                <pre
                  aria-label="Tool result"
                  style={{
                    maxHeight: 200,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {result}
                </pre>
              )}
            </details>
          </dialog>,
          document.body,
        )}
    </>
  );
}
