# Architecture decisions — Travis County, TX pipeline

Fixed on 2026-10-16 before implementation, revised the same day, and corrected the same day after the kit's
`oracle` agent reviewed sections 2–7 and 13 and the API contract against the kit's conventions
([`reviews/2026-10-16-oracle-conventions-review.md`](./reviews/2026-10-16-oracle-conventions-review.md)).
`README.md` is the spec and is never edited; this file records how it is met. Change it only by adding a dated
entry at the end; the one in-place rewrite is that 2026-10-16 correction, applied before anything was built and
itemized in section 14. Before the PR is marked ready, a dated closing entry records what was delivered against
this plan and what was not. The API shared with the CRM is in [`api-contract.md`](./api-contract.md).

## 1. Roles and repositories

- The candidate acts as **Oracle** (county onboarding, ingestion, lexicon validation, IPFS publication through
  the kit) and as **builder** (hosted API, MCP, agent, explorer).
- This repository owns ingestion, publication and the hosted query layer. The
  [roofing-crm](https://github.com/prismteam-ai/roofing-crm) only consumes the API and never ingests.

## 2. How the kit is used

- Built with the [soofi-xyz-team-kit](https://github.com/soofi-xyz/soofi-xyz-team-kit) run as its Claude Code
  plugin (kit v0.99.1, commit `99c7bff`). The kit is used as a product: not copied into this repo, no core
  changes; the Travis county modules live on a kit branch, which is the path the kit prescribes (section 3).
- Agents: `arceus` (routing), `oracle` (onboarding, ingestion, validation, `elephant-cli` publication), `mew`
  (lexicon modeling), `metagross` (hosted layer), `slowking` (self-assessment). Skills: `onboard-county`,
  `county-discovery`, `county-readiness-preflight`, `county-seed-data`, `county-appraisal-onboarding` (as the
  reference for wiring the appraisal source; the capture itself is bulk, see section 3), `county-permit-adapter`,
  `build-county-transform`, `query-db-loading-matching`, `county-ingest-run`, `bbb-harvest`, `use-oracle`,
  `build-rag-systems` and `build-ai-agents` (the agent), `apply-engineering-guidelines`, `guide-product-work`,
  `evaluate-candidate-*`.
- Design reviews before implementation, read-only, by kit agents in this order: `oracle` (kit conventions, done
  2026-10-16), `mew` (lexicon modeling), `alakazam` (retrieval design), `metagross` (hosted layer); `slowking`
  self-assessment after hosting. Each review is recorded under `docs/reviews/` and its corrections are applied
  to this file and to `api-contract.md` before the next review starts.
- Work follows `guide-product-work`: feature increments, each run and inspected by the operator before the
  next. The kit sets **at least four increments as a floor** for a full build, never a target. The kit's product
  catalog has no `iterationGuide` for Oracle, so the capability map is `onboard-county`'s stage order plus the
  README's acceptance criteria; it yields the ten increments below, each a user-visible capability with a stable
  id, its dependencies and one acceptance check. `county-ingest-run`'s numbered run stages (pilot, feasibility
  gate, full run, ramp-up, failure handling, streamed load, redrives, wrap-up) are the procedure inside T2–T5,
  not increments of their own. Progress is kept in `docs/progress.md`, one row per increment (`pending`,
  `prepared`, `observed`, `verified`); for the local-Restate increments the inspection checkpoint is the Restate
  UI and the validator or run-record JSON, and AWS inspection applies from T7.
  1. **T1 Readiness** (`county-discovery`, `county-readiness-preflight`, `county-seed-data`; no dependency):
     `travis-sources.yaml` with every jurisdiction classified, the records requests, the approved exceptions,
     the privacy classification of the permit contact fields and the BBB access request; the seed script and
     its row count. Check: the validator prints `PASS` with `seed_allowed` true.
  2. **T2 Appraisal transform and appraisal-only pilot** (`county-appraisal-onboarding`,
     `build-county-transform`, `county-ingest-run`; after T1): bulk capture materialized per parcel, one parcel
     through `Parcel.process`, field-coverage and validation proof, the ~25-parcel pilot run with the
     `__NONE__` eligibility sentinel (no permit harvest yet) and per-source timings. Check: `elephant-cli
     validate` clean on the pilot `county` group, pilot timings in the run record.
  3. **T3 Official identity baseline** (`onboard-county` stage 6; after T1): the Comptroller file loaded as
     registry candidates under the SOS approved exception; the TDLR and TSBPE licensing snapshot for the
     trade-permit rows that print a license number, or the recorded operator decision to proceed without one
     (Texas issues no roofing license; whether the Socrata export prints a license number is checked in
     discovery). Check: snapshot counts and freshness in the run record; no `PermitFeed` has started.
  4. **T4 Permit profile, permit pilot and feasibility** (`county-permit-adapter`, the
     `query-db-loading-matching` link rules; after T2 and T3): the Socrata harvester, the Travis permit
     profile (status, lifecycle and work-class mappings with fixtures, the `geo_id` link proof), the pilot
     re-run with `__ALL__` to exercise the permit, permit-less and failure paths, then the 1,000-parcel
     feasibility run with the 48-hour projection. Check: fixtures pass; link-method counts and the projection
     in the run record.
  5. **T5 Full run, reconciliation and signals** (`county-ingest-run`, `query-db-loading-matching`, the
     roof-age estimator; after T4): the backpressure-aware full run, Loader watermarks and tombstones,
     roof-age estimates, evidence-state counts, `runs/<run_id>.json`. Check: `seed = ready + dead + invalid`,
     counts per table, limitations listed.
  6. **T6 Publication, run 1** (`use-oracle`; after T5): per group validate → hash → validate CAR →
     export-tables → upload with readback; manifest, second pin, gateway checks, Atlas PR. Check: every root
     fetched from two public gateways with matching digests; the Atlas PR URL recorded.
  7. **T7 Hosted query layer** (`metagross`; after T6): the deploy-time DuckDB from the uploaded tables, the
     Lambda with REST `v1` and MCP. Check: `/v1/openapi.json` equals the contract, one MCP tool call answers,
     Lambda logs inspected.
  8. **T8 Explorer** (after T7): the static explorer with its Verify action and query panels. Check: the
     README demo transcript steps 1–7 on the live URL; CloudFront and S3 inspected.
  9. **T9 Agent** (after T7): the Bedrock agent behind `/v1/agent/chat` with the `v1` tools. Check: the two
     README agent prompts answered with cited ids and CIDs; Lambda and Bedrock usage inspected. Kept separate
     from T8 because it is a different concept with a different inspection point.
  10. **T10 Incremental refresh** (`continuous-ingestion`; after T6, demonstrated after T7): the windowed
      delta capability: change detection per source watermark, tombstones, the stale-snapshot queue, new group
      roots and multi-run history, shown by run 2. Check: a non-zero delta, both runs in `/v1/runs`, the old
      roots fetched again from both gateways.

## 3. Ingestion runtime

- The kit's Oracle runtime (`skills/use-oracle/runtime`; section 15 corrects this bullet: at `99c7bff` the shipped
  runtime is the `elephant-county` CLI, and Restate + Postgres via Colima is a v2 decision) runs **on demand
  for the ingest job only** and is shut down once the run has reached a terminal state under the Restate
  coordinator. Oracle carries no standing infrastructure.
