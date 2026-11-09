import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

/** Shared controller text entry for search and ordinary shell form fields. */
export function GamegridKeyboard({
  field,
  close,
}: {
  field: HTMLInputElement | HTMLTextAreaElement;
  close: () => void;
}) {
  const [value, setValue] = useState(field.value);
  const [upper, setUpper] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const secret = field instanceof HTMLInputElement && field.type === 'password';
  const label =
    field.getAttribute('aria-label') ||
    field.labels?.[0]?.textContent ||
    field.placeholder ||
    'Enter text';
  const chars = symbols
    ? '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
    : '1234567890qwertyuiopasdfghjklzxcvbnm@._-:/?&=+!#$%()';
  const done = () => {
    const prototype =
      field instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    requestAnimationFrame(() => field.isConnected && field.focus());
  };
  const append = (text: string) =>
    setValue((previous) => {
      const next = previous + text;
      return field.maxLength >= 0 ? next.slice(0, field.maxLength) : next;
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="gg-keyboard" aria-describedby="gg-keyboard-help">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription id="gg-keyboard-help">
          Choose letters with the D-pad. A selects · B cancels. For other languages, use your
          device’s keyboard.
        </DialogDescription>
        <output aria-label="Entered text" className="gg-keyboard-value">
          {secret ? '•'.repeat(value.length) : value || ' '}
        </output>
        <div className="gg-keyboard-keys">
          {[...chars].map((char) => (
            <button
              type="button"
              key={char}
              onClick={() => append(upper ? char.toUpperCase() : char)}
            >
              {upper ? char.toUpperCase() : char}
            </button>
          ))}
        </div>
        <div className="gg-keyboard-actions">
          <button onClick={() => setSymbols(!symbols)} aria-pressed={symbols}>
            {symbols ? 'Letters' : 'Symbols'}
          </button>
          <button onClick={() => setUpper(!upper)} aria-pressed={upper}>
            Shift
          </button>
          <button onClick={() => append(' ')}>Space</button>
          <button onClick={() => setValue((value) => [...value].slice(0, -1).join(''))}>
            Delete
          </button>
          <button onClick={() => setValue('')}>Clear</button>
          <button onClick={close}>Cancel</button>
          <button className="gg-primary" onClick={done}>
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
