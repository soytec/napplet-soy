/** Trusted shell UI. Never render napplet/provider strings as HTML. */
export function chooseCapability(
  title: string,
  options: { id: string; label: string }[],
  signal: AbortSignal,
  configure?: () => void,
  emptyMessage = 'No saved connection meets the requested capabilities. Configure the model and its image/JSON support in AI connections.',
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'capability-dialog';
    Object.assign(dialog.style, {
      padding: '24px',
      maxWidth: 'min(560px, 94vw)',
      borderRadius: '14px',
      color: 'var(--foreground, #1e2924)',
      background: 'var(--background, white)',
    });
    const heading = document.createElement('h2');
    heading.textContent = title;
    const select = document.createElement('select');
    select.setAttribute('aria-label', title);
    Object.assign(select.style, {
      display: 'block',
      width: '100%',
      padding: '12px',
      margin: '18px 0',
    });
    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.append(option);
    }
    const finish = (id?: string) => {
      signal.removeEventListener('abort', abort);
      dialog.remove();
      id ? resolve(id) : reject(new Error('user-cancelled'));
    };
    const abort = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish();
    });
    const button = (label: string, click: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.marginRight = '12px';
      b.style.padding = '10px';
      b.onclick = click;
      dialog.append(b);
      return b;
    };
    dialog.append(heading, select);
    if (!options.length) {
      const hint = document.createElement('p');
      hint.textContent = emptyMessage;
      dialog.append(hint);
    }
    button('Continue', () => finish(select.value)).disabled = !options.length;
    if (configure)
      button('AI connections', () => {
        finish();
        configure();
      });
    button('Cancel', () => finish());
    document.body.append(dialog);
    dialog.showModal();
    select.focus();
  });
}
