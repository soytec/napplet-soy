import { getClientPolicy } from '@/lib/client-policy.functions';
import { configureClient } from '@/lib/network';
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import { NostrProvider } from '@/components/nostr-provider';
import { Shell } from '@/components/shell';
import styles from '@/styles.css?url';
import { ProfilesProvider } from '@/lib/profiles';
import { appearanceBootstrap } from '../../../../packages/runtime/src/appearance';
import { siteHead } from '@/lib/site-head';

export const Route = createRootRoute({
  beforeLoad: async () => {
    const policy = await getClientPolicy();
    if (typeof window !== 'undefined') configureClient(policy);
    return { clientPolicy: policy };
  },
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...(match.context.clientPolicy
        ? siteHead(match.context.clientPolicy.siteOrigin).meta
        : [{ title: 'napplet.soy' }]),
      {
        httpEquiv: 'Content-Security-Policy',
        content: "frame-src 'self' blob:; object-src 'none'; base-uri 'self'",
      },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', href: '/brand/soy-mascot.png', type: 'image/png' },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="empty-page">
      <span className="eyebrow">404 / LOST IN SPACE</span>
      <h1>Nothing orbiting here.</h1>
      <p>This address hasn’t landed in our collection.</p>
      <Link to="/">Back to the playground →</Link>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="empty-page">
      <h1>A little turbulence.</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </div>
  ),
});
function Root() {
  const { clientPolicy } = Route.useRouteContext();
  // Hydration reuses SSR context without rerunning beforeLoad. Configure before any child reads.
  if (typeof window !== 'undefined') configureClient(clientPolicy);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The SSR function body and minified client body differ; the pre-paint script runs once. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('napplet:community-active')==='1')document.documentElement.dataset.communityPending='true'}catch{}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        <ProfilesProvider>
          <NostrProvider>
            <Shell>
              <Outlet />
            </Shell>
          </NostrProvider>
        </ProfilesProvider>
        <Scripts />
      </body>
    </html>
  );
}
