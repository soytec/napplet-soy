import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Tabs } from 'radix-ui';
import { BriefcaseBusiness, Wallet, Radio, UserRound } from 'lucide-react';
import { WorkDot } from '@/components/work-provider';
import { Button } from '@/components/ui/button';

const WorkManager = lazy(() =>
  import('@/components/work-manager').then((m) => ({ default: m.WorkManager })),
);
const WalletPanel = lazy(() =>
  import('@/components/wallet/wallet-panel').then((m) => ({ default: m.WalletPanel })),
);
const NetworkSettings = lazy(() =>
  import('@/components/network-settings').then((m) => ({ default: m.NetworkSettings })),
);
const ManagedProfile = lazy(() =>
  import('@/components/managed-profile').then((m) => ({ default: m.ManagedProfile })),
);
const sections = [
  ['work', 'My work', BriefcaseBusiness],
  ['wallet', 'Wallet', Wallet],
  ['relays', 'Relays', Radio],
  ['profile', 'Profile', UserRound],
] as const;

export const Route = createFileRoute('/manage')({
  head: () => ({
    meta: [{ title: 'Manage — napplet.soy' }, { name: 'robots', content: 'noindex' }],
  }),
  component: Manage,
});
function Manage() {
  const hash = useLocation({ select: (location) => location.hash });
  // URL fragments are absent from the server request. Match its initial markup
  // before selecting a deep-linked tab, including when entering through /network.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const currentHash = hash;
  const section = ['wallet', 'relays', 'profile'].includes(currentHash) ? currentHash : 'work';
  const navigate = useNavigate();
  return (
    <section className="detail-page work-page manage-page">
      <span className="eyebrow">YOUR SPACE</span>
      <h1>
        Manage<span className="coral">.</span>
      </h1>
      <p>Your work, wallet, connections and profile, in one place.</p>
      {hydrated ? (
        <Tabs.Root value={section} onValueChange={(hash) => void navigate({ to: '/manage', hash })}>
          <Tabs.List className="work-navigation manage-tabs" aria-label="Manage sections">
            {sections.map(([key, label, Icon]) => (
              <Tabs.Trigger key={key} value={key} asChild>
                <Button variant={section === key ? 'default' : 'outline'}>
                  <Icon size={18} /> {label} {key === 'work' && <WorkDot />}
                </Button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Suspense fallback={<p role="status">Loading this section…</p>}>
            <Tabs.Content value="work">
              <WorkManager hash={currentHash} />
            </Tabs.Content>
            <Tabs.Content value="wallet">
              <WalletPanel full />
            </Tabs.Content>
            <Tabs.Content value="relays">
              <NetworkSettings />
            </Tabs.Content>
            <Tabs.Content value="profile">
              <ManagedProfile />
            </Tabs.Content>
          </Suspense>
        </Tabs.Root>
      ) : (
        <p role="status">Loading your management tools…</p>
      )}
    </section>
  );
}
