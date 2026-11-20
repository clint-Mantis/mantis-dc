import { defineConfig } from '@playwright/test';
// Runs against a LOCAL Supabase stack loaded with supabase/seed.sql (never against production).
//   cd .. && supabase start && supabase db reset   (see README › Local development)
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key> npx playwright test
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 860 } },
  webServer: { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true, timeout: 120_000 },
});
