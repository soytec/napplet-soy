import type { EventTemplate, NostrEvent } from 'nostr-tools';
import { studioTemplate, verifyStudioSignature } from '../../packages/identity/src/studio-channel';

export type PublicationAccount = {
  pubkey: string | null;
  currentPubkey: () => string | null;
  connect: () => Promise<void>;
  sign: (pubkey: string, template: EventTemplate) => Promise<NostrEvent>;
};

/** Reuse the shell signer, pinned to the account explicitly selected for this review. */
export function bindPublicationAccount(account: PublicationAccount) {
  const pubkey = account.pubkey;
  if (!pubkey) throw new Error('Choose an account before publishing.');
  let closed = false;
  const alive = () => !closed && account.currentPubkey() === pubkey;
  return {
    pubkey,
    alive,
    close: () => {
      closed = true;
    },
    async signEvent(input: EventTemplate) {
      if (!alive()) throw new Error('Your selected account changed. Reconnect before continuing.');
      const template = studioTemplate.parse(input);
      const event = await account.sign(pubkey, template);
      if (!alive()) throw new Error('Your selected account changed during signing.');
      return verifyStudioSignature(pubkey, template, event);
    },
  };
}
