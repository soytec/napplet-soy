import { useEffect, useRef, useState } from 'react';
import { GitPullRequest, Play, Copy, RefreshCw, Terminal } from 'lucide-react';
import { Button } from './ui/button';
import { Player } from './player';
import { network, protocolClient, manifestAllowed } from '@/lib/network';
import { downloadBytes } from '../../../../packages/client/src/bytes';
import { publicNapplet, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import {
  observeRepository,
  observeProposals,
  tag,
  validatePreview,
  proposalId,
  type Proposal,
  type Repository,
} from '../../../../packages/collaboration/src/protocol';
import type { SignedEvent } from '../../../../packages/protocol/src';
import { switchMap, Subscription } from 'rxjs';
import { useNostr } from './nostr-provider';
import { communityMode } from '@/lib/community-mode';

export function Proposals({ manifest, reference }: { manifest?: SignedEvent; reference?: string }) {
  const { community } = useNostr();
  const source = manifest && tag(manifest, 'source');
  const playback = useRef(0);
  const [repository, setRepository] = useState<Repository>();
  const [rows, setRows] = useState<Proposal[]>([]),
    [selected, setSelected] = useState<string>(),
    [revision, setRevision] = useState<string>();
  const [playing, setPlaying] = useState<PublicNapplet | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [generation, refresh] = useState(0),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setSelected(undefined);
    setRevision(undefined);
    setPlaying(null);
    setRows([]);
    return () => {
      playback.current++;
    };
  }, [source, reference]);
  useEffect(() => {
    if (!source?.startsWith('nostr://') && !reference) return;
    let active = true;
    const controller = new AbortController();
    const subscription = new Subscription();
    setLoading(true);
    setError('');
    void (async () => {
      const client = protocolClient();
      let repoRef = source!,
        id: string | undefined;
      if (reference) {
        id = proposalId(reference);
        const root = await client.queryEvent(id, [1618, 1617], [], controller.signal);
        if (!root) throw new Error('Proposal unavailable on your relays.');
        if (!manifestAllowed(root)) throw new Error('Proposal unavailable here.');
        repoRef = tag(root, 'a') ?? '';
      }
      if (!active) return;
      subscription.add(
        observeRepository(client, repoRef)
          .pipe(
            switchMap((repo) => {
              setRepository(repo);
              return observeProposals(client, repo, id);
            }),
          )
          .subscribe({
            next: (proposals) => {
              setRows(proposals);
              if (proposals.length) setLoading(false);
              if (id) {
                setSelected((current) => current ?? id);
                setRevision(
                  (current) => current ?? proposals.find((p) => p.root.id === id)?.revision.id,
                );
              }
            },
            error: (error) => {
              setError(error.message);
              setLoading(false);
            },
            complete: () => setLoading(false),
          }),
      );
    })().catch((e) => {
      if (active) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      controller.abort();
      subscription.unsubscribe();
    };
  }, [source, reference, generation]);
  const visibleRows = community.enabled
    ? rows.filter(
        (p) => communityMode.allows(p.root.pubkey) && communityMode.allows(p.revision.pubkey),
      )
    : rows;
  const proposal = visibleRows.find((p) => p.root.id === selected);
  const eligibleRevisions = proposal?.revisions.filter((r) => communityMode.allows(r.pubkey)) ?? [];
  const chosen = eligibleRevisions.find((r) => r.id === revision) ?? proposal?.revision;
  async function play(original = false) {
    if (!chosen) return;
    const request = ++playback.current;
    setLoading(true);
    setError('');
    try {
      if (original && manifest) {
        const model = await publicNapplet(manifest);
        if (request === playback.current) setPlaying(model);
        return;
      }
      const url = tag(chosen, 'soy-preview');
      if (!url)
        throw new Error('No built preview. Review this revision locally with soyLI or ngit.');
      const preview = await validatePreview(
        await downloadBytes(url, AbortSignal.timeout(15000), 65536, network().blossom),
        chosen,
      );
      if (!manifestAllowed(preview.manifest))
        throw new Error('This preview is unavailable under this site’s moderation policy.');
      const model = await publicNapplet(preview.manifest, repository?.relays);
      if (request === playback.current) setPlaying({ ...model, availability: 'ready' });
    } catch (e) {
      if (request === playback.current) setError((e as Error).message);
    } finally {
      if (request === playback.current) setLoading(false);
    }
  }
  if (!source?.startsWith('nostr://') && !reference) return null;
  const command = proposal ? `soyli review ${proposal.root.id}` : undefined;
  return (
    <section className="proposal-section" aria-label="Proposed changes">
      <div className="source-section-heading">
        <div>
          <span className="eyebrow">BUILD ON EACH OTHER</span>
          <h2>
            <GitPullRequest size={25} /> Proposed changes
            <span className="proposal-count">{visibleRows.length}</span>
          </h2>
          <p>Play someone’s idea, discuss it, then bring it into the original.</p>
        </div>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => refresh((g) => g + 1)}
          aria-label="Refresh proposals"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      {!visibleRows.length && !loading && !error && (
        <p className="muted">
          No proposals yet. Remix the source, make a change, then use{' '}
          <code>soyli propose "Description"</code>. No website account needed.
        </p>
      )}
      <div className="proposal-list">
        {visibleRows.map((p) => (
          <button
            type="button"
            key={p.root.id}
            className={`proposal-row ${selected === p.root.id ? 'selected' : ''}`}
            onClick={() => {
              playback.current++;
              setLoading(false);
              setError('');
              setSelected(p.root.id);
              setRevision(p.revision.id);
              setPlaying(null);
              setCopied(false);
            }}
          >
            <span>
              <strong>{p.title}</strong>
              <small>
                {p.root.pubkey.slice(0, 12)}… ·{' '}
                {new Date(p.root.created_at * 1000).toLocaleDateString()}
              </small>
            </span>
            <span className="proposal-state">
              {p.status}
              {tag(p.revision, 'soy-preview') ? ' · playable' : ''}
            </span>
          </button>
        ))}
      </div>
      {proposal && chosen && (
        <div className="proposal-review">
          <div className="proposal-toolbar">
            <label>
              Revision{' '}
              <select
                value={chosen.id}
                onChange={(e) => {
                  playback.current++;
                  setLoading(false);
                  setError('');
                  setRevision(e.target.value);
                  setPlaying(null);
                }}
              >
                {eligibleRevisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.created_at * 1000).toLocaleString()} ·{' '}
                    {(tag(r, 'c') ?? r.id).slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={loading || !tag(chosen, 'soy-preview')}
              onClick={() => {
                void play();
              }}
            >
              <Play size={16} />
              Play proposed
            </Button>
            {manifest && (
              <Button
                variant="outline"
                onClick={() => {
                  void play(true);
                }}
              >
                Play original
              </Button>
            )}
          </div>
          {chosen.id !== proposal.revision.id && (
            <p>A newer revision is available. Your reviewed revision stays selected.</p>
          )}
          <p className="proposal-description">{proposal.root.content}</p>
          {playing && (
            <Player key={playing.manifest.id} napplet={playing} autoPlay reviewScope={chosen.id} />
          )}
          <p className="muted">
            Contributor-supplied preview. The signature verifies its author and bytes; use a local
            rebuild to compare it with the source.
          </p>
          {proposal.comments.length > 0 && (
            <div className="proposal-comments">
              {proposal.comments
                .filter((c) => communityMode.allows(c.pubkey))
                .map((c) => (
                  <article key={c.id}>
                    <small>{c.pubkey.slice(0, 12)}…</small>
                    <p>{c.content}</p>
                  </article>
                ))}
            </div>
          )}
          <a href={`/proposals/${proposal.root.id}`}>Link to this proposal ↗</a>
        </div>
      )}
      {command && (
        <>
          <div className="proposal-command">
            <Terminal size={17} />
            <code>{command}</code>
            <Button
              variant="ghost"
              aria-label="Copy review command"
              onClick={() => {
                void navigator.clipboard.writeText(command).then(
                  () => setCopied(true),
                  () => setError('Could not copy the command.'),
                );
              }}
            >
              <Copy size={15} />
              {copied ? 'Copied' : ''}
            </Button>
          </div>
          <p className="muted">
            Review this proposal’s diff, discuss changes and merge locally with soyLI. Ordinary Git
            and ngit work too.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
