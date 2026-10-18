import React, { useEffect, useId, useRef, useState } from 'react';
import { Brain, ChevronDown, Terminal } from 'lucide-react';
import type { Project } from './types';
import { reasoningLimits, working } from './types';

// Deliberately small Markdown subset: React text escaping, no HTML or executable URLs.
function inline(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : part.startsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}
export function ChatText({ text }: { text: string }) {
  const blocks = text.replace(/\\([._])/g, '$1').split(/(```[\s\S]*?```)/g);
  return (
    <div className="chat-prose">
      {blocks.map((block, b) =>
        block.startsWith('```') ? (
          <pre key={b}>
            <code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code>
          </pre>
        ) : (
          <React.Fragment key={b}>
            {block
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((paragraph, i) => {
                const lines = paragraph.split('\n');
                if (lines.every((l) => /^\s*[-*] /.test(l)))
                  return (
                    <ul key={i}>
                      {lines.map((l, j) => (
                        <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>
                      ))}
                    </ul>
                  );
                if (lines.every((l) => /^\d+\. /.test(l)))
                  return (
                    <ol key={i}>
                      {lines.map((l, j) => (
                        <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>
                      ))}
                    </ol>
                  );
                return (
                  <React.Fragment key={i}>
                    {lines.map((line, j) =>
                      /^#{1,6} /.test(line) ? (
                        <h4 key={j}>{inline(line.replace(/^#{1,6} /, ''))}</h4>
                      ) : (
                        <p key={j}>{inline(line)}</p>
                      ),
                    )}
                  </React.Fragment>
                );
              })}
          </React.Fragment>
        ),
      )}
    </div>
  );
}
export function ActivityPanel({ project: p }: { project: Project }) {
  const [open, setOpen] = useState(working(p.phase));
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    setOpen(working(p.phase));
    follow.current = true;
  }, [p.turnStartedAt]);
  useEffect(() => {
    if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [p.activity.length, p.activity.at(-1), open]);
  if (!p.activity.length) return null;
  return (
    <section className="live-activity" aria-label="Maker activity">
      <button className="activity-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Terminal size={14} />
        <span>{working(p.phase) ? 'Inside the workshop' : 'Workshop activity'}</span>
        <small>
          {p.turnSteps ?? p.steps}
          {p.turnLimit ? ` / ${p.turnLimit}` : ' total'} steps
        </small>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      {open ? (
        <>
          <div
            ref={log}
            className="activity-log"
            tabIndex={0}
            aria-label="Recent tool activity"
            onScroll={() => {
              const e = log.current!;
              follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 32;
            }}
          >
            {p.activity.map((line, i) => (
              <div key={i}>
                <span className="activity-tick">{String(i + 1).padStart(2, '0')}</span>
                {line}
              </div>
            ))}
          </div>
          <div className="activity-caption">
            Tool actions and progress · ${p.estimatedCost.toFixed(3)} reported total cost
          </div>
        </>
      ) : (
        <div className="activity-last">{p.activity.at(-1)}</div>
      )}
      {(p.budgetReached ??
        /maximum steps(?: for this agent have been reached| reached)/i.test(
          p.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '',
        )) && (
        <p className="budget-note">
          Step limit reached. Checks can still pass with unfinished work. Send a follow-up when
          you’re ready to continue.
        </p>
      )}
    </section>
  );
}

/** The provider's exposed reasoning channel, separate from chat and tool activity. */
export function ReasoningPanel({ project: p }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const blocks = p.reasoning ?? [];
  useEffect(() => {
    follow.current = true;
  }, [p.turnStartedAt]);
  useEffect(() => {
    if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [blocks.length, blocks.at(-1)?.text, open, p.turnStartedAt]);
  if (!p.turnStartedAt && !blocks.length && !working(p.phase)) return null;
  return (
    <section className="live-activity reasoning-panel" aria-label="Maker reasoning">
      <button
        className="activity-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Brain size={14} />
        <span>Reasoning</span>
        <small>
          {blocks.length
            ? `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`
            : 'When available'}
        </small>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div id={id}>
          <div
            ref={log}
            className="reasoning-log"
            tabIndex={0}
            aria-label="Provider reasoning"
            onScroll={() => {
              const e = log.current!;
              follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 32;
            }}
          >
            {p.reasoningOlder && (
              <p className="reasoning-notice">
                Showing the latest {reasoningLimits.blocks} blocks from this run.
              </p>
            )}
            {blocks.map((block) => (
              <div className="reasoning-block" key={block.id}>
                <ChatText text={block.text} />
                {block.truncated && (
                  <p className="reasoning-notice">Long block shortened for display.</p>
                )}
              </div>
            ))}
            {!blocks.length && (
              <p className="reasoning-notice">
                {p.phase === 'editing'
                  ? 'Waiting for the model to share reasoning. Completed blocks appear here as they arrive.'
                  : 'No reasoning is available for this run. New runs show it here when the model provides it.'}
              </p>
            )}
          </div>
          <div className="activity-caption">
            Shared by the model · Latest run · Some models provide summaries only
          </div>
        </div>
      )}
    </section>
  );
}
