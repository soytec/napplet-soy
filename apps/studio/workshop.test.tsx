import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityPanel } from './activity-ui';
import { recordWorkshop, workshopEntries, workshopTail } from './workshop';
import type { Project } from './types';

function project(): Project {
  return {
    id: 'toy',
    title: 'Toy',
    phase: 'editing',
    stage: 'Working',
    createdAt: 'now',
    updatedAt: 'now',
    messages: [],
    activity: [],
    checks: [],
    checkpoints: [],
    estimatedCost: 0,
    steps: 0,
    reasoning: [],
  };
}
test('one collapsed workshop shows the latest three live lines, including updated reasoning', () => {
  const p = project();
  recordWorkshop(p, { id: 'tool-1', type: 'activity', text: 'read · completed' });
  p.reasoning!.push({ id: 'r1', text: 'Inspect controls.' });
  recordWorkshop(p, { id: 'r1', type: 'reasoning' });
  recordWorkshop(p, { id: 'tool-2', type: 'activity', text: 'edit · completed' });
  recordWorkshop(p, { id: 'tool-3', type: 'activity', text: 'studio_check · running' });
  expect(workshopTail(p).map((e) => e.text)).toEqual([
    'Inspect controls.',
    'edit · completed',
    'studio_check · running',
  ]);
  p.reasoning![0].text = 'Compiler passed. Verify movement.';
  recordWorkshop(p, { id: 'r1', type: 'reasoning' });
  expect(workshopEntries(p).at(-1)?.text).toBe('Compiler passed. Verify movement.');
  const html = renderToStaticMarkup(<ActivityPanel project={p} />);
  expect(html.match(/<section/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');
  expect(html.match(/class="workshop-tail-line"/g)).toHaveLength(3);
  expect(html).toContain('Compiler passed. Verify movement.');
  expect(html).not.toContain('read · completed');
  expect(html).toContain('activity-working');
  p.phase = 'ready';
  expect(renderToStaticMarkup(<ActivityPanel project={p} />)).not.toContain('activity-working');
});
test('workshop bounds history and can display saved projects without the new feed', () => {
  const p = project();
  p.activity = ['Saved tool update'];
  p.reasoning = [{ id: 'old', text: 'Saved reasoning' }];
  expect(workshopEntries(p).map((e) => e.text)).toEqual(['Saved reasoning', 'Saved tool update']);
  recordWorkshop(p, { id: 'new', type: 'activity', text: 'New progress' });
  expect(workshopEntries(p).map((e) => e.text)).toEqual([
    'Saved reasoning',
    'Saved tool update',
    'New progress',
  ]);
  for (let i = 0; i < 120; i++)
    recordWorkshop(p, { id: `tool-${i}`, type: 'activity', text: `Update ${i}` });
  expect(p.workshop).toHaveLength(100);
  p.reasoning.push({
    id: 'long',
    text: 'Earlier detail. '.repeat(200) + 'Latest visible progress.',
  });
  recordWorkshop(p, { id: 'long', type: 'reasoning' });
  expect(workshopTail(p)).toHaveLength(3);
  expect(workshopTail(p).at(-1)?.text).toContain('Latest visible progress.');
});
