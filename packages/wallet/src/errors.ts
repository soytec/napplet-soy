/** Only messages authored by the wallet may cross the UI boundary. Mint/relay/signer
 * errors can echo bearer tokens or decrypted event content. */
export class WalletError extends Error {
  override name = 'WalletError';
}
export function walletErrorMessage(error: unknown) {
  return error instanceof WalletError
    ? error.message
    : 'The wallet operation failed. Check your signer, mint connection and wallet relays, then retry from Activity. Recovery data is kept on this device.';
}
