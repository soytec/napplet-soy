import { Link } from '@tanstack/react-router';
import { useNostr } from './nostr-provider';
import { ProfileEditor } from './profile-editor';
import { ProfileAvatar } from './creator-link';
import { Button } from './ui/button';
import { useProfile } from '@/lib/profiles';

export function ManagedProfile() {
  const { pubkey, connect } = useNostr();
  return pubkey ? (
    <ProfileDetails key={pubkey} pubkey={pubkey} />
  ) : (
    <Button onClick={() => void connect()}>Sign in to manage your profile</Button>
  );
}
function ProfileDetails({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return (
    <section className="manage-profile" aria-label="Profile settings">
      <h2>Your public profile</h2>
      <div className="manage-profile-summary">
        <ProfileAvatar profile={profile} name={profile?.name ?? 'Nostr'} large />
        <div>
          <strong>{profile?.name ?? 'Your Nostr account'}</strong>
          {profile?.about && <p>{profile.about}</p>}
          <Link to="/p/$pubkey" params={{ pubkey }} search={{ page: 1, all: false }}>
            View public profile ↗
          </Link>
        </div>
      </div>
      <ProfileEditor pubkey={pubkey} exists={!!profile?.eventId} />
    </section>
  );
}
