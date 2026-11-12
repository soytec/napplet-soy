import { PrivateKeySigner } from 'applesauce-signers';
import { WalletFactory, WalletTokenFactory } from 'applesauce-wallet/factories';
import { firstValueFrom, filter } from 'rxjs';
import { browserIdentity } from '../../apps/web/src/lib/browser-identity';
import { configureClient } from '../../apps/web/src/lib/network';
import { openWallet, type WalletRuntime } from '../../apps/web/src/lib/wallet-runtime';

let runtime: WalletRuntime | undefined;
export async function setup() {
  const key = new Uint8Array(32);
  key[31] = 3;
  const signer = new PrivateKeySigner(key);
  const pubkey = await signer.getPublicKey();
  (window as any).nostr = {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event: Parameters<typeof signer.signEvent>[0]) => signer.signEvent(event),
    nip44: signer.nip44,
  };
  configureClient({ relays: ['wss://bootstrap.example'], blossom: [], rules: [], featured: [] });
  await browserIdentity().extension(false);
  const wallet = await WalletFactory.create(['https://mint.test'], key, [
    'wss://bootstrap.example',
    'wss://wallet.example',
  ]).sign(signer);
  const token = await WalletTokenFactory.create({
    mint: 'https://mint.test',
    unit: 'sat',
    proofs: [{ id: '00abcdef', amount: 8, secret: 'loading-proof-secret', C: '02abcdef' }],
  }).sign(signer);
  const info = await signer.signEvent({
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [['mint', 'https://mint.test', 'sat']],
  });
  const oldToken = await WalletTokenFactory.create({
    mint: 'https://mint.test',
    unit: 'sat',
    proofs: [{ id: '00abcdef', amount: 16, secret: 'deleted-loading-proof', C: '02abcdef' }],
  }).sign(signer);
  const deletion = await signer.signEvent({
    kind: 5,
    created_at: oldToken.created_at,
    tags: [
      ['k', '7375'],
      ['e', oldToken.id],
    ],
    content: '',
  });
  return { pubkey, events: JSON.parse(JSON.stringify([wallet, token, info, oldToken, deletion])) };
}

async function loaded() {
  await firstValueFrom(runtime!.wallet.loadingState$.pipe(filter((loading) => !loading)));
  await runtime!.wallet.unlock();
  return runtime!.wallet.satBalances();
}
export async function open() {
  runtime = await openWallet(browserIdentity().state.pubkey!);
  return loaded();
}
export async function refresh() {
  await runtime!.refresh();
  return loaded();
}
export function close() {
  runtime?.close();
}
