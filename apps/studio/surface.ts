import type { Studio } from './studio';
import type { BrowserSigning } from './signing';

type AsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : never;
};
export type StudioSurface = Pick<
  Studio,
  | 'state'
  | 'connectionAction'
  | 'assets'
  | 'importAsset'
  | 'assetMedia'
  | 'create'
  | 'send'
  | 'stop'
  | 'check'
  | 'restore'
  | 'files'
  | 'file'
  | 'diff'
  | 'preview'
  | 'listing'
  | 'preparePublication'
  | 'publish'
  | 'prepareProposal'
  | 'propose'
  | 'refreshPublication'
  | 'fixPublication'
  | 'publicationMedia'
  | 'close'
> & {
  signing: AsyncMethods<Pick<BrowserSigning, 'connect' | 'next' | 'reply'>>;
  browserBuilds: AsyncMethods<Pick<Studio['browserBuilds'], 'next' | 'reply'>>;
};
