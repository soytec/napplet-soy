import { useEffect, useRef, useState } from 'react';
import { Subject, defer, repeat, retry } from 'rxjs';
import { receiveAnimated } from 'applesauce-wallet/helpers';
import { Button } from '../ui/button';
import { paymentInput } from '../../../../../packages/wallet/src/policy';
import { walletErrorMessage } from '../../../../../packages/wallet/src/errors';

/** Camera frames and uploaded images stay on this device. Decoding never navigates or pays. */
export function QrReader({ onRead }: { onRead: (value: string) => void }) {
  const video = useRef<HTMLVideoElement>(null),
    latest = useRef(onRead);
  latest.current = onRead;
  const [camera, setCamera] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  const parts = useRef(new Subject<string>());
  const accept = useRef((value: string) => {});
  useEffect(() => {
    const complete = (value: string) => {
      try {
        const parsed = paymentInput(value);
        latest.current(parsed.value);
        setError('');
        setProgress(
          parsed.type === 'cashu' ? 'Cashu token read.' : 'Invoice read. Review it before paying.',
        );
      } catch (error) {
        setError(walletErrorMessage(error));
        return;
      }
      setCamera(false);
    };
    const sub = defer(() => receiveAnimated(parts.current))
      .pipe(
        repeat(),
        retry({
          delay: () => {
            setError('QR code could not be decoded. Try again or paste the code.');
            return Promise.resolve();
          },
        }),
      )
      .subscribe({
        next: (value) =>
          typeof value === 'string'
            ? complete(value)
            : setProgress(`Reading animated QR… ${Math.round(value * 100)}%`),
        error: () => setError('QR code could not be decoded. Try again or paste the code.'),
      });
    accept.current = (value) => {
      if (/^ur:/i.test(value)) parts.current.next(value);
      else complete(value);
    };
    return () => sub.unsubscribe();
  }, []);
  useEffect(() => {
    if (!camera || !video.current) return;
    let closed = false,
      scanner: import('qr-scanner').default | undefined;
    import('qr-scanner')
      .then(async ({ default: Scanner }) => {
        if (closed) return;
        scanner = new Scanner(video.current!, (result) => accept.current(result.data), {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          returnDetailedScanResult: true,
        });
        await scanner.start();
        if (closed) scanner.destroy();
      })
      .catch(() => {
        if (!closed) {
          setError('Camera unavailable or permission denied. Choose an image or paste the code.');
          setCamera(false);
        }
      });
    return () => {
      closed = true;
      scanner?.destroy();
    };
  }, [camera]);
  return (
    <div className="wallet-scanner">
      <div className="wallet-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError('');
            setProgress('');
            setCamera((v) => !v);
          }}
        >
          {camera ? 'Stop camera' : 'Scan QR'}
        </Button>
        <label className="wallet-upload">
          Read QR image
          <input
            aria-label="Read QR image"
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError('');
              try {
                const { default: Scanner } = await import('qr-scanner');
                accept.current(
                  (await Scanner.scanImage(file, { returnDetailedScanResult: true })).data,
                );
              } catch {
                setError('No readable QR code found. Try another image or paste the code.');
              } finally {
                e.target.value = '';
              }
            }}
          />
        </label>
      </div>
      {camera && (
        <>
          <video ref={video} muted playsInline aria-label="QR scanner camera" />
          <p>
            Point your camera at a Lightning invoice or Cashu token. Keep animated codes in view.
          </p>
        </>
      )}
      {(error || progress) && <p role="status">{error || progress}</p>}
    </div>
  );
}
