# Phase 3 report – Evidence and verification

## Built
- `dc_evidence_files` (project / pillar / row / checklist item), `dc_evidence_checklist_items`, `dc_record_queries`, `dc_import_jobs`.
- Private buckets `dc-evidence` (25 MB; PDF, images, Excel/CSV, Word, ZIP) and `dc-imports`; storage RLS parses the project ID from the path and uses the same access helpers. Files open through signed links that expire after 10 minutes.
- Guards: only verifiers/consultants accept or reject evidence and checklist items, raise and close queries, sample and verify rows; client editors answer queries. Linking a file to a checklist item marks it "uploaded".
- RPCs for sampling (selected or random n per pillar), verification status, row locks and pillar locks; raising a query marks the row "queried".
- App: evidence panel (drag-and-drop, PDF/image preview, download, accept/reject with note), evidence checklist page, samples page across pillars, queries tab in the row panel, history tab per row and a project history page (who changed which field from what to what).
- POPIA: ID numbers and salaries are never written to the audit log; viewers can't open evidence files.

## Gate 3 – result
- Database tests for the full cycle (sample → query → answer → close → verify → lock, evidence accept/reject, storage isolation, audit): **passing**.
- Playwright full-cycle spec written, **not run yet** (see Phase 2).

## Deferred / known issues
- No email notifications for new queries yet (Mantis Hub's mail outbox could be reused).
- Evidence files are not virus-scanned.
