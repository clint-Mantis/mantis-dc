# Phase 2 report – Capture engine

## Built
- 10 capture tables with the standard verification columns, typed columns (money `numeric(18,2)`, percent `numeric(7,4)` 0–100, counts ≥ 0), cross-field checks (black women % ≤ black %, end ≥ start, payment ≥ invoice), generated `days_to_pay`, indexes on `project_id` and every foreign key.
- `dc.capture_guard` (roles, verification columns, locks, carried-forward confirmation) and `dc.validate_row` (conditional-required rules from metadata, learnership categories B–D, Y.E.S. age 18–35) on every capture table.
- One TypeScript rules engine shared by the form, the import function and the tests; parity with the SQL engine checked on 480 random rows (identical).
- Pillar page: virtualised grid (10 000 rows), column groups, sticky first columns, sort, global + column filters, column chooser saved per user, row selection; side-panel form (React Hook Form + Zod built from metadata) with live visibility and relabelling; people/supplier/beneficiary/division pickers with inline create and edit-everywhere.
- Financial page: single-record form plus prior-year and 12-month SDL mini grids.
- Import (`dc-import`): CSV (comma or semicolon) or XLSX → auto-mapping (labels, keys and legacy labels like "Sharholder Name") → adjustable mapping → per-row/per-column errors → new masters created → commit in one transaction (valid-only or all-or-nothing). Templates per pillar with dropdown lists. SA formats accepted (R 1 234,56; DD/MM/YYYY; Yes/No/Ja/Nee).
- Export (`dc-export`): XLSX per pillar, all pillars as sheets, or samples only, in the same column layout as the import template. CSV export in the browser.
- Copy forward (Ownership, Management Control, Suppliers) with a "confirm" badge until each row is edited or confirmed.
- Demo data: `supabase/seed.sql` (3 shareholders, 10 MC members, 10 suppliers, rows in every other pillar).

## Gate 2 – result
- Database tests (capture, required rules, imports, copy forward): **passing**.
- Vitest: **15/15 passing** (rules engine, Zod schemas, import parsing, SA formats).
- Performance: `dc_list_rows` returns 10 010 supplier rows in ~0.4 s; the dashboard's "rows missing required" for 10 000 rows ~0.8 s.
- Playwright spec `app/e2e/gates.spec.ts` is written for a local Supabase stack with `seed.sql`; it has **not been run** yet (the build environment has no browser or Docker).

## Deferred / known issues
- Deleting a master that is still used is refused (by design); there is no merge tool yet.
- Imports are limited to 20 000 rows per file.
