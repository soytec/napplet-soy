import { z } from 'zod';
import type { StudioSurface } from './surface';
import { proposalInput } from './proposal';
import { mergeInput } from './merge';
import { listingSchema } from './publication';
import { validSource } from './navigation';

const promptSchema = z.object({ prompt: z.string().trim().min(1).max(10000) }).strict();
const createSchema = promptSchema.extend({
  browserSession: z.uuid().optional(),
  title: z.string().trim().min(1).max(80),
  source: z
    .string()
    .trim()
    .max(4096)
    .refine(validSource, 'Use an HTTPS napplet link, Nostr identifier or loopback HTTP link.')
    .optional(),
});
/** Validated application dispatch shared by local HTTP and encrypted hosted control.
 * Authentication, request limits and idempotency belong to the transport boundary. */
export async function dispatchStudio(
  studio: StudioSurface,
  path: string,
  body?: unknown,
): Promise<Response> {
  if (
    !path ||
    path.length > 4096 ||
    path.startsWith('/') ||
    path.includes('#') ||
    path.includes('\\')
  )
    throw new Error('Invalid Studio operation.');
  const url = new URL('/api/' + path, 'https://studio.invalid');
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (body === undefined) {
    if (url.pathname === '/api/state') return json(await studio.state());
    const browserBuild = /^\/api\/browser-builds\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (browserBuild)
      return json(
        await studio.browserBuilds.next(browserBuild[1], url.searchParams.get('base') ?? undefined),
      );
    const signing = /^\/api\/signers\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (signing) return json(await studio.signing.next(signing[1]));
    const match =
      /^\/api\/projects\/([a-f0-9-]{36})\/(browser-git|files|file|diff|preview|listing|media|assets|asset)$/.exec(
        url.pathname,
      );
    if (match) {
      const [, id, action] = match;
      if (action === 'assets') return json(await studio.assets(id));
      if (action === 'asset') {
        const asset = await studio.assetMedia(id, url.searchParams.get('name') ?? '');
        return new Response(asset.bytes, {
          headers: {
            'Content-Type': asset.mime,
            'Content-Disposition': 'inline',
          },
        });
      }
      if (action === 'browser-git') return json(await studio.browserGit(id));
      if (action === 'files') return json(await studio.files(id));
      if (action === 'file') return json(await studio.file(id, url.searchParams.get('path') ?? ''));
      if (action === 'diff') return json(await studio.diff(id));
      if (action === 'preview') return json({ url: await studio.preview(id) });
      if (action === 'listing') return json(await studio.listing(id));
      if (action === 'media') {
        const media = await studio.publicationMedia(
          id,
          url.searchParams.get('review') ?? '',
          url.searchParams.get('name') ?? '',
        );
        return new Response(media.bytes, {
          headers: { 'Content-Type': media.mime },
        });
      }
    }
  }

  if (body !== undefined) {
    let result: unknown;
    if (/^\/api\/browser-builds\/[a-f0-9-]{36}$/.test(url.pathname)) {
      await studio.browserBuilds.reply(url.pathname.split('/').pop()!, body);
      result = { ok: true };
    } else if (/^\/api\/connections\/(save|select|remove|test|models|model)$/.test(url.pathname)) {
      result = await studio.connectionAction(url.pathname.split('/').pop()!, body);
    } else if (url.pathname === '/api/signers') {
      result = await studio.signing.connect(
        z
          .object({ pubkey: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .parse(body).pubkey,
      );
    } else if (/^\/api\/signers\/([a-f0-9-]{36})$/.test(url.pathname)) {
      const input = z
        .object({ requestId: z.uuid(), event: z.unknown().optional() })
        .strict()
        .parse(body);
      await studio.signing.reply(url.pathname.split('/').pop()!, input.requestId, input.event);
      result = { ok: true };
    } else if (url.pathname === '/api/merge-reviews') {
      const input = z.object({ session: z.uuid(), review: mergeInput }).strict().parse(body);
      result = { id: await studio.reviewMerge(input.session, input.review) };
    } else if (url.pathname === '/api/projects') {
      const input = createSchema.parse(body);
      result = {
        id: await studio.create(input.title, input.prompt, input.source, input.browserSession),
      };
    } else {
      const match =
        /^\/api\/projects\/([a-f0-9-]{36})\/(messages|stop|check|restore|prepare-publication|publish|prepare-proposal|propose|merge-proposal|refresh-publication|fix-publication)$/.exec(
          url.pathname,
        );
      if (!match) return json({ error: 'Not found.' }, 404);
      const [, id, action] = match;
      if (action === 'merge-proposal') {
        const input = z
          .object({ session: z.uuid(), review: z.uuid(), confirmed: z.literal(true) })
          .strict()
          .parse(body);
        await studio.mergeProposal(id, input.session, input.review);
      }
      if (action === 'messages') {
        const input = promptSchema
          .extend({
            browserSession: z.uuid().optional(),
            reviewPublication: z.boolean().optional(),
          })
          .parse(body);
        await studio.send(id, input.prompt, input.browserSession, input.reviewPublication);
      }
      if (action === 'prepare-publication') {
        const input = z.object({ session: z.uuid(), listing: listingSchema }).strict().parse(body);
        await studio.preparePublication(id, input.session, input.listing);
      }
      if (action === 'prepare-proposal') {
        const input = z.object({ session: z.uuid(), proposal: proposalInput }).strict().parse(body);
        await studio.prepareProposal(id, input.session, input.proposal);
      }
      if (action === 'publish' || action === 'propose') {
        const input = z
          .object({
            session: z.uuid(),
            review: z.uuid(),
            resume: z.boolean(),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(body);
        if (action === 'propose')
          await studio.propose(id, input.session, input.review, input.resume);
        else await studio.publish(id, input.session, input.review, input.resume);
      }
      if (action === 'refresh-publication' || action === 'fix-publication') {
        z.object({}).strict().parse(body);
        if (action === 'refresh-publication') await studio.refreshPublication(id);
        else await studio.fixPublication(id);
      }
      if (action === 'stop') {
        z.object({}).strict().parse(body);
        await studio.stop(id);
      }
      if (action === 'check') {
        const input = z.object({ browserSession: z.uuid().optional() }).strict().parse(body);
        await studio.check(id, input.browserSession);
      }
      if (action === 'restore')
        await studio.restore(
          id,
          z
            .object({ commit: z.string().regex(/^[a-f0-9]{40}$/) })
            .strict()
            .parse(body).commit,
        );
      result = { ok: true };
    }
    return json(result);
  }
  return json({ error: 'Not found.' }, 404);
}
