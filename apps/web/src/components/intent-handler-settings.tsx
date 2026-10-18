import { useEffect, useRef } from 'react';
import { intentDefaultControls } from '../../../../packages/runtime/src/intent-controls';
import { webIntentWorkspace } from '@/lib/intent-workspace';

export function IntentHandlerSettings() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controls = intentDefaultControls(webIntentWorkspace());
    container.current?.append(controls.element);
    return () => {
      controls.close();
      controls.element.remove();
    };
  }, []);
  return <div ref={container} className="intent-handler-settings" />;
}
