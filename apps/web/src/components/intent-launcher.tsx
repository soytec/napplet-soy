import { useSyncExternalStore, useState, useRef, useEffect } from 'react';
import { Player } from './player';
import {
  subscribeIntentUi,
  intentUi,
  serverIntentUi,
  closeIntentLaunch,
  failIntentLaunch,
  dismissIntentError,
} from '@/lib/intent-workspace';

/** Shell-owned handler choice and target surface; no payload is exposed to other catalog entries. */
export function IntentLauncher() {
  const state = useSyncExternalStore(subscribeIntentUi, intentUi, serverIntentUi);
  const [remember, setRemember] = useState(false);
  const choiceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (state.choice && !choiceDialog.current?.open) choiceDialog.current?.showModal();
  }, [state.choice]);
  return (
    <>
      {state.choice && (
        <dialog
          ref={choiceDialog}
          onCancel={(event) => {
            event.preventDefault();
            state.choice?.answer(null);
          }}
          aria-label="Choose napplet handler"
          className="intent-choice"
        >
          <h2>Open with a napplet</h2>
          <p>Choose a handler for {state.choice.request.convention}.</p>
          <label>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />{' '}
            Use this handler by default for {state.choice.availability.archetype}
          </label>
          <div>
            {state.choice.availability.candidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() => {
                  state.choice!.answer(candidate.id, remember);
                  setRemember(false);
                }}
              >
                {candidate.title ?? candidate.id}
              </button>
            ))}
          </div>
          <button onClick={() => state.choice!.answer(null)}>Cancel</button>
        </dialog>
      )}
      {state.launch && (
        <div
          className="intent-target"
          role="dialog"
          aria-label={state.launch.napplet.title}
          data-intent-catalog-id={state.launch.entry.id}
          tabIndex={-1}
        >
          <button className="intent-close" onClick={() => closeIntentLaunch(state.launch!.key)}>
            Close {state.launch.napplet.title}
          </button>
          <Player
            key={state.launch.key}
            napplet={state.launch.napplet}
            autoPlay
            onStop={() => closeIntentLaunch(state.launch!.key)}
            onLoadError={(error) => failIntentLaunch(state.launch!.key, error)}
          />
        </div>
      )}
      {state.error && (
        <div role="alert" className="intent-choice">
          <p>{state.error}</p>
          <button onClick={dismissIntentError}>Dismiss</button>
        </div>
      )}
    </>
  );
}
