# Mantis DC Repository

A rebuild of the B-BBEE **Data Capture (DC) repository** from the old Laravel client portal (`portal.mantisnetworks.co.za/client/dc`), built the same way as Mantis Hub:

- **Supabase** (the existing `mantis-hub` project) holds the database, logins, file storage and Edge Functions.
- **GitHub** holds the source. A GitHub Action builds the React app into **one self-contained `index.html`** and publishes it on **GitHub Pages**.

The full specification is in [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). The build plan, open questions and phase reports are in [`docs/`](docs).

## What's in it (Phases 1–3)

| Area | What you get |
|---|---|
| Foundation | Email/password + magic-link login (same users as Mantis Hub), organisation switcher, roles (Mantis admin, consultant, client editor, client viewer, verifier), admin area, project list, 6-step project wizard, project dashboard |
| Capture engine | One metadata-driven grid + side-panel form for all 8 pillars (fields, labels, required rules and visibility come from `dc_field_defs` / `dc_field_rules`), people/supplier/beneficiary pickers with inline create, CSV/XLSX import with column mapping and row-level errors, XLSX templates with dropdowns, CSV/XLSX export, copy-forward |
| Evidence & verification | File evidence (25 MB, private bucket, 10-minute signed links) on the project, pillar or row; evidence checklist; sampling (manual and random); verifier queries; pillar and row locking; full audit history |

## How it fits into Mantis Hub

Everything lives in the Mantis Hub Supabase project but **does not change any Hub table**:

- DC tables are `public.dc_*`; helper functions live in the private `dc` schema.
- Organisations are Hub's `public.organisations` (no duplicate client list).
- Logins are the shared Supabase Auth users. Hub **super admins** are automatically DC admins; anyone else gets access through `dc_memberships` (per organisation) or `dc_project_members` (per project, e.g. verifiers).
- Buckets: `dc-evidence` and `dc-imports` (both private).
- Edge Functions: `dc-import`, `dc-export`, `dc-invite`.

## Repository layout

```
app/                     React 18 + TypeScript + Vite (single-file build)
  src/pages, src/components, src/lib
  src/__tests__          Vitest unit tests (rules engine, import parsing, Zod schemas, SA formats)
  e2e/                   Playwright gate tests (local stack only)
supabase/
  migrations/            SQL migrations (schema, RLS, functions, config seed)
  functions/             Edge Functions + _shared engine (also used by the app)
  spec/fields.mjs        SINGLE SOURCE for pillar fields, lookups and rules
  spec/generate.mjs      regenerates the capture-table + seed migrations from fields.mjs
  tests/dc_gate_tests.sql  88 role/RLS/validation tests – always rolled back
  seed.sql               demo data for local development only
docs/                    build prompt, plan, questions, phase reports
.github/workflows/       Pages deploy (automatic) and Supabase deploy (manual)
```

## Day-to-day

### Change the app
Edit `app/src`, push to `main`. The **Build and deploy to GitHub Pages** workflow runs the unit tests, builds `index.html` and publishes it.

### Change the database
1. Add a new file in `supabase/migrations/` (never edit an applied one).
2. Apply it with the Supabase MCP connector in Claude, or with the **Deploy Supabase** workflow (Actions tab › Run workflow; needs the `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` repository secrets).
3. Run `supabase/tests/dc_gate_tests.sql` in the SQL editor. It ends with an error message that **is** the test report (for example `DC GATE TESTS: 88 passed, 0 failed (all changes rolled back)`), so nothing it creates is kept.

Migration file names match the versions recorded in the live project (`supabase_migrations.schema_migrations`), so `supabase db push` only applies new files. Keep it that way when adding migrations through the MCP connector: rename the file to the version Supabase records.

### Change pillar fields
Edit `supabase/spec/fields.mjs`, then run `node supabase/spec/generate.mjs`. This rewrites the generated migrations for a fresh database. For the live database, write a small follow-up migration (add the column + upsert the `dc_field_defs` row). The app, import templates and validation pick changes up automatically from the metadata tables.

## Local development

```bash
cd app
cp .env.example .env.local   # points at the live project by default
npm install
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run build                # dist/index.html
```

A full local stack (`supabase start`) needs the Mantis Hub schema first, because the DC migrations reference `public.organisations` and `private.is_super_admin()`. Run `supabase db pull` against the Hub project, then `supabase db reset`, which also loads `seed.sql`. To test only the database on a plain Postgres 15+ (no Supabase), load `supabase/tests/hub_stub.sql`, then the migrations, then `seed.sql`, then the gate tests; this is how the migrations were tested before going live. The Playwright gate tests (`npx playwright test`) run against that local stack with the demo logins listed in `seed.sql`.

## One-off setup checklist

- [ ] GitHub › Settings › Pages › Source "Deploy from a branch" › Branch **gh-pages** / (root) › Save (the workflow creates that branch).
- [ ] Supabase › Authentication › URL Configuration: add `https://clint-mantis.github.io/mantis-dc/` to **Redirect URLs** (needed for magic links, invitations and password resets).
- [ ] Optional: repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` for the manual Supabase deploy workflow.
- [ ] Give people access: Admin › Users & memberships (Hub super admins already have full access).

## Security notes

- Every table has row-level security; the browser only holds the public publishable key.
- Client viewers never receive ID numbers (masked to the last 4 digits) or salaries/stipends.
- The audit log never stores ID numbers or salaries – only that they were set or changed.
- Evidence files are private and served via signed links that expire after 10 minutes.
- The repository is public: no secrets are committed. Keep it that way, or make the repo private (GitHub Pages on private repos needs a paid GitHub plan).
