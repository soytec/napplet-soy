import {
  IntentWorkspace,
  type IntentAvailability,
  type IntentEntry,
  type IntentRequest,
  intentCatalogId,
  intentContracts,
} from '../../../../packages/runtime/src/intent-session';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import type { SignedEvent } from '../../../../packages/protocol/src';
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
/** One shell workspace; catalog reads are supplied by the browser integration. */
export function createWebIntentWorkspace(
  queryCatalog: (
    author?: string,
    search?: { archetype: string },
    known?: SignedEvent[],
  ) => Promise<PublicNapplet[]>,
) {
  let state: IntentUi = {};
  const listeners = new Set<() => void>();
  const models = new Map<string, PublicNapplet>();
  let serial = 0;
  let reconciliation = Promise.resolve();
  let workspace: IntentWorkspace | undefined;
  const preferenceKey = 'soy.intent-defaults/v1';
  const update = (next: IntentUi) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const subscribeIntentUi = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const intentUi = () => state;
  function closeIntentLaunch(key: number) {
    if (state.launch?.key === key) {
      workspace?.dropPending(state.launch.entry.id);
      update({ ...state, launch: undefined });
    }
  }
  function failIntentLaunch(key: number, error: Error) {
    if (state.launch?.key === key) {
      workspace?.dropPending(state.launch.entry.id);
      update({ ...state, error: error.message });
    }
  }
  function dismissIntentError() {
    update({ ...state, error: undefined });
  }
  function webIntentWorkspace() {
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
        // Refresh known coordinates too: a newer revision may no longer match
        // the old role's tag filter. Empty/partial results are not deletion.
        const catalog = await queryCatalog(
          undefined,
          archetype ? { archetype } : undefined,
          [...models.values()].map((model) => model.manifest),
        );
        await (reconciliation = reconciliation.then(async () => {
          for (const model of catalog) {
            const id = intentCatalogId(model.manifest);
            const known = models.get(id) ?? workspace!.entry(id);
            const matches =
              !archetype ||
              intentContracts(model.manifest.tags).some(
                (contract) => contract.convention.slice(8).split('/')[0] === archetype,
              );
            if (!known && (!matches || models.size >= 100 || model.availability !== 'ready'))
              continue;
            try {
              const release = await validateManifest(model.manifest);
              // Keep the newest verified revision, including observations that
              // retire admission. A stale relay reply must not resurrect it.
              const previous = [models.get(id)?.manifest, workspace!.entry(id)?.manifest]
                .filter((event): event is SignedEvent => !!event)
                .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
              if (
                previous &&
                (previous.created_at > release.manifest.created_at ||
                  (previous.created_at === release.manifest.created_at &&
                    previous.id < release.manifest.id))
              )
                continue;
              if (model.availability !== 'ready' || missingDomains(release.domains).length) {
                models.set(id, model);
                workspace!.remove(id);
                continue;
              }
              await workspace!.install(release.manifest, model.title);
              models.set(id, model);
            } catch {
              /* Invalid observations cannot replace a verified installed handler. */
            }
          }
        }));
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
        if (!model || (entry.manifest && model.manifest.id !== entry.manifest.id))
          throw new Error('The chosen handler listing changed. Refresh discovery before retrying.');
        const previous = state.launch;
        // The broker already queued the new delivery under this catalog ID.
        // Only a different target's pending work belongs to the replaced surface.
        const cancelled =
          previous && previous.entry.id !== entry.id
            ? workspace!.dropPending(previous.entry.id)
            : 0;
        update({
          ...state,
          launch: { key: ++serial, entry, napplet: model },
          error: cancelled
            ? 'The previous pending handler request was cancelled when this napplet opened.'
            : undefined,
        });
      },
      focus: (id) => {
        document
          .querySelector<HTMLElement>(`[data-intent-catalog-id="${CSS.escape(id)}"]`)
          ?.focus();
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
  return {
    workspace: webIntentWorkspace(),
    subscribeIntentUi,
    intentUi,
    closeIntentLaunch,
    failIntentLaunch,
    dismissIntentError,
  };
}
