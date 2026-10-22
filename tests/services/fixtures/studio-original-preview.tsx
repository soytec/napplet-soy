import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '../../../apps/studio/ui';
import { StudioOriginalPreview } from '../../../apps/web/src/components/studio-original-preview';
import { configureClient } from '../../../apps/web/src/lib/network';
import type { StudioState, Project } from '../../../apps/studio/types';
import type { StudioClient } from '../../../apps/studio/local-client';
import type { StudioRoute } from '../../../apps/studio/navigation';

const fixture = await (await fetch('/fixture')).json();
configureClient({
  relays: [location.origin.replace('http', 'ws') + '/relay'],
  blossom: [location.origin],
  rules: [],
  featured: [],
});
const project: Project = {
  id: '0602a60b-df41-4600-aed5-84bd70529892',
  title: 'Remix fixture',
  source: 'https://napplet.example/r/' + fixture.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phase: 'preparing',
  stage: 'Loading the original source',
  messages: [],
  activity: [],
  checks: [],
  checkpoints: [],
  estimatedCost: 0,
  steps: 0,
};
const state: StudioState = {
  projects: [project],
  model: 'Fixture',
  busy: project.id,
  browserBuilds: true,
};
const requests: string[] = [];
let delayPreview = false;
let releasePreview: (() => void) | undefined;
const client: StudioClient = {
  mode: 'local',
  async api<T>(path: string, body?: unknown) {
    requests.push(path);
    if (body !== undefined) throw Error('The preview must not trigger mutations');
    if (path === 'state') return structuredClone(state) as T;
    if (path.endsWith('/preview')) {
      if (delayPreview)
        await new Promise<void>((resolve) => {
          releasePreview = resolve;
        });
      return { url: location.origin + '/draft/' + project.preview } as T;
    }
    throw Error('Unexpected Studio request: ' + path);
  },
  url: (path) => path,
  token: () => '',
  media: async () => {
    throw Error('No media request expected');
  },
  upload: async () => {
    throw Error('No upload expected');
  },
};
function App() {
  const [route, setRoute] = useState<StudioRoute>({ view: 'project', id: project.id });
  const [enabled, setEnabled] = useState(new URLSearchParams(location.search).has('browser'));
  (window as any).remixTest = {
    update(patch: Partial<Project>) {
      Object.assign(project, patch);
    },
    requests,
    delay() {
      delayPreview = true;
    },
    release() {
      delayPreview = false;
      releasePreview?.();
    },
    fresh() {
      const fresh: Project = {
        ...project,
        id: crypto.randomUUID(),
        title: 'Fresh creation',
        phase: 'preparing',
        source: undefined,
        preview: undefined,
        sourceRevision: undefined,
      };
      state.projects.push(fresh);
      state.busy = fresh.id;
      setRoute({ view: 'project', id: fresh.id });
    },
  };
  return (
    <div className="studio-surface studio-embedded">
      <StudioApp
        client={client}
        route={route}
        navigate={() => {}}
        openConnections={() => {}}
        account={{
          pubkey: null,
          currentPubkey: () => null,
          connect: async () => {},
          sign: async () => {
            throw Error('No signing expected');
          },
        }}
        OriginalPreview={StudioOriginalPreview}
        browserBuild={{ enabled, setEnabled, status: '', session: undefined }}
        setBrowserBuildAvailable={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
