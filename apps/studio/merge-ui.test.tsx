import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MergePanel } from './merge-ui';
import type { Project } from './types';

test('merge feedback stays active through signing and delivery, then stops on success or failure', () => {
  const project = {
    id: 'review',
    stage: 'Publishing and verifying the merged status.',
    merge: {
      status: 'publishing',
      detail: 'Publishing and verifying the merged status.',
      review: { id: 'review', pubkey: 'author', commit: 'commit' },
    },
  } as Project;
  const render = () =>
    renderToStaticMarkup(
      <MergePanel
        project={project}
        busy={false}
        signer={{
          session: undefined,
          pubkey: 'author',
          status: 'Approve the merge status in your signer',
          connect: async () => undefined,
        }}
        api={async <T,>() => undefined as T}
        refresh={async () => {}}
      />,
    );
  let html = render();
  expect(html).toContain('Merging…');
  expect(html).toContain('spin');
  expect(html).toContain('Publishing and verifying the merged status.');
  expect(html).toContain('Approve the merge status in your signer');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('disabled=""');
  project.merge!.status = 'failed';
  project.merge!.detail = 'Source host unavailable. Retry the reviewed merge.';
  html = render();
  expect(html).not.toContain('spin');
  expect(html).toContain('Retry reviewed merge');
  expect(html).toContain('Source host unavailable');
  project.merge!.status = 'merged';
  html = render();
  expect(html).not.toContain('spin');
  expect(html).not.toContain('Merge and update source');
  expect(html).toContain('Changes merged');
});
