/** Browser-local master switch. It never grants document-level tool access. */
const key = 'napplet.webmcp.enabled';
const listeners = new Set<() => void>();
let memory: boolean | undefined;
export function webmcpEnabled(): boolean {
  if (typeof localStorage === 'undefined') return memory ?? true;
  try {
    return localStorage.getItem(key) !== 'false';
  } catch {
    return memory ?? true;
  }
}
export function setWebmcpEnabled(enabled: boolean) {
  memory = enabled;
  try {
    localStorage.setItem(key, String(enabled));
  } catch {
    /* Session-only preference. */
  }
  for (const listener of listeners) listener();
}
export function subscribeWebmcp(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) for (const listener of listeners) listener();
  });
