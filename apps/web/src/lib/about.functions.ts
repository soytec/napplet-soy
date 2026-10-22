import { createServerFn } from '@tanstack/react-start';

// Only public repository links cross the server boundary; operators can override the upstream default.
export const getProjectLinks = createServerFn({ method: 'GET' }).handler(() => {
  const links: { label: string; href: string }[] = [];
  for (const [label, value, host] of [
    [
      'GitHub',
      process.env.SPACE_SOURCE_GITHUB_URL ?? 'https://github.com/soytec/napplet-soy',
      'github.com',
    ],
    ['Gitworkshop', process.env.SPACE_SOURCE_GITWORKSHOP_URL, 'gitworkshop.dev'],
  ]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (
        url.protocol === 'https:' &&
        url.hostname === host &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname !== '/'
      ) {
        links.push({ label: label!, href: url.href });
      }
    } catch {
      /* Missing or invalid operator metadata is not a visitor error. */
    }
  }
  return links;
});
