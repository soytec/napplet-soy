import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProposalProgressPanel } from './proposal-progress-ui';
import { proposalProgress } from './proposal-progress';
import type { Project } from './types';

test('proposal UI identifies real stage, pending signer, failure and confirmed delivery', () => {
  const project = {
    phase: 'publishing',
    proposal: { progress: proposalProgress('source', 'Sharing exact source with git.example') },
  } as Project;
  let html = renderToStaticMarkup(
    <ProposalProgressPanel project={project} signing="Approve the signing request" />,
  );
  expect(html).toContain('Sharing exact source with git.example');
  expect(html).toContain('Approve the signing request');
  expect(html).not.toContain('Proposal submitted');
  project.phase = 'failed';
  project.error = {
    code: 'GIT',
    message: 'Source host unavailable',
    operation: 'share source',
    recovery: 'Retry',
  };
  html = renderToStaticMarkup(<ProposalProgressPanel project={project} signing="" />);
  expect(html).toContain('Source host unavailable');
  expect(html).toContain('Proposal needs attention');
  project.phase = 'ready';
  project.proposal!.progress!.complete = true;
  html = renderToStaticMarkup(<ProposalProgressPanel project={project} signing="" />);
  expect(html).toContain('Proposal submitted');
  expect(html).toContain('value="7"');
  project.phase = 'failed'; // An unrelated later maker error cannot undo delivery.
  expect(renderToStaticMarkup(<ProposalProgressPanel project={project} signing="" />)).toContain(
    'Proposal submitted',
  );
  project.phase = 'ready';
  // Preparing the next revision must not retain the completed state.
  project.proposal!.progress = proposalProgress('check', 'Checking next revision');
  expect(
    renderToStaticMarkup(<ProposalProgressPanel project={project} signing="" />),
  ).not.toContain('Proposal submitted');
});
