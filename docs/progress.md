# Progress — feature increments (guide-product-work)

One row per increment of `docs/decisions.md` section 2. Status is `pending`, `prepared`, `observed` or
`verified`; `verified` only after the operator's run, the inspection and the acceptance comparison.

| ID | Increment | Depends on | Status | Run / request id | Checkpoint | Expected vs actual | Operator observation | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Readiness | — | pending | | validator JSON | | | |
| T2 | Appraisal transform and appraisal-only pilot | T1 | pending | | Restate UI, pilot run record | | | |
| T3 | Official identity baseline | T1 | pending | | run record | | | |
| T4 | Permit profile, permit pilot and feasibility | T2, T3 | pending | | fixtures, run record | | | |
| T5 | Full run, reconciliation and signals | T4 | pending | | run record | | | |
| T6 | Publication, run 1 | T5 | pending | | gateway checks, Atlas PR | | | |
| T7 | Hosted query layer | T6 | pending | | Lambda logs, `/v1/openapi.json` | | | |
| T8 | Explorer | T7 | pending | | CloudFront, S3 | | | |
| T9 | Agent | T7 | pending | | Lambda, Bedrock usage | | | |
| T10 | Incremental refresh (run 2) | T6, T7 | pending | | `/v1/runs`, gateway checks | | | |
