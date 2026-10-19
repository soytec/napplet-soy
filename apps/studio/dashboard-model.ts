import type { Project } from './types';

export type ProjectFilter = 'all' | 'drafts' | 'published' | 'remixes' | 'attention';
export function matchesFilter(project: Project, filter: ProjectFilter) {
  const published = project.publication?.attempt?.status === 'published';
  return (
    filter === 'all' ||
    (filter === 'drafts' && !published) ||
    (filter === 'published' && published) ||
    (filter === 'remixes' && !!project.source) ||
    (filter === 'attention' && ['failed', 'stopped'].includes(project.phase))
  );
}

export function visibleProjects(
  projects: Project[],
  filter: ProjectFilter,
  search: string,
  order: string,
) {
  const needle = search.trim().toLocaleLowerCase();
  return projects
    .filter(
      (project) =>
        matchesFilter(project, filter) &&
        `${project.title} ${project.source ?? ''}`.toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) =>
      order === 'name'
        ? a.title.localeCompare(b.title)
        : (order === 'created'
            ? b.createdAt.localeCompare(a.createdAt)
            : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id),
    );
}
