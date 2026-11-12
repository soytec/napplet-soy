import { Wallet, LoaderCircle } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '../ui/popover';
import { useWallet } from './wallet-provider';
import { WalletAccess } from './wallet-access';
export function WalletButton() {
  const { enabled, runtime, balance, busy } = useWallet();
  const loading = busy && !runtime;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            loading
              ? 'Wallet, loading'
              : runtime
                ? `Wallet, ${balance} sats`
                : enabled
                  ? 'Wallet'
                  : 'Wallet, disabled'
          }
          title={
            loading
              ? 'Loading wallet…'
              : runtime
                ? `Wallet · ${balance.toLocaleString()} sats`
                : enabled
                  ? 'Wallet'
                  : 'Wallet · disabled'
          }
        >
          {loading ? <LoaderCircle size={20} className="animate-spin" /> : <Wallet size={20} />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="wallet-popover">
        <WalletAccess />
        <PopoverClose asChild>
          <Link className="wallet-more" to="/manage" hash="wallet">
            Manage wallet ↗
          </Link>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
