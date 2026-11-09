import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useGamegridInput } from '../../apps/web/src/lib/use-gamegrid-input';
import { GamegridKeyboard } from '../../apps/web/src/components/gamegrid-keyboard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../apps/web/src/components/ui/dialog';
import { presentShellDialog } from '../../packages/runtime/src/shell-ui';

function NativeReview({ close, approve }: { close: () => void; approve: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => presentShellDialog(dialog.current!), []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-label="Native action review"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2>Review fixture action</h2>
      <button onClick={approve}>Approve action</button>
      <button onClick={close}>Cancel review</button>
    </dialog>,
    document.body,
  );
}

function App() {
  const root = useRef<HTMLDivElement>(null);
  const lastTile = useRef('tile-one');
  const [playing, setPlaying] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [review, setReview] = useState(false);
  const [settings, setSettings] = useState(false);
  const [field, setField] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [search, setSearch] = useState('');
  const [secret, setSecret] = useState('');
  const [volume, setVolume] = useState(2);
  const [approvals, setApprovals] = useState(0);
  const [launches, setLaunches] = useState(0);
  const [backs, setBacks] = useState(0);
  useEffect(() => {
    const request = (event: MessageEvent) => {
      if (
        event.source === root.current?.querySelector('iframe')?.contentWindow &&
        event.data === 'gamegrid-fixture:review'
      )
        setReview(true);
    };
    window.addEventListener('message', request);
    return () => window.removeEventListener('message', request);
  }, []);
  const input = useGamegridInput({
    root,
    playing: playing !== null,
    onMenu: () => setMenu(true),
    onBack: () => setBacks((count) => count + 1),
    onText: setField,
  });
  const resume = () => {
    setMenu(false);
    input.resumeWhenNeutral();
  };
  const leave = () => {
    setMenu(false);
    setPlaying(null);
    requestAnimationFrame(() => document.getElementById(lastTile.current)?.focus());
  };
  return (
    <div ref={root} data-mode={playing ? 'game' : 'browse'}>
      <output data-controller>{input.status}</output>
      <output data-counts>{JSON.stringify({ approvals, launches, backs })}</output>
      <output data-search>{search}</output>
      <output data-secret-length>{secret.length}</output>
      <output data-volume>{volume}</output>
      <section hidden={playing !== null} aria-label="Browse games">
        <header>
          <input
            aria-label="Search games"
            maxLength={4}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button onClick={() => setSettings(true)}>Account settings</button>
        </header>
        <div className="tiles">
          {['one', 'two', 'three'].map((id) => (
            <button
              id={`tile-${id}`}
              key={id}
              onClick={() => {
                lastTile.current = `tile-${id}`;
                setPlaying(id);
                setLaunches((count) => count + 1);
              }}
            >
              Game {id}
            </button>
          ))}
        </div>
      </section>
      {playing && (
        <div className="player-stage">
          <iframe
            title={`Running game ${playing}`}
            sandbox="allow-scripts"
            srcDoc={`<button onclick="this.textContent=Number(this.textContent)+1">0</button>
              <button onclick="parent.postMessage('gamegrid-fixture:review','*')">Request host review</button>`}
          />
        </div>
      )}
      <Dialog open={menu} onOpenChange={(open) => (open ? setMenu(true) : resume())}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Game menu</DialogTitle>
          <DialogDescription>Trusted controller menu fixture</DialogDescription>
          <button onClick={resume}>Resume game</button>
          <button onClick={() => setReview(true)}>Review action</button>
          <button onClick={leave}>Back to grid</button>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Ordinary shell text entry fixture</DialogDescription>
          <input
            aria-label="Connection password"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          <input
            aria-label="Controller volume"
            type="range"
            min={0}
            max={10}
            step={2}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          <button onClick={() => setSettings(false)}>Close settings</button>
        </DialogContent>
      </Dialog>
      {review && (
        <NativeReview
          close={() => setReview(false)}
          approve={() => {
            setApprovals((count) => count + 1);
            setReview(false);
          }}
        />
      )}
      {field && <GamegridKeyboard field={field} close={() => setField(null)} />}
    </div>
  );
}

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
