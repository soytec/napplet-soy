import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { latestProfile } from '../../protocol/src/profile';
import { hasLightningAddress } from '../../client/src/zaps';
import { nutzapRecipient } from './policy';

/** Choose replaceable winners before validation: a newer withdrawal must not
 * resurrect an older Lightning address or nutzap receiving configuration. */
export type PaymentRecipient = {
  profile: SignedEvent | undefined;
  lightning: boolean;
  nutzap: SignedEvent | undefined;
  relayList: SignedEvent | undefined;
};
export function paymentRecipient(inputs: SignedEvent[], pubkey: string): PaymentRecipient {
  const events = inputs
    .flatMap((input) => {
      try {
        const event = verifiedEvent(input);
        return event.pubkey === pubkey && event.created_at <= Date.now() / 1000 + 60 ? [event] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  const profile = latestProfile(events, pubkey) ?? undefined;
  const candidate = events.find((e) => e.kind === 10019);
  let nutzap: SignedEvent | undefined;
  if (candidate) {
    try {
      nutzapRecipient(candidate);
      nutzap = candidate;
    } catch {}
  }
  return {
    profile,
    lightning: !!profile && hasLightningAddress(profile),
    nutzap,
    relayList: events.find((e) => e.kind === 10002),
  };
}
