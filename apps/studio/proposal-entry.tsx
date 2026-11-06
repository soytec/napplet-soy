import React from 'react';
import type { Project } from './types';

export function ProposalEntry({
  project,
  busy,
  open,
}: {
  project: Project;
  busy: boolean;
  open: () => void;
}) {
  if (!project.source || project.merge) return null;
  const missing = project.proposalAvailable === false;
  return (
    <span className="proposal-entry">
      <button
        className="outline"
        disabled={busy || !project.preview || project.proposalAvailable !== true}
        aria-describedby={missing ? 'proposal-unavailable' : undefined}
        title={project.proposalAvailable === undefined ? 'Checking upstream Git source' : undefined}
        onClick={open}
      >
        Propose changes
      </button>
      {missing && (
        <small id="proposal-unavailable">
          No upstream Git repository. Use Publish to share your remix.
        </small>
      )}
    </span>
  );
}
