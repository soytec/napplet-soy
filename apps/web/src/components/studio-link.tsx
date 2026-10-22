import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { studioEntry } from '../../../studio/navigation';

/** Studio navigation stays in the shell, including exact remix query parameters. */
export function StudioLink({
  path = '/studio',
  children,
  ...appearance
}: {
  path?: string;
  children: ReactNode;
  className?: string;
  'data-effect'?: string;
  'data-tone'?: string;
}) {
  const href = studioEntry('https://napplet.soy', path) ?? '/studio';
  return (
    <Link to={href} {...appearance}>
      {children}
    </Link>
  );
}
