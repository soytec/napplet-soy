import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProposalEntry } from './proposal-entry';
import type { Project } from './types';

const project: Project = {
  id: '0602a60b-df41-4600-aed5-84bd70529892',
  title: 'HTML remix',
  source: 'https://napplet.example/n/original',
  preview: 'a'.repeat(40),
  createdAt: '',
  updatedAt: '',
  phase: 'ready',
  stage: 'Ready to play',
  messages: [],
  activity: [],
  checks: [],
  checkpoints: [],
  estimatedCost: 0,
  steps: 0,
};
const render = (patch: Partial<Project>, busy = false) =>
  renderToStaticMarkup(
    <ProposalEntry project={{ ...project, ...patch }} busy={busy} open={() => {}} />,
  );

test('a playable HTML remix explains the missing repository instead of offering a failing proposal', () => {
  const html = render({ proposalAvailable: false });
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-describedby="proposal-unavailable"');
  expect(html).toContain('No upstream Git repository. Use Publish to share your remix.');
  expect(html).not.toContain('doctor');
});

test('proposals require a resolved Git binding and playable idle draft', () => {
  expect(render({ proposalAvailable: true })).not.toContain('disabled');
  expect(render({ proposalAvailable: undefined })).toContain('disabled=""');
  expect(render({ proposalAvailable: true, preview: undefined })).toContain('disabled=""');
  expect(render({ proposalAvailable: true }, true)).toContain('disabled=""');
  expect(render({ source: undefined, proposalAvailable: true })).toBe('');
});
