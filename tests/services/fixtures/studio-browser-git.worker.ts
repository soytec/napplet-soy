import '../../../apps/studio/browser-git-globals';
// Isolated GRASP fixture only. Production Studio intentionally has no push command yet.
import LightningFS from '@isomorphic-git/lightning-fs';
import { BrowserGit } from '../../../apps/studio/browser-git-engine';

const fs = new LightningFS('studio-browser-git-fixture');
self.onmessage = async ({ data }) => {
  try {
    const result = await navigator.locks.request('studio-browser-git-fixture', async () => {
      const git = new BrowserGit(fs, fs.promises);
      await git.open();
      const value = await (git as any)[data.method](...data.args);
      await fs.promises.flush();
      return value;
    });
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
