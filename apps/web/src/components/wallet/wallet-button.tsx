import { lazy, Suspense } from 'react';
import { Wallet } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '../ui/popover';
import { useWallet } from './wallet-provider';
const Panel = lazy(() => import('./wallet-panel').then((m) => ({ default: m.WalletPanel })));
export function WalletButton() {
  const { runtime, balance } = useWallet();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={runtime ? `Wallet, ${balance} sats` : 'Wallet'}
          title={runtime ? `Wallet · ${balance.toLocaleString()} sats` : 'Wallet'}
        >
          <Wallet size={20} />
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
