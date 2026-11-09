/** Trusted shell presentation only. Never pass prompts, credentials or provider errors here. */
const dialogs: HTMLDialogElement[] = [];
let listening = false;

export function hasShellDialog() {
  return typeof document !== 'undefined' && !!document.querySelector('dialog:modal');
}

/** Most recently presented trusted dialog, including dialogs promoted for fullscreen. */
export function activeShellDialog() {
  return [...dialogs].reverse().find((dialog) => dialog.isConnected && dialog.open) ?? null;
}

/** Native top-layer dialogs stay above both an expanded player and browser fullscreen. */
export function presentShellDialog(dialog: HTMLDialogElement) {
  const previous = document.activeElement;
  dialog.dataset.shellDialog = '';
  Object.assign(dialog.style, {
    position: 'fixed',
    inset: '0',
    margin: 'auto',
    maxHeight: dialog.hasAttribute('data-shell-layer') ? 'none' : 'calc(100dvh - 32px)',
    overflowY: 'auto',
  });
  // close events are queued; re-promoting an open dialog is not a user dismissal.
  const closed = (event: Event) => {
    if (dialog.open) event.stopImmediatePropagation();
  };
  dialog.addEventListener('close', closed);
  if (!dialog.open) dialog.showModal();
  dialogs.push(dialog);
  if (!listening) {
    listening = true;
    document.addEventListener('fullscreenchange', () => {
      // A fullscreen element can have entered the top layer after an existing prompt.
      const focused = document.activeElement;
      for (const current of dialogs) {
        if (!current.isConnected || !current.open) continue;
        current.close();
        current.showModal();
      }
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
      placeNotices();
    });
  }
  placeNotices();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = dialogs.lastIndexOf(dialog);
    if (index >= 0) dialogs.splice(index, 1);
    dialog.removeEventListener('close', closed);
    dialog.close();
    delete dialog.dataset.shellDialog;
    placeNotices();
    if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]'))
      previous.focus({ preventScroll: true });
  };
}

type NoticeState = 'working' | 'success' | 'error';
let notices: HTMLDivElement | undefined;
function placeNotices() {
  if (!notices?.childElementCount) return;
  const active = [...dialogs].reverse().find((d) => d.isConnected && d.open);
  const owner = active?.querySelector('[data-slot=dialog-content]') ?? active ?? document.body;
  if (notices.parentElement !== owner) owner.append(notices);
  if (notices.matches(':popover-open')) notices.hidePopover();
  notices.showPopover();
}

/** One changing notice per operation, rather than a new toast for every poll or token. */
export function shellActivity(message: string, signal?: AbortSignal) {
  if (typeof document === 'undefined' || signal?.aborted)
    return {
      update: (_: string) => {},
      success: (_: string) => {},
      error: (_: string) => {},
      dismiss: () => {},
    };
  if (!notices) {
    notices = document.createElement('div');
    notices.popover = 'manual';
    notices.className = 'shell-notices';
    notices.setAttribute('aria-label', 'Shell activity');
    Object.assign(notices.style, {
      position: 'fixed',
      inset: 'auto 16px 16px auto',
      margin: '0',
      padding: '0',
      border: '0',
      width: 'min(380px, calc(100vw - 32px))',
      maxHeight: '35dvh',
      overflow: 'auto',
      background: 'transparent',
      pointerEvents: 'none',
      color: 'var(--foreground, #1e2924)',
    });
  }
  const item = document.createElement('div');
  item.className = 'shell-notice';
  Object.assign(item.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    marginTop: '8px',
    border: '1px solid var(--border, #81968d)',
    borderRadius: '12px',
    background: 'var(--card, white)',
    boxShadow: '0 4px 20px #0002',
    pointerEvents: 'auto',
    font: '500 14px/1.5 var(--font-sans, system-ui)',
  });
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const close = document.createElement('button');
  close.textContent = '×';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  Object.assign(close.style, {
    marginLeft: 'auto',
    padding: '4px',
    color: 'inherit',
    background: 'none',
    border: '0',
  });
  item.append(icon, label, close);
  notices.append(item);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dismissed = false;
  const dismiss = () => {
    dismissed = true;
    signal?.removeEventListener('abort', dismiss);
    clearTimeout(timer);
    item.remove();
    if (!notices?.childElementCount && notices?.matches(':popover-open')) notices.hidePopover();
  };
  close.onclick = dismiss;
  signal?.addEventListener('abort', dismiss, { once: true });
  const render = (text: string, state: NoticeState) => {
    if (dismissed) return;
    clearTimeout(timer);
    if (state !== 'working') signal?.removeEventListener('abort', dismiss);
    item.dataset.state = state;
    icon.textContent = state === 'working' ? '◌' : state === 'success' ? '✓' : '!';
    label.textContent = text;
    placeNotices();
    if (state === 'success') timer = setTimeout(dismiss, 4500);
  };
  render(message, 'working');
  return {
    update: (text: string) => render(text, 'working'),
    success: (text: string) => render(text, 'success'),
    error: (text: string) => render(text, 'error'),
    dismiss,
  };
}
