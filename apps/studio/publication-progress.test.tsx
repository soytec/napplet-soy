import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project } from './types';
import { publishProgress, publicationProgress } from './publication-progress';
import { PublicationProgressPanel } from './publication-progress-ui';

const project = (ready = false) =>
  ({
    phase: 'ready',
    stage: 'Published',
    publication: {
      progress: publishProgress('website'),
      review: { id: 'one' },
      attempt: { status: 'published', review: { id: 'one' }, result: { websiteReady: ready } },
    },
  }) as Project;

test('publication progress distinguishes relay acceptance, website readiness and a new release', () => {
  const p = project();
  expect(publicationProgress(p)).toMatchObject({ completed: 7, complete: false });
  expect(renderToStaticMarkup(<PublicationProgressPanel project={p} />)).toContain(
    'aria-current="step"',
  );
  p.publication!.attempt!.result!.websiteReady = true;
  expect(publicationProgress(p)).toMatchObject({ completed: 8, complete: true });
  expect(renderToStaticMarkup(<PublicationProgressPanel project={p} />)).toContain(
    'Publication complete',
  );
  p.publication!.progress = {
    step: 0,
    detail: 'Checking build',
    hint: 'Keep playing',
    at: Date.now(),
  };
  expect(publicationProgress(p)).toMatchObject({ completed: 0, complete: false });
  p.publication!.review!.id = 'two';
  delete p.publication!.progress;
  expect(publicationProgress(p)).toMatchObject({ completed: 2, complete: false });
});
test('progress reports the actual stopped stage and signer approval without marking it done', () => {
  const p = project();
  p.publication!.attempt!.status = 'running';
  p.phase = 'publishing';
  p.publication!.progress = publishProgress('upload');
  const html = renderToStaticMarkup(
    <PublicationProgressPanel project={p} signing="Approve the upload request" />,
  );
  expect(html).toContain('Approve the upload request');
  expect(html).toContain('Upload files');
  p.phase = 'failed';
  p.error = {
    code: 'UPLOAD',
    message: 'Blossom refused the upload',
    operation: 'upload',
    recovery: 'Retry',
  };
  expect(publicationProgress(p)).toMatchObject({
    completed: 5,
    failed: true,
    complete: false,
    detail: 'Blossom refused the upload',
  });
  for (const stage of ['current', 'snapshot', 'descriptor', 'outbox', 'mirror'])
    expect(publishProgress(stage).step).toBe(6);
});
