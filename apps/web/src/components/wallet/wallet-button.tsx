import { lazy, Suspense } from 'react';
import { Wallet, LoaderCircle } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '../ui/popover';
import { useWallet } from './wallet-provider';
const Panel = lazy(() => import('./wallet-panel').then((m) => ({ default: m.WalletPanel })));
export function WalletButton() {
  const { runtime, balance, busy } = useWallet();
  const loading = busy && !runtime;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={loading ? 'Wallet, loading' : runtime ? `Wallet, ${balance} sats` : 'Wallet'}
          title={
            loading
              ? 'Loading wallet…'
              : runtime
                ? `Wallet · ${balance.toLocaleString()} sats`
                : 'Wallet'
          }
        >
          {loading ? <LoaderCircle size={20} className="animate-spin" /> : <Wallet size={20} />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="wallet-popover">
        <Suspense fallback={<p>Opening wallet tools…</p>}>
          <Panel />
        </Suspense>
        <PopoverClose asChild>
          <Link className="wallet-more" to="/manage" hash="wallet">
            Manage wallet ↗
          </Link>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
