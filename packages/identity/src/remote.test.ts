import { expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerWebSocket } from 'bun';
import { matchFilters, type Filter, type NostrEvent } from 'nostr-tools';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { NostrConnectProvider } from 'applesauce-signers/signers/nostr-connect-provider';
import { RelayPool } from 'applesauce-relay';
import { Accounts, captureAccount, PlaintextVault, type Vault } from './accounts';
import { bunkerCredential, openCredential, pairCredential, websiteKinds } from './signer';
import { BrowserIdentity } from '../../../apps/web/src/lib/browser-identity';
import { SessionAccount, sessionMaterial } from '../../../apps/web/src/lib/session-account';
import { browserConnectionName } from '../../../apps/web/src/lib/connection-name';

async function environment() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-remote-'));
  const sockets = new Map<ServerWebSocket<unknown>, Map<string, Filter[]>>();
  const events: NostrEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) =>
      server.upgrade(request) ? undefined : new Response('WebSocket required', { status: 400 }),
    websocket: {
      open(socket) {
        sockets.set(socket, new Map());
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(socket, raw) {
        const [method, value, ...filters] = JSON.parse(String(raw));
        if (method === 'REQ') {
          sockets.get(socket)!.set(value, filters);
          for (const event of events)
            if (matchFilters(filters, event)) socket.send(JSON.stringify(['EVENT', value, event]));
          socket.send(JSON.stringify(['EOSE', value]));
        } else if (method === 'CLOSE') sockets.get(socket)!.delete(value);
        else if (method === 'EVENT') {
          events.push(value);
          socket.send(JSON.stringify(['OK', value.id, true, '']));
          for (const [peer, subscriptions] of sockets)
            for (const [id, filters] of subscriptions)
              if (matchFilters(filters, value)) peer.send(JSON.stringify(['EVENT', id, value]));
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${relay.port}`;
  const pool = new RelayPool();
  const creator = new PrivateKeySigner();
  const transport = new PrivateKeySigner();
  const provider = new NostrConnectProvider({
    upstream: creator,
    signer: transport,
    relays: [url],
    bunkerSecret: 'test-pairing-secret',
    pool,
  });
  await provider.start();
  const values = new Map<string, string>();
  const vaultCalls: string[] = [];
  const vault: Vault = {
    get: async (id) => {
      vaultCalls.push('get');
      return values.get(id) ?? null;
    },
    set: async (id, value) => {
      vaultCalls.push('set');
      values.set(id, value);
    },
    delete: async (id) => {
      vaultCalls.push('delete');
      values.delete(id);
    },
  };
  return {
    directory,
    relay,
    url,
    creator,
    transport,
    provider,
    events,
    vault,
    values,
    vaultCalls,
    session: async (id: string) =>
      JSON.parse(await readFile(join(directory, 'remote-sessions', `${id}.json`), 'utf8')),
    pool,
    sockets,
    async close() {
      await provider.stop();
      pool.close();
      relay.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('browser pairing and bunker connect carry device labels; reconnect keeps the public connection suffix', async () => {
  const e = await environment();
  const desktop = new BrowserIdentity('local', undefined, (key) =>
    browserConnectionName(key, { userAgent: 'Firefox/143.0' }),
  );
  const mobile = new BrowserIdentity('local', undefined, (key) =>
    browserConnectionName(key, { userAgent: 'iPhone Mobile Safari/604.1' }),
  );
  try {
    const uris: string[] = [];
    for (const identity of [desktop, mobile]) {
      await e.provider.stop();
      e.provider.bunkerSecret = undefined;
      await e.provider.start();
      await identity.pair([e.url], async (uri) => {
        uris.push(uri);
        await e.provider.handleNostrConnectURI(uri);
      });
    }
    const names = uris.map((uri) => new URL(uri).searchParams.get('name'));
    expect(names[0]).toMatch(/^napplet\.soy · Firefox · Desktop · [a-f0-9]{8}$/);
    expect(names[1]).toMatch(/^napplet\.soy · Safari · Mobile · [a-f0-9]{8}$/);
    expect(names[0]).not.toBe(names[1]);
    expect(names[0]).toContain(new URL(uris[0]).hostname.slice(0, 8));
    // This provider fixture serves one client at a time; select the desktop session.
    await e.provider.stop();
    e.provider.client = new URL(uris[0]).hostname;
    await e.provider.start();
    const saved = desktop.accounts.active!.id;
    await desktop.useSession(saved);
    const target = await e.transport.getPublicKey();
    const connects = async () => {
      const requests = [];
      for (const event of e.events.filter((e) =>
        e.tags.some((t) => t[0] === 'p' && t[1] === target),
      )) {
        const request = JSON.parse(await e.transport.nip44!.decrypt(event.pubkey, event.content));
        if (request.method === 'connect') requests.push({ event, request });
      }
      return requests;
    };
    const reopened = (await connects()).at(-1)!;
    expect(JSON.parse(reopened.request.params[3])).toEqual({
      name: names[0],
      url: 'https://napplet.soy',
    });
    expect(reopened.event.pubkey).toBe(new URL(uris[0]).hostname);
    await e.provider.stop();
    await e.provider.start();
    await desktop.bunker(await e.provider.getBunkerURI());
    const pasted = (await connects()).at(-1)!;
    expect(JSON.parse(pasted.request.params[3]).name).toBe(
      browserConnectionName(pasted.event.pubkey, { userAgent: 'Firefox/143.0' }),
    );
    expect(pasted.request.params[2]).toContain('sign_event:7');
    expect(pasted.event.content).not.toContain('Firefox');
    const creator = await e.creator.getPublicKey();
    expect(
      (await desktop.sign(creator, { kind: 7, created_at: 1, tags: [], content: '+' })).pubkey,
    ).toBe(creator);
  } finally {
    await desktop.disconnect();
    await mobile.disconnect();
    await e.close();
  }
}, 15000);
test('a captured remote account still signs remotely after another process selects a local key', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const local = await accounts.create();
    const remote = await accounts.connect(await e.provider.getBunkerURI(), { timeoutMs: 3000 });
    const captured = await captureAccount(accounts);
    const otherProcess = new Accounts('local', e.directory, e.vault);
    await otherProcess.use(local.id);
    e.vaultCalls.length = 0;
    const signer = await captured.signer({ timeoutMs: 3000 });
    try {
      const event = await signer.signEvent({
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [['d', 'selected']],
      });
      expect(event.pubkey).toBe(remote.pubkey);
      expect(e.vaultCalls).toEqual([]);
      expect((await accounts.current())?.id).toBe(local.id);
      expect((await accounts.list()).map((a) => a.id)).toContain(remote.id);
    } finally {
      await signer.close();
    }
  } finally {
    await e.close();
  }
}, 10000);
test('NIP-46 pairs over encrypted relay traffic, stores only a client session and verifies the creator again after reopening', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const account = await accounts.connect(await e.provider.getBunkerURI(), { timeoutMs: 3000 });
    expect(account.pubkey).toBe(await e.creator.getPublicKey());
    expect(account.pubkey).not.toBe(await e.transport.getPublicKey());
    await expect(accounts.backup()).rejects.toMatchObject({ code: 'RECOVERY_REMOTE' });
    expect(await accounts.create()).toEqual(account);
    expect(await Bun.file(join(e.directory, `${account.pubkey}.nsec`)).exists()).toBe(false);
    const reopened = new Accounts('local', e.directory, e.vault);
    await expect(reopened.use(account.id, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'SIGNER_CLOSED',
    });
    expect(await reopened.current()).toEqual(account);
    expect(await reopened.use(account.id, { timeoutMs: 3000 })).toEqual(account);
    const signer = await reopened.signer({ timeoutMs: 3000 });
    try {
      const signed = await signer.signEvent({
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [['d', 'creator-test']],
      });
      expect(signed.pubkey).toBe(account.pubkey);
    } finally {
      await signer.close();
    }
    expect(account.sessionStorage).toBe('file');
    expect(e.values.size).toBe(0);
    expect(e.vaultCalls).toEqual([]);
    expect(JSON.stringify(await e.session(account.id))).not.toContain(
      Buffer.from(e.creator.key).toString('hex'),
    );
    expect(JSON.stringify(e.events)).not.toContain('test-pairing-secret');
    expect(e.events.every((event) => event.kind === 24133)).toBe(true);
    e.provider.upstream = new PrivateKeySigner();
    await expect(reopened.signer({ timeoutMs: 3000 })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
  } finally {
    await e.close();
  }
}, 15000);

test('remote storage is separate from local keys; legacy sessions migrate both ways without changing the approved client', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const local = await accounts.create();
    const localCredential = e.values.get(local.id);
    const remote = await accounts.connect(await e.provider.getBunkerURI(), {
      sessionStorage: 'keychain',
      timeoutMs: 3000,
    });
    expect(remote.sessionStorage).toBe('keychain');
    const original = e.values.get(remote.id)!;
    // Old releases have no storage field in the account index.
    const indexPath = join(e.directory, 'accounts.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    delete index.accounts.find((a: { id: string }) => a.id === remote.id).sessionStorage;
    await writeFile(indexPath, JSON.stringify(index), { mode: 0o600 });
    const before = e.events.length;
    const moved = await new Accounts('local', e.directory, e.vault).setSessionStorage('file');
    expect(moved).toMatchObject({ id: remote.id, pubkey: remote.pubkey, sessionStorage: 'file' });
    expect(moved.sessionCleanup).toBeUndefined();
    expect(e.events.length).toBe(before); // Storage migration requires no new remote approval.
    expect(await e.session(remote.id)).toEqual(JSON.parse(original));
    expect(e.values.has(remote.id)).toBe(false);
    expect(e.values.get(local.id)).toBe(localCredential);
    const file = join(e.directory, 'remote-sessions', `${remote.id}.json`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(e.directory, 'remote-sessions'))).mode & 0o777).toBe(0o700);
    const signer = await new Accounts('local', e.directory, e.vault).signer({ timeoutMs: 3000 });
    try {
      expect(
        (await signer.signEvent({ kind: 24242, tags: [], created_at: 1, content: '' })).pubkey,
      ).toBe(remote.pubkey);
    } finally {
      await signer.close();
    }
    await accounts.setSessionStorage('keychain');
    expect(JSON.parse(e.values.get(remote.id)!)).toEqual(JSON.parse(original));
    expect(await Bun.file(file).exists()).toBe(false);
    await accounts.use(local.id);
    await expect(accounts.setSessionStorage('file')).rejects.toMatchObject({
      code: 'SESSION_STORAGE',
    });
    expect(e.values.get(local.id)).toBe(localCredential);
  } finally {
    await e.close();
  }
}, 15000);

test('failed session writes keep the old selection; old-copy cleanup is durable, redacted and retriable after restart', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const remote = await accounts.connect(await e.provider.getBunkerURI(), {
      sessionStorage: 'keychain',
      timeoutMs: 3000,
    });
    const original = e.values.get(remote.id)!;
    const wrongStore: Vault = {
      get: async () => 'not what was written',
      set: async () => {},
      delete: async () => {},
    };
    await expect(
      new Accounts('local', e.directory, e.vault, { sessionFiles: wrongStore }).setSessionStorage(
        'file',
      ),
    ).rejects.toMatchObject({ code: 'KEYSTORE_VERIFY' });
    expect(await accounts.current()).toEqual(remote);
    expect(e.values.get(remote.id)).toBe(original);
    const remove = e.vault.delete;
    e.vault.delete = async () => {
      throw new Error('synthetic-secret-should-not-appear');
    };
    const error = await accounts.setSessionStorage('file').catch((e) => e);
    expect(error.code).toBe('SESSION_CLEANUP');
    expect(error.message).toContain('Retry soyli account storage file');
    expect(error.message).not.toContain('synthetic-secret-should-not-appear');
    expect(await accounts.current()).toMatchObject({
      id: remote.id,
      sessionStorage: 'file',
      sessionCleanup: 'keychain',
    });
    expect(e.values.get(remote.id)).toBe(original);
    const file = join(e.directory, 'remote-sessions', `${remote.id}.json`);
    await chmod(file, 0o644);
    await expect(
      new Accounts('local', e.directory, e.vault).setSessionStorage('file'),
    ).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
    expect(e.values.has(remote.id)).toBe(true);
    await chmod(file, 0o600);
    e.vault.delete = remove;
    const finished = await new Accounts('local', e.directory, e.vault).setSessionStorage('file');
    expect(finished.sessionCleanup).toBeUndefined();
    expect(e.values.has(remote.id)).toBe(false);
    expect(await e.session(remote.id)).toEqual(JSON.parse(original));
  } finally {
    await e.close();
  }
}, 15000);

test('remote file sessions reject unsafe files and directories without falling back to the Keychain', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const remote = await accounts.connect(await e.provider.getBunkerURI(), { timeoutMs: 3000 });
    const file = join(e.directory, 'remote-sessions', `${remote.id}.json`);
    const contents = await readFile(file, 'utf8');
    await chmod(file, 0o644);
    await expect(accounts.signer()).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
    await rm(file);
    const other = join(e.directory, 'other');
    await writeFile(other, contents, { mode: 0o600 });
    await symlink(other, file);
    await expect(accounts.signer()).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
    await rm(file);
    await expect(accounts.signer()).rejects.toMatchObject({ code: 'CREDENTIAL_MISSING' });
    await writeFile(file, contents, { mode: 0o600 });
    await chmod(join(e.directory, 'remote-sessions'), 0o755);
    await expect(accounts.signer()).rejects.toMatchObject({ code: 'KEYSTORE_FILE' });
    await chmod(join(e.directory, 'remote-sessions'), 0o700);
    await mkdir(join(e.directory, '.git'));
    await expect(accounts.signer()).rejects.toMatchObject({ code: 'ACCOUNT_PATH' });
    expect(e.vaultCalls).toEqual([]);
    expect(await readFile(other, 'utf8')).toBe(contents);
  } finally {
    await e.close();
  }
}, 10000);

test('a crash after saving a new remote session recovers its reservation from the file store', async () => {
  const e = await environment();
  try {
    const files = new PlaintextVault(join(e.directory, 'remote-sessions'));
    const interrupted: Vault = {
      get: (id) => files.get(id),
      delete: (id) => files.delete(id),
      set: async (id, value) => {
        await files.set(id, value);
        throw new Error('simulated interruption');
      },
    };
    const accounts = new Accounts('local', e.directory, e.vault, { sessionFiles: interrupted });
    await expect(
      accounts.connect(await e.provider.getBunkerURI(), { timeoutMs: 3000 }),
    ).rejects.toThrow('simulated interruption');
    expect(await accounts.current()).toBeNull();
    const pending = (await accounts.list())[0];
    expect(pending).toMatchObject({ status: 'pending', sessionStorage: 'file', type: 'remote' });
    const reopened = new Accounts('local', e.directory, e.vault);
    const recovered = await reopened.create();
    expect(recovered).toMatchObject({
      id: pending.id,
      pubkey: pending.pubkey,
      status: 'ready',
      type: 'remote',
    });
    const signer = await reopened.signer({ timeoutMs: 3000 });
    try {
      expect(await signer.getPublicKey()).toBe(pending.pubkey);
    } finally {
      await signer.close();
    }
    expect(e.vaultCalls).toEqual([]);
  } finally {
    await e.close();
  }
}, 10000);

test('CLI remote sessions reconnect without Keychain; migration failures expose safe causes and cleanup survives a new process', async () => {
  const e = await environment();
  const preload = join(e.directory, 'deny-keychain.ts');
  const legacy = join(e.directory, 'synthetic-legacy.json');
  await writeFile(
    preload,
    `
import { readFile, rm } from 'node:fs/promises';
import { spyOn } from 'bun:test';
const denied = () => { throw Object.assign(new Error('synthetic-os-secret-must-not-leak'), {code:'EACCES'}); };
spyOn(Bun.secrets, 'get').mockImplementation(async () => process.env.SOY_TEST_LEGACY ? readFile(process.env.SOY_TEST_LEGACY, 'utf8') : denied());
spyOn(Bun.secrets, 'set').mockImplementation(async () => denied());
spyOn(Bun.secrets, 'delete').mockImplementation(async () => {
  if (process.env.SOY_TEST_REMOVE === '1') { await rm(process.env.SOY_TEST_LEGACY, {force:true}); return true; }
  return denied();
});
`,
  );
  async function invoke(args: string[], input = '', extraEnv: Record<string, string> = {}) {
    const child = Bun.spawn(
      [
        process.execPath,
        '--preload',
        preload,
        new URL('../../../apps/cli/src/index.ts', import.meta.url).pathname,
        'account',
        ...args,
        '--network',
        'local',
        '--json',
      ],
      {
        cwd: e.directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: e.directory, ...extraEnv },
        stdin: new Blob([input]),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stdout + stderr).not.toContain('synthetic-os-secret-must-not-leak');
      expect(stdout + stderr).not.toContain('test-pairing-secret');
      return { code, data: JSON.parse(stdout) };
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const connected = await invoke(['connect', '--stdin'], await e.provider.getBunkerURI());
    expect(connected.code).toBe(0);
    expect(connected.data.account.storage).toBe('file');
    expect((await invoke(['check'])).code).toBe(0);
    const id = connected.data.account.id;
    const directory = join(e.directory, 'accounts/local');
    const file = join(directory, 'remote-sessions', `${id}.json`);
    const contents = await readFile(file, 'utf8');
    const failed = await invoke(['storage', 'keychain']);
    expect(failed.code).toBe(1);
    expect(failed.data.error.code).toBe('KEYSTORE_UNAVAILABLE');
    expect(failed.data.error.message).toContain('write failed (EACCES)');
    expect((await invoke(['show'])).data.account.storage).toBe('file');
    expect(await readFile(file, 'utf8')).toBe(contents);
    // Recreate the metadata shape of an old release backed by the synthetic native store.
    const indexPath = join(directory, 'accounts.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    delete index.accounts[0].sessionStorage;
    await writeFile(indexPath, JSON.stringify(index), { mode: 0o600 });
    await writeFile(legacy, contents, { mode: 0o600 });
    await rm(file);
    const cleanup = await invoke(['storage', 'file'], '', { SOY_TEST_LEGACY: legacy });
    expect(cleanup.code).toBe(1);
    expect(cleanup.data.error.code).toBe('SESSION_CLEANUP');
    expect(cleanup.data.error.message).toContain('delete failed (EACCES)');
    expect(cleanup.data.error.message).toContain('Retry soyli account storage file');
    expect((await invoke(['show'])).data.account.storageCleanupPending).toBe(true);
    expect((await invoke(['check'])).code).toBe(0);
    expect(
      (await invoke(['storage', 'file'], '', { SOY_TEST_LEGACY: legacy, SOY_TEST_REMOVE: '1' }))
        .code,
    ).toBe(0);
    expect(await Bun.file(legacy).exists()).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(JSON.parse(contents));
    expect((await invoke(['show'])).data.account.storageCleanupPending).toBeUndefined();
    await chmod(file, 0o644);
    const unsafe = await invoke(['check']);
    expect(unsafe.code).toBe(1);
    expect(unsafe.data.error.code).toBe('KEYSTORE_FILE');
    expect(unsafe.data.error.message).toContain('0600');
    for (const args of [
      ['show', '--session-storage', 'file'],
      ['connect', '--session-storage', 'unknown'],
      ['storage', 'file', '--dry-run'],
    ]) {
      expect((await invoke(args)).data.error.code).toBe('USAGE');
    }
  } finally {
    await e.close();
  }
}, 25000);
test('remote denial, changed events and timeout fail closed without exposing provider errors or retaining sockets', async () => {
  const e = await environment();
  try {
    const credential = bunkerCredential(await e.provider.getBunkerURI(), 'local');
    let signer = await openCredential(credential, 'local', { timeoutMs: 1500 });
    e.provider.onSignEvent = () => false;
    await expect(
      signer.signEvent({ kind: 30617, created_at: 1, content: '', tags: [] }),
    ).rejects.toMatchObject({ code: 'SIGNER_REFUSED' });
    await signer.close();
    e.provider.onSignEvent = () => true;
    const upstream = e.creator.signEvent.bind(e.creator);
    e.creator.signEvent = (template) => upstream({ ...template, content: 'modified by signer' });
    signer = await openCredential(credential, 'local', { timeoutMs: 1500 });
    await expect(
      signer.signEvent({ kind: 30618, created_at: 1, content: '', tags: [] }),
    ).rejects.toMatchObject({ code: 'SIGNER_CHANGED_EVENT' });
    await signer.close();
    await e.provider.stop();
    await expect(openCredential(credential, 'local', { timeoutMs: 100 })).rejects.toMatchObject({
      code: 'SIGNER_TIMEOUT',
    });
    await expect(
      openCredential(credential, 'local', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'SIGNER_CLOSED' });
  } finally {
    await e.close();
  }
}, 10000);
test('local signer profile rejects public relay destinations before connecting', () => {
  const key = 'a'.repeat(64);
  for (const url of [
    'wss://relay.example',
    'ws://localhost',
    'ws://127.0.0.1.evil.example',
    'ws://name:password@127.0.0.1',
  ])
    expect(() =>
      bunkerCredential(`bunker://${key}?relay=${encodeURIComponent(url)}`, 'local'),
    ).toThrow();
  expect(() =>
    bunkerCredential(`bunker://${key}?relay=${encodeURIComponent('ws://127.0.0.1')}`, 'public'),
  ).toThrow();
});

test('bunker links preserve four through eight distinct WSS relay hints', () => {
  for (const count of [4, 8]) {
    const url = new URL(`bunker://${'a'.repeat(64)}`);
    const relays = Array.from({ length: count }, (_, i) => `wss://signer-${i}.example.com/`);
    for (const relay of relays) url.searchParams.append('relay', relay);
    url.searchParams.set('secret', 'synthetic-pairing-secret');
    expect(bunkerCredential(url.href, 'public').relays).toEqual(relays);
  }
});

test('an eight-relay bunker uses the responding last relay and reopens its saved CLI and browser sessions', async () => {
  const e = await environment();
  const quiet = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: { message() {} },
  });
  try {
    const link = new URL(await e.provider.getBunkerURI());
    link.searchParams.delete('relay');
    for (let i = 0; i < 7; i++)
      link.searchParams.append('relay', `ws://127.0.0.1:${quiet.port}/${i}`);
    link.searchParams.append('relay', e.url);
    const accounts = new Accounts('local', e.directory, e.vault);
    const connected = await accounts.connect(link.href, { timeoutMs: 3000 });
    expect(connected.pubkey).toBe(await e.creator.getPublicKey());
    const saved = await e.session(connected.id);
    expect(saved.relays).toHaveLength(8);
    expect(saved.secret).toBeUndefined();
    const reopened = await new Accounts('local', e.directory, e.vault).signer({ timeoutMs: 3000 });
    try {
      expect(
        (
          await reopened.signEvent({
            kind: 35129,
            created_at: 1,
            tags: [['d', 'eight-relays']],
            content: '',
          })
        ).pubkey,
      ).toBe(connected.pubkey);
      const material = sessionMaterial.parse({ method: 'remote', credential: saved });
      const browser = new SessionAccount(connected.pubkey, reopened);
      browser.material = material;
      browser.metadata = { remember: true, expires: Date.now() + 60000 };
      expect(SessionAccount.fromJSON(browser.toJSON()).material as typeof material).toEqual(
        material,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    quiet.stop(true);
    await e.close();
  }
}, 10000);

test('client pairing ignores forged acknowledgements, persists a restartable client credential and scopes permissions', async () => {
  const e = await environment();
  try {
    e.provider.bunkerSecret = undefined;
    const accounts = new Accounts('local', e.directory, e.vault);
    let permissions: string[] = [];
    e.provider.onConnect = (_client, requested) => {
      permissions = requested;
      return true;
    };
    const attacker = new PrivateKeySigner();
    const account = await accounts.pair([e.url], {
      timeoutMs: 3000,
      onPairing: async (uri) => {
        const link = new URL(uri);
        expect(link.protocol).toBe('nostrconnect:');
        expect(link.searchParams.get('secret')!.length).toBeGreaterThanOrEqual(32);
        for (const result of ['ack', 'incorrect secret']) {
          const content = await attacker.nip44.encrypt(
            link.hostname,
            JSON.stringify({ id: 'forged', result }),
          );
          const event = await attacker.signEvent({
            kind: 24133,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', link.hostname]],
            content,
          });
          await e.pool.publish([e.url], event);
        }
        await Bun.sleep(25);
        await e.provider.handleNostrConnectURI(uri);
      },
    });
    expect(account.pubkey).toBe(await e.creator.getPublicKey());
    expect(permissions).toContain('sign_event:35129');
    expect(permissions).not.toContain('sign_event:9734');
    const stored = await e.session(account.id);
    expect(stored.remote).toBe(await e.transport.getPublicKey());
    expect(stored.secret).toBeUndefined();
    expect(e.values.size).toBe(0);
    const signer = await new Accounts('local', e.directory, e.vault).signer({ timeoutMs: 3000 });
    try {
      await expect(
        signer.signEvent({ kind: 9734, created_at: 1, tags: [], content: '' }),
      ).rejects.toMatchObject({ code: 'SIGNING_SCOPE' });
      expect(
        (await signer.signEvent({ kind: 35129, created_at: 1, tags: [], content: '' })).pubkey,
      ).toBe(account.pubkey);
    } finally {
      await signer.close();
    }
  } finally {
    await e.close();
  }
}, 10000);

test('pairing timeout and cancellation leave no account, and retries use fresh client keys', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const uris: string[] = [];
    await expect(
      accounts.pair([e.url], {
        timeoutMs: 100,
        onPairing: (uri) => {
          uris.push(uri);
        },
      }),
    ).rejects.toMatchObject({ code: 'SIGNER_TIMEOUT' });
    const controller = new AbortController();
    await expect(
      accounts.pair([e.url], {
        signal: controller.signal,
        onPairing: (uri) => {
          uris.push(uri);
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'SIGNER_CANCELLED' });
    expect(await accounts.current()).toBeNull();
    expect(e.values.size).toBe(0);
    expect(new URL(uris[0]).hostname).not.toBe(new URL(uris[1]).hostname);
    expect(new URL(uris[0]).searchParams.get('secret')).not.toBe(
      new URL(uris[1]).searchParams.get('secret'),
    );
    await expect(
      pairCredential(['wss://not-local.example'], 'local', { onPairing: () => {} }),
    ).rejects.toMatchObject({ code: 'INVALID_RELAY' });
  } finally {
    await e.close();
  }
});

test('browser identity scopes signatures, reconnects the same user, cancels pairing and rejects stale signatures after a switch', async () => {
  const e = await environment();
  const identity = new BrowserIdentity('local');
  try {
    const template = { kind: 7, created_at: 1, tags: [], content: '+' };
    await identity.bunker(await e.provider.getBunkerURI());
    const creator = await e.creator.getPublicKey();
    expect(identity.state.pubkey).toBe(creator);
    for (const kind of websiteKinds)
      expect((await identity.sign(creator, { ...template, kind })).pubkey).toBe(creator);
    await expect(identity.sign(creator, { ...template, kind: 9999 })).rejects.toThrow(
      'permissions',
    );
    e.provider.onSignEvent = () => false;
    await expect(identity.sign(creator, template)).rejects.toThrow('still selected');
    expect(identity.state).toMatchObject({ pubkey: creator, reconnect: true });
    e.provider.onSignEvent = () => true;
    await identity.reconnect();
    expect(identity.state.pubkey).toBe(creator);
    let release!: (value: boolean) => void;
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    e.provider.onSignEvent = () => {
      requested();
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const signing = identity.sign(creator, template);
    const rejected = signing.then(
      () => null,
      (error) => error,
    );
    await started;
    const replacement = new PrivateKeySigner();
    await identity.importKey(Buffer.from(replacement.key).toString('hex'));
    release(true);
    expect((await rejected)?.message).toContain('Signing did not complete');
    expect(identity.state.pubkey).toBe(await replacement.getPublicKey());
    await expect(identity.sign(creator, template)).rejects.toThrow('correct account');
    const pairing = identity.pair([e.url], () => {
      identity.cancel();
    });
    await expect(pairing).rejects.toThrow();
    expect(identity.state.pubkey).toBe(await replacement.getPublicKey());
    identity.disconnect();
    expect(identity.state).toMatchObject({ pubkey: null, method: null, reconnect: false });
  } finally {
    identity.disconnect();
    await e.close();
  }
}, 15000);
