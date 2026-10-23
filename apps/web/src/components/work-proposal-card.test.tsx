import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ProfilesProvider } from '../lib/profiles';
import { shortPubkey } from '../../../../packages/protocol/src/profile';
import { WorkProposalCard } from './work-proposal-card';
import type { WorkProposal } from '../../../../packages/client/src/work';

test('proposal cards identify the contributor immediately, with a linked public-key fallback', async () => {
  const author = '1'.repeat(64),
    owner = '2'.repeat(64);
  const row = {
    proposal: {
      title: 'Improve the radio',
      status: 'open',
      root: { id: 'proposal', pubkey: author },
      revision: { created_at: 1 },
      comments: [],
    },
    repository: { identifier: 'radio', pubkey: owner },
    publication: { title: 'Funclet', href: '/n/funclet', manifest: { pubkey: owner } },
    incoming: true,
  } as unknown as WorkProposal;
  function Card() {
    return <WorkProposalCard row={row} incoming={true} unread={true} />;
  }
  const route = createRootRoute({
    component: () => (
      <ProfilesProvider>
        <Card />
      </ProfilesProvider>
    ),
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const render = () => renderToStaticMarkup(<RouterProvider router={router} />);
  let html = render();
  expect(html).toContain('Proposed by');
  expect(html).toContain(shortPubkey(author));
  expect(html).not.toContain(shortPubkey(owner));
  expect(html).toContain('Review &amp; manage');
  expect(html).toContain('/n/funclet?proposal=proposal#proposals');
  expect(html).toContain('/p/npub1');
  expect(html).not.toContain('<summary>');
});
