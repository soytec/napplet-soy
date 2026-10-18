import { useState } from 'react';
import { ArrowUpRight, GitBranch, Search, Sparkles, Plus, Play, LoaderCircle } from 'lucide-react';
import { working, type Project } from './types';

import { matchesFilter, visibleProjects, type ProjectFilter } from './dashboard-model';

export function Dashboard({
  projects,
  loading,
  busy,
  navigate,
}: {
  projects: Project[];
  loading: boolean;
  busy?: string;
  navigate: (path: string) => void;
}) {
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState('updated');
  const visible = visibleProjects(projects, filter, search, order);
  const filters = [
    ['all', 'All'],
    ['drafts', 'Drafts'],
    ['published', 'Published'],
    ['remixes', 'Remixes'],
    ['attention', 'Needs attention'],
  ] as const;
  return (
    <section className="creations-page">
      <div className="creations-heading">
        <div>
          <span className="eyebrow">A PLACE FOR YOUR NEXT LITTLE OBSESSION</span>
          <h1>
            My creations<span>.</span>
          </h1>
          <p>Pick up an idea. Play with it. See where it goes.</p>
        </div>
        <button className="primary" onClick={() => navigate('/studio/create')}>
          <Plus size={18} /> Create a napplet
        </button>
      </div>
      <div className="creations-summary">
        <span>
          <strong>{projects.length}</strong> saved{' '}
          {projects.length === 1 ? 'creation' : 'creations'}
        </span>
        <span>
          <strong>{projects.filter((p) => p.preview).length}</strong> playable previews
        </span>
        <span className="storage-note">Saved on this computer · You choose when to publish</span>
      </div>
      {busy && (
        <button className="running-project" onClick={() => navigate('/studio/' + busy)}>
          <LoaderCircle className="spin" size={16} /> A creation is running. Follow its progress{' '}
          <ArrowUpRight size={16} />
        </button>
      )}
      <div className="creations-tools">
        <div className="creation-filters" aria-label="Filter creations">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? 'selected' : ''}
              onClick={() => setFilter(value)}
            >
              {label} <span>{projects.filter((p) => matchesFilter(p, value)).length}</span>
            </button>
          ))}
        </div>
        <div className="creation-search">
          <label>
            <Search size={16} />
            <input
              type="search"
              aria-label="Search creations"
              placeholder="Find an idea…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Sort creations"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          >
            <option value="updated">Recently edited</option>
            <option value="created">Newest created</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      {loading ? (
        <p role="status">Loading your creations…</p>
      ) : visible.length ? (
        <div className="creation-grid">
          {visible.map((p, index) => (
            <a
              className={`creation-card color-${index % 4}`}
              key={p.id}
              href={'/studio/' + p.id}
              onClick={(e) => {
                if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  navigate('/studio/' + p.id);
                }
              }}
            >
              <div className="creation-art" aria-hidden="true">
                <span className="creation-orbit" />
                <span className="creation-symbol">
                  {p.source ? <GitBranch size={40} /> : <Sparkles size={40} />}
                </span>
                <span className="creation-open">
                  <ArrowUpRight size={20} />
                </span>
              </div>
              <div className="creation-card-body">
                <span className="creation-kind">
                  {p.source ? 'REMIX' : 'ORIGINAL'} ·{' '}
                  {p.publication?.attempt?.status === 'published' ? 'PUBLISHED' : 'PRIVATE DRAFT'}
                </span>
                <h2>{p.title}</h2>
                <p className={`creation-stage ${p.phase}`}>
                  {working(p.phase) && <LoaderCircle className="spin" size={14} />}
                  {p.phase === 'failed'
                    ? 'Needs attention — your work is saved'
                    : p.phase === 'stopped'
                      ? 'Paused — continue when you’re ready'
                      : working(p.phase)
                        ? p.stage
                        : p.preview
                          ? 'Ready to play and keep shaping'
                          : p.stage}
                </p>
                <div className="creation-card-foot">
                  <span>
                    <Play size={13} />
                    {p.preview
                      ? `${p.checkpoints.length} saved preview${p.checkpoints.length === 1 ? '' : 's'}`
                      : 'First preview ahead'}
                  </span>
                  <time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString()}>
                    {new Date(p.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="creations-empty">
          <Sparkles size={32} />
          <h2>
            {projects.length
              ? 'No creations match yet.'
              : 'Every little obsession starts somewhere.'}
          </h2>
          <p>
            {projects.length
              ? 'Try another filter or search.'
              : 'Describe an idea and give it a place to grow.'}
          </p>
          {projects.length ? (
            <button
              className="outline"
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
            >
              Show all creations
            </button>
          ) : (
            <button className="primary" onClick={() => navigate('/studio/create')}>
              Start your first napplet <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
