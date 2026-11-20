import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@engine': fileURLToPath(new URL('../supabase/functions/_shared/engine.ts', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', '../supabase/functions/_shared/*.test.ts'], environment: 'node' },
});
