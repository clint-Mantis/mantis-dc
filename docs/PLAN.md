# Build plan – DC repository on Supabase (Phases 1–3)

Clint chose to build all three phases in one pass and review at the end, so the plan below was followed without stopping between phases. Each phase has a report in `docs/PHASE_n_REPORT.md`.

## Decisions taken before building (agreed with Clint, 20 Nov 2026)

| Decision | Choice | Why |
|---|---|---|
| Where the database lives | Inside the existing **Mantis Hub** Supabase project | Shares logins and the 444 Hub organisations, avoids syncing two client lists, and stays on the free plan |
| Name clashes with Hub (`organisations`, `people`, `products`, `projects`, `audit_log` already exist) | DC tables are `public.dc_*`, helpers in schema `dc` | No Hub table is altered; PostgREST exposes `public` without config changes |
| Organisations | Reuse `public.organisations` | Prompt's `organisations` table becomes the Hub one; creating an org in the wizard creates it in Hub |
| `mantis_admin` | Hub super admins + `dc_admins` table | Prompt's role stored in memberships; a global role fits better in its own table |
| GitHub | New repo `clint-Mantis/mantis-dc` with **source**, Action builds the single-file `index.html` to Pages | Same hosting as Mantis Hub, but the source is versioned too |
| Local stack | Migrations tested on a local Postgres 17 with a Hub stub, then applied with the Supabase MCP connector | No Docker in the build environment; the live DB is never used for experiments |

## Adaptations to the prompt

- `has_project_access(project_id, min_role)` takes a **capability** (`read`, `read_full`, `capture`, `manage`, `verify`, `admin`) instead of a role rank, because the roles are not a strict ladder (a verifier can verify but not capture). RLS uses the set-returning `dc.my_projects(cap)` / `dc.my_orgs(cap)` so each query evaluates access once.
- Viewers: the masked view is `dc_v_people_masked`; grid data for every role comes from `dc_list_rows()`, which strips salaries/stipends for viewers. Viewers are blocked from the base tables.
- `dc_field_defs` has extra columns (`enum_values`, `enum_labels`, `fk_target`, `min_value`, `max_value`, `is_criteria`, `sensitive`, `legacy_labels`) and `dc_field_rules` has `criteria_key` (ESD needs rules on two fields: `esd_category` and `contribution_type`).
- Capture rows have an extra `confirmed` flag for the copy-forward "confirm" badge.
- Validation lives in one TypeScript engine (`supabase/functions/_shared/engine.ts`) used by the form, the import function and the tests, and is mirrored in Postgres (`dc.field_state`, `dc.validate_row`). A parity test checked 480 random rows: TS and SQL agree on every field.

## Task breakdown

### Phase 1 – Foundation
1. Config tables + seed (pillars, sector codes, products, 11 lookup lists, 142 field definitions, 94 rules, 20 evidence templates), generated from `supabase/spec/fields.mjs`.
2. Tenancy: `dc_admins`, `dc_profiles`, `dc_memberships`, `dc_org_divisions`; projects, members, pillar status; people / beneficiaries / suppliers masters with SA ID checksum.
3. Helpers (`dc.is_admin`, `dc.role_can`, `dc.my_projects`, `dc.my_orgs`, `dc.has_project_access`, `dc.has_org_access`, `dc.project_role`), RLS on every table, masked people view.
4. RPCs: `dc_my_context`, `dc_search_orgs`, `dc_create_org`, `dc_list_users`, `dc_user_names`, `dc_create_project` (wizard), `dc_project_dashboard`.
5. App: login (password, magic link, reset), org switcher, admin area, project list, wizard, dashboard.
6. Gate 1: role tests in `supabase/tests/dc_gate_tests.sql`.

### Phase 2 – Capture engine
1. 10 capture tables (8 pillars + financial history + SDL months) with standard columns, check constraints, indexes, `dc.capture_guard`, `dc.validate_row`, touch + audit triggers, RLS with lock checks.
2. `dc_list_rows`, `dc_copy_forward`, `dc_confirm_rows`, `dc_import_commit` (one transaction, valid-only or all-or-nothing).
3. Edge Functions `dc-import` (parse, auto-map incl. legacy labels, validate, create masters, commit) and `dc-export` (XLSX per pillar / all pillars / samples, and templates with dropdowns).
4. App: generic pillar page (virtualised grid, column groups, sticky columns, sort, filters, column chooser, selection), side-panel form (React Hook Form + Zod from metadata), master pickers, financial single-record page with mini grids, import dialog, CSV/XLSX export, delete with typed confirmation.
5. Gate 2: DB tests + Vitest + Playwright spec + `seed.sql` demo project.

### Phase 3 – Evidence and verification
1. Evidence tables, checklist, queries, import jobs; private buckets with path-based storage RLS.
2. Guards: only verify roles accept/reject evidence and checklist items, raise/close queries; capture roles answer.
3. RPCs: sampling (manual + random), verification status, row locks, pillar locks, raise query.
4. App: evidence panel (drag-and-drop, preview, signed links), checklist page, samples page, queries tab, history tab/page.
5. Gate 3: DB tests + Playwright spec for the full cycle.
