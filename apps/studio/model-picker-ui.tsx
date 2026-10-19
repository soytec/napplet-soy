import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Settings2 } from 'lucide-react';
import type { ConnectionState, ModelCatalogue, ModelCatalogueInput } from './connections-model';

type Api = <T>(path: string, body?: unknown) => Promise<T>;

/** Same picker for unsaved connection forms and the composer's saved connection. */
export function ModelPicker({
  source,
  api,
  value,
  onChange,
  disabled,
  autoLoad = false,
}: {
  source: ModelCatalogueInput;
  api: Api;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  autoLoad?: boolean;
}) {
  const id = useId();
  const [catalogue, setCatalogue] = useState<ModelCatalogue>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(false);
  const request = useRef(0);
  const load = async () => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    try {
      const next = await api<ModelCatalogue>('connections/models', source);
      if (current === request.current) setCatalogue(next);
    } catch (e) {
      if (current === request.current) setError((e as Error).message);
    } finally {
      if (current === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    setCatalogue(undefined);
    setError('');
    setSearch('');
    setLoading(false);
    if (autoLoad) void load();
    return () => {
      request.current++;
    };
  }, [source.id, source.provider, source.endpoint, source.key, autoLoad]);
  const models = catalogue?.models ?? [];
  const needle = search.trim().toLowerCase();
  const shown = models.filter(
    (m) => m.id === value || `${m.id} ${m.name}`.toLowerCase().includes(needle),
  );
  return (
    <div
      className="model-picker"
      onKeyDown={(e) => {
        // Searching or entering a model must not send the surrounding chat form.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="model-picker-heading">
        <label htmlFor={id}>Model</label>
        <button type="button" disabled={disabled || loading} onClick={() => void load()}>
          <RefreshCw size={13} className={loading ? 'model-loading' : undefined} />
          {loading ? 'Fetching models…' : catalogue ? 'Refresh models' : 'Fetch models'}
        </button>
      </div>
      {models.length > 12 && (
        <input
          aria-label="Search models"
          type="search"
          autoComplete="off"
          placeholder="Search models…"
          value={search}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <select
        id={id}
        aria-busy={loading}
        value={manual ? '__manual' : value}
        disabled={disabled}
        onChange={(e) => {
          const custom = e.target.value === '__manual';
          setManual(custom);
          if (!custom) onChange(e.target.value);
        }}
      >
        <option value="" disabled>
          {loading ? 'Fetching models…' : 'Choose a model'}
        </option>
        {value && !models.some((m) => m.id === value) && (
          <option value={value}>
            {value}
            {catalogue ? ' (not in catalogue)' : ' (current)'}
          </option>
        )}
        {shown.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name === m.id ? m.id : `${m.name} · ${m.id}`}
          </option>
        ))}
        <option value="__manual">Enter a model ID manually…</option>
      </select>
      {manual && (
        <label>
          Model ID
          <input
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={160}
            value={value}
            placeholder="Exact model ID from your provider"
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="settings-error">
          {error} You can still enter a model ID manually.
        </p>
      )}
      <p role="status" className="settings-hint">
        {loading
          ? 'Reading the provider’s model catalogue. No generation is requested.'
          : catalogue
            ? `${models.length} models available.${catalogue.truncated ? ' Partial list; enter an unlisted ID manually.' : ''}${models.length === 0 ? ' Check that your server has a model installed, or enter its ID manually.' : ''}`
            : 'Enter your API key, then fetch models. Local servers may not need a key.'}
      </p>
    </div>
  );
}

export function QuickModelChoice({
  state,
  api,
  refresh,
  openConnections,
  disabled,
}: {
  state?: ConnectionState;
  api: Api;
  refresh: () => Promise<void>;
  openConnections: () => void;
  disabled: boolean;
}) {
  const c = state?.connections.find((c) => c.id === state.selected);
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const popup = menu.current;
    const position = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 32);
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`;
      const above = rect.top > 260;
      popup.style.top = above ? 'auto' : `${rect.bottom + 8}px`;
      popup.style.bottom = above ? `${window.innerHeight - rect.top + 8}px` : 'auto';
      popup.style.maxHeight = `${Math.max(100, Math.min(480, above ? rect.top - 24 : window.innerHeight - rect.bottom - 24))}px`;
    };
    position();
    popup.showPopover();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, c?.id]);
  useEffect(() => {
    setModel(c?.model ?? '');
    setError('');
  }, [c?.id, c?.revision, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const apply = async () => {
    if (!c) return;
    setPending(true);
    setError('');
    try {
      await api('connections/model', { id: c.id, revision: c.revision, model });
      await refresh();
      setOpen(false);
      trigger.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div ref={root} className="model-switcher">
      <button
        type="button"
        ref={trigger}
        className="model-choice"
        title="Choose a model"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        disabled={disabled || pending}
        onClick={() => (c ? setOpen(!open) : openConnections())}
      >
        <span className="dot" />
        {c ? `${c.name} / ${c.model}` : 'Choose a connection'}
        <ChevronDown size={12} />
      </button>
      {open && c && (
        <div
          ref={menu}
          popover="auto"
          onToggle={(e) => {
            if (e.newState === 'closed') setOpen(false);
          }}
          id={popupId}
          className="model-menu"
          role="region"
          aria-label="Quick model choice"
        >
          <strong>{c.name}</strong>
          <ModelPicker
            key={c.id + c.revision}
            source={{ id: c.id, provider: c.provider, endpoint: c.endpoint }}
            api={api}
            value={model}
            onChange={setModel}
            disabled={disabled || pending}
            autoLoad
          />
          <p className="settings-hint">For your next message. Choose a model with tool calling.</p>
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          <div className="connection-buttons">
            <button
              type="button"
              className="primary"
              disabled={disabled || pending || !model.trim() || model === c.model}
              onClick={() => void apply()}
            >
              {pending ? 'Saving…' : 'Use model'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openConnections();
              }}
            >
              <Settings2 size={14} /> Connections
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
