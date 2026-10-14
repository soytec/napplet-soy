import {
  IntentWorkspace,
  type IntentAvailability,
  type IntentEntry,
  type IntentRequest,
  intentCatalogId,
  intentContracts,
} from '../../../../packages/runtime/src/intent-session';
import { queryCatalog } from './protocol-catalog';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';

type Choice = {
  availability: IntentAvailability;
  request: IntentRequest;
  answer: (id: string | null, remember?: boolean) => void;
};
export type IntentUi = {
  choice?: Choice;
  launch?: { key: number; entry: IntentEntry; napplet: PublicNapplet };
  error?: string;
};
let state: IntentUi = {};
const empty: IntentUi = {};
const listeners = new Set<() => void>();
const models = new Map<string, PublicNapplet>();
let serial = 0;
let workspace: IntentWorkspace | undefined;
const preferenceKey = 'soy.intent-defaults/v1';
const update = (next: IntentUi) => {
  state = next;
  for (const listener of listeners) listener();
};
export const subscribeIntentUi = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const intentUi = () => state;
export const serverIntentUi = () => empty;
export function closeIntentLaunch(key: number) {
  if (state.launch?.key === key) {
    workspace?.dropPending(state.launch.entry.id);
    update({ ...state, launch: undefined });
  }
}
export function failIntentLaunch(key: number, error: Error) {
  if (state.launch?.key === key) {
    workspace?.dropPending(state.launch.entry.id);
    update({ ...state, error: error.message });
  }
}
export function dismissIntentError() {
  update({ ...state, error: undefined });
}
export function webIntentWorkspace() {
  if (workspace) return workspace;
  let defaults: Record<string, string> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      defaults = Object.fromEntries(
        Object.entries(saved).filter(
          (entry): entry is [string, string] =>
            entry[0].length > 0 &&
            entry[0].length <= 1024 &&
            !/[\u0000-\u001f\u007f]/.test(entry[0]) &&
            typeof entry[1] === 'string',
        ),
      );
  } catch {}
  workspace = new IntentWorkspace({
    defaults,
    saveDefaults: (value) => {
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(value));
      } catch {
        update({
          ...state,
          error: 'Your default handler choice could not be saved on this browser.',
        });
      }
    },
    discover: async (archetype) => {
      const catalog = await queryCatalog(undefined, archetype ? { archetype } : undefined);
      const relevant = archetype
        ? catalog.filter((model) =>
            intentContracts(model.manifest.tags).some(
              (contract) => contract.convention.slice(8).split('/')[0] === archetype,
            ),
          )
        : catalog;
      for (const model of relevant.slice(0, 100)) {
        if (model.availability !== 'ready') continue;
        try {
          const entry = await workspace!.install(model.manifest, model.title);
          models.set(entry.id, model);
        } catch {
          /* Invalid or unsupported manifests never enter the installed catalog. */
        }
      }
    },
    choose: (availability, request) =>
      new Promise((resolve) => {
        if (state.choice) {
          resolve(null);
          return;
        }
        const answer = (id: string | null, remember = false) => {
          if (id && !availability.candidates.some((candidate) => candidate.id === id)) {
            resolve(null);
            update({ ...state, choice: undefined });
            return;
          }
          if (id && remember) workspace!.setDefault(availability.archetype, id);
          update({ ...state, choice: undefined });
          resolve(id);
        };
        update({ ...state, choice: { availability, request, answer } });
      }),
    launch: async (entry) => {
      const model = models.get(entry.id);
      if (!model) throw new Error('The chosen handler is no longer available.');
      const previous = state.launch;
      const cancelled = previous ? workspace!.dropPending(previous.entry.id) : 0;
      update({
        ...state,
        launch: { key: ++serial, entry, napplet: model },
        error: cancelled
          ? 'The previous pending handler request was cancelled when this napplet opened.'
          : undefined,
      });
    },
    focus: (id) => {
      document.querySelector<HTMLElement>(`[data-intent-catalog-id="${CSS.escape(id)}"]`)?.focus();
    },
    failed: (entry, error) =>
      update({
        ...state,
        launch: state.launch?.entry.id === entry.id ? undefined : state.launch,
        error: error instanceof Error ? error.message : 'Could not open the requested napplet.',
      }),
  });
  return workspace;
}
export async function installPlayerIntent(manifest: unknown, title: string) {
  return webIntentWorkspace().install(manifest, title);
}
export function playerIntentCatalogId(manifest: Parameters<typeof intentCatalogId>[0]) {
  return intentCatalogId(manifest);
}
