# Open questions and assumptions

Each item notes the default that was built, so nothing is blocked. Please confirm or correct.

## Data model / B-BBEE rules
1. **Sector-specific Skills Development overrides** (Construction, Finance, ICT, Property, AgriBEE, Defence, MAC). Placeholder rules exist in `dc_field_rules` (note "TODO verify per sector code") and change nothing yet. *Need:* the field differences per sector code.
2. **"Learnership category subset" for `sd_learners`.** Built: learners hide ancillary cost, office based, core & critical skills, management level and unemployed/student; learning category must be B, C or D. *Confirm* the exact field list.
3. **ESD/SED benefit factors and contribution multipliers** (`meta.benefit_factor`, `meta.multiplier`). Left empty on purpose rather than guessed; they only matter for the later scorecard calculation. Fill them in Admin › Lookups › Meta.
4. **Procurement exclusion reasons.** Seeded a placeholder list (imports with no local capacity, taxes and levies, salaries, empowerment-related, public entities, other). *Need:* the official list you use.
5. **Evidence checklist templates.** Seeded 20 generic items across the pillars (editable in Admin › Evidence templates). *Confirm* wording and which are required; add sector-specific ones if needed.
6. **Ownership fields by category.** Only `black_pct` is restricted to organisations (as specified). Should the other "% owned by…" fields also be organisation-only, and the Yes/No flags individual-only?
7. **SA ID vs passport.** The ID checksum is enforced unless the person's nationality is "Foreign National". OK?
8. **Y.E.S. age** is derived from the SA ID number at the start date (or the period start if no start date). People without an SA ID are not age-checked.

## Access
9. **Mantis staff.** Any active Mantis Hub staff member can search all organisations, create organisations and create projects (and becomes consultant on projects they create). Only Hub **super admins** (and users in `dc_admins`) are DC admins. *Confirm*, or restrict project creation to consultants only.
10. **Viewers and evidence.** Client viewers can see the evidence list and statuses but cannot open files (files may contain ID copies or payslips). *Confirm.*
11. **New divisions during import.** Creating a division needs consultant rights, so a client editor's import that mentions a new division fails with a clear error. Alternative: let editors create divisions.
12. **Verifier organisations.** Verifiers are added per project (as specified). Should verification agencies also be Hub organisations (`org_type = verification_agency`) with their staff listed there?

## Product / hosting
13. **Products.** DC has its own small `dc_products` table (seeded "DTi Generic Calculator Package") instead of using Hub's `products` catalogue, to avoid adding rows to the licensing catalogue. Link them later if useful.
14. **Public repository.** `clint-Mantis/mantis-dc` is public (like `mantis-hub`). It holds no secrets and access is enforced in the database, but the schema and rules are visible. Make it private if that matters (GitHub Pages on a private repo needs a paid plan).
15. **Legacy data migration** and **scorecard calculation** are out of scope (Phases 4+). The schema leaves room for both: carried-forward/import sources, `import_jobs`, lookups' `meta` for factors.

## Decided
16. **Hub contacts for DC users** (23 Nov 2026): adding a client editor/viewer to an organisation creates or links their Mantis Hub contact and links it to their login, so the same login opens the Hub client portal. A contact who already exists in Hub under another organisation is linked where it is (Hub allows one contact per email) – move it in Hub if needed.
