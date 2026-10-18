import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { storyAssets } from '../../scripts/presentation/spatial/vite.ts';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [storyAssets(), tailwind(), tanstackStart(), react()],
  optimizeDeps: {
    exclude: ['@resvg/resvg-js', 'sharp', 'ws'],
    // Avoid reloading Studio (and losing its tab-bound build job) on first worker use.
    include: ['esbuild-wasm', 'typescript-browser', 'parse5'],
  },
  ssr: { external: ['@resvg/resvg-js', 'sharp', 'ws'] },
  server: { strictPort: true, allowedHosts: ['napplet.localhost'] },
});
