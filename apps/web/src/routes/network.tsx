import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/network')({
  beforeLoad: () => {
    throw redirect({ to: '/manage', hash: 'relays', replace: true });
  },
});
