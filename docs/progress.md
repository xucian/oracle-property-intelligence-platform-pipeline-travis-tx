# Progress — feature increments (guide-product-work)

One row per increment of `docs/decisions.md` section 2. Status is `pending`, `prepared`, `observed` or
`verified`; `verified` only after the operator's run, the inspection and the acceptance comparison.
Versions (decisions.md section 15): v1 = T1–T2 plus the pilot upload; v2 = T3–T7; v3 = T8–T10.
Stop-per-increment is in force again (decisions.md section 17): T1 is handed to the operator; the
work listed under T2 is **preparation, not T2**, allowed while the readiness validator is BLOCKED.

| ID | Increment | Depends on | Status | Run / request id | Checkpoint | Expected vs actual | Operator observation | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Readiness | — | observed (blocked part) | `travis-v1-pilot` (job id reserved) | kit `skills/use-oracle/runtime/docs/travis-readiness-2026-10-16.json`; `travis-sources.yaml`; `travis-county-findings.md` | Expected today: `BLOCKED` on the parcel gate only (TCAD/TNR counts pending the US egress window); permit `PASS` 23/23, destination `NOT_APPLICABLE`, enrichment `PASS`. Actual: as expected (validator exit 1). | 2026-10-16 evening: operator ran the validator from the kit worktree; output `overall: BLOCKED`, `seed_allowed: false`, `execution_allowed: false`; gates catalog_metadata PASS, parcel BLOCKED (assessed count missing, owner county-discovery), permit PASS 23/23, destination NOT_APPLICABLE, enrichment PASS. Matches the expected blocked state. Not yet `verified`: the acceptance check is PASS with `seed_allowed: true`. | Operator: switch on the US VPN and say so. Agent, under that egress: TCAD page and export (stop for a payment decision if the file is paid), TNR feature count and centroids, Comptroller row count, `build-seed.mjs`, counts into `travis-sources.yaml`, commit. Operator: re-run the validator, expect PASS → `verified`. Separately (T2 critical path): the lexicon county-enum PR from a fork, which the operator opens or authorizes; precedent PRs for Ellis, Hunt and Dallas merged the same day. |
| T2 | Appraisal transform and appraisal-only pilot | T1 | pending | — | preparation only: kit branch `travis` adapter scaffold, transform with the Seed group, `fixtures/travis-replay`, `elephant-county replay --county travis` green, `npm test` green (51 files, 445 tests); live `elephant-cli validate` on the fixture output fails only on the county enum (kit `docs/evidence/travis-fixture-validate-2026-10-16.txt`) | not started: no seed, smoke, pilot or `ingest --live-fetch` has run | — | blocked until T1 PASS, the operator's go-ahead and the lexicon enum merge; then runbook section 3 |
| T3 | Official identity baseline | T1 | pending | | run record | | | |
| T4 | Permit profile, permit pilot and feasibility | T2, T3 | pending | | fixtures, run record | preparation only: `src/counties/travis/permit-profile.mjs` with fixtures (status groups, lifecycle, work classes, date and `tcad_id` evidence, digits-only proof, roof-age profile) | | |
| T5 | Full run, reconciliation and signals | T4 | pending | | run record | | | |
| T6 | Publication, run 1 | T5 | pending | | gateway checks, Atlas PR | | | |
| T7 | Hosted query layer | T6 | pending | | Lambda logs, `/v1/openapi.json` | | | |
| T8 | Explorer | T7 | pending | | CloudFront, S3 | | | |
| T9 | Agent | T7 | pending | | Lambda, Bedrock usage | | | |
| T10 | Incremental refresh (run 2) | T6, T7 | pending | | `/v1/runs`, gateway checks | | | |
