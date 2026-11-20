import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Builds ONE self-contained index.html (same deployment model as Mantis Hub on GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { '@engine': fileURLToPath(new URL('../supabase/functions/_shared/engine.ts', import.meta.url)) },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
});
