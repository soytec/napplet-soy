import { createFileRoute } from '@tanstack/react-router';
import { previewResponse } from '../../../../packages/backend/src/previews';

export const Route = createFileRoute('/api/previews/$id')({
  server: {
    handlers: {
      GET: ({ params, request }) => previewResponse(params.id, request),
      HEAD: ({ params, request }) => previewResponse(params.id, request),
    },
  },
});
