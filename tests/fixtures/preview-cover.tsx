import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewCover } from '../../apps/web/src/components/preview-cover';
import { playback } from '../../apps/web/src/lib/playback-coordinator';

function App() {
  const group = useRef({}),
    explicitOwner = useRef({});
  const [enabled, setEnabled] = useState(true);
  const grouped = !new URLSearchParams(location.search).has('exclusive');
  const card = (id: string) => (
    <div data-cover={id}>
      <PreviewCover
        title={id}
        revision={id}
        mode="auto"
        enabled={enabled}
        previewGroup={grouped ? group.current : undefined}
        video={{ url: '/clip.webm', hash: 'a'.repeat(64) }}
      >
        <span>{id}</span>
      </PreviewCover>
    </div>
  );
  return (
    <>
      <nav>
        <button onClick={() => setEnabled((value) => !value)}>Toggle previews</button>
        <button onClick={() => playback.claim(explicitOwner.current, 'napplet', () => {})}>
          Start napplet
        </button>
        <button onClick={() => playback.claim(explicitOwner.current, 'media', () => {})}>
          Start media
        </button>
        <button onClick={() => playback.release(explicitOwner.current)}>
          Stop explicit playback
        </button>
      </nav>
      <section className="first-row">
        {card('one')}
        {card('two')}
      </section>
      <div className="spacer" />
      {card('three')}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
