import { fileDownloads } from '../../packages/runtime/src/file-downloads';
import { NappletFiles } from '../../packages/runtime/src/filesystem';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePlayerPresentation } from '../../apps/web/src/lib/use-player-presentation';
import { inferenceService } from '../../packages/runtime/src/llm-service';
import { Dialog, DialogContent, DialogTitle } from '../../apps/web/src/components/ui/dialog';
import { ConnectionsDialog } from '../../apps/studio/connections-ui';
import type { ConnectionState } from '../../apps/studio/connections-model';

const connection = {
  id: 'test',
  revision: 'r1',
  name: 'DS',
  provider: 'deepseek' as const,
  endpoint: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  hasKey: true,
  steps: 100,
  images: false,
};
let release: (() => void) | undefined;
let saved: unknown;
let failGeneration = false;
let selection = new AbortController();
Object.assign(window, {
  releaseConnections: () => release?.(),
  savedConnection: () => saved,
  failGeneration: () => {
    failGeneration = true;
  },
  cancelSelection: () => selection.abort(),
});
function App() {
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = document.createElement('div');
    wrapper.current!.append(container);
    const downloads = fileDownloads(container);
    const files = new NappletFiles(
      () => {},
      (value) => downloads.update(value),
    );
    Object.assign(window, {
      writeDownload: (data: string, mode = 'replace') =>
        files.handle(
          { type: 'fs.write', path: '/files/pattern.pdf', data: btoa(data), options: { mode } },
          async () => true,
        ),
      clearDownloads: () => downloads.update([]),
    });
    return () => {
      downloads.close();
      container.remove();
    };
  }, []);
  const [settings, setSettings] = useState(false);
  const [wallet, setWallet] = useState(false);
  const [result, setResult] = useState('');
  const [state, setState] = useState<ConnectionState>({ connections: [connection] });
  const view = usePlayerPresentation(wrapper, false, false);
  const api = async <T,>(path: string, body?: unknown): Promise<T> => {
    if (path === 'connections/models')
      return {
        models: [{ id: 'deepseek-flash', name: 'Flash', images: true }],
        truncated: false,
      } as T;
    if (path === 'connections/save') {
      saved = body;
      setState({ connections: [{ ...connection, ...(body as object) }] });
      return {} as T;
    }
    if (path === 'state') {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { connections: state } as T;
    }
    if (path === 'connections/llm-start') return { id: 'generation' } as T;
    if (path === 'connections/llm-read' && failGeneration)
      return { error: 'private-provider-key-diagnostic' } as T;
    if (path === 'connections/llm-read')
      return {
        result: { content: [{ type: 'text', text: 'Private report fixture' }], finish: 'stop' },
      } as T;
    return {} as T;
  };
  const service = inferenceService(api, () => setSettings(true));
  const choose = () => {
    selection = new AbortController();
    void service.select({}, selection.signal).then(
      (m) => setResult(m.images ? 'Images available' : 'Text only'),
      () => setResult('Cancelled'),
    );
  };
  return (
    <>
      <aside>Shell background</aside>
      <div ref={wrapper} tabIndex={-1} className={view.expanded ? 'player-expanded' : ''}>
        <button onClick={view.enterNative}>Fullscreen</button>
        <button onClick={view.exitNative}>Exit native fullscreen</button>
        <button onClick={view.leave}>Leave player</button>
        <button onClick={choose}>Choose model</button>
        <button onClick={() => setWallet(true)}>Wallet</button>
        <button onClick={() => setSettings(true)}>Settings</button>
        <button
          onClick={() =>
            void service
              .generate(
                {
                  handle: 'test:r1',
                  messages: [
                    { role: 'user', content: [{ type: 'text', text: 'private medical fixture' }] },
                  ],
                },
                new AbortController().signal,
              )
              .catch(() => setResult('Generation failed'))
          }
        >
          Generate
        </button>
        <p data-result>{result}</p>
        <iframe
          title="napplet"
          sandbox="allow-scripts"
          srcDoc="<button onclick='this.textContent=Number(this.textContent)+1'>0</button>"
        />
      </div>
      <Dialog open={wallet} onOpenChange={setWallet}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Wallet review</DialogTitle>
          <button onClick={() => setWallet(false)}>Cancel payment</button>
        </DialogContent>
      </Dialog>
      <section>
        {settings && (
          <ConnectionsDialog
            state={state}
            api={api}
            busy={false}
            refresh={async () => {}}
            close={() => setSettings(false)}
          />
        )}
      </section>
    </>
  );
}
createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
