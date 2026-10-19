import './browser-git-globals';
import LightningFS from '@isomorphic-git/lightning-fs';
import { BrowserGit } from './browser-git-engine';
import type { GitCommand } from './browser-git-contract';
import { redactDiagnostic } from '../../packages/diagnostics/src';

let queue: Promise<unknown> = Promise.resolve();
const databases = new Map<string, LightningFS>();
self.onmessage = (event: MessageEvent<{ id: string; scope: string; command: GitCommand }>) => {
  const { id, scope, command } = event.data;
  queue = queue
    .catch(() => {})
    .then(async () => {
      if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid browser workspace scope.');
      if (!navigator.locks)
        throw new Error('Browser Git requires Web Locks and persistent browser storage.');
      return navigator.locks.request('studio-browser-git-' + scope, async () => {
        const fs = databases.get(scope) ?? new LightningFS('studio-browser-git-' + scope);
        databases.set(scope, fs);
        const engine = new BrowserGit(fs, fs.promises, (text) =>
          self.postMessage({ id, progress: text }),
        );
        await engine.open();
        let value: unknown;
        switch (command.type) {
          case 'status':
            value = await engine.view();
            break;
          case 'import':
            value = await engine.import(command.snapshot);
            break;
          case 'clone':
            value = await engine.clone(command.url, command.commit);
            break;
          case 'diff':
            value = await engine.diff(command.path);
            break;
          case 'read':
            value = await engine.read(command.path);
            break;
          case 'write':
            value = await engine.write(command.path, command.text, command.expected);
            break;
          case 'commit':
            value = await engine.commit(command.message, command.expected);
            break;
          case 'export':
            value = await engine.export();
            break;
          default:
            throw new Error('Unsupported browser Git operation.');
        }
        await fs.promises.flush();
        self.postMessage({ id, value });
      });
    })
    .catch((error) =>
      self.postMessage({ id, error: redactDiagnostic((error as Error).message, 1200) }),
    );
};