- Travis County is a **new county adapter** in that runtime (`adapter`, `seed`, `permit-profile`,
  `query-table`, `validate`, enrichment profile), developed on branch `travis` of a kit checkout pinned at
  `99c7bff`. The adapter sources, the findings, `skills/use-oracle/runtime/docs/travis-sources.yaml`, the Texas
  contractor-identity note, the seed-producing script and a replay fixture under 1 MB (`fixtures/travis-replay/`,
  with a few-row `seed.csv`) are **mirrored into this repository under `oracle/travis/`** with a script that
  copies them into a kit checkout, so a reviewer can rerun from this PR. The full seed CSV, captures, hashed
  output, CARs and Parquet are never committed, here or in the kit. At `99c7bff` the runtime's `.gitignore`
  does not cover `data/` (`bootstrap-oracle-infra` describes it as ignored, but `git check-ignore` matches
  nothing), so the first commit on the `travis` branch adds `data/` to `skills/use-oracle/runtime/.gitignore`
  and the kit's clean-room gate is the proof; tracked runtime files stay under 512 KiB. The county transform is also offered as a PR to the public
  [elephant-xyz/Counties-trasform-scripts](https://github.com/elephant-xyz/Counties-trasform-scripts) repository,
  as the kit prescribes; its merge depends on that repository's maintainers and this submission does not wait for it.
- **Bulk-first capture.** The kit's default appraisal path captures one appraiser page per parcel. For Travis
  the bulk files are the captured sources: the TCAD appraisal export rows, the TNR parcel layer features, the
  Socrata permit export and the Comptroller file. The adapter's capture step materializes one per-property
  input per parcel from those rows, so the kit's per-property transform, validate and hash flow runs
  unchanged. Provenance is the kit's: every entity carries `source_http_request` describing the bulk-file GET
  that was actually made (method, URL, query; never reconstructed after the fact) and `request_identifier` =
  `PROP_ID` as printed; the row locator and fetch time ride in the run record. For `property_improvement`
  entities the `source_http_request` is the Socrata export GET that was actually made and `request_identifier`
  stays the linked parcel's `PROP_ID`: the seed row's request is the default for every entity of that parcel,
  and the export GET is recorded because it was made, never reconstructed. `travis-sources.yaml` records
  "bulk" as the appraisal access method and the publication rights of the TCAD, Socrata and Comptroller files.
  One parcel is still run through the runtime's `Parcel.process` to prove the per-property flow. No per-parcel
  appraiser-page capture unless a required field is absent from every bulk source, and then only for the
  parcels that need it.
- **Readiness gate.** `county-readiness-preflight` validates `travis-sources.yaml` after discovery and again
  immediately before seed, before the pilot and before the full run. A BLOCKED gate stops seed, pilot and full
  ingest, not preparation. The entries Travis needs to pass are named in sections 4 and 13.
- **Identity baseline, pilot, feasibility, full run.** First the kit's pilot: about 25 representative parcels
  (commercial and residential, with and without permits) through capture, transform, validate, hash and load,
  run appraisal-only with the `__NONE__` eligibility sentinel before any permit harvest, verifying the
  residential-skip and failure paths and recording per-source latency, safe concurrency and failure rate.
  Permits are never harvested before the official identity baseline is loaded (section 2, T3; the kit forbids
  harvesting first or in parallel). With the baseline loaded and the adapter built, the pilot is re-run with
  `__ALL__` to exercise the permit and permit-less paths. Then the feasibility increment: 1,000 parcels and
  their permits through the same stages, recording rows per minute per stage and the projected full-county
  duration against the kit's 48-hour gate. The lexicon `property_improvement` scope is set from those numbers.
  Every permit row is loaded into the internal Query DB for reconciliation, but only a permit that links to a
  parcel can be published at all (an archive is property-rooted), and the hosted API serves exactly the
  published `property_improvement` scope: unlinked and excluded permits appear as counts and limitations,
  never as rows. `property_improvement` records start with building permits that link to a parcel and widen
  only if the measured throughput allows it before the publish deadline. While any permit class is excluded
  the group's availability is typed `supported_partial`, with the excluded classes and their counts in the
  run record.
- No rebuild of Oracle from scratch, no replacement of Restate by Step Functions, no generated records.

## 4. Sources (seed list; `county-discovery` verifies, extends and records the evidence)

Probed from outside the US on 2026-10-15/16 unless noted. **First act of discovery:** switch to US egress and
confirm the TCAD export, the TNR parcel layer and data.texas.gov all answer, before anything else is planned.

| Data | Source | Status |
| --- | --- | --- |
| Permits | City of Austin "Issued Construction Permits", Socrata `3syk-w9eu` on data.austintexas.gov. 2,380,323 rows; 65,392 mention roof, 33,340 of those are building permits (`BP`) spanning 22,401 distinct `tcad_id`; daily updates (latest `applieddate` 2026-10-14). Covers Austin full purpose, its ETJ and several small cities, not unincorporated Travis. `tcad_id` is the TCAD **Geographic ID**. | verified, reachable worldwide |
| Permits, rest of county | Every Travis jurisdiction is enumerated in `travis-sources.yaml`: unincorporated Travis County (its development-services permit system), each municipality, the jurisdictions whose permits are inside the Austin feed (classified `delegated`) and the ETJ handling, each with a classification and a `historical_records` flag; the Austin one-stop is never marked as countywide history. Every `blocked`, `custodian-only` or `manual-only` row carries a complete `records_request` (recipient office, portal URL or email, system and date scope, `api-first` or `records-first`), filed before the full run. A block or absence is reported per jurisdiction with that request on record; a limitation note alone leaves the permit gate BLOCKED. | to enumerate and classify in discovery |
| Parcels, ownership, year built, deed/sale date | TCAD public exports at traviscad.org/publicinformation: 2026 Certified Appraisal Export (July), 2026 Supplemental Appraisal Roll Exports, Improvement Details 2026, Export Layout zip. Listed as downloads; cost not stated on the page. Both `PROP_ID` and `geo_id` are expected in the roll. If the files are paid, the purchase is a human payment decision recorded in the run record (section 13). | page reachable; the file host returns 403 outside the US (geo-block or paywall: resolve under VPN first) |
| Coordinates | In this order: (1) Travis County TNR parcel layer `gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/FeatureServer/0` (fields include `PROP_ID` and `geo_id`, 1,000 features/request) → centroid per parcel; (2) the county GIS parcel shapefile download if the service blocks bulk paging; (3) the City of Austin parcel layer on its ArcGIS organization or data.austintexas.gov. Secondary for parcels with no geometry: permit `latitude`/`longitude`. **No geocoding, no invented coordinates.** If no source yields parcel centroids under US egress, radius search covers only permit-located parcels and that coverage number is reported as a limitation. | (1) blocked outside the US |
| Business records | Texas Comptroller "Active Franchise Tax Permit Holders", data.texas.gov `9cir-efmm` (~3M rows, filter Travis). The Texas SOS is the official corporate registry and is paid: using the Comptroller file instead is recorded in `travis-sources.yaml` as an approved exception, with the SOS purchase as a human payment decision. Comptroller rows load as registry candidates only (section 5). If they are published as a `corporate_registry` group, each company's `source_http_request` is the per-taxpayer detail GET on the Comptroller site, never the bulk file page. The API's `registry_candidates` and `registry_rows_loaded` exist only if that group is published, as a deploy-time derivation over published groups; otherwise both are empty. | portal blocked outside the US |
| Contractors | From permit rows: `contractor_full_name`, `contractor_company_name`, `contractor_phone`, address, `contractor_trade`, kept raw on the `property_improvement` record as **source-name attribution**. They are not identity: the kit treats name, phone and address matches as candidates, excludes phone from identity matching, and writes no `company`, `person` or `license` record and no `property_improvement_has_contractor` edge without an official registry or licensing match. Texas issues no state roofing license (recorded as a gap). The official authorities named in the county profile before permit harvest are the Texas SOS (corporate registry; see the row above), TDLR (electrical and HVAC licenses) and TSBPE (plumbing) for trade permits. A Comptroller exact unique normalized-name hit is a review candidate (`registry_candidates`), never identity. Official identity is null in v1 unless an official record matches. Contractor phone and address are business contact fields printed on the public permit record and are returned as printed; personal phone and email fields are not collected. That privacy classification is recorded in `travis-sources.yaml` as the kit asks and can be reversed before hosting; whether the printed contact fields enter a published record or only the hosted API depends on the open decision in section 5, since `property_improvement` has no property for them. | derived, attribution only |
| BBB ratings | bbb.org returns a bot challenge and 403 to scripted access (probed 2026-10-16 from outside the US, which the kit does not accept as evidence). Per `bbb-harvest`: one bounded probe from the approved AWS US-egress runtime (`operator_machine: false`), keep the evidence, stop on 403, no proxies, challenge evasion or third-party scrapers, and request approved access through the official API at developer.bbb.org; the request (date, scope, recipient) is recorded in the run manifest. Coverage carries `source_access_status: blocked`, `source_access_complete: false`, `incomplete_reason: http_403_source_block`. BBB fields ship as `rating: null`, `status: blocked`. | blocked, access requested |

**US egress.** TCAD files, the Travis GIS server and data.texas.gov reject non-US clients. Ingestion runs with US
egress on the operator's machine. This is a geo-restriction on public open-data portals, which the kit's
`onboard-county` intake asks about ("US egress and any login, CAPTCHA, records-request, or custodian constraints")
and `county-discovery` handles ("verify the current egress IP is in the US"); it is not bot or robots.txt evasion.
BBB is the exception: its probe and any harvest run from the approved AWS runtime, never from the operator's machine.

## 5. Canonical model and reconciliation

- Records are produced as lexicon records by the kit runtime and validated against the live lexicon before
  hashing. Classes: `property`, `parcel`, `address`, `company` and `person` (in v1 these two
  are the roll's owners in the `county` group, never contractors), and **`property_improvement`** for
  permits. The lexicon has no `permit` class: the kit's permit transform emits the `property_improvement` data
  group, whose properties include `permit_number`, `permit_issue_date` and `permit_close_date`. Links:
  `property_has_property_improvement` and `parcel_has_property_improvement`;
  `property_improvement_has_contractor` only from an official identity match (none expected in v1). The API
  calls these records "permits"; that is the product name for `property_improvement` rows.
- Identity: property = TCAD `PROP_ID` **as printed** (the kit's folio / `request_identifier`; a string, never
  normalized, leading zeros preserved; the roll prints an integer, so there are none to strip); `geo_id` kept
  as a second key as printed; permit = `permit_number` as printed; business = Comptroller taxpayer number (a
  registry candidate, not identity); owner = (`PROP_ID`, owner name as printed) from the roll. Contractors have
  **no identity** in v1: the API's `contractor_attribution_key` (hash of the printed company name and phone)
  only groups permits that print the same values and is labelled `source_name_attribution`.
- **Property ↔ permit link on `geo_id`** (the permits' `tcad_id`), never `PROP_ID`. Exact as-printed match
  first. The strip-non-digits comparison is a fallback used only after the Travis permit profile proves it
  one-to-one over the roll (no two `geo_id` values collapse) and records the normalization version; every link
  carries `match_method` (`exact` or `normalized_digits`), `normalization_version` and `confidence`; a permit
  with zero or several candidates, or a malformed `tcad_id` (`invalid_quarantined`, raw value kept), stays
  valid-unlinked (`property_id` null) with an `unlinked_reason` of `no_candidate`, `multiple_candidates` or
  `invalid_quarantined`, each counted. No digits-only value
  is ever a conflict key. Permit ↔ contractor = the printed fields (attribution). Contractor ↔ business =
  registry candidate only. No fuzzy link sets a public flag.
- Provenance on every record: the lexicon `source_http_request` and `request_identifier` (section 3), dataset
  id, record id as printed, `fetched_at`, `run_id`, and the CIDs `export-tables` writes (`record_cid`,
  `property_cid`, `data_group_cid`) plus the group's archive, tables and schema CIDs.
- **Roofing signals are deploy-time derivations, not published objects.** `roof_work_class`, `is_roofing`,
  `is_reroof`, `roof_year`, `roof_age_basis`, `roof_age_confidence`, `status_group`, `open_since`,
  `open_duration_days`, `days_since_expiry`, `owner_absentee` and `owner_out_of_area` are computed at deploy
  into the hosted DuckDB mirror (section 8) from loaded source fields, with the rules in `api-contract.md`.
  Nothing derived is uploaded to IPFS or registered in Atlas.
  - Work classification comes from the Travis permit profile: fixture-tested mappings of exact source terms in
    `description`, `work_class` and `permit_class` to the kit's classes `primary_roof_replacement`,
    `primary_roof_new_construction`, `repair_or_coating`, `accessory_roof`, `other` and `needs_review`,
    versioned as `work_classifier_version`. The regex tiers of the first draft are the seed vocabulary for those
    mappings and live in the profile's fixtures, not in query-time SQL. Unmapped or contradictory text is
    `needs_review`.
  - Roof age is computed by the kit's bundled estimator (`elephant.roof-age-estimate.v1`): the anchor is the
    completion or close date of a completed `primary_roof_replacement` (high confidence), else of a completed
    `primary_roof_new_construction` (medium), else `year_built` (low). Open permits, repairs, coatings and
    accessory roofs never reset age; no date is synthesized, so there is no `issued_date` fallback; quarantined
    or impossible dates are excluded. The estimator's anchor, confidence and caveats (partial history) are
    exposed by the API.
  - Status groups come from the profile's exact mapping of `status_current`. Any unmapped value is
    `needs_review`: excluded from the `open`, `stalled` and `closed` counts and from the open-permit signal,
    and counted under limitations. The status in v1 is the indexed Socrata value with its observation time
    (`status_source: indexed`); live detail refresh of open roofing permits is not done in v1 and is recorded
    in the permit-evidence gap ledger as a limitation of the open-permit lead decision.
  - A blank `completed_date` in the export is `unknown` evidence (a blank listing column is not a confirmed
    empty); a valid date is `confirmed_present`; an impossible date is `invalid_quarantined` with the raw value
    kept. `stalled` therefore means "expired with no completion evidence".
  - Lifecycle status for the estimator is mapped by the profile separately from `status_group`: only `Final`
    maps to `completed` and can anchor; `Withdrawn`, `Cancelled`, `VOID`, `Aborted` and `Expired` map to
    `other`, so a `closed` permit is never read as completed work.
  - The estimator runs twice with the same frozen profile: in Query DB reconciliation (the kit's internal
    lineage) and at deploy over the published fields. The Travis transform does not pass `roofAge` to the
    runner, so no `structure.roof_date` or `roof_age_years` is published, and the two runs' counts must
    reconcile.
  - Per-field evidence-state counts for `completed_date`, `status_current` and `tcad_id` are written to the
    run record and exposed by `/v1/meta`, so the basis of every `stalled` or unlinked row is countable.
  - **Decision on non-lexicon permit fields (decided by the operator on 2026-10-16; `mew` verifies the premise).** The product fields the README
    needs on a permit (`description`, the printed `status_current`, `expires_date`, the printed contractor
    fields, and therefore text search) have no `property_improvement` property: the class carries the permit
    dates, `fee`, `contractor_type`, the owner-builder and disaster flags and the enums `improvement_type`,
    `improvement_action` and `improvement_status`. The transform keeps such fields in `source_payload` as
    lexicon gaps, which `export-tables` does not write. The options, to be decided before T4 is built:
    (i) classify at transform time into the three enums, make the API's `roof_work_class` and `status_group`
    deploy-time projections of them, and list the homeless fields as lexicon gaps the hosted layer cannot
    serve (the README's contractor name and free-text search would then be unmet); (ii) have the deploy-time
    build also read the published archive blocks, if `mew` confirms that `source_payload` survives
    validate → hash into the CAR; (iii) have the deploy-time build re-read the public Socrata export for the
    non-lexicon columns, keyed by `permit_number` and joined to the published `record_cid`, with its own
    `source_http_request` and shown as source-backed but unpublished fields. Decided: (ii) if it holds, else
    (iii); never the Query DB. The `mew` review answers the factual question first, whether `source_payload`
    survives `validate` → `hash` into the archive blocks; T7's deploy-time build then reads the published
    archive (ii) or the public export (iii), and T4's profile fixtures cover both paths.
- A small deploy-time **search-center** table holds, for every distinct situs city and situs ZIP in the roll,
  the centroid of its parcels with coordinates and the parcel count. It is the only way a place name becomes a
  search center; no external geocoder is called. It is not published, and it is not the kit's `places`
  (Overture) data group, which v1 does not produce.
- At deploy, one DuckDB database file is built from the uploaded-with-readback, CID-verified `export-tables` output
  (the roots the Atlas page entry carries; the Atlas merge is not a dependency; never the Query DB): every published table loaded, the derived tables above, plus a full-text index
  over building permits' `description`, `permit_class` and `work_class` that backs `/v1/permits/text-search`
  (which source supplies those non-lexicon columns is the open decision above).
  The file is stored in S3 beside the Parquet mirror, downloaded once per Lambda instance into ephemeral storage
  (sized to the file, 2 GB) and reused across warm invocations, so queries never range-read S3 per request. It
  is a deployment artifact, not a published one; the Parquet mirror is what the browser reads. No provisioned
  concurrency: the first request after an idle period can take several seconds, and the README says so.

## 6. Incremental runs

- Per-source watermarks: Socrata `:updated_at` and `applieddate` window; TCAD supplemental export number;
  GIS layer edit date when available; Comptroller file date.
- Loader state per track (appraisal, permits, registry): a content-aware watermark of `(path, artifact hash)`
  with `mergedCount` and `lastMergedAt`, verified from durable Loader state rather than logs or file counts.
  Dead and invalid tombstones (permits voided or removed in a later Socrata window, parcels dropped from a
  supplemental roll) are consumed in the same merge, with the tombstone, its evidence and terminal reason
  retained and the watermark updated atomically.
- Each run writes `runs/<run_id>.json` (timestamps, sources and watermarks, Loader watermarks and tombstones
  consumed, counts including dead, invalid and retryable with `seed = ready + dead + invalid`, deltas,
  limitations, per-stage timings, per-source throughput with request counts and any throttling or errors seen,
  per-group CIDs, CAR validation counts, upload and readback summaries, gateway checks, CLI commit, lexicon
  manifest URL, kit commit, readiness report), committed to this repo and published. The slow or constrained
  sources the README asks about are read from that record, not estimated.
- Idempotent: re-running the same window changes nothing. Run 2 uses a later permit window (the dataset
  updates daily) plus any new supplemental roll, so it carries real new rows and new archive and tables roots
  for every group that changed. Run 2 is started no earlier than 24 hours after run 1's permit watermark, and
  its delta is confirmed non-zero before it publishes.
- Scheduling is on demand from the operator's machine; a cron wrapper is optional and not a substitute for run 2.
  A newer loaded watermark marks the published groups stale and queues a new immutable snapshot; prior roots are
  never mutated.

## 7. Publication

1. Kit flow per data group (`county` from the appraisal transform, `property_improvement` from the permit
   pipeline; `corporate_registry` only if the Comptroller exception in section 4 is approved): `elephant-cli
   validate <group-dir>` → `hash` (one CAR per county per data group, seed root inside) →
   **`validate <county>-<group>.car`** (the six per-check counts are kept as evidence) →
   `export-tables --atlas-page` with a 128 MB part-size cap (the kit's default is 1 GB; unit syntax per the CLI
   help) so every published object is small enough for public gateways to serve → `upload` of the CAR and of
   the tables directory, each requiring CID-matching readback of its root through a public gateway before
   anything else happens. CAR shards follow the kit's 5,000-property cap.
2. README packet, every run: `publish/<run_id>/manifest.json` listing every kit-eligible object (per group the
   archive root `cid`, the tables root, every table part and the schema CID, plus the manifest itself) with
   `cid` (CIDv1 base32), `name`, `size`, codec (`file`/`directory`), `sha256`, optional `origins`. Coverage is
   expressed as counts inside the manifest (the README's "coverage"); the CountyIndex and CountyTables roots are
   its "indexes"; one property's data-group root CID is its "sample extract". No Query DB export, coverage
   object, overlay or derived table is listed or uploaded. A `cars[]` section lists, per group, the archive CAR
   and `tables.car` with `root_cid`, `group`, `kind` (`archive` or `tables`), `schema_cid`, `block_count`, `car_validation` counts, `path`,
   `size`, `sha256` and `readback_url` (the CAR file is an export of the root, not a separately pinned object).
   The manifest is a README-packet descriptor, pinned so the packet can verify itself; it is never referenced
   from the Atlas page or served as a registry, and consumers read the global Atlas IPNS.
   Second pin: Pinata **pin-by-CID** of every root after the Filebase upload, which preserves the CIDs by
   construction; each pin is confirmed complete before the gateway checks, and if a pin-by-CID stalls the
   fallback vendor is Storacha with a CAR upload. Pinata's free tier is 1 GB, so a paid month is budgeted if two
   runs exceed it. Retrieval of every root from `ipfs.io` and `dweb.link` with size and digest compared; inner
   blocks are reached by path from the root or with `?format=car` on the root, since third-party gateways cannot
   resolve inner blocks by bare CID; multihash digests are compared, not CID strings, when codecs differ. Saved
   as `runs/<run_id>.gateway-checks.json` and run **immediately after run 1**, not before the demo. **No IPNS
   name is minted:** consumers read the global `elephant-atlas` IPNS; after the Atlas merge the run record
   stores that name with its resolved index CID (null before merge), which is what the README's "if IPNS is
   used" clause receives. Prior CIDs are never mutated. CARs are never committed: they ship as GitHub Release
   assets of this repository (the demo packet), referenced by CID from the manifest.
3. Atlas: open the county-page PR on [elephant-xyz/atlas](https://github.com/elephant-xyz/atlas) as the kit
   prescribes. Publication state is reported in the kit's vocabulary: "uploaded with readback", "Atlas PR open /
   merged / not merged", and "published per kit" only once the global IPNS resolves to an index that includes
   Travis and the MCP sync has run. If `gh` write access to `elephant-xyz/atlas` is missing, the access request
   is recorded and the PR is opened when it arrives. The merge depends on the Atlas maintainers, so the README
   packet above is what this submission proves on its own; the PR body links the Atlas PR or records why it
   could not be opened.

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
  `resolve_search_center` (called first when a question names a city or ZIP) and `search_permit_text`; cites ids
  and sources; per-request output cap and a CloudWatch alarm on daily usage.
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

Run summary and counts by source; run history with every group root; manifest view with links to both public
gateways and a **Verify** action per object that fetches it from `ipfs.io` and from `dweb.link` in the browser
and compares size and sha256 to the manifest, so the IPFS criteria can be exercised live; query panels (center
from a place box backed by `/v1/search-centers` or typed coordinates) for radius + roof age, open and stalled
roofing permits with contractor attribution and BBB status, owner tenure, absentee and out-of-area owners, and
free-text permit search; a DuckDB-WASM SQL box over the published Parquet (served from the S3 mirror with CORS,
CIDs shown); agent chat; MCP endpoint and example call. Property views show both `property_id` and `geo_id`.

## 10. Quality bar

TypeScript strict, Vitest, ESLint, Prettier, `tsc`, GitHub Actions on the PR. No secrets in git, logs or
video. Real Travis records only; a missing source is a limitation with evidence, never generated data.

## 11. Out of scope

CRM UI and lead workflows (other repo), outbound messaging, waiting for an Atlas or transform-scripts merge,
generated datasets, copying or forking the kit into this repository.

## 12. PR deliverables

Live explorer URL, `API_BASE` and its `/v1/openapi.json`, MCP URL, demo video recorded on the live URLs,
`publish/` manifests with the CARs attached as Release assets referenced by CID (never committed), `runs/` with
at least two runs and two sets of group root CIDs, `docs/reviews/` (one record per pre-implementation review),
`docs/intent.md`, `docs/runbook.md` (rerun from a clean clone: kit checkout, `.env.example`, the mirror script,
the ingest and publish commands), `docs/slowking-self-assessment.md`, record counts per table with source,
limitations, a cost table that separates standing cost (S3, CloudFront, CloudWatch) from per-request cost
(Lambda, Bedrock) and shows the ingestion runtime at zero when idle, "how to review in two minutes".

## 13. Contingencies (2026-10-16)

- **Bedrock enablement on the deployment account is pending with AWS** (requested 2026-10-16). Bedrock is
  first needed in the hosting increment. If enablement is still pending then, the agent runs on the Vercel AI
  SDK's Anthropic provider with an API key in Secrets Manager, recorded here as a dated deviation, and moves
  to Bedrock when access arrives.
- **Parcel geometry unavailable under US egress** → coverage limited to permit-located parcels, reported as a
  number, never geocoded.
- **TCAD export behind a paywall** → the purchase is a human payment decision, recorded in the run record. If
  it is declined, the TNR parcel layer's attributes become the parcel roll (owner, situs, values are published
  there), and year built and deed dates become documented gaps unless another official source provides them.
  Because GIS features are not the assessed-property population, this path requires an `approved_exceptions`
  entry in `travis-sources.yaml` naming the cause (TCAD paywall or geo-block), the canonical denominator, the
  seed decision, the excluded population (`separately_assessed_without_geometry`) and the coverage effect;
  without it the readiness validator blocks seed, pilot and full ingest.

## 14. 2026-10-16 (later): corrections after the oracle conventions review

Applied in place before implementation; the review and every citation are in
[`reviews/2026-10-16-oracle-conventions-review.md`](./reviews/2026-10-16-oracle-conventions-review.md).

- §5: `permit` class → `property_improvement` with its two parcel/property edges. The API keeps "permit" as
  the product name.
- §5, contract: property ↔ permit link is exact `geo_id` first; digits-only comparison only as a recorded,
  profile-proven fallback with method, version and confidence; `property_id` is `PROP_ID` as printed.
- §4, §5, contract: contractor identity removed. Printed fields are source-name attribution; no company,
  person or license records; Comptroller hits are registry candidates; Texas official authorities named.
- §5, contract: regex roofing tiers → profile-mapped work classes; roof age from the kit's estimator; no
  `issued_date` fallback; unmapped statuses → `needs_review`; blank completion dates are `unknown` evidence.
- §5, §7: `roofing_signals`, the search-center table and coverage are deploy-time artifacts, never published.
- §7, contract: no minted IPNS; the global `elephant-atlas` name and resolved index CID are recorded after merge.
- §3, §7, §12: no seed CSV or CARs in git; replay fixture under 1 MB; CARs as Release assets by CID.
- §7: `validate <county>-<group>.car` and root readback added to the sequence; publication state vocabulary.
- §7, contract: single `dataset_cid` → per-group `{cid, schema, tables}`.
- §3: kit pilot (about 25 parcels) before the 1,000-parcel feasibility increment; readiness validator before each.
- §4: rest-of-county permits enumerated per jurisdiction with `records_request`; BBB access request filed and
  the probe moved to the AWS US-egress runtime; Comptroller-for-SOS recorded as an approved exception.
- §13: GIS-only roll contingency requires an `approved_exceptions` entry.
- §3, §6: bulk-capture provenance rule; Loader watermarks and tombstones in the run record.
- §2: review order recorded; §8, §9: `places` renamed to search centers.
- Second look, same day (`reviews/2026-10-16-oracle-second-look.md`): §2 ten-increment plan (T1–T10) against
  the kit's floor of four, identity baseline before any permit harvest, appraisal-only pilot then `__ALL__`
  re-run, explorer and agent split, incremental refresh named as a capability; §3 the runtime `.gitignore`
  gap and the `property_improvement` provenance; §3, §5, contract: the API serves only the published permit
  scope, unlinked and excluded permits are counts; §4 privacy classification and registry candidates
  conditional on a published group; §5 owners as `company`/`person`, `unlinked_reason`, lifecycle mapping,
  estimator run twice, evidence-state counts, `status_source`, and the decision on non-lexicon permit
  fields (option ii, else iii, decided by the operator the same day; `mew` verifies whether `source_payload`
  survives hashing); §7 `cars[].kind` and the manifest as a packet descriptor.

## 15. 2026-10-16 (evening): v1 cut and runtime correction before implementation

- **Runtime premise corrected.** At `99c7bff` the kit's bundled runtime is the `elephant-county` CLI
  (`skills/use-oracle/runtime/bin/elephant-county.mjs`: `capture-raw`, `ingest`, `reconcile-export`, `replay`)
  over per-county modules `src/counties/<county>/{adapter,seed,query-table,validate,permit-profile,enrichment-profile}.mjs`
  (Duval, Broward and Pinellas ship), plus the AWS Batch track for enrichment. It ships no Restate services, no
  Postgres, no `docker-compose.yml` and no `Parcel.process`; the Restate topology that `county-ingest-run`,
  `county-appraisal-onboarding` and `bootstrap-oracle-infra` describe is one the operator would author with
  `durable-workflow-builder`. Section 3's "Restate + Postgres via Colima" and its `Parcel.process` smoke are
  therefore replaced for v1: Travis is a `src/counties/travis/` module registered in the CLI's adapter map, the
  single-parcel smoke is `elephant-county ingest --live-fetch` on a one-row seed, the pilot is the same command
  on the 25-row seed, and the internal load is `reconcile-export`. The durable Restate topology is a v2
  decision, taken only if the full run's volume needs it. "On demand, no standing infrastructure" still holds:
  the CLI runs and exits.
- **Versions.** The kit has no v1/v2/v3 staging; this is the repo's cut over section 2's increments, chosen so
  v1 is the lowest-hanging end-to-end slice. **v1** = T1 readiness PASS + T2 appraisal-only pilot (about 25
  parcels) through the CLI runtime, the pilot `county` group taken through `validate → hash → validate CAR →
  export-tables`, and, when Filebase keys are available, `upload` with readback, Pinata pin, two-gateway checks
  and `publish/<run_id>/manifest.json`, labelled "pilot scope, uploaded with readback, no Atlas PR". **v2** =
  T3–T7: identity baseline, permit profile and feasibility, full run and reconciliation, run-1 publication with
  the Atlas PR, hosted layer (the first point at which `slowking` can score). **v3** = T8–T10: explorer, agent,
  incremental refresh with run 2 at least 24 hours after run 1, plus BBB from the AWS runtime, the
  `corporate_registry` group if approved, Atlas merge → IPNS → MCP sync.
- **Autonomy, recorded as the operator's explicit instruction.** On 2026-10-16 the operator instructed the
  agent to "proceed autonomously" to deliver v1. Per `guide-product-work` this overrides the stop-per-increment
  rule for the v1 preparation steps; the omitted evidence (the operator's own run and observation of T1 and
  T2) is collected afterwards and recorded in `docs/progress.md` before T3 starts.
  **Restored the same evening:** the operator restored the stop-per-increment rule. The autonomous run is
  limited to T1 plus the safe preparation the readiness skill allows while blocked (adapter scaffold, fixtures,
  profile fixtures, seed script not run). From the T1 hand-off onward the operator runs and inspects each
  increment before the next starts, and the omitted-evidence clause above no longer applies.
- **Egress today.** The operator's egress is outside the US (`ipinfo.io/country` returned `RO`). TCAD, the
  TNR parcel layer and data.texas.gov are unreachable until a US VPN window; the Austin Socrata feed, the
  lexicon manifest, GitHub, Filebase and the public gateways are reachable. Until the window: safe preparation
  only (catalog, records requests, approved exceptions, permit-profile fixtures from Socrata samples, adapter
  scaffold, the runtime `.gitignore` fix, the readiness validator's BLOCKED report); no seeding, no pilot, no
  live fetch of geo-blocked hosts, no BBB from the laptop.
- **Where the Travis module lives.** In a separate worktree of the kit at
  `/Users/luti/dev/ateam/role1-prism/kit-travis` on branch `travis`, because the Claude Code plugin installs
  from the main checkout, which stays at the pin on `main`. The mirror into this repository under
  `oracle/travis/` is unchanged.

## 16. 2026-10-16 (evening): lexicon corrections from the `mew` lookup, and two CRM-side contract fixes

Source: the `mew` agent's read-only lookup against the kit's bundled catalog. The live lexicon MCP tools returned
errors today, so the live manifest confirms each point at T2's first `elephant-cli validate`.

- **Envelope, not lexicon properties.** `source_http_request` and `request_identifier` are the kit's per-entity
  envelope required by `elephant-cli validate` (output-contract.md:31-32), not properties of any class;
  relationships carry only `from` and `to`. Section 5's "the lexicon `source_http_request`" is read that way.
  The kit defines `request_identifier` as the parcel identifier substituted into the request; keeping `PROP_ID`
  on `property_improvement` entities whose request is the bulk Socrata GET is a deliberate deviation so that
  the tables column stays the parcel id. Recorded here as such.
- **The Seed group is mandatory.** The transform also emits `property_seed` (`parcel_id`, `prior_parcel_id`)
  and `unnormalized_address` (with `county_jurisdiction`), linked by the seed relationships; `hash` refuses to
  run without the seed root. Section 5's class list is read as including them.
- **Owners are never "as printed".** `person.first_name` and `last_name` are required and pattern-constrained
  (capitalized), so a roll owner string is case-normalized and split into a `person`, or becomes a `company`
  by a recorded classification rule; the as-printed string and the (`PROP_ID`, printed name) owner key stay in
  `source_payload`. `company.name` has no pattern.
- **Cardinality.** `parcel_has_property_improvement` is single-valued per root; `property_has_property_improvement`
  (one-to-many) is the carrying link for a property's many permits. The transform emits one
  `property_has_property_improvement` per permit and at most one `parcel_has_property_improvement`.
- **`property_id` comes from the archive.** A published `property_improvement` always sits under its property
  root, so a served permit always has `property_id` and `property_link` (the method recorded at transform time);
  `unlinked_reason` exists only as counts on `/v1/meta`. The `geo_id` link is made in the transform and the
  Query DB, never re-made by the hosted layer. `geo_id` has no lexicon home: the transform keeps it in
  `source_payload` on the property and on the permit, so option (ii) covers it; under (iii) the deploy also
  re-reads the TCAD export for it.
- **Identity of published records.** `permit_number` is optional and unpatterned in the lexicon; uniqueness per
  permit is a transform and Query DB invariant, and the published identity is the record CID.
- **Option (i) is dead on the lexicon's own terms.** `improvement_status` has no `Expired` member, so `stalled`
  would be unrecoverable, and `improvement_type: Roofing` or `improvement_action: Replacement` taken from
  description text would publish the classifier's output. The recorded choice, (ii) else (iii), stands. The
  empirical check for (ii) is fixed: hash one pilot property whose `property_improvement.json` carries
  `source_payload`, inspect the canonical block for the key, change one `source_payload` value and confirm the
  record CID changes, and confirm `export-tables` writes no such column.
- **Contractor contact fields.** The group has homes (`company.name`, `communication.phone_number` through
  `company_has_communication`, `person` through `contractor_has_person`); v1 writes none because there is no
  official identity. The gap ledger records this as a policy consequence, not a lexicon gap. `trade`, applicant
  and job valuation have no home.
- **Groups to confirm live.** The bundled catalog has no `corporate_registry` or `places` group, and `company`
  has no taxpayer-number property (only `sunbiz_document_number`); the Comptroller rows therefore stay Query DB
  candidates unless the live manifest provides a home.
- **CRM-side contract fixes** (reported through the roofing-crm agents): `API_BASE` is recorded in
  `docs/runbook.md` and the PR body after deploy, never in README.md; and the MCP endpoint enforces the same
  per-operation limits as the REST routes inside its handler, so `search_permit_text` cannot bypass the
  text-search throttle.
- **Publication credentials.** Filebase and Pinata credentials exist in the operator's git-ignored `.env`
  (variable names only: `FILEBASE_ACCESS_TOKEN`, `FILEBASE_SECRET_KEY`, `PINATA_API_KEY`, `PINATA_API_SECRET`,
  `PINATA_JWT_SECRET_ACCESS_TOKEN`). The kit's CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and
  `FILEBASE_BUCKET`, so the runbook maps the token variable onto the key variable and the bucket name is added
  before the first upload. The v1 pilot upload is therefore possible as soon as the US egress window has
  produced the pilot.

## 17. 2026-10-16 (night): T1 preparation results and two recorded changes

- **Hand-off at T1** (the restoration of stop-per-increment is recorded in section 15). This run
  ends with T1 handed to the operator (`docs/progress.md`: T1 `prepared`, T2 `pending`); everything
  beyond T1 that was built is the safe preparation `county-readiness-preflight` allows while the
  validator is BLOCKED and is labelled "preparation, not T2". No seed, smoke, pilot or
  `ingest --live-fetch` has run.
- **Section 5, non-lexicon permit fields: option (ii) is dead at `validate`.** Every live class
  schema is `additionalProperties: false` without `source_payload`, and `elephant-cli validate`
  1.58.1 (commit `44bb182`) rejects `source_payload` on a `property` entity (kit evidence
  `docs/evidence/travis-fixture-validate-2026-10-16.*`). The transform keeps lexicon-gap fields in a
  per-parcel sidecar outside the archive; the hosted layer takes option (iii) (re-read the public
  exports for the non-lexicon columns, keyed by `permit_number` and `PROP_ID`, with their own
  provenance). Section 16's `geo_id` note follows: the deploy re-reads the TCAD export for it.
- **Lexicon county enum (new blocker for T2).** `unnormalized_address.county_jurisdiction` (required)
  and `address.county_name` are enumerated and lack `Travis`; every Travis property fails
  `validate` on exactly that error until the enum is extended. The request is drafted in the kit
  (`docs/travis-lexicon-county-enum-request.md`); opening the pull request on
  `elephant-xyz/lexicon` is an operator action and precedes any hash or upload.
- **Austin permits carry no license number** (78 export columns, none license-related) and Texas
  issues no roofing license, so the DBPR-style official lookup has no key in v1/v2; contractor
  fields stay source-name attribution, as section 4 already states. `:updated_at` is the daily
  publish time on every Socrata row, so incremental runs watermark on row content and the
  `statusdate`/`applieddate` windows, not on `:updated_at` (section 6 reads that way).
- **Elephant CLI** is installed project-locally in this repository (`package.json` devDependency,
  `github:elephant-xyz/elephant-cli#main` resolved to 1.58.1 / `44bb182b9f7f904662e9b33e1fde70bdeab62322`).

## 18. 2026-10-16 (night): the lexicon merge is a hard dependency

- Unlike the Atlas merge (section 7) and the transform-scripts merge (section 11), the Travis county-enum change
  in `elephant-xyz/lexicon` gates the first step, `elephant-cli validate`, because `unnormalized_address`
  is required in the Seed group of every archive. Without it no Travis record validates, so nothing is hashed,
  published, hosted or demonstrated; section 11's "waiting for a merge is out of scope" does not cover it.
- The kit has no lexicon step in county onboarding, so its readiness validator can PASS for a county the enum
  lacks; that is a kit gap worth reporting. Upstream, adding a county is a routine small pull request (Ellis
  #171, Hunt #115, Dallas #148), merged the same day by the maintainers.
- Since `elephant-xyz/lexicon` #189 (merged 2026-10-16) the repository pins the SHA-256 and source revision of
  `src/data/lexicon.json` in `scripts/build-model-composition.mjs`, so any lexicon edit also needs the Model
  composition rebuilt, and the revision must name the merge commit. Whether county additions now go through a
  governed Model release instead of a direct edit is a question for the maintainers.
- Route: a pull request from the operator's fork, carrying the change exactly as Ellis did and asking the
  maintainers which composition route they want. It is the operator's decision; T1 to T2 preparation and every
  increment's code and fixtures continue meanwhile, and validation is re-run when the published manifest
  includes Travis.

