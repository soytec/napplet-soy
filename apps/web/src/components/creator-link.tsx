import { nativeMediaUrl } from '../../../../packages/client/src/bytes';
import { Link } from '@tanstack/react-router';
import { nip19 } from 'nostr-tools';
import { useState } from 'react';
import { useProfile } from '../lib/profiles';
import { shortPubkey, type ProfileView } from '../../../../packages/protocol/src/profile';

export function ProfileAvatar({
  profile,
  name,
  large = false,
}: {
  profile?: ProfileView;
  name: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState('');
  const src = nativeMediaUrl(profile?.picture) ?? '';
  return (
    <span className={`profile-avatar${large ? ' profile-avatar-large' : ''}`} aria-hidden="true">
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
export function CreatorLink({
  pubkey,
  initial,
  linked = true,
}: {
  pubkey: string;
  initial?: ProfileView;
  linked?: boolean;
}) {
  const loaded = useProfile(pubkey),
    profile = loaded ?? initial;
  const name = profile?.name ?? shortPubkey(pubkey);
  const children = (
    <>
      <ProfileAvatar profile={profile} name={name} />
      <span className="creator-name">{name}</span>
    </>
  );
  return linked ? (
    <Link
      className="nostr-creator"
      to="/p/$pubkey"
      params={{ pubkey: nip19.npubEncode(pubkey) }}
      search={{ page: 1, all: false }}
      title={nip19.npubEncode(pubkey)}
    >
      {children}
    </Link>
  ) : (
    <span className="nostr-creator" title={nip19.npubEncode(pubkey)}>
      {children}
    </span>
  );
}
