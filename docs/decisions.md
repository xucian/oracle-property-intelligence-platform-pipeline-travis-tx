# Architecture decisions — Travis County, TX pipeline

Fixed on 2026-10-16 before implementation, revised the same day. `README.md` is the spec; this file records
how it is met. Change it only by adding a dated entry at the end; before the PR is marked ready, a dated
closing entry records what was delivered against this plan and what was not. The API shared with the CRM is
in [`api-contract.md`](./api-contract.md).

## 1. Roles and repositories

- The candidate acts as **Oracle** (county onboarding, ingestion, lexicon validation, IPFS publication through
  the kit) and as **builder** (hosted API, MCP, agent, explorer).
- This repository owns ingestion, publication and the hosted query layer. The
  [roofing-crm](https://github.com/prismteam-ai/roofing-crm) only consumes the API and never ingests.

## 2. How the kit is used

- Built with the [soofi-xyz-team-kit](https://github.com/soofi-xyz/soofi-xyz-team-kit) run as its Claude Code
  plugin (kit v0.99.1, commit `99c7bff`). The kit is used as a product: not copied into this repo, not patched.
- Agents: `arceus` (routing), `oracle` (onboarding, ingestion, validation, `elephant-cli` publication),
  `metagross` (hosted layer), `slowking` (self-assessment). Skills: `onboard-county`, `county-discovery`,
  `county-readiness-preflight`, `county-seed-data`, `county-appraisal-onboarding` (as the reference for wiring
  the appraisal source; the capture itself is bulk, see section 3),
  `build-county-transform`, `query-db-loading-matching`, `county-ingest-run`, `bbb-harvest`, `use-oracle`,
  `build-rag-systems` and `build-ai-agents` (the agent), `apply-engineering-guidelines`, `guide-product-work`,
  `evaluate-candidate-*`.
- Work follows `guide-product-work`: feature increments, each run and inspected by the operator before the next.

## 3. Ingestion runtime

- The kit's Oracle runtime (`skills/use-oracle/runtime`, Restate + Postgres, local via Colima) runs **on demand
  for the ingest job only** and is shut down after publication. Oracle carries no standing infrastructure.
- Travis County is a **new county adapter** in that runtime (`adapter`, `seed`, `permit-profile`,
  `query-table`, `validate`, enrichment profile), developed on branch `travis` of a kit checkout pinned at
  `99c7bff`. The Travis files, findings, seed data and the Texas contractor-identity note are **mirrored into
  this repository under `oracle/travis/`** with a script that copies them into a kit checkout, so a reviewer can
  rerun from this PR. The county transform is also offered as a PR to the public
  [elephant-xyz/Counties-trasform-scripts](https://github.com/elephant-xyz/Counties-trasform-scripts) repository,
  as the kit prescribes; its merge depends on that repository's maintainers and this submission does not wait for it.
- **Bulk-first capture.** The kit's default appraisal path captures one appraiser page per parcel. For Travis
  the bulk files are the captured sources: the TCAD appraisal export rows, the TNR parcel layer features, the
  Socrata permit export and the Comptroller file. The adapter's capture step materializes one per-property
  input per parcel from those rows, so the kit's per-property transform, validate and hash flow runs
  unchanged; provenance is the kit's `source_http_request` for the bulk file plus the row locator and fetch
  time. No per-parcel appraiser-page capture unless a required field is absent from every bulk source, and
  then only for the parcels that need it.
- **Pilot gate before the full run.** The first increment takes 1,000 parcels and their permits through
  transform, validate and hash, and records rows per minute per stage. The lexicon permit scope is set from
  those numbers: all permits always go into the query tables; lexicon `permit` records start with building
  permits plus every permit that joins to a parcel, and widen only if the measured throughput allows it before
  the publish deadline.
- No rebuild of Oracle from scratch, no replacement of Restate by Step Functions, no generated records.

## 4. Sources (seed list; `county-discovery` verifies, extends and records the evidence)

Probed from outside the US on 2026-10-15/16 unless noted. **First act of discovery:** switch to US egress and
confirm the TCAD export, the TNR parcel layer and data.texas.gov all answer, before anything else is planned.

| Data | Source | Status |
| --- | --- | --- |
| Permits | City of Austin "Issued Construction Permits", Socrata `3syk-w9eu` on data.austintexas.gov. 2,380,323 rows; 65,392 mention roof, 33,340 of those are building permits (`BP`) spanning 22,401 distinct `tcad_id`; daily updates (latest `applieddate` 2026-10-14). Covers Austin full purpose, its ETJ and several small cities, not unincorporated Travis. `tcad_id` is the TCAD **Geographic ID**. | verified, reachable worldwide |
| Permits, rest of county | Travis County's own development-services permit system (unincorporated areas) and the municipal portals not already inside the Austin feed | to attempt each; a block or absence is a documented limitation per portal |
| Parcels, ownership, year built, deed/sale date | TCAD public exports at traviscad.org/publicinformation: 2026 Certified Appraisal Export (July), 2026 Supplemental Appraisal Roll Exports, Improvement Details 2026, Export Layout zip. Listed as downloads; cost not stated on the page. Both `PROP_ID` and `geo_id` are expected in the roll. | page reachable; the file host returns 403 outside the US (geo-block or paywall: resolve under VPN first) |
| Coordinates | In this order: (1) Travis County TNR parcel layer `gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/FeatureServer/0` (fields include `PROP_ID` and `geo_id`, 1,000 features/request) → centroid per parcel; (2) the county GIS parcel shapefile download if the service blocks bulk paging; (3) the City of Austin parcel layer on its ArcGIS organization or data.austintexas.gov. Secondary for parcels with no geometry: permit `latitude`/`longitude`. **No geocoding, no invented coordinates.** If no source yields parcel centroids under US egress, radius search covers only permit-located parcels and that coverage number is reported as a limitation. | (1) blocked outside the US |
| Business records | Texas Comptroller "Active Franchise Tax Permit Holders", data.texas.gov `9cir-efmm` (~3M rows, filter Travis). Texas SOS is paid → not used, documented. | portal blocked outside the US |
| Contractors | From permit rows: `contractor_full_name`, `contractor_company_name`, `contractor_phone`, address, `contractor_trade`. Texas issues no state roofing license, so identity = normalized company name + phone; printed names are always retained on the permit. Business match = exact unique normalized name against the Comptroller file, whose taxpayer number is the official Texas entity identity and plays the role Sunbiz document numbers play in the kit's Florida path. | derived |
| BBB ratings | bbb.org returns a bot challenge and 403 to scripted access (probed 2026-10-16). Per the kit's `bbb-harvest` rule: one bounded probe, keep the evidence, mark coverage `blocked`, no proxies or challenge evasion, no third-party scrapers. No self-serve registration was found for the official API at developer.bbb.org, so it is not used. BBB fields ship as `null` + `unavailable`. | blocked, documented |

**US egress.** TCAD files, the Travis GIS server and data.texas.gov reject non-US clients. Ingestion runs with US
egress on the operator's machine. This is a geo-restriction on public open-data portals, which the kit's
`onboard-county` intake asks about ("US egress and any login, CAPTCHA, records-request, or custodian constraints")
and `county-discovery` handles ("verify the current egress IP is in the US"); it is not bot or robots.txt evasion.

## 5. Canonical model and reconciliation

- Records are produced as lexicon records by the kit runtime (its `property`, `parcel`, `permit`, `company`,
  `person` and `address` classes as the lexicon defines them) and validated against the live lexicon before hashing.
- Identity: property = TCAD `PROP_ID` (canonical `property_id`); `geo_id` kept as a second key; permit =
  `permit_number`; contractor = normalized (company name, phone); business = taxpayer number; owner =
  (`PROP_ID`, normalized owner name) from the roll.
- **Property ↔ permit link = `geo_id`** (the permits' `tcad_id`), never `PROP_ID`. Permit ↔ contractor link =
  the printed contractor fields. Contractor ↔ business link = exact unique normalized name. No fuzzy link sets
  a public flag.
- Provenance on every record: dataset id, record id as printed, source URL, `fetched_at`, `run_id`, content hash.
- Roofing signals (`is_roofing`, `is_reroof`, `roof_year`, `roof_age_basis`, `status_group`, `open_since`,
  `open_duration_days`, `days_since_expiry`, `owner_absentee`, `owner_out_of_area`) are derived columns in a
  published `roofing_signals` table, computed only from loaded source fields, with the rules in
  `api-contract.md`. Only the strict `is_reroof` tier may move a roof's age; the broad tier feeds the
  open-permit signal.
- A small published `places` table holds, for every distinct situs city and situs ZIP in the roll, the
  centroid of its parcels with coordinates and the parcel count. It is the only way a place name becomes a
  search center; no external geocoder is called.
- At deploy, one DuckDB database file is built from the published tables: every table loaded, plus a
  full-text index over building permits' `description`, `permit_class` and `work_class` that backs
  `/v1/permits/text-search`. The file is stored in S3 beside the Parquet mirror, downloaded once per Lambda
  instance into ephemeral storage (sized to the file, 2 GB) and reused across warm invocations, so queries
  never range-read S3 per request. It is a deployment artifact, not a published one; the Parquet mirror is
  what the browser reads. No provisioned concurrency: the first request after an idle period can take several
  seconds, and the README says so.

## 6. Incremental runs

- Per-source watermarks: Socrata `:updated_at` and `applieddate` window; TCAD supplemental export number;
  GIS layer edit date when available; Comptroller file date.
- Each run writes `runs/<run_id>.json` (timestamps, sources and watermarks, counts, deltas, limitations,
  per-stage timings, per-source throughput with request counts and any throttling or errors seen, CIDs,
  gateway checks), committed to this repo and published. The slow or constrained sources the README asks
  about are read from that record, not estimated.
- Idempotent: re-running the same window changes nothing. Run 2 uses a later permit window (the dataset
  updates daily) plus any new supplemental roll, so it carries real new rows and a new dataset CID. Run 2 is
  started no earlier than 24 hours after run 1's permit watermark, and its delta is confirmed non-zero before
  it publishes.
- Scheduling is on demand from the operator's machine; a cron wrapper is optional and not a substitute for run 2.

## 7. Publication

1. Kit flow: lexicon output → `elephant-cli validate` → `hash` → CAR → `export-tables` → `upload` to Filebase.
   `export-tables` runs with a 128 MB part-size cap (the kit's default is 1 GB; unit syntax per the CLI help) so
   every published object is small enough for public gateways to serve; CAR shards follow the kit's
   5,000-property cap.
2. README packet, every run: `publish/<run_id>/manifest.json` listing every object (query table parts,
   coverage, indexes, sample extracts, directory roots) with `cid` (CIDv1 base32), `name`, `size`, codec
   (`file`/`directory`), `sha256`, optional `origins`, plus a `cars[]` section with `root_cid`, `path`, `size`
   and `sha256` for the CAR exported from each directory root (the CAR is an export, not a separately pinned
   object). Second pin: Pinata **pin-by-CID** of every root after the Filebase upload, which preserves the CIDs
   by construction; each pin is confirmed complete before the gateway checks, and if a pin-by-CID stalls the
   fallback vendor is Storacha with a CAR upload. Pinata's free tier is 1 GB, so a paid month is budgeted if two
   runs exceed it. Retrieval of every listed CID from `ipfs.io` and `dweb.link` with size and digest compared,
   saved as `runs/<run_id>.gateway-checks.json` and run **immediately after run 1**, not before the demo. IPNS optional; if used, record name and resolved
   CID per run and repoint after run 2. Prior CIDs are never mutated. Files over 100 MB go to GitHub Releases.
3. Atlas: open the county-page PR on [elephant-xyz/atlas](https://github.com/elephant-xyz/atlas) as the kit
   prescribes. Its merge depends on the Atlas maintainers, so the README packet above is what this submission
   proves on its own; the PR body links the Atlas PR or records why it could not be opened.

## 8. Hosted layer (us-east-2, TypeScript, one CDK stack, near-zero standing cost)

- S3 mirror of the published tables + CloudFront for the explorer, with CORS that allows `Range` requests so
  DuckDB-WASM can read Parquet directly from the browser. The mirror is a locator, not the identity:
  at deploy, every mirrored object's sha256 is checked against the run's manifest, and the explorer and the API
  show the CID beside anything read from it.
- One Lambda (Node 22, packaged as a container image or with a layer so DuckDB's native binary ships) running
  DuckDB over the deploy-time database file described in section 5, behind an HTTP API: REST `v1`, MCP at `/mcp`
  (stateless JSON, no SSE), `/v1/permits/text-search` and `/v1/agent/chat`. Pay per request, reserved
  concurrency, stage and route throttling as in the contract, no always-on database.
- Agent: Vercel AI SDK + Zod on Bedrock, `ToolLoopAgent` with the `v1` operations as typed tools, including
  `resolve_place` (called first when a question names a city or ZIP) and `search_permit_text`; cites ids and sources; per-request output cap and a CloudWatch alarm on daily usage.
  Model: the US cross-region inference profile `us.anthropic.claude-opus-5-5` (listed in the account's
  inference profiles on 2026-10-16), set through one stack parameter `BEDROCK_MODEL_ID` so it can be switched to
  `us.anthropic.claude-sonnet-5-5` without a code change. The Lambda role is granted `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream` on the profile ARN and on the foundation-model ARNs of every region
  the profile routes to.
- **Retrieval design.** The agent is retrieval-augmented over governed records: structured retrieval
  (radius, roof age, permit status, tenure) through the `v1` query tools, lexical retrieval through the
  full-text permit index, and generation that only reports rows those tools returned, with ids and sources.
  No embedding index is used: the README's example questions are numeric and spatial filters, which
  embeddings cannot evaluate, and the kit's RAG skill counts operational retrieval over records as RAG.
- **Kit-guideline exceptions, recorded.** The chat path calls Bedrock synchronously because the user waits
  for the answer; it has a 30-second timeout, two retries with backoff, bounded concurrency and metrics, which
  is the guideline's documented-sync case. Critical-failure alerting goes to a PagerDuty free-tier service
  through SNS if it can be wired in the hosting increment; otherwise the alarms notify by email and the PR
  records the substitution. Local Lambda emulation for the agent uses `sam local` against the CDK-synthesized
  template, as the kit's RAG skill asks; CDK remains the only IaC.
- Powertools logger, tracer and metrics on the Lambda; secrets in SSM/Secrets Manager; cost-allocation tags.
- Not used: Cloudflare, SAM as IaC, Terraform, browser-held keys.

## 9. Explorer (static React + Vite, TypeScript, on CloudFront)

Run summary and counts by source; run history with every CID; manifest view with links to both public
gateways and a **Verify** action per object that fetches it from `ipfs.io` and from `dweb.link` in the browser
and compares size and sha256 to the manifest, so the IPFS criteria can be exercised live; query panels (center from a place box backed by `/v1/places` or typed coordinates) for radius + roof age, open and stalled roofing permits with contractor and BBB,
owner tenure, absentee and out-of-area owners, and free-text permit search; a DuckDB-WASM SQL box over the
published Parquet (served from the S3 mirror with CORS, CIDs shown); agent chat; MCP endpoint and example call.
Property views show both `property_id` and `geo_id`.

## 10. Quality bar

TypeScript strict, Vitest, ESLint, Prettier, `tsc`, GitHub Actions on the PR. No secrets in git, logs or
video. Real Travis records only; a missing source is a limitation with evidence, never generated data.

## 11. Out of scope

CRM UI and lead workflows (other repo), outbound messaging, waiting for an Atlas or transform-scripts merge,
generated datasets, copying or forking the kit into this repository.

## 12. PR deliverables

Live explorer URL, `API_BASE` and its `/v1/openapi.json`, MCP URL, demo video recorded on the live URLs,
`publish/` manifests and CARs (or Release links), `runs/` with at least two runs and two dataset CIDs,
`docs/intent.md`, `docs/runbook.md` (rerun from a clean clone: kit checkout, `.env.example`, the mirror
script, the ingest and publish commands), `docs/slowking-self-assessment.md`, record counts per table with
source, limitations, a cost table that separates standing cost (S3, CloudFront, CloudWatch) from per-request
cost (Lambda, Bedrock) and shows the ingestion runtime at zero when idle, "how to review in two minutes".

## 13. Contingencies (2026-10-16)

- **Bedrock enablement on the deployment account is pending with AWS** (requested 2026-10-16). Bedrock is
  first needed in the hosting increment. If enablement is still pending then, the agent runs on the Vercel AI
  SDK's Anthropic provider with an API key in Secrets Manager, recorded here as a dated deviation, and moves
  to Bedrock when access arrives.
- **Parcel geometry unavailable under US egress** → coverage limited to permit-located parcels, reported as a
  number, never geocoded.
- **TCAD export behind a paywall** → the TNR parcel layer's attributes become the parcel roll (owner, situs,
  values are published there); year built and deed dates become documented gaps unless another official
  source provides them.
