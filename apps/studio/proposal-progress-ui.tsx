import React from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { Project } from './types';
import { proposalSteps } from './proposal-progress';

export function ProposalProgressPanel({ project, signing }: { project: Project; signing: string }) {
  const progress = project.proposal?.progress;
  if (!progress) return null;
  const complete = !!progress.complete;
  const failed = !complete && (project.phase === 'failed' || project.phase === 'stopped');
  const count = complete ? proposalSteps.length : progress.step;
  return (
    <section className="publication-timeline" aria-label="Proposal progress">
      <div className="publication-timeline-heading">
        {complete ? (
          <Check size={18} />
        ) : (
          <LoaderCircle size={18} className={failed || progress.step === 1 ? '' : 'spin'} />
        )}
        <strong>
          {complete
            ? 'Proposal submitted'
            : failed
              ? 'Proposal needs attention'
              : proposalSteps[progress.step]}
        </strong>
        <small>
          {count} / {proposalSteps.length} steps complete
        </small>
      </div>
      <progress max={proposalSteps.length} value={count} aria-label="Proposal steps completed" />
      <ol>
        {proposalSteps.map((label, index) => (
          <li
            key={label}
            data-state={index < count ? 'done' : index === progress.step ? 'current' : 'waiting'}
            aria-current={!complete && index === progress.step ? 'step' : undefined}
          >
            <span aria-hidden="true">{index < count ? '✓' : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="publication-live-detail" role="status" aria-live="polite">
        <p>{failed ? (project.error?.message ?? project.stage) : progress.detail}</p>
        <p>
          {failed
            ? 'Your work and any signed attempt are saved. Review the error before retrying.'
            : complete
              ? 'The maintainers can now review your changes. The original napplet is unchanged.'
              : signing.startsWith('Approve')
                ? signing
                : 'Keep this tab open. Signing requests appear in your selected account.'}
        </p>
      </div>
    </section>
  );
}
