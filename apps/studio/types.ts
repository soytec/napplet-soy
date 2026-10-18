import type { ConnectionState } from './connections-model';
import type { Diagnostic } from '../../packages/diagnostics/src';
import type { ProposalState } from './proposal';
import type { PublicationState } from './publication';
import type { StudioJob } from './store';

export type Phase =
  | 'idle'
  | 'preparing'
  | 'editing'
  | 'checking'
  | 'ready'
  | 'failed'
  | 'stopped'
  | 'preparing_release'
  | 'publishing';
export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: string;
};
export type Checkpoint = { commit: string; at: string; label: string };
export type Check = { name: string; state: 'running' | 'passed' | 'failed'; detail?: string };
export const reasoningLimits = { blocks: 16, characters: 12000 } as const;
export type ReasoningBlock = { id: string; text: string; truncated?: boolean };
export type Project = {
  id: string;
  title: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  stage: string;
  messages: Message[];
  activity: string[];
  reasoning?: ReasoningBlock[];
  reasoningOlder?: boolean;
  checks: Check[];
  checkpoints: Checkpoint[];
  session?: string;
  connectionKey?: string;
  turnSteps?: number;
  turnLimit?: number;
  turnStartedAt?: string;
  budgetReached?: boolean;
  initialized?: boolean;
  setup?: boolean;
  baseline?: string;
  preview?: string;
  previewUrl?: string;
  error?: Diagnostic;
  publication?: PublicationState;
  proposal?: ProposalState;
  publicationIntent?: string;
  estimatedCost: number;
  steps: number;
};
export type StudioState = {
  projects: Project[];
  model: string;
  connections?: ConnectionState;
  busy?: string;
  jobs?: StudioJob[];
};
export const working = (phase: Phase) =>
  ['preparing', 'editing', 'checking', 'preparing_release', 'publishing'].includes(phase);
