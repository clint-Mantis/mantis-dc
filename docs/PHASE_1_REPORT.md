# Phase 1 report – Foundation

## Built
- Config tables, seeded from `supabase/spec/fields.mjs`: 8 pillars, 8 sector codes, 1 product, 79 lookup values in 11 lists, 142 field definitions, 94 visibility/required rules, 20 evidence templates.
- Tenancy on top of Mantis Hub: `dc_admins`, `dc_profiles`, `dc_memberships` (consultant / client editor / client viewer per organisation), `dc_project_members` (incl. verifiers), `dc_org_divisions`.
- Projects with derived measurement period and label, pillar status rows, evidence checklist generated from templates, financial records pre-created.
- Masters: people (SA ID checksum unless foreign national; unique ID per organisation), beneficiaries, suppliers (unique vendor number per organisation).
- RLS on every DC table through `dc.my_projects(cap)` / `dc.my_orgs(cap)`; masked people view for viewers; generic audit trigger.
- App: login (password, magic link, password reset), organisation switcher (members see their orgs; staff/admins search all Hub orgs), project list with evidence progress, 6-step wizard, project dashboard, admin area (users & memberships, invitations, divisions, sector codes & products, lookups, read-only field metadata and rules, evidence templates), profile page.

## Gate 1 – result
`supabase/tests/dc_gate_tests.sql`, Gate 1 section: every role's read/write rights and cross-organisation isolation – **all passing** on Postgres 17 with the Hub stub (88/88 for the whole file). The same file runs against the live database (it always rolls back).

## Deferred / known issues
- Field metadata is read-only in the admin area (as allowed by the prompt); edit `fields.mjs` and add a migration.
- Supabase Auth redirect URLs must include the GitHub Pages address (manual setting).
