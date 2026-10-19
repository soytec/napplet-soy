import React, { useEffect, useId, useRef, useState } from 'react';
import { Brain, ChevronDown, Terminal } from 'lucide-react';
import { workshopEntries, workshopTail } from './workshop';
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
  const [open, setOpen] = useState(false);
  const id = useId();
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const entries = workshopEntries(p);
  const tail = workshopTail(p);
  const active = working(p.phase);
  const latest = entries.at(-1);
  useEffect(() => {
    setOpen(false);
    follow.current = true;
  }, [p.turnStartedAt]);
  useEffect(() => {
    if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries.length, latest?.id, latest?.text, open]);
  if (!entries.length && !active && !p.turnStartedAt) return null;
  return (
    <section
      className={`live-activity${active ? ' activity-working' : ''}`}
      aria-label="Workshop activity and reasoning"
    >
      <button
        className="activity-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          follow.current = true;
          setOpen(!open);
        }}
      >
        <Terminal size={14} className="workshop-pulse" />
        <span>Workshop activity</span>
        <small>
          {p.turnSteps ?? p.steps}
          {p.turnLimit ? ` / ${p.turnLimit}` : ' total'} steps
          {p.turnTimeLimitMs ? ` · ${Math.round(p.turnTimeLimitMs / 60000)} min limit` : ''}
        </small>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      <div id={id}>
        {open ? (
          <>
            <div
              ref={log}
              className="workshop-log"
              tabIndex={0}
              aria-label="Reasoning and tool updates"
              onScroll={() => {
                const e = log.current!;
                follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 32;
              }}
            >
              {p.reasoningOlder && (
                <p className="reasoning-notice">
                  Showing the latest {reasoningLimits.blocks} reasoning blocks.
                </p>
              )}
              {entries.map((entry) => (
                <div className={`workshop-entry workshop-${entry.type}`} key={entry.id}>
                  <span className="workshop-kind">
                    {entry.type === 'reasoning' ? <Brain size={12} /> : <Terminal size={12} />}
                    {entry.type === 'reasoning' ? 'Reasoning' : 'Activity'}
                  </span>
                  {entry.type === 'reasoning' ? (
                    <ChatText text={entry.text} />
                  ) : (
                    <div>{entry.text}</div>
                  )}
                  {entry.truncated && (
                    <p className="reasoning-notice">Long block shortened for display.</p>
                  )}
                </div>
              ))}
              {!entries.length && <p className="reasoning-notice">Waiting for the next update…</p>}
            </div>
            <div className="activity-caption">
              Tool updates and model-shared reasoning · ${p.estimatedCost.toFixed(3)} reported total
              cost
            </div>
          </>
        ) : (
          <div
            className="workshop-tail"
            role="log"
            aria-live="polite"
            aria-label="Latest three workshop lines"
          >
            {tail.length ? (
              tail.map((line, i) => (
                <div className="workshop-tail-line" key={i}>
                  {line.type === 'reasoning' ? (
                    <Brain size={12} aria-label="Reasoning" />
                  ) : (
                    <Terminal size={12} aria-label="Activity" />
                  )}
                  <span>{line.text}</span>
                </div>
              ))
            ) : (
              <div className="workshop-tail-line">Waiting for the next update…</div>
            )}
          </div>
        )}
      </div>
      {p.timeLimitReached ? (
        <p className="budget-note">
          Time limit reached. Edits and the agent session are saved; checks determine whether a
          preview can be opened. Send a follow-up to continue.
        </p>
      ) : (
        (p.budgetReached ??
          /maximum steps(?: for this agent have been reached| reached)/i.test(
            p.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '',
          )) && (
          <p className="budget-note">
            Step limit reached. Checks can still pass with unfinished work. Send a follow-up when
            you’re ready to continue.
          </p>
        )
      )}
    </section>
  );
}
