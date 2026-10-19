import React, { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { ManagedAsset } from '../../packages/assets/src';
import type { Project } from './types';
import type { StudioClient } from './local-client';
type Api = <T>(path: string, body?: unknown) => Promise<T>;
export function AssetsPanel({
  project,
  busy,
  api,
  client,
  selectedFile,
  clearFile,
  chat,
  refresh,
}: {
  project: Project;
  busy: boolean;
  api: Api;
  client: StudioClient;
  selectedFile?: File;
  clearFile: () => void;
  chat: (text: string) => void;
  refresh: () => Promise<void>;
}) {
  const [assets, setAssets] = useState<ManagedAsset[]>([]);
  const [file, setFile] = useState<File>();
  const [id, setId] = useState('');
  const [license, setLicense] = useState('');
  const [source, setSource] = useState('');
  const [storage, setStorage] = useState<'embedded' | 'external'>('embedded');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number>();
  const [media, setMedia] = useState<Record<string, string>>({});
  const xhr = useRef<AbortController | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const choose = (f?: File) => {
    if (!f) return;
    if (!f.size || f.size > 10 * 1024 * 1024) {
      setError('Choose a nonempty file up to 10 MiB.');
      return;
    }
    setFile(f);
    setId(
      f.name
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^[^a-z]+/, 'asset-')
        .slice(0, 48) || 'asset',
    );
    setError('');
  };
  useEffect(() => {
    choose(selectedFile);
    clearFile();
  }, [selectedFile]);
  useEffect(() => {
    let live = true;
    void api<ManagedAsset[]>(`projects/${project.id}/assets`)
      .then((a) => {
        if (live) setAssets(a);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [project.id, project.updatedAt]);
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    setMedia({});
    for (const asset of assets.filter(
      (a) =>
        a.mime.startsWith('image/') || a.mime.startsWith('audio/') || a.mime.startsWith('video/'),
    )) {
      void client
        .media(`projects/${project.id}/asset?name=${encodeURIComponent(asset.id)}`)
        .then((blob) => {
          if (!live) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setMedia((old) => ({ ...old, [asset.id]: url }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [project.id, assets]);
  useEffect(() => () => xhr.current?.abort(), []);
  const upload = async () => {
    if (!file || busy) return;
    setError('');
    setProgress(0);
    try {
      const controller = new AbortController();
      xhr.current = controller;
      setAssets(
        await client.upload<ManagedAsset[]>(
          `projects/${project.id}/assets`,
          { id, license, source, storage },
          file,
          setProgress,
          controller.signal,
        ),
      );
      setFile(undefined);
      setId('');
      setLicense('');
      setSource('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setProgress(undefined);
      xhr.current = undefined;
    }
  };
  return (
    <div
      className="assets-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (progress === undefined) choose(e.dataTransfer.files[0]);
      }}
      onPaste={(e) => {
        const f = Array.from(e.clipboardData.items)
          .find((i) => i.kind === 'file')
          ?.getAsFile();
        if (f) {
          e.preventDefault();
          choose(f);
        }
      }}
    >
      <span className="eyebrow">A LITTLE SOMETHING TO BUILD WITH</span>
      <h2>Your assets</h2>
      <p>
        Drop a file, paste an image or choose one below. These are in-app assets: they become part
        of your public source when you publish. Keep private references out of this collection.
      </p>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Choose an asset file"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        className="asset-drop"
        disabled={progress !== undefined || busy || !project.initialized}
        onClick={() => input.current?.click()}
      >
        <Upload size={22} />
        <strong>Bring something of your own</strong>
        <span>Images, audio, video, fonts and data · up to 10 MiB each</span>
      </button>
      {file && (
        <form
          className="asset-import"
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <div className="settings-heading">
            <strong>
              {file.name} · {(file.size / 1024).toFixed(1)} KiB
            </strong>
            <button
              type="button"
              aria-label="Discard selected file"
              disabled={progress !== undefined}
              onClick={() => setFile(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            Asset name
            <input
              required
              pattern={'[a-z][a-z0-9\\-]{0,47}'}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="player-sprite"
            />
          </label>
          <label>
            License or permission
            <input
              required
              maxLength={160}
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="e.g. CC0, CC-BY-4.0, or original work"
            />
          </label>
          <label>
            Source / credit
            <input
              maxLength={500}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Author and source link, if applicable"
            />
          </label>
          <label>
            Delivery
            <select value={storage} onChange={(e) => setStorage(e.target.value as typeof storage)}>
              <option value="embedded">Embedded in the napplet</option>
              <option value="external">External asset through Blossom at publication</option>
            </select>
          </label>
          <div className="connection-buttons">
            <button className="primary" disabled={busy || progress !== undefined}>
              Add to this draft
            </button>
            {progress !== undefined && (
              <>
                <progress value={progress} max={100} />
                <button type="button" onClick={() => xhr.current?.abort()}>
                  Cancel upload
                </button>
              </>
            )}
          </div>
        </form>
      )}
      {error && (
        <pre className="settings-error" role="alert">
          {error}
        </pre>
      )}
      <div className="asset-grid">
        {assets.map((a) => (
          <article key={a.id} className="asset-card">
            {media[a.id] &&
              (a.mime.startsWith('image/') ? (
                <img src={media[a.id]} alt={a.id} />
              ) : a.mime.startsWith('audio/') ? (
                <audio src={media[a.id]} controls preload="none" />
              ) : (
                <video src={media[a.id]} controls preload="metadata" />
              ))}
            <strong>{a.id}</strong>
            <small>
              {a.mime} · {(a.bytes / 1024).toFixed(1)} KiB · {a.storage}
            </small>
            <small>
              {a.license}
              {a.source ? ` · ${a.source}` : ''}
            </small>
            <button
              className="outline"
              disabled={busy}
              onClick={() =>
                chat(
                  `Use the existing managed asset “${a.id}” (${a.mime}) in this napplet. Read napplet.assets.json and use assetUrl/assetBlob from soy-assets.js. Keep the asset’s license and attribution. `,
                )
              }
            >
              Ask maker to use it
            </button>
          </article>
        ))}
      </div>
      <p className="settings-hint">
        {assets.length} / 32 assets ·{' '}
        {(assets.reduce((n, a) => n + a.bytes, 0) / 1024 / 1024).toFixed(1)} / 32 MiB. Nothing
        uploads to Blossom here. Your current playable preview stays unchanged until the next
        successful build.
      </p>
    </div>
  );
}
