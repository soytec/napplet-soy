import { expect, test } from 'bun:test';
import {
  localSource,
  localStudioOrigin,
  studioCreatePath,
  studioEntry,
  studioRoute,
  validSource,
} from './navigation';
import { matchesFilter, visibleProjects } from './dashboard-model';
import type { Project } from './types';

test('shell links preserve an exact remix revision without granting an automatic action', () => {
  const source = 'https://napplet.soy/r/' + 'a'.repeat(64);
  const path = studioCreatePath(source, 'A game & a name');
  const url = studioEntry('http://localhost:3000', path)!;
  expect(url.startsWith('/studio/create?')).toBe(true);
  expect(studioRoute(new URL(url, 'http://localhost:3000'))).toEqual({
    view: 'create',
    source,
    title: 'A game & a name',
  });
  expect(studioEntry('https://napplet.soy', path)).toBe(path);
  expect(localStudioOrigin('http://127.0.0.1.evil.test')).toBeUndefined();
  expect(localStudioOrigin('https://napplet.soy')).toBeUndefined();
  expect(studioEntry('http://localhost:3000', 'https://evil.test/create')).toBeUndefined();
  expect(studioEntry('http://localhost:3000', '/api/state')).toBeUndefined();
  expect(localStudioOrigin('http://localhost:3000', '4215')).toBe('http://127.0.0.1:4215');
  expect(validSource('javascript:alert(1)')).toBe(false);
  expect(validSource('https://user:password@example.com/r/id')).toBe(false);
  expect(validSource('http://192.168.1.1/r/id')).toBe(false);
  expect(localSource('http://127.0.0.1:3000/r/' + 'b'.repeat(64))).toBe(true);
  expect(localSource(source)).toBe(false);
});

test('dashboard, creation and workspace routes survive direct navigation without selecting another project', () => {
  const id = '0602a60b-df41-4600-aed5-84bd70529892';
  const route = (path: string) => studioRoute(new URL(path, 'http://127.0.0.1:4195'));
  expect(route('/')).toEqual({ view: 'dashboard' });
  expect(route('/studio')).toEqual({ view: 'dashboard' });
  expect(route('/studio/' + id)).toEqual({ view: 'project', id });
  expect(route('/studio/create')).toEqual({ view: 'create', source: '', title: '' });
  expect(route('/create?source=javascript%3Aalert(1)')).toEqual({ view: 'missing' });
  expect(route('/studio/unknown')).toEqual({ view: 'missing' });
});

test('dashboard filters and ordering keep underlying projects and their history intact', () => {
  const a = {
    id: 'a',
    title: 'Orbit Pop',
    phase: 'ready',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-17',
    checkpoints: [],
  } as unknown as Project;
  const b = {
    ...a,
    id: 'b',
    title: 'Breakout',
    source: 'https://napplet.soy/r/original',
    phase: 'failed',
    createdAt: '2026-10-15',
    updatedAt: '2026-10-16',
  } as Project;
  const c = {
    ...a,
    id: 'c',
    title: 'Published',
    publication: { attempt: { status: 'published' } },
  } as Project;
  const projects = [b, a, c];
  const before = structuredClone(projects);
  expect(visibleProjects(projects, 'all', '', 'updated').map((p) => p.id)).toEqual(['a', 'c', 'b']);
  expect(visibleProjects(projects, 'all', '', 'created')[0].id).toBe('b');
  expect(visibleProjects(projects, 'all', ' ORBIT ', 'name')).toEqual([a]);
  expect(visibleProjects(projects, 'remixes', '', 'updated')).toEqual([b]);
  expect(visibleProjects(projects, 'attention', '', 'updated')).toEqual([b]);
  expect(matchesFilter(c, 'published')).toBe(true);
  expect(matchesFilter(c, 'drafts')).toBe(false);
  expect(projects).toEqual(before);
});
