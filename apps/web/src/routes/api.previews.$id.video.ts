import { createFileRoute } from '@tanstack/react-router';
import { previewVideoResponse } from '../../../../packages/backend/src/previews';

export const Route = createFileRoute('/api/previews/$id/video')({
  server: {
    handlers: {
      GET: ({ params, request }) => previewVideoResponse(params.id, request),
      HEAD: ({ params, request }) => previewVideoResponse(params.id, request),
    },
  },
});
