# AGENTS.md

This repo is a candidate assignment for Prism. The README is the user story; its Acceptance Criteria and Demo Transcript are the spec. The deliverable is this pull request, marked Ready for review, with a public hosted runtime and a short demo video of the working solution.

## Precedence
1. The README.
2. The soofi-xyz-team-kit skills, `apply-engineering-guidelines` and `guide-product-work` above all.
3. This file: decisions and county facts only. If it conflicts with 1 or 2, it is wrong.

## How work is done here
- Thin end-to-end slices. Each increment is a usable capability deployed to the real runtime, then I run it and inspect AWS before the next one. Later pieces are not prebuilt.
- Mocks and fixtures are preparation. They are never presented as working, and the final demo runs on real Travis County data at full scale.
- Real data only. No source field is ever generated (year built, permit dates, owner names). A missing source is a documented limitation with evidence.
- Blocked or slow sources: measure, document, back off. Do not change egress, proxies or browser fingerprints to evade a block. US egress is fine if a portal is geo-restricted.
- Each pipeline run writes a run record: timestamp, sources, counts, deltas, limitations. Published artifacts get new CIDs; earlier CIDs are never mutated.
- Standing infrastructure cost near zero: static hosting, Lambda on demand, S3. No always-on database.

## Stack decisions
TypeScript. CDK, us-east-2. Model calls through the Vercel AI SDK on Bedrock. External calls behind queues. Powertools logging. DuckDB for the query layer, Parquet on S3 and IPFS (CIDv1, CAR per directory root, manifest with cid, name, size, codec, sha256).

## Travis County sources (pipeline)
- Parcels, owner name, coordinates: Travis County TNR layer `gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/FeatureServer/0` (GeoJSON, 1,000 per request).
- Appraisal roll (year built, values, deed data): TCAD public export, traviscad.org/publicinformation (fixed-width; layout PDF on the site).
- Permits: City of Austin "Issued Construction Permits", Socrata `3syk-w9eu` on data.austintexas.gov (CSV/JSON bulk). City only; the rest of the county is a documented gap unless another source is found.
- BBB: no API. `bbb-harvest` only for contractors seen in permits, within its rules; otherwise documented as unavailable.
- Business records: Texas SOS is paid. Documented limitation.

## CRM
Consumes the pipeline's REST/MCP API; no ingestion here. Map with pin/GPS and radius, aged-roof and open-permit filters, property and permit details, lead CRUD, an agent using the pipeline tools, greyed-out future sections.

## PR description must include
Live URLs; "how to review in 2 minutes"; a table of record counts per table with source; a criterion-to-screen table; limitations; monthly cost; a link to `docs/slowking-self-assessment.md`.
