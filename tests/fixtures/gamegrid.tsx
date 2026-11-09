import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useGamegridInput } from '../../apps/web/src/lib/use-gamegrid-input';
import { GamegridKeyboard } from '../../apps/web/src/components/gamegrid-keyboard';
import { GamegridSelect } from '../../apps/web/src/components/gamegrid-select';
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
  const [select, setSelect] = useState<HTMLSelectElement | null>(null);
  const [wallet, setWallet] = useState(false);
  const [walletPayment, setWalletPayment] = useState(false);
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState('new');
  const [secret, setSecret] = useState('');
  const [volume, setVolume] = useState(2);
  const [approvals, setApprovals] = useState(0);
  const [launches, setLaunches] = useState(0);
  const [backs, setBacks] = useState(0);
  const [sections, setSections] = useState(0);
  const [searches, setSearches] = useState(0);
  const [longCatalog, setLongCatalog] = useState(false);
  const [longSettings, setLongSettings] = useState(false);
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
    onSelect: setSelect,
    onSection: (direction) => setSections((count) => count + direction),
    onSearch: () => setSearches((count) => count + 1),
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
      <output data-counts>
        {JSON.stringify({ approvals, launches, backs, sections, searches })}
      </output>
      <output data-search>{search}</output>
      <output data-secret-length>{secret.length}</output>
      <output data-volume>{volume}</output>
      <section hidden={playing !== null} aria-label="Browse games">
        <header data-gamegrid-nav="toolbar">
          <select
            aria-label="Game collection"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            <option value="new">New</option>
            <option value="zapped">Most zapped</option>
            <option value="games">All games</option>
            <option value="continue">Continue</option>
          </select>
          <input
            aria-label="Search games"
            maxLength={4}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button onClick={() => setSettings(true)}>Account settings</button>
          <button onClick={() => setWallet(true)}>Wallet</button>
          <button onClick={() => setLongCatalog((value) => !value)}>Long catalog</button>
        </header>
        <div className="catalog-scroll" data-gamegrid-scroll>
          <div className="tiles" data-gamegrid-nav="grid">
            {[
              'one',
              'two',
              'three',
              ...(longCatalog ? Array.from({ length: 30 }, (_, index) => `extra-${index}`) : []),
            ].map((id) => (
              <button
                id={`tile-${id}`}
                data-game-id={id}
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
        </div>
        <footer data-gamegrid-nav="footer">
          <button>Previous page</button>
          <button>Next page</button>
        </footer>
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
          <button onClick={() => setSettings(true)}>Account settings</button>
          <button onClick={() => setWallet(true)}>Wallet</button>
          <button onClick={leave}>Back to grid</button>
        </DialogContent>
      </Dialog>
      <Dialog open={wallet} onOpenChange={setWallet}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Wallet</DialogTitle>
          <DialogDescription>Wallet back-navigation fixture</DialogDescription>
          {walletPayment ? (
            <>
              <p>Payment form</p>
              <button data-gamegrid-back onClick={() => setWalletPayment(false)}>
                Back to wallet
              </button>
            </>
          ) : (
            <button onClick={() => setWalletPayment(true)}>Send payment</button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Ordinary shell text entry fixture</DialogDescription>
          <button onClick={() => setLongSettings((value) => !value)}>Show all settings</button>
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
          {longSettings &&
            Array.from({ length: 30 }, (_, index) => (
              <button key={index}>Extra setting {index}</button>
            ))}
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
      {select && <GamegridSelect field={select} close={() => setSelect(null)} />}
    </div>
  );
}

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
