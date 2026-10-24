import type { Listing, ListingDetails, ReleaseReview } from '../../../apps/studio/publication';
import { listingSchema } from '../../../apps/studio/publication';

/** Disposable UI only: no signer, inference, Git writes or public network services. */
export async function publicationFixture() {
  const bundle = await Bun.build({
    entrypoints: [new URL('./studio-publication.tsx', import.meta.url).pathname],
    target: 'browser',
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const requests: Array<{ path: string; body: any }> = [];
  const listing: ListingDetails = {
    title: 'Funclet',
    description: 'A little window into a world of radio.',
    topics: ['radio', 'music'],
    video: true,
    portrait: false,
    autoplay: false,
    keepMedia: true,
    updating: true,
    existingMedia: { image: true, video: true },
    recordingPlanned: false,
  };
  const review = (input: Listing): ReleaseReview =>
    ({
      id: 'fixture-review',
      fingerprint: 'f'.repeat(64),
      createdAt: new Date().toISOString(),
      plan: {
        ...input,
        pubkey: 'a'.repeat(64),
        sourceCommit: 'b'.repeat(40),
        files: ['index.html'],
        sourceBytes: 1000,
        targets: { blossom: 'https://blossom.invalid', relay: 'wss://relay.invalid', mirrors: [] },
        license: 'MIT',
      },
      media: [
        {
          name: 'cover.png',
          label: 'Existing listing cover',
          mime: 'image/png',
          hash: 'c'.repeat(64),
          bytes: 68,
          promotional: false,
          reused: input.keepMedia,
        },
        {
          name: 'clip.webm',
          label: 'Existing listing clip',
          mime: 'video/webm',
          hash: 'd'.repeat(64),
          bytes: 1000,
          promotional: false,
          reused: input.keepMedia,
        },
      ],
      repository: { hosted: false, address: `30617:${'a'.repeat(64)}:funclet` },
    }) as unknown as ReleaseReview;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/bundle.js')
        return new Response(bundle.outputs[0], { headers: { 'content-type': 'text/javascript' } });
      if (url.pathname === '/theme.css')
        return new Response(
          Bun.file(new URL('../../../packages/runtime/src/appearance.css', import.meta.url)),
        );
      if (url.pathname === '/studio.css')
        return new Response(Bun.file(new URL('../../../apps/studio/style.css', import.meta.url)));
      if (url.pathname === '/clip.webm')
        return new Response(Bun.file(new URL('../../fixtures/preview.webm', import.meta.url)));
      if (url.pathname === '/cover.png')
        return new Response(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
            'base64',
          ),
          { headers: { 'content-type': 'image/png' } },
        );
      if (url.pathname === '/state')
        return Response.json({
          id: 'fixture',
          title: 'Funclet',
          phase: 'ready',
          messages: [],
          activity: [],
          checks: [],
          checkpoints: [],
          ...(url.searchParams.get('first') === 'false' ? { merge: { status: 'merged' } } : {}),
        });
      if (url.pathname === '/api') {
        const { first, path, body } = await request.json();
        requests.push({ path, body });
        if (path.endsWith('/listing'))
          return Response.json(
            first
              ? {
                  ...listing,
                  keepMedia: false,
                  updating: false,
                  existingMedia: { image: false, video: false },
                }
              : listing,
          );
        if (path.endsWith('/prepare-publication'))
          return Response.json(review(listingSchema.parse(body.listing)));
        return Response.json({ ok: true });
      }
      return new Response(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/studio.css"><style>body{margin:0;background:var(--background)}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>',
        { headers: { 'content-type': 'text/html' } },
      );
    },
  });
  return { server, requests };
}
