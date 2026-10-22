import React from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { Project } from './types';
import { publicationProgress, publicationSteps } from './publication-progress';

export function PublicationProgressPanel({
  project,
  signing,
}: {
  project: Project;
  signing?: string;
}) {
  const progress = publicationProgress(project);
  if (!progress) return null;
  const { complete, failed, completed, step } = progress;
  return (
    <section className="publication-timeline" aria-label="Publication progress">
      <div className="publication-timeline-heading">
        {complete ? (
          <Check size={18} />
        ) : (
          <LoaderCircle size={18} className={failed || step === 2 ? '' : 'spin'} />
        )}
        <strong>
          {complete
            ? 'Publication complete'
            : failed
              ? 'Publication needs attention'
              : publicationSteps[step]}
        </strong>
        <small>
          {completed} / {publicationSteps.length} steps complete
        </small>
      </div>
      <progress
        max={publicationSteps.length}
        value={completed}
        aria-label="Publication steps completed"
      />
      <ol>
        {publicationSteps.map((label, index) => (
          <li
            key={label}
            data-state={index < completed ? 'done' : index === step ? 'current' : 'waiting'}
            aria-current={!complete && index === step ? 'step' : undefined}
          >
            <span aria-hidden="true">{index < completed ? '✓' : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="publication-live-detail" role="status" aria-live="polite">
        <p>{progress.detail}</p>
        <p>{!complete && !failed && signing?.startsWith('Approve') ? signing : progress.hint}</p>
      </div>
    </section>
  );
}
