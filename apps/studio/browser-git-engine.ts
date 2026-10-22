import './browser-git-globals';
import { redactDiagnostic } from '../../packages/diagnostics/src';
import * as git from 'isomorphic-git';
import type { FsClient, HttpClient } from 'isomorphic-git';
import {
  gitDigest,
  gitLimits,
  gitOid,
  gitPath,
  gitUrl,
  fromBase64,
  toBase64,
  type GitSnapshot,
  type GitView,
} from './browser-git-contract';

/** Portable engine: browser worker uses IndexedDB; tests use real native Git fixtures. */
export class BrowserGit {
  private dir = '/repo';
  constructor(
    private fs: FsClient,
    private pfs: any,
    private progress: (text: string) => void = () => {},
  ) {}
  private options() {
    return { fs: this.fs, dir: this.dir };
  }
  private async metadata(): Promise<{ head: string; revision: string }> {
    return JSON.parse(await this.pfs.readFile('/location.json', { encoding: 'utf8' }));
  }
  private async mkdir(path: string) {
    let dir = '';
    for (const part of path.split('/').filter(Boolean)) {
      dir += '/' + part;
      try {
        await this.pfs.mkdir(dir);
      } catch (e) {
        if ((e as any).code !== 'EEXIST') throw e;
      }
    }
  }
  private async root() {
    try {
      await this.metadata();
    } catch (e) {
      if ((e as any).code === 'ENOENT') throw new Error('Create a browser copy first.');
      throw e;
    }
  }
  private async files() {
    const found: string[] = [];
    let total = 0;
    const walk = async (dir: string) => {
      for (const name of await this.pfs.readdir(dir)) {
        if (dir === this.dir && name === '.git') continue;
        const path = dir + '/' + name;
        const stat = await this.pfs.lstat(path);
        if (stat.isSymbolicLink())
          throw new Error('Browser Git experiment does not support source symlinks.');
        if (stat.isDirectory()) await walk(path);
        else {
          const relative = gitPath(path.slice(this.dir.length + 1));
          found.push(relative);
          total += stat.size;
          if (found.length > gitLimits.files || total > gitLimits.bytes)
            throw new Error('Browser source exceeds 1,024 files or 40 MiB.');
        }
      }
    };
    await walk(this.dir);
    return found.sort();
  }
  async view(): Promise<GitView> {
    await this.root();
    const meta = await this.metadata();
    const head = await git.resolveRef({ ...this.options(), ref: 'HEAD' });
    const files = await this.files();
    const rows = await git.statusMatrix({
      ...this.options(),
      ignored: true,
      filter: (path) => path !== '.git' && !path.startsWith('.git/'),
    });
    return {
      head,
      base: meta.head,
      revision: meta.revision,
      files,
      changes: rows
        .filter(([, h, w, s]) => h !== w || w !== s)
        .map(([path, h, w]) => ({
          path,
          status: w === 0 ? 'deleted' : h === 0 ? 'added' : 'modified',
        })),
      log: (await git.log({ ...this.options(), depth: 25 })).map((e) => ({
        oid: e.oid,
        message: e.commit.message.trim(),
      })),
    };
  }
  async read(path: string) {
    await this.root();
    const bytes: Uint8Array = await this.pfs.readFile(this.dir + '/' + gitPath(path));
    if (bytes.length > gitLimits.editBytes || bytes.includes(0))
      throw new Error('Editor supports text files up to 256 KiB.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async diff(path: string) {
    await this.root();
    gitPath(path);
    const head = await git.resolveRef({ ...this.options(), ref: 'HEAD' });
    let before = '',
      after = '';
    try {
      const { blob } = await git.readBlob({ ...this.options(), oid: head, filepath: path });
      if (blob.length > gitLimits.editBytes || blob.includes(0))
        throw new Error('Diff supports text files up to 256 KiB.');
      before = new TextDecoder('utf-8', { fatal: true }).decode(blob);
    } catch (e) {
      if ((e as any).code !== 'NotFoundError') throw e;
    }
    try {
      after = await this.read(path);
    } catch (e) {
      if ((e as any).code !== 'ENOENT') throw e;
    }
    return { path, before, after };
  }
  async write(path: string, text: string, expected: string) {
    await this.root();
    const current = await this.read(path);
    if (current !== expected)
      throw new Error('This file changed in another tab. Reload it before saving.');
    if (new TextEncoder().encode(text).length > gitLimits.editBytes)
      throw new Error('Text file exceeds 256 KiB.');
    await this.pfs.writeFile(this.dir + '/' + gitPath(path), text);
    return this.view();
  }
  async commit(message: string, expected: string) {
    const state = await this.view();
    if (state.head !== expected)
      throw new Error('Browser HEAD changed in another tab. Reload before committing.');
    if (!message.trim() || message.length > 200)
      throw new Error('Give the checkpoint a short description.');
    if (!state.changes.length) throw new Error('No browser changes to checkpoint.');
    for (const { path, status } of state.changes) {
      gitPath(path);
      if (status === 'deleted') await git.remove({ ...this.options(), filepath: path });
      else await git.add({ ...this.options(), filepath: path, force: true });
    }
    await git.commit({
      ...this.options(),
      message,
      author: { name: 'Studio browser checkpoint', email: 'browser@napplet.invalid' },
    });
    return this.view();
  }
  private async assertReplace(revision: string) {
    try {
      const state = await this.view();
      if (state.revision === revision) return false;
      const files = [];
      for (const path of state.files)
        files.push({ path, data: toBase64(await this.pfs.readFile(this.dir + '/' + path)) });
      const unchanged = state.revision.startsWith('clone:')
        ? !state.changes.length
        : (await gitDigest(JSON.stringify({ head: state.head, files }))) === state.revision;
      if (state.head !== state.base || !unchanged)
        throw new Error(
          'Browser work differs from Studio. Export your browser copy before replacing it; no files were overwritten.',
        );
    } catch (e) {
      if ((e as any).code !== 'ENOENT' && (e as Error).message !== 'Create a browser copy first.')
        throw e;
    }
    return true;
  }
  private async validateTree(ref: string) {
    let files = 0,
      total = 0;
    const walk = async (oid: string, prefix = '') => {
      const { tree } = await git.readTree({ ...this.options(), oid });
      for (const entry of tree) {
        const path = gitPath(prefix + entry.path);
        if (entry.type === 'tree') {
          await walk(entry.oid, path + '/');
          continue;
        }
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
          throw new Error(
            'Browser Git supports regular source files only (no submodules or links).',
          );
        const { blob } = await git.readBlob({ ...this.options(), oid: entry.oid });
        total += blob.length;
        if (++files > gitLimits.files || total > gitLimits.bytes)
          throw new Error('Browser checkout exceeds its source limits.');
      }
    };
    const commit = await git.readCommit({ ...this.options(), oid: ref });
    await walk(commit.commit.tree);
  }
  async import(snapshot: GitSnapshot) {
    gitOid(snapshot.head);
    if (!/^[a-f0-9]{64}$/.test(snapshot.revision) || snapshot.files.length > gitLimits.files)
      throw new Error('Invalid Studio Git snapshot.');
    if (
      (await gitDigest(JSON.stringify({ head: snapshot.head, files: snapshot.files }))) !==
      snapshot.revision
    )
      throw new Error('Studio snapshot hash mismatch.');
    const paths = new Set<string>();
    let total = 0;
    const files = snapshot.files.map((f) => {
      gitPath(f.path);
      if (paths.has(f.path)) throw new Error('Duplicate source path.');
      paths.add(f.path);
      const bytes = fromBase64(f.data, gitLimits.bytes);
      total += bytes.length;
      return { ...f, bytes };
    });
    if (total > gitLimits.bytes) throw new Error('Browser source exceeds 40 MiB.');
    if (!(await this.assertReplace(snapshot.revision))) return this.view();
    // Stage in a fresh directory so bad objects or interrupted import cannot replace a good copy.
    const previous = this.dir;
    this.dir = '/stage-' + crypto.randomUUID();
    try {
      await this.mkdir(this.dir);
      await git.init({ ...this.options(), defaultBranch: 'main' });
      const pack = fromBase64(snapshot.pack, gitLimits.packBytes);
      await this.mkdir(this.dir + '/.git/objects/pack');
      await this.pfs.writeFile(this.dir + '/.git/objects/pack/import.pack', pack);
      this.progress('Indexing Git history in this browser…');
      await git.indexPack({ ...this.options(), filepath: '.git/objects/pack/import.pack' });
      await this.validateTree(snapshot.head);
      await git.writeRef({
        ...this.options(),
        ref: 'refs/heads/main',
        value: snapshot.head,
        force: true,
      });
      await git.checkout({ ...this.options(), ref: 'main', force: true });
      for (const path of await this.files())
        if (!paths.has(path)) await this.pfs.unlink(this.dir + '/' + path);
      for (const f of files) {
        await this.mkdir(this.dir + '/' + f.path.split('/').slice(0, -1).join('/'));
        await this.pfs.writeFile(this.dir + '/' + f.path, f.bytes);
      }
      await this.promote(previous, snapshot.head, snapshot.revision);
    } catch (e) {
      await this.remove(this.dir);
      this.dir = previous;
      throw e;
    }
    return this.view();
  }
  private async remove(dir: string) {
    try {
      for (const name of await this.pfs.readdir(dir)) {
        const path = dir + '/' + name;
        const s = await this.pfs.lstat(path);
        if (s.isDirectory()) await this.remove(path);
        else await this.pfs.unlink(path);
      }
      await this.pfs.rmdir(dir);
    } catch (e) {
      if ((e as any).code !== 'ENOENT') throw e;
    }
  }
  private async promote(previous: string, head: string, revision: string) {
    // Switch an external pointer only after the complete staging tree exists. Old copies remain recoverable.
    await this.pfs.writeFile(
      '/location-next.json',
      JSON.stringify({ dir: this.dir, head, revision, previous }),
    );
    await this.pfs.rename('/location-next.json', '/location.json');
  }
  async open() {
    let previous = '';
    try {
      const saved = JSON.parse(await this.pfs.readFile('/location.json', { encoding: 'utf8' }));
      this.dir = saved.dir;
      previous = saved.previous;
      if (!/^\/stage-[a-f0-9-]{36}$/.test(this.dir))
        throw new Error('Invalid browser repository location.');
    } catch (e) {
      if ((e as any).code !== 'ENOENT') throw e;
    }
    // Keep one prior completed copy; collect interrupted/older staging trees under the worker lock.
    for (const name of await this.pfs.readdir('/')) {
      const path = '/' + name;
      if (/^stage-[a-f0-9-]{36}$/.test(name) && path !== this.dir && path !== previous)
        await this.remove(path);
    }
  }
  async clone(url: string, commit: string) {
    url = gitUrl(url);
    gitOid(commit);
    if (!(await this.assertReplace('clone:' + commit))) return this.view();
    const previous = this.dir;
    this.dir = '/stage-' + crypto.randomUUID();
    try {
      await this.mkdir(this.dir);
      await git.clone({
        ...this.options(),
        http: boundedGitHttp(url),
        url,
        ref: 'main',
        singleBranch: true,
        noTags: true,
        noCheckout: true,
        onProgress: (e) => this.progress(`${e.phase}: ${e.loaded}`),
      });
      const remote = await git.resolveRef({ ...this.options(), ref: 'refs/remotes/origin/main' });
      if (remote !== commit)
        throw new Error(
          'GRASP main does not match the selected source revision. Refresh its signed state.',
        );
      await this.validateTree(commit);
      await git.checkout({ ...this.options(), ref: 'main' });
      await this.promote(previous, commit, 'clone:' + commit);
    } catch (e) {
      await this.remove(this.dir);
      this.dir = previous;
      throw e;
    }
    return this.view();
  }
  async export() {
    const state = await this.view();
    const files = [];
    for (const path of state.files)
      files.push({ path, data: toBase64(await this.pfs.readFile(this.dir + '/' + path)) });
    // Preserve reachable imported history and browser checkpoints, without Git configuration.
    const seen = new Set<string>();
    const walk = async (oid: string) => {
      if (seen.has(oid)) return;
      seen.add(oid);
      if (seen.size > 10000) throw new Error('Browser export exceeds 10,000 Git objects.');
      const obj = await git.readObject({ ...this.options(), oid });
      if (obj.type === 'commit') {
        const c = await git.readCommit({ ...this.options(), oid });
        await walk(c.commit.tree);
        for (const parent of c.commit.parent) await walk(parent);
      } else if (obj.type === 'tree') {
        for (const e of (await git.readTree({ ...this.options(), oid })).tree) await walk(e.oid);
      }
    };
    await walk(state.head);
    const { packfile } = await git.packObjects({ ...this.options(), oids: [...seen] });
    if (!packfile || packfile.length > gitLimits.packBytes)
      throw new Error('Browser Git pack exceeds 40 MiB.');
    return {
      head: state.head,
      files,
      pack: toBase64(packfile),
      revision: await gitDigest(JSON.stringify({ head: state.head, files })),
    } satisfies GitSnapshot;
  }
  /** Only the disposable-repository experiment calls this; Studio publishing remains unchanged. */
  async push(url: string, expected: string) {
    const state = await this.view();
    if (state.changes.length) throw new Error('Checkpoint browser changes before pushing.');
    url = gitUrl(url);
    gitOid(expected);
    const http = boundedGitHttp(url, expected);
    const refs = await git.listServerRefs({ http, url });
    if (refs.find((r) => r.ref === 'refs/heads/main')?.oid !== expected)
      throw new Error('GRASP main changed; refusing to overwrite another revision.');
    const pushed = await git.push({
      ...this.options(),
      http,
      url,
      ref: 'main',
      remoteRef: 'main',
      force: false,
    });
    if (!pushed.ok)
      throw new Error(
        `GRASP rejected the Git push: ${redactDiagnostic(pushed.error ?? 'Ref update rejected', 800)}`,
      );
    const after = await git.listServerRefs({ http: boundedGitHttp(url), url });
    if (after.find((r) => r.ref === 'refs/heads/main')?.oid !== state.head)
      throw new Error(
        'Push returned without confirming the exact commit. Check GRASP state before retrying.',
      );
    return state.head;
  }
}

/** Exact Git endpoint, no credentials/redirects/proxy; bounded requests and responses. */
export function boundedGitHttp(target: string, expected?: string): HttpClient {
  target = gitUrl(target);
  return {
    async request(input) {
      const u = new URL(input.url),
        base = new URL(target);
      if (
        u.origin !== base.origin ||
        ![
          base.pathname + '/info/refs',
          base.pathname + '/git-upload-pack',
          base.pathname + '/git-receive-pack',
        ].includes(u.pathname)
      )
        throw new Error('Git attempted an unexpected endpoint.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (input.body)
        for await (const chunk of input.body) {
          size += chunk.length;
          if (size > gitLimits.packBytes) throw new Error('Git upload exceeds 40 MiB.');
          chunks.push(chunk);
        }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      if (expected && u.pathname.endsWith('/git-receive-pack')) {
        // Compare the old OID in the update command, not merely an earlier advertisement.
        if (new TextDecoder().decode(body.subarray(4, 44)) !== expected)
          throw new Error('GRASP changed during push negotiation; retry after fetching.');
      }
      const headers = new Headers(input.headers);
      headers.delete('user-agent');
      headers.delete('content-length');
      headers.delete('accept-encoding');
      const response = await fetch(u, {
        method: input.method,
        headers,
        body: input.method === 'POST' ? body : undefined,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok)
        throw new Error(
          `Git HTTP ${response.status} at ${u.pathname}. Check the repository and CORS policy.`,
        );
      const reader = response.body!.getReader();
      let received = 0;
      async function* stream() {
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            received += item.value.length;
            if (received > gitLimits.packBytes) throw new Error('Git response exceeds 40 MiB.');
            yield item.value;
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      return {
        url: response.url,
        method: input.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: stream(),
      };
    },
  };
}
