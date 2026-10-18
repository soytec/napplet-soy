/** Browser routes only. Opening a link never creates a project or starts inference. */
export type StudioRoute =
  | { view: 'dashboard' }
  | { view: 'create'; source: string; title: string }
  | { view: 'project'; id: string }
  | { view: 'missing' };

export const localHost = (hostname: string) =>
  ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);

export function localSource(source: string) {
  try {
    const url = new URL(source);
    return url.protocol === 'http:' && localHost(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validSource(source: string) {
  if (!source || source.length > 4096) return false;
  if (/^(?:nostr:)?(?:naddr1|nevent1)[a-z0-9]+$/.test(source)) return true;
  try {
    const url = new URL(source);
    return !url.username && !url.password && (url.protocol === 'https:' || localSource(source));
  } catch {
    return false;
  }
}

export function studioRoute(url: URL): StudioRoute {
  if (url.pathname === '/' || url.pathname === '/studio') return { view: 'dashboard' };
  if (url.pathname === '/studio/create' || url.pathname === '/create') {
    const source = url.searchParams.get('source') ?? '';
    if (source && !validSource(source)) return { view: 'missing' };
    return { view: 'create', source, title: (url.searchParams.get('title') ?? '').slice(0, 80) };
  }
  const project = /^\/studio\/([a-f0-9-]{36})$/.exec(url.pathname);
  return project ? { view: 'project', id: project[1] } : { view: 'missing' };
}

export function studioCreatePath(source = '', title = '') {
  const search = new URLSearchParams();
  if (source) search.set('source', source);
  if (title) search.set('title', title.slice(0, 80));
  return '/studio/create' + (search.size ? '?' + search : '');
}

/** UI routes stay in the shell. The local execution service is a separate adapter. */
export function studioEntry(shellOrigin: string, path = '/studio') {
  const shell = new URL(shellOrigin);
  const target = new URL(path, shell);
  if (target.origin !== shell.origin || studioRoute(target).view === 'missing') return undefined;
  if (target.pathname === '/create') target.pathname = '/studio/create';
  if (target.pathname === '/') target.pathname = '/studio';
  return target.pathname + target.search;
}

export function localStudioOrigin(shellOrigin: string, port = '4195') {
  const shell = new URL(shellOrigin);
  if (!localHost(shell.hostname) || shell.protocol !== 'http:') return undefined;
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return undefined;
  return `http://127.0.0.1:${port}`;
}
