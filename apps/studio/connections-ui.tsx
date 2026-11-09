import { presentShellDialog } from '../../packages/runtime/src/shell-ui';
import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { ModelPicker } from './model-picker-ui';
import {
  defaultSteps,
  providers,
  type Connection,
  type ConnectionInput,
  type ConnectionState,
  type Provider,
} from './connections-model';

type Api = <T>(path: string, body?: unknown) => Promise<T>;
const fresh = (): ConnectionInput => ({
  name: '',
  provider: 'openrouter',
  endpoint: providers.openrouter.url,
  model: '',
  images: false,
  json: false,
  tools: false,
  toolChoiceModes: [],
  steps: defaultSteps,
  key: '',
});
export function ConnectionsDialog({
  state,
  hosted = false,
  busy: working,
  loading = false,
  loadError = '',
  api,
  refresh,
  close,
}: {
  state: ConnectionState;
  hosted?: boolean;
  busy: boolean;
  loading?: boolean;
  loadError?: string;
  api: Api;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const busy = working || loading || !!loadError;
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<ConnectionInput>(fresh);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (dialog.current) return presentShellDialog(dialog.current);
  }, []);
  const perform = async (action: string, body: unknown) => {
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ message?: string }>('connections/' + action, body);
      if (action === 'save') {
        setForm(fresh());
        setEditing(false);
      }
      setMessage(
        result.message ??
          (action === 'save'
            ? 'Connection saved.'
            : action === 'select'
              ? 'Ready for your next message.'
              : 'Connection removed.'),
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const edit = (c: Connection) => {
    setForm({
      id: c.id,
      name: c.name,
      provider: c.provider,
      endpoint: c.endpoint,
      model: c.model,
      steps: c.steps,
      images: c.images,
      json: c.json,
      tools: c.tools,
      toolChoiceModes: c.toolChoiceModes,
    });
    setEditing(true);
    setError('');
    setMessage('');
  };
  return (
    <dialog
      ref={dialog}
      className="connections-dialog"
      aria-label="AI connections"
      onCancel={close}
      onClose={(event) => {
        if (!event.currentTarget.open) close();
      }}
    >
      <div className="settings-heading">
        <div>
          <span className="eyebrow">YOUR TOOLS, YOUR CHOICE</span>
          <h2>Inference connections</h2>
        </div>
        <button aria-label="Close connections" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <p className="settings-intro">
        {hosted
          ? 'Use your own cloud provider API key. Connections are private to your account and encrypted on the Studio host, outside your projects. Keys are supplied only to the selected inference provider and are never published with your source.'
          : 'Choose where your maker runs. Saved on this computer, outside your projects. Credentials are protected by local file permissions; they are not stored in your browser or published with your source.'}
      </p>
      {loading && !loadError && <p role="status">Loading your connections…</p>}
      {loadError && (
        <p role="alert" className="settings-error">
          {loadError}
        </p>
      )}
      {working && (
        <p className="settings-notice">
          Wait for the current task to finish, or stop it before changing connections.
        </p>
      )}
      <div className="connection-list">
        {state.connections.map((c) => (
          <div className="connection-card" key={c.id}>
            <div>
              <strong>
                {c.name}{' '}
                {state.selected === c.id && (
                  <span className="connection-selected">
                    <Check size={12} /> Active
                  </span>
                )}
              </strong>
              <small>
                {providers[c.provider].name} · {c.model}
              </small>
              <small>
                {new URL(c.endpoint).host} · {c.hasKey ? 'Key saved' : 'No API key'} · {c.steps}{' '}
                steps per turn
              </small>
              <small>
                {c.images ? 'Images enabled' : 'Text input'}
                {c.json ? ' · JSON output' : ''}
              </small>
            </div>
            <div className="connection-buttons">
              <button disabled={busy || pending} onClick={() => edit(c)}>
                Edit
              </button>
              <button disabled={busy || pending} onClick={() => void perform('test', { id: c.id })}>
                Test
              </button>
              {state.selected !== c.id && (
                <button
                  className="outline"
                  disabled={busy || pending}
                  onClick={() => void perform('select', { id: c.id })}
                >
                  Use
                </button>
              )}
              <button
                aria-label={'Remove ' + c.name}
                disabled={busy || pending}
                onClick={() => {
                  if (
                    confirm(
                      `Remove ${c.name} and its saved credential? Your projects remain saved.`,
                    )
                  )
                    void perform('remove', { id: c.id });
                }}
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!editing ? (
        <button
          className="outline"
          disabled={busy || pending}
          onClick={() => {
            setForm(fresh());
            setEditing(true);
          }}
        >
          <Plus size={16} /> Add connection
        </button>
      ) : (
        <form
          className="connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform('save', form);
          }}
        >
          <h3>{form.id ? 'Edit connection' : 'Add a connection'}</h3>
          <div className="settings-grid">
            <label>
              Name
              <input
                required
                maxLength={60}
                placeholder="My everyday maker"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Provider
              <select
                value={form.provider}
                onChange={(e) => {
                  const provider = e.target.value as Provider;
                  setForm({
                    ...form,
                    provider,
                    endpoint: providers[provider].url,
                    model: '',
                    images: false,
                    json: false,
                    tools: false,
                    toolChoiceModes: [],
                    key: '',
                  });
                }}
              >
                {Object.entries(providers)
                  .filter(([, p]) => !hosted || p.url.startsWith('https:'))
                  .map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            API base URL
            <input
              required
              readOnly={hosted}
              type="url"
              placeholder="https://your-provider.example/v1"
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            />
          </label>
          <div className="settings-grid">
            <label>
              API key
              <input
                type="password"
                autoComplete="new-password"
                value={form.key ?? ''}
                placeholder={
                  form.id
                    ? 'Leave blank to keep the saved key'
                    : hosted
                      ? 'Your provider API key'
                      : 'Optional for local servers'
                }
                onChange={(e) =>
                  setForm({ ...form, key: e.target.value || (form.id ? undefined : '') })
                }
              />
            </label>
            <label>
              Steps per turn
              <input
                type="number"
                min={10}
                max={100}
                required
                value={form.steps}
                onChange={(e) => setForm({ ...form, steps: Number(e.target.value) })}
              />
            </label>
          </div>
          <ModelPicker
            source={{
              id: form.id,
              provider: form.provider,
              endpoint: form.endpoint,
              key: form.key,
            }}
            api={api}
            value={form.model}
            onChange={(model, images) =>
              setForm({
                ...form,
                model,
                images: images ?? false,
                json: false,
                tools: false,
                toolChoiceModes: [],
              })
            }
            onDetected={(model, images) =>
              setForm((current) => (current.model === model ? { ...current, images } : current))
            }
            disabled={busy || pending}
            autoLoad={
              !!form.id &&
              form.key === undefined &&
              state.connections.some(
                (c) =>
                  c.id === form.id && c.provider === form.provider && c.endpoint === form.endpoint,
              )
            }
          />
          {form.id && ['ollama', 'lmstudio', 'llamacpp', 'compatible'].includes(form.provider) && (
            <button type="button" onClick={() => setForm({ ...form, key: '' })}>
              Clear saved API key on save
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={form.images ?? false}
              onChange={(e) => setForm({ ...form, images: e.target.checked })}
            />{' '}
            This model accepts images
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.json ?? false}
              onChange={(e) => setForm({ ...form, json: e.target.checked })}
            />{' '}
            This model supports JSON object output
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.tools ?? false}
              onChange={(e) => setForm({ ...form, tools: e.target.checked, toolChoiceModes: [] })}
            />{' '}
            This model supports tool calls (auto and none)
          </label>
          {form.tools &&
            (['required', 'tool'] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="checkbox"
                  checked={form.toolChoiceModes?.includes(mode) ?? false}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      toolChoiceModes: e.target.checked
                        ? [...(form.toolChoiceModes ?? []), mode]
                        : form.toolChoiceModes?.filter((m) => m !== mode),
                    })
                  }
                />{' '}
                {mode === 'required' ? 'Can require a tool call' : 'Can require one named tool'}
              </label>
            ))}
          <p>
            Image support is filled from the provider’s model catalogue when available. You can
            override it here; save to apply it to napplets. JSON and tool support remain manual.
          </p>
          <p className="settings-hint">
            Higher step limits can cost more.{' '}
            {hosted
              ? 'A turn has 20 minutes including queue time; each server job has up to 10 minutes.'
              : 'The maker also has a 20-minute deadline.'}{' '}
            Use a model with tool calling and enough context for the project’s skills. Testing only
            checks access to the model catalogue.
          </p>
          <div className="connection-buttons">
            <button
              type="submit"
              className="primary"
              disabled={busy || pending || !form.model.trim()}
            >
              {pending ? 'Saving…' : 'Save connection'}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(fresh());
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="settings-notice">
          {message}
        </p>
      )}
      {error && (
        <pre role="alert" className="settings-error">
          {error}
        </pre>
      )}
    </dialog>
  );
}
