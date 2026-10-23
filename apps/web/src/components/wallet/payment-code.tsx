import { useEffect, useState } from 'react';
import { sendAnimated } from 'applesauce-wallet/helpers';
import { LightningCode } from '../lightning-code';
import { Button } from '../ui/button';

export function PaymentCode({ value, label }: { value: string; label: string }) {
  const [part, setPart] = useState(value),
    [message, setMessage] = useState('');
  const animated = /^cashu[AB]/.test(value) && value.length > 900;
  useEffect(() => {
    setPart(value);
    if (!animated) return;
    const sub = sendAnimated(value, { interval: 300 }).subscribe({
      next: setPart,
      error: () => setMessage('Use Copy or Download if animated QR is unavailable.'),
    });
    return () => sub.unsubscribe();
  }, [value, animated]);
  return (
    <div className="wallet-code">
      <LightningCode value={part} label={label} preserveCase={!/^ln/i.test(value)} />
      {animated && <small>Animated Cashu QR — keep the scanner pointed here.</small>}
      <textarea aria-label={label} value={value} readOnly rows={3} />
      <div className="wallet-actions">
        <Button
          variant="outline"
          onClick={() =>
            navigator.clipboard
              .writeText(value)
              .then(() => setMessage('Copied.'))
              .catch(() => setMessage('Select and copy the code above.'))
          }
        >
          Copy
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([value], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = /^ln/i.test(value) ? 'lightning-invoice.txt' : 'cashu-token.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
