import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from './store';
import type { Project } from './types';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-store-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const project: Project = {
    id: crypto.randomUUID(),
    title: 'Saved draft',
    phase: 'ready',
    stage: 'Ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    activity: [],
    checks: [],
    checkpoints: [],
    estimatedCost: 0.02,
    steps: 4,
    session: 'ses_saved',
    preview: 'a'.repeat(40),
  };
  const open = (owner = 'local:test') => {
    const store = new StudioStore(dir, owner);
    cleanups.push(() => store.close());
    return store;
  };
  return { dir, project, open };
}
test('legacy JSON migrates once with an exact private backup; later stale JSON cannot replace saved work', () => {
  const { dir, project, open } = fixture();
  const original = JSON.stringify({ version: 1, projects: [project] }, null, 2);
  writeFileSync(join(dir, 'state.json'), original);
  const store = open();
  expect(store.load()).toEqual([project]);
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(original);
  expect(readFileSync(join(dir, 'state.legacy-v1.json'), 'utf8')).toBe(original);
  expect(statSync(join(dir, 'state.legacy-v1.json')).mode & 0o777).toBe(0o600);
  expect(statSync(join(dir, 'studio.sqlite')).mode & 0o777).toBe(0o600);
  project.title = 'Newer work';
  project.previewUrl = 'http://127.0.0.1:12345';
  store.save([project]);
  store.close();
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 1, projects: [] }));
  expect(open().load()).toEqual([{ ...project, previewUrl: undefined }]);
});
test('owner mismatch, simultaneous writers and malformed legacy state fail without replacing drafts', () => {
  const { dir, project, open } = fixture();
  const store = open();
  store.save([project]);
  expect(() => open()).toThrow('Another worker');
  store.close();
  expect(() => open('local:someone-else')).toThrow('different owner');
  expect(open().load()).toEqual([project]);
  const other = fixture();
  const malformed = JSON.stringify({
    version: 1,
    projects: [{ ...project, id: '../../other-user' }],
  });
  writeFileSync(join(other.dir, 'state.json'), malformed);
  expect(() => other.open()).toThrow();
  expect(readFileSync(join(other.dir, 'state.json'), 'utf8')).toBe(malformed);
  writeFileSync(join(other.dir, 'state.json'), JSON.stringify({ version: 1, projects: [project] }));
  expect(other.open().load()).toEqual([project]);
});
test('job reservation and snapshot are atomic, recovery records interruption, and finalization cannot overwrite newer state', () => {
  const { project, open } = fixture();
  const store = open();
  project.phase = 'editing';
  const job = store.begin([project], project.id);
  expect(store.jobs()[0]).toMatchObject({ id: job, projectId: project.id, status: 'running' });
  expect(() => store.begin([{ ...project, title: 'Uncommitted' }], project.id)).toThrow();
  expect(store.load()[0].title).toBe('Saved draft');
  store.close();
  const restart = open();
  expect(restart.jobs()[0].status).toBe('running');
  project.phase = 'stopped';
  restart.recover([project]);
  expect(restart.jobs()[0]).toMatchObject({ status: 'interrupted' });
  expect(restart.jobs()[0].finishedAt).toBeTruthy();
  expect(() => restart.finish([{ ...project, title: 'Stale finish' }], job, 'completed')).toThrow();
  expect(restart.load()[0].title).toBe('Saved draft');
  const next = restart.begin([project], project.id);
  restart.finish([project], next, 'completed');
  expect(restart.jobs().find((j) => j.id === next)?.status).toBe('completed');
});
test('a dangling storage symlink is rejected before SQLite can create its target', () => {
  const { dir, open } = fixture();
  symlinkSync(join(dir, 'unexpected-target'), join(dir, 'studio.sqlite'));
  expect(() => open()).toThrow('ordinary files');
});
