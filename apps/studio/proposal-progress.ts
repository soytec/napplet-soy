import type { ProposalStage } from '../../packages/collaboration/src/progress';

export const proposalSteps = [
  'Check project',
  'Review proposal',
  'Upload preview',
  'Sign proposal',
  'Publish to relays',
  'Share source',
  'Verify delivery',
] as const;
export type ProposalProgressState = {
  step: number;
  detail: string;
  at: number;
  complete?: boolean;
};
export function proposalProgress(stage: ProposalStage, detail: string): ProposalProgressState {
  return {
    step: { check: 0, upload: 2, sign: 3, relay: 4, source: 5, verify: 6 }[stage],
    detail,
    at: Date.now(),
  };
}
