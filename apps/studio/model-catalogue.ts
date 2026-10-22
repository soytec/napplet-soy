import { DiagnosticError } from '../../packages/diagnostics/src';
import { readBytes } from '../../packages/client/src/bytes';
import type { InferenceModel, ModelCatalogue, ModelCatalogueInput } from './connections-model';

export const modelIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/;
const limits = { bytes: 8 * 1024 * 1024, models: 2000, pages: 10, timeout: 10000 };
const failure = (message: string, status?: number) =>
  new DiagnosticError('STUDIO_CONNECTION', message, {
    operation: 'fetch inference models',
    status,
    recovery:
      'Check the endpoint and API key, or enter a model ID manually. No generation was requested.',
  });

/** Credentials stay at the configured origin. Never follow redirects or provider-supplied URLs. */
export async function fetchModelCatalogue(c: ModelCatalogueInput): Promise<ModelCatalogue> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (c.provider === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  if (c.key) {
    if (c.provider === 'anthropic') headers['x-api-key'] = c.key;
    else if (c.provider === 'google') headers['x-goog-api-key'] = c.key;
    else headers.Authorization = `Bearer ${c.key}`;
  }
  const base = c.endpoint.replace(/\/+$/, '') + '/models';
  const signal = AbortSignal.timeout(limits.timeout);
  const models = new Map<string, InferenceModel>();
  const cursors = new Set<string>();
  let cursor = '',
    bytesLeft = limits.bytes;
  for (let page = 0; page < limits.pages; page++) {
    const url = new URL(base);
    if (c.provider === 'anthropic') {
      url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set('after_id', cursor);
    } else if (c.provider === 'google') {
      url.searchParams.set('pageSize', '1000');
      if (cursor) url.searchParams.set('pageToken', cursor);
    }
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal });
    } catch {
      throw failure(
        'Could not reach the model catalogue. Check the endpoint and whether the server is running.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw failure(`The model catalogue returned HTTP ${response.status}.`, response.status);
    }
    let body: Record<string, unknown>;
    try {
      const bytes = await readBytes(response, bytesLeft);
      bytesLeft -= bytes.length;
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw failure(
        signal.aborted
          ? 'The model catalogue took too long to download. Try again.'
          : 'The model catalogue is invalid or exceeds the 8 MiB download limit.',
      );
    }
    const rows = body && (Array.isArray(body) ? body : (body.data ?? body.models));
    if (!Array.isArray(rows))
      throw failure(
        'The server did not return a supported model catalogue. Check its API base URL.',
      );
    let truncated = false;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      // Gemini also lists embedding-only models; these cannot run the maker.
      if (
        c.provider === 'google' &&
        Array.isArray(row.supportedGenerationMethods) &&
        !row.supportedGenerationMethods.includes('generateContent')
      )
        continue;
      const rawId = row.id ?? row.name;
      if (typeof rawId !== 'string') continue;
      const id = c.provider === 'google' ? rawId.replace(/^models\//, '') : rawId;
      if (id.length > 160 || !modelIdPattern.test(id)) continue;
      const rawName = row.display_name ?? row.displayName ?? row.name;
      const name = typeof rawName === 'string' ? rawName.slice(0, 200) : id;
      if (c.key && (id.includes(c.key) || name.includes(c.key))) continue;
      if (!models.has(id) && models.size >= limits.models) {
        truncated = true;
        break;
      }
      models.set(id, { id, name });
    }
    const next =
      c.provider === 'google'
        ? body.nextPageToken
        : c.provider === 'anthropic' && body.has_more
          ? body.last_id
          : undefined;
    if (c.provider === 'anthropic' && body.has_more && !next)
      throw failure('The model catalogue returned an invalid pagination cursor.');
    if (next && (typeof next !== 'string' || next.length > 2048 || cursors.has(next)))
      throw failure('The model catalogue returned an invalid pagination cursor.');
    if (
      truncated ||
      !next ||
      page === limits.pages - 1 ||
      models.size >= limits.models ||
      bytesLeft <= 0
    )
      return {
        models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)),
        truncated: truncated || !!next,
      };
    cursor = next as string;
    cursors.add(cursor);
  }
  throw failure('The model catalogue could not be read.');
}
