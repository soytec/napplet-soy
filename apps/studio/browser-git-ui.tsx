import React, { useEffect, useRef, useState } from 'react';
import { BrowserGitClient } from './browser-git-client';
import { gitDigest, type GitSnapshot, type GitView, type GitDiff } from './browser-git-contract';
import type { StudioClient } from './local-client';

/** Opt-in browser-owned copy; no automatic source writes, inference, or public publication. */
export function BrowserGitPanel({
  id,
  client,
  busy,
}: {
  id: string;
  client: StudioClient;
  busy: boolean;
}) {
  const worker = useRef<BrowserGitClient | null>(null);
  const [view, setView] = useState<GitView>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false),
    [progress, setProgress] = useState('');
  const [path, setPath] = useState(''),
    [text, setText] = useState(''),
    [original, setOriginal] = useState('');
  const [message, setMessage] = useState('Browser checkpoint');
  const [diff, setDiff] = useState<GitDiff>();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    setReady(false);
    let live = true;
    void gitDigest(client.url('') + '|' + id)
      .then(async (scope) => {
        if (!live) return;
        const git = (worker.current = new BrowserGitClient(scope, setProgress));
        try {
          const saved = await git.call<GitView>({ type: 'status' });
          if (live) setView(saved);
        } catch (e) {
          if (live && !(e as Error).message.includes('Create a browser copy'))
            setError((e as Error).message);
        } finally {
          if (live) setReady(true);
        }
      })
      .catch((e) => {
        if (live) {
          setReady(true);
          setError((e as Error).message);
        }
      });
    return () => {
      live = false;
      worker.current?.dispose();
      worker.current = null;
    };
  }, [enabled, id, client]);
  const action = async (fn: (git: BrowserGitClient) => Promise<void>) => {
    if (!worker.current || pending) return;
    setPending(true);
    setError('');
    setProgress('Working in this browser…');
    try {
      await fn(worker.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
      setProgress('');
    }
  };
  const dirty = text !== original;
  return (
    <section className="browser-git-panel" aria-label="Browser Git experiment">
      <h3>
        Git in this browser <small>Experimental</small>
      </h3>
      <p>
        A separate copy with real history, stored on this device. Browser edits do not change the
        maker’s workspace or the playable preview. Export a backup before clearing site data.
      </p>
      {!enabled ? (
        <button className="outline" onClick={() => setEnabled(true)}>
          Open browser Git
        </button>
      ) : (
        <>
          {!ready && <p role="status">Opening saved browser workspace…</p>}
          <div className="browser-git-actions">
            <button
              className="outline"
              disabled={!ready || pending || busy || dirty}
              onClick={() =>
                void action(async (git) => {
                  const snapshot = await client.api<GitSnapshot>(`projects/${id}/browser-git`);
                  setView(await git.call({ type: 'import', snapshot }));
                  setPath('');
                  setText('');
                  setOriginal('');
                  setDiff(undefined);
                })
              }
            >
              {view ? 'Refresh from Studio' : 'Copy draft into browser'}
            </button>
            {view && (
              <button
                className="outline"
                disabled={pending || dirty}
                onClick={() =>
                  void action(async (git) => {
                    const snapshot = await git.call<GitSnapshot>({ type: 'export' });
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(snapshot)], { type: 'application/json' }),
                    );
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `studio-browser-${id}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  })
                }
              >
                Export browser copy
              </button>
            )}
            {!view && (
              <label>
                Restore browser backup
                <input
                  type="file"
                  accept="application/json"
                  disabled={!ready || pending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void action(async (git) => {
                      if (file.size > 115 * 1024 * 1024)
                        throw new Error('Browser backup is too large.');
                      const snapshot = JSON.parse(await file.text());
                      setView(await git.call({ type: 'import', snapshot }));
                    });
                  }}
                />
              </label>
            )}
          </div>
          {view && (
            <>
              <p className="muted">
                Browser HEAD {view.head.slice(0, 8)} · Studio base {view.base.slice(0, 8)} ·{' '}
                {view.files.length} files
              </p>
              <label>
                Browser source file
                <select
                  value={path}
                  disabled={pending || dirty}
                  onChange={(e) => {
                    const next = e.target.value;
                    void action(async (git) => {
                      const value = await git.call<string>({ type: 'read', path: next });
                      setPath(next);
                      setText(value);
                      setOriginal(value);
                    });
                  }}
                >
                  <option value="">Choose a text file</option>
                  {view.files.map((path) => (
                    <option key={path}>{path}</option>
                  ))}
                </select>
              </label>
              {path && (
                <>
                  <textarea
                    aria-label="Browser source editor"
                    value={text}
                    disabled={pending}
                    onChange={(e) => setText(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    className="outline"
                    disabled={pending || !dirty}
                    onClick={() =>
                      void action(async (git) => {
                        setView(await git.call({ type: 'write', path, text, expected: original }));
                        setOriginal(text);
                      })
                    }
                  >
                    Save in browser
                  </button>
                </>
              )}
              <p>
                {view.changes.length
                  ? `${view.changes.length} changed files`
                  : 'Working tree clean'}
              </p>
              <ul>
                {view.changes.map((change) => (
                  <li key={change.path}>
                    <button
                      className="outline"
                      disabled={pending}
                      onClick={() =>
                        void action(async (git) =>
                          setDiff(await git.call({ type: 'diff', path: change.path })),
                        )
                      }
                    >
                      {change.status} · {change.path}
                    </button>
                  </li>
                ))}
              </ul>
              {diff && (
                <details open>
                  <summary>Changes in {diff.path}</summary>
                  <strong>At browser HEAD</strong>
                  <pre>{diff.before || '(absent or empty)'}</pre>
                  <strong>Working copy</strong>
                  <pre>{diff.after || '(absent or empty)'}</pre>
                </details>
              )}
              <label>
                Checkpoint description
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={200}
                />
              </label>
              <button
                className="primary"
                disabled={pending || dirty || !view.changes.length}
                onClick={() =>
                  void action(async (git) => {
                    setView(await git.call({ type: 'commit', message, expected: view.head }));
                    setDiff(undefined);
                  })
                }
              >
                Create browser checkpoint
              </button>
              <details>
                <summary>Browser Git history</summary>
                {view.log.map((c) => (
                  <p key={c.oid}>
                    <code>{c.oid.slice(0, 8)}</code> {c.message}
                  </p>
                ))}
              </details>
            </>
          )}
        </>
      )}
      {pending && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
