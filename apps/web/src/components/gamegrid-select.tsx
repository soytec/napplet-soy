import { useRef } from 'react';
import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/** A controller-accessible choice scope, without an OS-owned select popup. */
export function GamegridSelect({ field, close }: { field: HTMLSelectElement; close: () => void }) {
  const initial = useRef<HTMLButtonElement>(null);
  const returnTo = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : field,
  );
  const options = [...field.options].filter((option) => !option.matches(':disabled'));
  const label =
    field.getAttribute('aria-label') || field.labels?.[0]?.textContent || 'Choose an option';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="gg-select-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          initial.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnTo.current.isConnected) returnTo.current.focus();
        }}
      >
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>D-pad to choose · A select · B cancel</DialogDescription>
        <div className="gg-menu-actions">
          {options.map((option, index) => (
            <button
              key={index}
              ref={
                option.selected || (!options.some((item) => item.selected) && index === 0)
                  ? initial
                  : undefined
              }
              aria-pressed={option.selected}
              onClick={() => {
                if (field.isConnected && !field.disabled) {
                  field.value = option.value;
                  field.dispatchEvent(new Event('change', { bubbles: true }));
                }
                close();
              }}
            >
              {option.label}
              {option.selected && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
