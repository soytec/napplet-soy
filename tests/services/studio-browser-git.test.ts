import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { RelayPool } from 'applesauce-relay';
import { buildGrasp, graspBinary } from '../../scripts/grasp-build';
import { graspEnvironment, graspHealth } from '../../scripts/grasp';
import {
  prepareSource,
  publishSource,
  sourceGit,
  sourceUrls,
} from '../../packages/grasp/src/client';
import { browserEngine } from '../../apps/cli/src/browser';
import type { GitView } from '../../apps/studio/browser-git-contract';

test('browser worker clones GRASP across origins, persists checkpoints, and pushes only signed fast forwards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-browser-grasp-'));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let browser:
    | Awaited<ReturnType<Awaited<ReturnType<typeof browserEngine>>['chromium']['launch']>>
    | undefined;
  const pool = new RelayPool();
  try {
    await buildGrasp();
    const state = join(directory, 'grasp');
    await mkdir(state);
    child = Bun.spawn([graspBinary], {
      cwd: state,
      env: {
        ...graspEnvironment({
          origin: 'http://127.0.0.1:1',
          directory: state,
          local: true,
          instance: 'browser-git-test',
          bind: '127.0.0.1:0',
        }),
        NGIT_DOMAIN: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const startup = setTimeout(() => child?.kill('SIGKILL'), 15000);
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    let output = '',
      origin = '';
    try {
      while (!origin) {
        const next = await reader.read();
        if (next.done) throw new Error('Disposable GRASP did not start.');
        output += new TextDecoder().decode(next.value);
        const port = output.match(/Starting HTTP server on 127\.0\.0\.1:(\d+)/)?.[1];
        if (port) origin = `http://127.0.0.1:${port}`;
      }
    } finally {
      clearTimeout(startup);
      reader.releaseLock();
    }
    void (async () => {
      for await (const _ of child!.stdout as ReadableStream<Uint8Array>) {
        /* drain */
      }
    })();
    void (async () => {
      for await (const _ of child!.stderr as ReadableStream<Uint8Array>) {
        /* drain */
      }
    })();
    expect(await graspHealth(origin)).toBeTruthy();
    const signer = new PrivateKeySigner();
    const source = join(directory, 'source');
    await mkdir(source);
    await sourceGit(source, ['init', '--initial-branch=main']);
    await Bun.write(join(source, 'index.html'), '<h1>Browser Git fixture</h1>');
    await sourceGit(source, ['add', '.']);
    await sourceGit(source, ['commit', '-m', 'Original']);
    const publication = await prepareSource({
      directory: source,
      identifier: 'browser-roundtrip',
      title: 'Disposable browser round trip',
      origin,
      signer,
      local: true,
    });
    await publishSource({ directory: source, origin, publication, local: true });
    const urls = sourceUrls(origin, await signer.getPublicKey(), 'browser-roundtrip', true);
    const head = await sourceGit(source, ['rev-parse', 'HEAD']);
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, 'fixtures/studio-browser-git.worker.ts')],
      target: 'browser',
      format: 'esm',
    });
    if (!built.success) throw new Error(built.logs.join('\n'));
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname === '/worker.js'
          ? new Response(built.outputs[0], { headers: { 'Content-Type': 'text/javascript' } })
          : new Response('<!doctype html><title>Browser Git fixture</title>');
      },
    });
    browser = await (await browserEngine()).chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const open = async (target = page) => {
      await target.goto(server!.url.href);
      await target.evaluate(() => {
        (window as any).gitWorker = new Worker('/worker.js', { type: 'module' });
      });
    };
    const rpc =
      (target: typeof page) =>
      async <T = any>(method: string, ...args: any[]): Promise<T> =>
        target.evaluate(
          ({ method, args }) =>
            new Promise((resolve, reject) => {
              const worker = (window as any).gitWorker;
              const timer = setTimeout(
                () => reject(new Error('Browser Git fixture timed out')),
                30000,
              );
              worker.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Browser Git fixture worker failed'));
              };
              worker.onmessage = ({ data }: MessageEvent) => {
                clearTimeout(timer);
                data.error ? reject(new Error(data.error)) : resolve(data.result);
              };
              worker.postMessage({ method, args });
            }),
          { method, args },
        );
    const call = rpc(page);
    await open();
    const cloned = await call<GitView>('clone', urls.clone, head);
    expect(cloned.head).toBe(head);
    const other = await page.context().newPage();
    await open(other);
    const otherCall = rpc(other);
    expect(await otherCall<string>('read', 'index.html')).toBe('<h1>Browser Git fixture</h1>');
    await call('write', 'index.html', '<h1>Made in a browser</h1>', '<h1>Browser Git fixture</h1>');
    await expect(
      otherCall('write', 'index.html', 'stale browser edit', '<h1>Browser Git fixture</h1>'),
    ).rejects.toThrow('another tab');
    const checkpoint = await call<GitView>('commit', 'Browser change', head);
    await expect(otherCall('commit', 'stale checkpoint', head)).rejects.toThrow('HEAD changed');
    await other.close();
    expect(checkpoint.log[1].oid).toBe(head);
    // New document/worker, same persistent IndexedDB repository.
    await open();
    expect((await call<GitView>('view')).head).toBe(checkpoint.head);
    expect(await call<string>('read', 'index.html')).toBe('<h1>Made in a browser</h1>');
    // No author state means no permission to advance the remote branch.
    await expect(call('push', urls.clone, head)).rejects.toThrow();
    const signed = await signer.signEvent({
      kind: 30618,
      created_at: publication.state.created_at + 1,
      content: '',
      tags: [
        ['d', 'browser-roundtrip'],
        ['refs/heads/main', checkpoint.head],
        ['HEAD', 'ref: refs/heads/main'],
      ],
    });
    await pool
      .relay(urls.relay)
      .publish(signed, { timeout: 5000, retries: false, reconnect: false });
    expect(await call<string>('push', urls.clone, head)).toBe(checkpoint.head);
    const independent = join(directory, 'independent');
    await sourceGit(directory, ['clone', urls.clone, independent]);
    expect(await sourceGit(independent, ['rev-parse', 'HEAD'])).toBe(checkpoint.head);
    expect(await sourceGit(independent, ['rev-parse', 'HEAD^'])).toBe(head);
    expect(await Bun.file(join(independent, 'index.html')).text()).toBe(
      '<h1>Made in a browser</h1>',
    );
    await expect(call('push', urls.clone, head)).rejects.toThrow('main changed');
  } finally {
    pool.close();
    await browser?.close();
    await server?.stop(true);
    if (child?.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 15000);
      await child.exited;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
