import { initialize } from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import { compileBrowserProject } from './browser-compiler';
import type { BrowserBuildTransfer } from './browser-build-contract';
import { BrowserBuildCache } from './browser-build-cache';

const ready = initialize({ wasmURL, worker: false });
const cache = new BrowserBuildCache();
addEventListener('message', async (event: MessageEvent<BrowserBuildTransfer>) => {
  try {
    await ready;
    postMessage(await compileBrowserProject(cache.apply(event.data)));
  } catch (error) {
    postMessage({
      id: event.data.id,
      revision: event.data.revision,
      error: String(error).slice(0, 12000),
      errorKind: 'worker',
      typecheckMs: 0,
      buildMs: 0,
    });
  }
});
