import { createFileRoute, stripSearchParams, type SearchSchemaInput } from '@tanstack/react-router';
import { z } from 'zod';
import { Gamegrid, gamegridCatalogSearch, type GamegridSearch } from '@/components/gamegrid';
import { getBrowseGallery } from '@/lib/catalog.functions';
import { siteHead } from '@/lib/site-head';

const searchSchema = z.object({
  q: z.string().trim().max(100).catch(''),
  section: z.enum(['new', 'zapped', 'games', 'continue']).catch('new'),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
});

export const Route = createFileRoute('/gg')({
  validateSearch: (input: SearchSchemaInput & Partial<GamegridSearch>) => searchSchema.parse(input),
  search: { middlewares: [stripSearchParams({ q: '', section: 'new', page: 1 })] },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getBrowseGallery({ data: gamegridCatalogSearch(deps) }),
  head: ({ match }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      '/gg',
      'Gamegrid — a little world awaits',
      'Find small games, bring your controller, and make yourself at home. A flavor of napplet.soy.',
    ),
  component: GamegridRoute,
});

function GamegridRoute() {
  const initial = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Gamegrid
      initial={initial}
      search={search}
      update={(patch) => {
        void navigate({
          search: (previous) => ({ ...previous, page: 1, ...patch }),
          resetScroll: false,
        });
      }}
    />
  );
}
