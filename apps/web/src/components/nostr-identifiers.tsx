import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { SignedEvent } from '../../../../packages/protocol/src';

/**
 * Copyable Nostr identifiers for a napplet page: the addressable naddr (latest
 * publication) when one exists, and the nevent of the release shown here.
 */
export function NostrIdentifiers({
  naddr,
  release,
  relays,
}: {
  naddr: string | null;
  release: SignedEvent;
  relays: string[];
}) {
  const nevent = nip19.neventEncode({
    id: release.id,
    author: release.pubkey,
    kind: release.kind,
    relays: relays.slice(0, 8),
  });
  return (
    <>
      {naddr && <NostrIdentifier label="naddr" value={naddr} />}
      <NostrIdentifier label="nevent" value={nevent} />
    </>
  );
}

const TAIL = 8;

function NostrIdentifier({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null);
  const code = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div className="nostr-identifier">
      <span>{label}</span>
      {/* Full value stays in the DOM (selection, fallback copy); CSS elides the middle. */}
      <code ref={code} title={value} data-testid={`napplet-${label}`}>
        <span className="nostr-identifier-head">{value.slice(0, -TAIL)}</span>
        <span className="nostr-identifier-tail">{value.slice(-TAIL)}</span>
      </code>
      <button
        type="button"
        className="nostr-identifier-copy"
        data-state={feedback ?? undefined}
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setFeedback('copied');
          } catch {
            // Select the full value so the visitor can copy it manually.
            const selection = window.getSelection();
            if (code.current && selection) selection.selectAllChildren(code.current);
            setFeedback('error');
          }
        }}
      >
        {feedback === 'copied' ? <Check size={13} strokeWidth={3} /> : <Copy size={12} />}
        <span role="status" className="sr-only">
          {feedback === 'copied'
            ? `${label} copied`
            : feedback === 'error'
              ? `${label} selected; press copy to finish`
              : ''}
        </span>
      </button>
    </div>
  );
}
