import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button } from './ui/button';

/** A small exit target; hover, keyboard focus and touch disclose the same controls. */
export function PlayerChrome({
  expanded,
  embedded = false,
  blocked,
  title,
  description,
  detailPath,
  returnLabel,
  onExit,
  children,
}: {
  expanded: boolean;
  embedded?: boolean;
  blocked: boolean;
  title: string;
  description: string;
  detailPath?: string;
  returnLabel: string;
  onExit: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const pointer = useRef('');
  const id = useId();
  const visible = !expanded || open;
  const text = description.trim().replace(/\s+/g, ' ');
  const excerpt =
    Array.from(text).slice(0, 160).join('') + (Array.from(text).length > 160 ? '…' : '');

  useEffect(() => setOpen(false), [expanded]);
  useEffect(() => {
    if (!expanded || !open || blocked) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Pointer events inside an opaque iframe do not bubble to its host document.
    const blur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', blur);
    };
  }, [expanded, open, blocked]);

  function activate(event: MouseEvent) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (embedded) {
      setOpen(true);
      return;
    }
    if (pointer.current === 'touch' && !open) {
      setOpen(true);
      return;
    }
    onExit();
  }
  const exitLabel = embedded ? 'Player controls' : detailPath ? 'Back to details' : returnLabel;
  const triangle = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v16Z" />
    </svg>
  );
  const triggerProps = {
    className: 'player-corner-trigger',
    'aria-label': exitLabel,
    'aria-controls': id,
    'aria-expanded': open,
    'aria-describedby': `${id}-hint`,
    onPointerDown: (event: React.PointerEvent) => {
      pointer.current = event.pointerType;
    },
    onKeyDown: () => {
      pointer.current = '';
    },
    onClick: activate,
  };

  return (
    <div
      ref={root}
      className={`player-chrome${expanded ? ' player-corner' : ''}`}
      data-open={open}
      inert={blocked}
      onPointerEnter={(event) => {
        if (expanded && event.pointerType === 'mouse') {
          pointer.current = 'mouse';
          setOpen(true);
        }
      }}
      onPointerMove={(event) => {
        if (expanded && event.pointerType === 'mouse') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && !root.current?.contains(document.activeElement))
          setOpen(false);
      }}
      onFocusCapture={(event) => {
        if (expanded && event.target.matches(':focus-visible')) setOpen(true);
      }}
      onBlurCapture={(event) => {
        if (
          !blocked &&
          !event.currentTarget.contains(event.relatedTarget as Node) &&
          !(pointer.current === 'mouse' && event.currentTarget.matches(':hover'))
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (expanded && open && event.key === 'Escape' && !document.fullscreenElement) {
          event.preventDefault();
          event.stopPropagation();
          trigger.current?.focus({ preventScroll: true });
          setOpen(false);
        }
      }}
    >
      {expanded && (
        <>
          {detailPath ? (
            <Button variant="ghost" asChild {...triggerProps}>
              <a
                href={detailPath}
                ref={(node) => {
                  trigger.current = node;
                }}
              >
                {triangle}
              </a>
            </Button>
          ) : (
            <Button
              variant="ghost"
              {...triggerProps}
              ref={(node) => {
                trigger.current = node;
              }}
            >
              {triangle}
            </Button>
          )}
          <span id={`${id}-hint`} className="sr-only">
            {embedded
              ? 'Open player controls.'
              : 'Hover or focus to show player controls. On touch, tap once for controls and again to return.'}
          </span>
        </>
      )}
      <div id={id} className="player-chrome-panel" inert={!visible} aria-hidden={!visible}>
        {expanded && (
          <div className="player-corner-info">
            <strong>{title}</strong>
            {excerpt && <p>{excerpt}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
