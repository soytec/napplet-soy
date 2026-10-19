import { createFileRoute, Outlet } from '@tanstack/react-router';
import styles from '../../../studio/style.css?url';
export const Route = createFileRoute('/studio')({
  head: () => ({
    meta: [{ title: 'Studio · napplet.soy' }],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  component: Outlet,
});
