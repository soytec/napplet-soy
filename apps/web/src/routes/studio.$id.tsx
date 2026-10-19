import { createFileRoute } from '@tanstack/react-router';
import { StudioPage } from '@/components/studio-page';
export const Route = createFileRoute('/studio/$id')({ component: StudioPage });
