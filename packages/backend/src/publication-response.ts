import { manifestBlocked } from '../../moderation/src/policy';
import { decodeAddress, identityAddress, verifiedEvent } from '../../protocol/src';
import { validateManifest, validateRelease } from '../../protocol/src/manifest';
import { indexedLookup, indexedArtifact, indexHealth, indexStore } from './indexed-catalog';

/** Pure projection lookup: no request can trigger relay access, downloads, or execution. */
export async function publicationResponse(request: Request) {
  const url = new URL(request.url);
  const naddr = url.searchParams.get('address') ?? '';
  const currentId = url.searchParams.get('current') ?? '';
  const snapshotId = url.searchParams.get('snapshot') ?? '';
  let address: string;
  try {
    if (
      naddr.length > 4096 ||
      !/^[a-f0-9]{64}$/.test(currentId) ||
      (url.searchParams.has('snapshot') && !/^[a-f0-9]{64}$/.test(snapshotId))
    )
      throw new Error();
    address = identityAddress(decodeAddress(naddr));
  } catch {
    return new Response('Invalid publication lookup', { status: 400 });
  }
  const row = indexStore()?.row(address);
  const candidate = row ? verifiedEvent(JSON.parse(row.event)) : null;
  const current = candidate && !manifestBlocked(candidate) ? candidate : null;
  const entry = (await indexedLookup({ type: 'address', naddr })).entry;
  const snapshot = snapshotId
    ? (await indexedLookup({ type: 'snapshot', id: snapshotId })).entry
    : null;
  let status: 'ready' | 'pending' | 'superseded' =
    current && current.id !== currentId ? 'superseded' : 'pending';
  const health = indexHealth();
  if (
    status !== 'superseded' &&
    !health.stale &&
    // An unrelated relay outage does not invalidate this verified publication.
    // Freshness, deletion/moderation policy and exact artifact bytes still apply.
    entry?.availability === 'ready' &&
    (!snapshotId || snapshot?.availability === 'ready') &&
    current?.id === currentId
  ) {
    try {
      const release = snapshotId
        ? await validateRelease(entry.manifest, snapshot!.manifest)
        : await validateManifest(entry.manifest);
      if (await indexedArtifact(release.artifactHash)) status = 'ready';
    } catch {
      /* A mismatched pair can never be confirmed. */
    }
  }
  return Response.json(
    {
      version: 1,
      status,
      checkedAt: Date.now(),
      current,
      snapshot: snapshot?.manifest ?? null,
      artifactHash: entry?.artifactHash ?? null,
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
