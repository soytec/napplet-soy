/** Implemented NAP surfaces. Individual operations remain subject to host policy. */
export const RUNTIME_DOMAINS = [
  'shell',
  'identity',
  'intent',
  'storage',
  'theme',
  'keys',
  'resource',
  'relay',
  'outbox',
  'common',
  'link',
  'fs',
  'upload',
  'lists',
  'config',
  'media',
  'cvm',
  'webrtc',
] as const;
export const RUNTIME_PROFILE = 'space-playback-7';

/** Namespace injection and admission must agree with this surface's endpoint support. */
export const surfaceDomains = (intent = false) =>
  RUNTIME_DOMAINS.filter((domain) => domain !== 'intent' || intent);

// Only request types understood by this host. Notifications, responses and future
// operations must be ignored, including unknown operations in supported domains.
export const HOST_REQUESTS = new Set(
  Object.entries({
    intent: ['invoke', 'available', 'handlers'],
    upload: ['info', 'upload', 'status'],
    lists: ['supported', 'add', 'remove'],
    cvm: [
      'discover',
      'request',
      'close',
      'registry.list',
      'registry.has',
      'registry.describe',
      'registry.call',
    ],
    webrtc: ['open', 'send', 'close'],
    config: ['registerSchema', 'get', 'subscribe', 'unsubscribe', 'openSettings'],
    identity: [
      'getPublicKey',
      'getRelays',
      'getProfile',
      'getFollows',
      'getList',
      'getZaps',
      'getMutes',
      'getBlocked',
      'getBadges',
    ],
    storage: ['get', 'set', 'remove', 'keys'],
    theme: ['get'],
    keys: ['registerAction', 'unregisterAction', 'forward'],
    resource: ['info', 'bytes', 'bytesMany', 'cancel'],
    relay: ['query', 'subscribe', 'close', 'publish', 'publishEncrypted'],
    outbox: ['getEvent', 'query', 'subscribe', 'close', 'publish', 'resolveRelays'],
    common: [
      'encodeNip19',
      'decodeNip19',
      'getProfile',
      'follows',
      'follow',
      'unfollow',
      'react',
      'report',
    ],
    link: ['open'],
    fs: [
      'info',
      'pickFile',
      'pickFiles',
      'pickDirectory',
      'pickSaveFile',
      'stat',
      'list',
      'read',
      'write',
      'mkdir',
      'remove',
      'move',
      'watch',
      'unwatch',
    ],
  }).flatMap(([domain, actions]) => actions.map((action) => `${domain}.${action}`)),
);
export const missingDomains = (
  required: readonly string[],
  available: readonly string[] = RUNTIME_DOMAINS,
) => required.filter((domain) => !available.includes(domain));
