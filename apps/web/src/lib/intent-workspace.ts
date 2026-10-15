import { intentCatalogId } from '../../../../packages/runtime/src/intent-session';
import { queryCatalog } from './protocol-catalog';
import { createWebIntentWorkspace, type IntentUi } from './intent-workspace-state';
export type { IntentUi } from './intent-workspace-state';

let session: ReturnType<typeof createWebIntentWorkspace> | undefined;
const current = () => (session ??= createWebIntentWorkspace(queryCatalog));
const empty: IntentUi = {};
export const subscribeIntentUi = (listener: () => void) => current().subscribeIntentUi(listener);
export const intentUi = () => current().intentUi();
export const serverIntentUi = () => empty;
export const closeIntentLaunch = (key: number) => current().closeIntentLaunch(key);
export const failIntentLaunch = (key: number, error: Error) =>
  current().failIntentLaunch(key, error);
export const dismissIntentError = () => current().dismissIntentError();
export const webIntentWorkspace = () => current().workspace;
export async function installPlayerIntent(manifest: unknown, title: string) {
  return webIntentWorkspace().install(manifest, title);
}
export function playerIntentCatalogId(manifest: Parameters<typeof intentCatalogId>[0]) {
  return intentCatalogId(manifest);
}
