import { resolveOutbox } from '../../../../packages/nostr/src/publication-copies';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Download, EyeOff, LoaderCircle, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { network } from '@/lib/network';
import { signForAccount } from '@/lib/community-client';
import { savedLifecycles, saveLifecycle, retainedLifecycleHistory } from '@/lib/lifecycle';
import { applyLifecycleEvent } from '@/lib/protocol-catalog';
import { diagnose } from '../../../../packages/diagnostics/src';
import {
  nappletKey,
  planLifecycle,
  createLifecycleReceipt,
  executeLifecycle,
  lifecycleFinished,
  lifecycleUrl,
  listingRemoved,
  type LifecycleReceipt,
  type Operation,
} from '../../../../packages/lifecycle/src';
import { LifecycleTransport } from '../../../../packages/lifecycle/src/transport';
import type { SignedEvent } from '../../../../packages/protocol/src';
import './lifecycle-manager.css';

export function LifecycleManager({
  manifest,
  relays = [],
  metadata = [],
  saved,
  onChange,
}: {
  manifest: SignedEvent;
  relays?: string[];
  metadata?: SignedEvent[];
  saved?: LifecycleReceipt;
  onChange?: () => void;
}) {
  const { pubkey, needsReconnect } = useNostr();
  const [open, setOpen] = useState(false),
    [receipt, setReceipt] = useState<LifecycleReceipt | null>(saved ?? null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [typed, setTyped] = useState('');
  const pending = useRef(false);
  const local =
    typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
  useEffect(() => {
    setReceipt(saved ?? null);
  }, [saved]);
  if (pubkey !== manifest.pubkey) return null;
  async function prepare(operation: Operation) {
    if (pending.current) return;
    pending.current = true;
    setBusy('Inspecting publication…');
    setError('');
    setConfirmed(false);
    setTyped('');
    const io = new LifecycleTransport();
    try {
      const previous = savedLifecycles(manifest.pubkey).find(
        (r) => r.plan.key === nappletKey(manifest),
      );
      const knownRelays = [
        ...new Set([...relays, ...network().relays, ...(previous?.plan.relays ?? [])]),
      ];
      const lookup = await resolveOutbox(
        io.read.bind(io),
        manifest.pubkey,
        { relay: knownRelays[0], mirrors: knownRelays.slice(1) },
        local ? 'local' : 'public',
      );
      const history = await retainedLifecycleHistory(manifest);
      if (lookup.error) {
        history.complete = false;
        history.warnings.push(lookup.error.message);
      }
      const p = await planLifecycle({
        operation,
        manifest,
        relays: [...knownRelays, ...lookup.relays],
        metadata,
        saved: previous?.plan.manifests,
        history,
        snapshotPairs: previous?.plan.snapshotPairs?.map((pair) => ({
          current: previous.plan.manifests.find((event) => event.id === pair.current)!,
          snapshot: previous.plan.manifests.find((event) => event.id === pair.snapshot)!,
        })),
        local,
        io,
      });
      const next = createLifecycleReceipt(p, operation);
      saveLifecycle(next);
      setReceipt(next);
    } catch (e) {
      setError(message(e));
    } finally {
      io.close();
      setBusy('');
      pending.current = false;
    }
  }
  async function run() {
    if (!receipt || pending.current || !confirmed || needsReconnect) return;
    pending.current = true;
    setBusy(receipt.operation === 'republish' ? 'Republishing…' : 'Updating services…');
    setError('');
    const io = new LifecycleTransport();
    try {
      await executeLifecycle(receipt, {
        io,
        local,
        signer: { signEvent: (t) => signForAccount(manifest.pubkey, t) },
        save: async (r) => {
          saveLifecycle(r);
          setReceipt(structuredClone(r));
          const event = r.events.deletion ?? r.events.listing;
          if (event && r.steps.some((s) => s.id.startsWith('relay:') && s.state === 'done'))
            applyLifecycleEvent(event);
        },
      });
      onChange?.();
    } catch (e) {
      setError(message(e));
    } finally {
      io.close();
      setBusy('');
      pending.current = false;
      setConfirmed(false);
    }
  }
  function download() {
    if (!receipt) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'napplet-lifecycle.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const finished = receipt && Object.keys(receipt.events).length > 0 && lifecycleFinished(receipt);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 size={16} />
          Manage publication
        </Button>
      </DialogTrigger>
      <DialogContent className="lifecycle-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{receipt?.plan.title ?? 'Manage this napplet'}</DialogTitle>
          <DialogDescription>
            Control this publication with its author identity. Local source files and private keys
            stay on your device.
          </DialogDescription>
        </DialogHeader>
        <div className="lifecycle-choices">
          <Button
            variant="outline"
            disabled={!!busy || needsReconnect}
            onClick={() => void prepare('unpublish')}
          >
            <EyeOff size={16} />
            Unpublish
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || needsReconnect}
            onClick={() => void prepare('republish')}
          >
            <RotateCcw size={16} />
            Republish
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || needsReconnect}
            onClick={() => void prepare('delete')}
          >
            <Trash2 size={16} />
            Delete hosted data
          </Button>
        </div>
        {!receipt && (
          <p className="muted">
            Unpublish removes the listing and known pinned releases. Keep the files to republish
            later at the same address. Deletion additionally removes selected hosted files and
            requests Git repository removal.
          </p>
        )}
        {receipt && (
          <>
            <div className="lifecycle-summary">
              <strong>
                {receipt.operation === 'delete'
                  ? 'Review before deleting'
                  : receipt.operation === 'republish'
                    ? 'Publish a fresh listing'
                    : 'Take this napplet off the listings'}
              </strong>
              <p>
                {receipt.operation === 'delete'
                  ? 'The files below will be removed where you are their uploader. Shared files are retained. Git removal may affect proposals attached to that repository. Soy’s GRASP keeps a recovery archive for 90 days; other servers set their own retention.'
                  : receipt.operation === 'republish'
                    ? 'Your napplet keeps its address and gets a fresh signed listing. Old pinned links stay unpublished. The build must still be available.'
                    : 'The code and assets stay hosted. You can republish this napplet later using its saved record or soyLI project.'}
              </p>
              <p>
                Downloaded copies, forks, mirrors and other people’s social events cannot be
                recalled.
              </p>
            </div>
            {receipt.operation !== 'republish' && (
              <details className="lifecycle-release-inventory">
                <summary>Selected signed releases ({receipt.plan.manifests.length})</summary>
                <p>
                  Only these event IDs and this publication's address are selected. Exact paired
                  snapshots remain independent for playback; this confirmation includes them in this
                  removal request.
                </p>
                <ul>
                  {receipt.plan.manifests.map((event) => (
                    <li key={event.id}>
                      {event.tags.find((tag) => tag[0] === 'title')?.[1] ?? 'Untitled napplet'}
                      {' · '}
                      {event.kind === 5129
                        ? receipt.plan.snapshotPairs?.some((pair) => pair.snapshot === event.id)
                          ? 'Exact paired snapshot'
                          : 'Snapshot'
                        : 'Named/root revision'}
                      <code>{event.id}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <ol className="lifecycle-steps" aria-label="Service progress" aria-live="polite">
              {receipt.steps.map((s) => (
                <li key={s.id} data-state={s.state}>
                  <span className="lifecycle-state">
                    {s.state === 'running' ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : s.state === 'done' ? (
                      <Check size={16} />
                    ) : null}
                    {s.state === 'pending'
                      ? 'Ready'
                      : s.state === 'requested'
                        ? 'Awaiting confirmation'
                        : s.state}
                  </span>
                  <strong>{s.label}</strong>
                  <code>{s.target}</code>
                  {s.message && <p>{s.message}</p>}
                </li>
              ))}
            </ol>
            {!!receipt.plan.warnings.length && (
              <details>
                <summary>Inventory notes ({receipt.plan.warnings.length})</summary>
                {receipt.plan.warnings.map((w, i) => (
                  <p key={i} className="muted">
                    {w}
                  </p>
                ))}
              </details>
            )}
            {!receipt.plan.complete && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void prepare(receipt.operation)}
              >
                Refresh incomplete inventory
              </Button>
            )}
            <div className="lifecycle-backup">
              <span>Progress and republishing data are saved in this browser.</span>
              <Button size="sm" variant="ghost" onClick={download}>
                <Download size={14} />
                Save recovery record
              </Button>
            </div>
            {!finished && (
              <div className="lifecycle-confirm">
                {receipt.operation === 'delete' && (
                  <label>
                    Type DELETE to confirm the inventory
                    <input
                      value={typed}
                      onChange={(e) => {
                        setTyped(e.target.value);
                        setConfirmed(false);
                      }}
                      autoComplete="off"
                      disabled={!!busy}
                    />
                  </label>
                )}
                <label className="lifecycle-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!!busy || (receipt.operation === 'delete' && typed !== 'DELETE')}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I have reviewed the targets and understand what will be retained.
                </label>
                <Button
                  variant={receipt.operation === 'delete' ? 'destructive' : 'default'}
                  disabled={!!busy || !confirmed || needsReconnect}
                  onClick={() => void run()}
                >
                  {busy ? <LoaderCircle className="animate-spin" size={16} /> : null}
                  {busy ||
                    (Object.keys(receipt.events).length
                      ? 'Retry unfinished steps'
                      : receipt.operation === 'delete'
                        ? 'Delete selected hosted data'
                        : receipt.operation === 'republish'
                          ? 'Republish napplet'
                          : 'Confirm unpublish')}
                </Button>
              </div>
            )}
            {finished && (
              <p role="status">
                {receipt.operation === 'republish'
                  ? 'Listing published.'
                  : listingRemoved(receipt)
                    ? 'Listing unpublished. See each service’s result above.'
                    : 'Operation finished.'}{' '}
                {receipt.operation === 'republish' ? (
                  <Link to={lifecycleUrl(receipt.plan)}>Open napplet route</Link>
                ) : (
                  <Link to="/manage">Your napplets</Link>
                )}
              </p>
            )}
          </>
        )}
        {busy && !receipt && (
          <p role="status">
            <LoaderCircle className="animate-spin" size={16} /> {busy}
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {needsReconnect && <p className="muted">Reconnect your author identity to continue.</p>}
      </DialogContent>
    </Dialog>
  );
}

function message(error: unknown) {
  const d = diagnose(error);
  return [d.message, ...(d.details ?? []), d.recovery].join(' ');
}
