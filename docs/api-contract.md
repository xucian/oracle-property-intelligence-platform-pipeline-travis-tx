# Travis County property intelligence API — contract v1

This is the hosted query surface that the explorer, the pipeline agent, the MCP server and the
[roofing-crm](https://github.com/prismteam-ai/roofing-crm) consume. It is the only coupling between
the two repositories. Changes to v1 are additive only (new optional params, new nullable fields).
Anything else is v2.

Vocabulary: the API says "permit" for what the lexicon stores as a `property_improvement` record, and it
never asserts contractor identity (see `contractor_attribution_key`). Names that come from the kit
(`request_identifier`, `source_http_request`, `roof_work_class`, the evidence states, the availability types,
the group CIDs) keep the kit's spelling so that a reader of the Atlas tables and of this API sees one vocabulary.

## Transport

- HTTPS, JSON, UTF-8. No authentication. CORS `*`.
- Base URL: recorded in `docs/runbook.md` and the PR body after deploy as `API_BASE` (README.md is the
  assignment text and is never edited). OpenAPI 3.1 served at `GET /v1/openapi.json` and kept identical to this file.
- MCP (Streamable HTTP, stateless JSON responses, no SSE) at `POST /mcp`, exposing the same operations as
  tools (see "MCP tools").
- Throttling is per API stage, shared by all clients: 20 requests/s steady, burst 40. Route throttles:
  `/v1/agent/chat` 1 request/s, burst 3; `/v1/permits/text-search` 5 requests/s, burst 10. Chat output is
  capped per request (1,500 output tokens) and a CloudWatch alarm watches daily chat invocations and token
  usage. Over limit → `429`; the body is API Gateway's own throttling message and a `Retry-After` header may be
  absent, so clients back off on the status code alone (1 s, then 2 s, then 4 s). Tool calls the pipeline's own
  agent makes inside its Lambda do not pass through the HTTP API; the CRM's agent calls over HTTP and must
  back off on `429` like any client.
- The MCP endpoint is a single route, so the Lambda enforces the same per-operation limits inside the MCP
  handler: `search_permit_text` 5 requests/s, burst 10; the other tools at the stage rate. Over limit the tool
  returns a JSON-RPC error carrying `retry_after_seconds`, and the client backs off as for `429`.
- Errors: `400 {error, detail}` for invalid params, `404 {error}` for unknown ids, `429`, `5xx {error, request_id}`.
- Path ids are URL-encoded; `permit_id` contains a space (`2026-102216%20EP`).

## Shared definitions

| Term | Definition |
| --- | --- |
| `property_id` | TCAD **Property ID** (`PROP_ID`) exactly as the roll prints it: a string, never normalized, leading zeros preserved (the roll and the GIS layer print an integer, so none are expected). It is the lexicon `parcel_identifier` and the kit's `request_identifier` for the parcel. |
| `geo_id` | TCAD **Geographic ID** (`geo_id`, string, e.g. `0222210299`), kept exactly as printed. Austin permits carry it as `tcad_id`; **permits link to properties on `geo_id`**, never on `property_id`. The link compares the printed values exactly first. Comparing with every non-digit character removed is a fallback that is enabled only after the Travis permit profile has proven that normalization one-to-one over the roll (no two `geo_id` values collapse) and recorded its version. Every served permit states how its link was made (`property_link`). A permit with zero or several candidate parcels stays valid-unlinked in the Query DB, is never published or served, and is counted under `/v1/meta.unlinked_reasons`. |
| `permit_id` | Austin permit number as printed (the lexicon `permit_number`), e.g. `2026-102216 EP`. |
| `contractor_attribution_key` | Pipeline-assigned grouping key: hash of the printed company name and phone. It groups permits that print the same values; it is **not** an identity, and phone never feeds identity. Every contractor object carries `identity_status: "source_name_attribution"`; `official_identity` is null until an official registry or licensing record matches, which v1 does not attempt. |
| `run_id` | Pipeline run id, `YYYYMMDDTHHMMSSZ`. |
| Distances | Miles, great-circle. Coordinates WGS84 `lat`, `lon`. |
| Dates | ISO-8601. Date-only where the source is date-only. |
| `source` | `{dataset, record_id, url, fetched_at, run_id, request_identifier, source_http_request}` on every record. `record_id` is the id as printed by the source. `request_identifier` and `source_http_request` (`{method, url, multiValueQueryString}`: the request that actually fetched the bulk file or page, never reconstructed) are the lexicon provenance fields. |
| CIDs on records | `record_cid` = CID of the record's own lexicon block; `property_cid` = CID of the property's root; `data_group_cid` = CID of the data-group root for that property. `record_cid` is the tables' `cid` column renamed (the old `cid` meant the table's CID); `property_cid` and `data_group_cid` are the columns `elephant-cli export-tables` writes beside it, with `request_identifier`. Group-level CIDs (`cid` = archive root, `schema`, `tables`) live on the run under `groups` and are not repeated per record. |
| `roof_work_class` | The Travis permit profile's fixture-tested mapping of exact source terms in `description`, `work_class` and `permit_class` to one of `primary_roof_replacement`, `primary_roof_new_construction`, `repair_or_coating`, `accessory_roof`, `other`, `needs_review`; `work_classifier_version` names the profile version. No regex is applied at query time. Unmapped or contradictory text is `needs_review`. Trade permits (`EP`, `MP`, `PP`) are `other`. |
| Roofing permit | `is_roofing` = `roof_work_class` in {`primary_roof_replacement`, `primary_roof_new_construction`, `repair_or_coating`, `accessory_roof`}. Drives the open/stalled permit signal and the counts. `needs_review` rows are neither roofing nor not: they are excluded from the signal and counted separately. |
| Re-roof permit | `is_reroof` = `roof_work_class = primary_roof_replacement`. The only class that may reset a roof's age. |
| Roof age | Computed by the kit's estimator (`elephant.roof-age-estimate.v1`). Anchor: the `completed_date` or close date of the latest completed `primary_roof_replacement` → `roof_age_basis = completed_replacement`, `roof_age_confidence = high`; else of a completed `primary_roof_new_construction` → `new_construction`, `medium`; else `year_built` → `year_built`, `low`; else `null`, `none` (these `roof_age_basis` values are the API's names for the estimator's eligibility reason codes; the mapping is fixed in the profile fixtures). Open permits, repairs, coatings and accessory roofs never reset age. No date is synthesized: a permit without a valid completion or close date is not an anchor whatever its status, and `issued_date` is never used. `roof_year` = year of the anchor; `roof_age_years` = year of `roof_age_as_of` − `roof_year`. `roof_age_anchor` = `{permit_id, date, date_field}` for a permit anchor, `{source_field: "year_built"}` for the built-year fallback, or null; `roof_age_caveats[]` carries the estimator's codes (for example `partial_history`). |
| Age threshold | "Older than N years" is **strict**: a property matches when `roof_age_years > roof_age_min`. |
| Status group | From the profile's exact mapping of `status_current`: `open` = `Active`, `Pending Permit`, `On Hold`, `Re Review`, `Suspended`, `Inactive Pending Revision`. `stalled` = `Expired` with `completed_date_evidence` other than `confirmed_present`. `closed` = `Final`, `Withdrawn`, the exact `Cancelled …` values the export prints (enumerated in the profile fixtures), `VOID`, `Aborted`, and `Expired` with a confirmed `completed_date`. **`needs_review`** = any value outside the mapping. `needs_review` rows are excluded from the `open`, `stalled` and `closed` counts and from the open-permit signal; their count is `/v1/meta.counts.permits_needs_review` and the values are listed under `limitations`. The profile maps lifecycle status for the roof-age estimator separately: only `Final` is `completed`; `Withdrawn`, `Cancelled`, `VOID`, `Aborted` and `Expired` are `other`, so `closed` never reads as completed work. |
| Status source | `status_observed_at` = the source's `:updated_at` for the row, else `fetched_at`. `status_source` = `indexed` (the Socrata export) or `live` (the permit's public page); it names where the value was observed and is not one of the kit's evidence states. v1 serves `indexed` only; live refresh of open roofing permits is a listed limitation. |
| `completed_date_evidence` | `confirmed_present` (a valid date in the export), `unknown` (blank in the export: a blank listing column is not a confirmed empty), `invalid_quarantined` (an impossible or malformed date; the raw value stays in `source`), `confirmed_empty` (only after a detail lookup, never in v1), `unavailable`, `stale`, `conflicting`: the kit's seven-state vocabulary, of which `stale` and `conflicting` are unused while v1 serves indexed values only. |
| `open_since` | `issued_date`, else `applied_date`; `open_since_basis` says which. |
| `open_duration_days` | `open`: today − `open_since` (`open_duration_basis: today`). `stalled`: `expires_date` − `open_since` (`expires_date`), or `statusdate` − `open_since` when `expires_date` is missing (`statusdate`): how long it stayed open before lapsing. `closed` and `needs_review`: `null`. |
| `days_since_expiry` | `stalled` only: today − `expires_date`; `null` otherwise. |
| Long-open | `open_duration_days ≥ long_open_years × 365`, default 5 years. |
| Owner tenure | `owner_tenure_years` from the deed/sale date in the appraisal export when present, else `null`. |
| Absentee owner | `owner_absentee` = normalized mailing address ≠ normalized situs address, when the roll has both, else `null`. |
| Out-of-area owner | `owner_out_of_area` = mailing state ≠ `TX`, or mailing ZIP not in the set of situs ZIPs present in the roll; `null` when the roll lacks mailing fields. |
| BBB | `bbb` = `{rating, status, incomplete_reason, note}`, always present. `status` = `blocked` while source access is blocked (`incomplete_reason: http_403_source_block`, evidence under `limitations`); `unavailable` when the source was reachable but has no profile for the contractor; `available` with a `rating` otherwise. `rating` is `null` unless `available`. |
| Search center | A named search center derived from the loaded roll, never from an external geocoder: for each distinct situs city and each situs ZIP, the centroid of its parcels with coordinates and the parcel count. "Austin" resolves to the Austin situs-city centroid. This is a deploy-time table, not the lexicon `places` data group. |

Defaults: `radius_miles` 5 (0.1–25), `roof_age_min` 15, `long_open_years` 5, `limit` 50 (max 500).
`roof_age_min = 0` omits the age clause; with `open_permits = false` as well, every property in the radius
matches. A `lat`/`lon` outside the Travis County bounding box (about 30.02–30.63 N, −98.17 to −97.37 W; the
server derives the exact box from the loaded parcels) is valid and returns `200` with `total: 0` and
`area_note: "outside Travis County"`; the MCP tools return the same.

## Endpoints

### `GET /v1/meta`

```json
{
  "county": "Travis County, TX", "fips": "48453",
  "run": {"run_id": "…", "started_at": "…", "finished_at": "…"},
  "counts": {"properties": 0, "with_coordinates": 0, "with_roof_age": 0,
             "permits": 0, "permits_joined_to_property": 0, "permits_unmatched": 0, "permits_needs_review": 0,
             "roofing_permits": 0, "open_roofing_permits": 0, "stalled_roofing_permits": 0, "roofing_permits_needs_review": 0,
             "owners": 0, "permit_contractor_attributions": 0, "registry_rows_loaded": 0, "bbb_profiles": 0},
  "groups": {"county": {"cid": "bafy…", "schema": "bafy…", "tables": "bafy…"},
             "property_improvement": {"cid": "bafy…", "schema": "bafy…", "tables": "bafy…"}},
  "manifest_cid": "bafy…",
  "atlas": null,
  "evidence_states": {"completed_date": {"confirmed_present": 0, "unknown": 0, "invalid_quarantined": 0},
                      "status_current": {"confirmed_present": 0, "unknown": 0},
                      "tcad_id": {"confirmed_present": 0, "invalid_quarantined": 0}},
  "unlinked_reasons": {"no_candidate": 0, "multiple_candidates": 0, "invalid_quarantined": 0},
  "limitations": [{"source": "bbb.org", "availability": "unsupported", "source_access_status": "blocked", "incomplete_reason": "http_403_source_block",
                   "detail": "…", "evidence": "runs/…", "records_request": null}],
  "cli_commit": "…", "lexicon_manifest_url": "…", "kit_commit": "99c7bff"
}
```

`groups` holds one entry per published data group with the three CIDs the Atlas page entry holds (archive
root `cid`, `schema`, `tables`). `atlas` has the Run schema's shape (`page_path`, `pr_url`,
`validate_state`, `merge_state`, `revert_issue_url`, `ipns`, `index_cid`, `mcp_sync`): `ipns` is the global
`elephant-atlas` name and `index_cid` its resolved value once the county page is merged; before the PR is
opened the object is `null`. No IPNS name is minted for this dataset. `counts.permit_contractor_attributions` counts
distinct `contractor_attribution_key` values, not contractor entities; `counts.registry_rows_loaded` counts
Comptroller rows loaded as candidates, not linked identities, and is 0 unless a `corporate_registry` group is
published. `limitations[]` carries both `availability` (`unsupported`, `supported_partial`, `supported_full`)
and `source_access_status` (`blocked` while a source block stands), as `sources[]` does; `records_request` is the kit's
`{recipient_office, request_portal_url | request_email, system_scope, route}` for blocked, custodian-only and
manual-only jurisdictions. `evidence_states` gives the per-field evidence-state counts for `completed_date`,
`status_current` and `tcad_id`; `unlinked_reasons` counts the permits that could not be linked, by reason.

### `GET /v1/search-centers`

Params: `q` (required; case-insensitive prefix of a city name or a ZIP). Response
`{items: [{name, kind: "city"|"zip", lat, lon, parcel_count, basis}]}` where `basis` reads like
"centroid of 41,203 parcels with situs city PFLUGERVILLE". Backs "within five miles of [city]" questions.

### `GET /v1/properties/search`

Params: `lat`, `lon` (optional, given together), `radius_miles`, `roof_age_min`, `open_permits` (bool, default
`true`), `long_open_years`, `owner_tenure_min` (years), `absentee_owner` (bool), `out_of_area_owner` (bool),
`limit`, `cursor`. Without `lat`/`lon` the search is county-wide: the radius clause is skipped and
`distance_miles` is `null`, which is how "properties that have not changed owner in 10+ years" is asked
without a center.

Match rule: within radius (when a center is given) **and** (`roof_age_years > roof_age_min` **or**
(`open_permits` and the property has an `open` or `stalled` roofing permit)). `needs_review` permits never
satisfy `open_permits`. `owner_tenure_min`, `absentee_owner` and `out_of_area_owner` narrow further.

Sort: properties with an `open` roofing permit first, then `stalled`, each by `open_duration_days` desc; then
the rest by `roof_age_years` desc; ties by `distance_miles` asc.

Response: `{items: PropertySummary[], total: number, next_cursor: string|null}`. `total` is the exact count of
matches in the radius, so a client can say "12,431 matches, showing 500". Each item carries `distance_miles`
and `match_reasons[]` from `aged_roof`, `open_roofing_permit`, `long_open_roofing_permit`,
`stalled_roofing_permit`, `owner_tenure`, `absentee_owner`, `out_of_area_owner`.

### `GET /v1/properties/{property_id}` → `PropertyDetail`

Also `GET /v1/properties/by-geo-id/{geo_id}` → the same object.

### `GET /v1/permits/search`

Params: `lat`, `lon` (optional, given together; county-wide without them, as for properties), `radius_miles`,
`status_group` (comma list of `open`, `stalled`, `closed`, `needs_review`; default `open,stalled`),
`roofing_only` (default `true`), `roof_work_class` (comma list, optional), `min_open_years`,
`contractor_attribution_key`, `limit`, `cursor`.
Sort: `open` before `stalled` before `closed` before `needs_review`, then `open_duration_days` desc.
Response: `{items: PermitSummary[], total, next_cursor}`.

### `GET /v1/permits/text-search`

Full-text retrieval over building permits' `description`, `permit_class` and `work_class` (DuckDB full-text
index, no embeddings; trade permits are not indexed). Params: `q` (required, plain words), `lat`, `lon`,
`radius_miles` (optional), `status_group`, `roofing_only` (default `false`), `limit`, `cursor`. Response:
`{items: PermitSummary[], total, next_cursor}`; each item adds `match_snippet` and `score`. This is the
retrieval tool behind free-text questions ("hail damage re-roofs near Pflugerville"); it does not classify.

### `GET /v1/permits/{permit_id}` → `PermitDetail`

### `GET /v1/contractors/{contractor_attribution_key}` → `Contractor`

### `GET /v1/runs`

`{items: Run[]}`, newest first. Every run that ever published stays listed with its group roots.

### `GET /v1/runs/{run_id}/manifest`

The run's artifact manifest JSON, byte-identical to the object pinned as `manifest_cid`.

### `POST /v1/agent/chat`

Request `{messages: [{role, content}], session_id?: string}`. The server is stateless: the client sends the
full history every time; `session_id` only correlates logs.
Response `{answer: string, tool_calls: [{name, args, result_summary}], evidence: [{property_id?, permit_id?, record_cid, source}], limitations: string[]}`.
The agent answers only from the tools below, cites ids and CIDs, and states what is missing (including
`needs_review` counts and the BBB block). Out-of-county or off-topic questions get a clear miss, never
invented rows.

## MCP tools (`POST /mcp`)

| Tool | Equivalent REST | Notes |
| --- | --- | --- |
| `resolve_search_center` | `GET /v1/search-centers` | the agent calls this first when a question names a city or ZIP |
| `search_properties` | `GET /v1/properties/search` | same params and result |
| `get_property` | `GET /v1/properties/{id}` | also accepts `geo_id` |
| `search_permits` | `GET /v1/permits/search` | |
| `search_permit_text` | `GET /v1/permits/text-search` | |
| `get_permit` | `GET /v1/permits/{id}` | |
| `get_contractor` | `GET /v1/contractors/{key}` | |
| `get_run_summary` | `GET /v1/meta` + `GET /v1/runs` | |

Server `instructions` describe the county, the run, the counts, the group CIDs and the limitations.

## Schemas

**PropertySummary**

| Field | Type | Notes |
| --- | --- | --- |
| `property_id` | string | TCAD `PROP_ID` as printed, never normalized |
| `geo_id` | string | TCAD Geographic ID as printed |
| `address` | `{line1, city, zip}` | situs address from the roll, fields null when absent |
| `lat`, `lon` | number | parcel centroid; permit coordinates only when the parcel has none |
| `coordinate_basis` | `parcel_centroid`, `permit` | |
| `year_built` | int or null | from improvement details |
| `roof_year`, `roof_age_years`, `roof_age_basis`, `roof_age_confidence`, `roof_age_anchor`, `roof_age_as_of`, `roof_age_caveats[]` | see definitions | the estimator's output |
| `last_roofing_permit` | `{permit_id, date, status_group, roof_work_class}` or null | latest `is_roofing` permit |
| `roofing_permit_counts` | `{open, stalled, closed, needs_review}` | |
| `owner_tenure_years` | number or null | |
| `owner_absentee`, `owner_out_of_area` | bool or null | |
| `has_bbb_contractor` | bool | `false` while BBB is blocked |
| `source`, `record_cid`, `property_cid`, `data_group_cid` | | see definitions |
| `distance_miles`, `match_reasons` | | only in search results; `distance_miles` null for county-wide searches |

**PropertyDetail** = PropertySummary + `owner` + `permits: PermitSummary[]` + `improvements[]` (optional).

**Owner** (public appraisal-roll fields only; the roll carries no phones or emails)

| Field | Type |
| --- | --- |
| `owner_name` | string or null; as printed, from the property's `source_payload` (option ii) or the TCAD export (iii), since the published `person` record is case-normalized and split |
| `mailing_address` | `{line1, line2, city, state, zip}` or null |
| `deed_date` | date or null |
| `owner_tenure_years` | number or null |
| `owner_absentee`, `owner_out_of_area` | bool or null |
| `source` | |

**PermitSummary**

| Field | Type | Notes |
| --- | --- | --- |
| `permit_id` | string | as printed (`permit_number`) |
| `geo_id` | string or null | `tcad_id` as printed, from the record's `source_payload` (option ii) or the Socrata export (option iii); it has no lexicon home |
| `property_id` | string | always present: a published permit sits under its property root in the archive |
| `property_link` | `{match_method: "exact"|"normalized_digits", normalization_version, confidence}` | how the link was made at transform time; unlinked permits are never served, only counted |
| `permit_type`, `permit_class`, `work_class`, `description` | string | as printed |
| `roof_work_class`, `work_classifier_version` | see definitions | |
| `is_roofing`, `is_reroof` | bool | derived from `roof_work_class` |
| `status` | string | `status_current` as printed |
| `status_group` | `open`, `stalled`, `closed`, `needs_review` | |
| `status_observed_at`, `status_source` | | see definitions |
| `applied_date`, `issued_date`, `expires_date`, `completed_date` | date or null | as printed; a null `completed_date` is not a confirmed empty |
| `completed_date_evidence` | see definitions | |
| `open_since`, `open_since_basis`, `open_duration_days`, `open_duration_basis`, `days_since_expiry` | | see definitions |
| `contractor` | `{contractor_attribution_key, identity_status: "source_name_attribution", printed_name, company_name, trade, phone}` | `printed_name` = `contractor_full_name` as printed, never blanked |
| `bbb` | `{rating, status, incomplete_reason, note}` | |
| `lat`, `lon` | number or null | permit coordinates |
| `source` | `{dataset: "austin-issued-construction-permits/3syk-w9eu", record_id, url, fetched_at, run_id, request_identifier, source_http_request}` | `url` = the permit's public page; `source_http_request` comes from the archive block (option ii) or the run record, since the exported tables omit it |
| `record_cid`, `property_cid`, `data_group_cid` | string | always present: the API serves only permits in the published `property_improvement` group |
| `match_snippet`, `score` | | text-search results only |

**PermitDetail** = PermitSummary + `property: PropertySummary|null` + `applicant` (as printed) + `valuations` (optional).

**Contractor**

| Field | Type |
| --- | --- |
| `contractor_attribution_key` | string |
| `identity_status` | `"source_name_attribution"` in v1 |
| `company_name`, `printed_names[]`, `trade`, `phone`, `address` | from permits, as printed (business contact fields of a public record; see decisions.md section 4) |
| `permit_count`, `open_permit_count`, `roofing_permit_count`, `needs_review_permit_count` | int |
| `registry_candidates[]` | `{source: "tx-comptroller-franchise-tax/9cir-efmm", taxpayer_number, name, match_method: "exact_unique_normalized_name", status: "candidate"}`; review candidates only, never identity; empty unless a `corporate_registry` group is published |
| `official_identity` | null in v1; `{company_cid, license_identifier, source}` once an official registry or licensing record matches |
| `bbb` | `{rating, status, incomplete_reason, note}` |

**Run**

| Field | Type |
| --- | --- |
| `run_id`, `started_at`, `finished_at` | |
| `window` | `{source: {from, to}}` per source |
| `sources[]` | `{dataset, url, watermark, fetched_at, availability, source_access_status}`; `availability` is `unsupported`, `supported_partial` or `supported_full` |
| `loader_watermarks[]` | `{track, path, artifact_hash, merged_count, last_merged_at}` per track (appraisal, permits, registry) |
| `tombstones_consumed` | `{dead, invalid}` |
| `counts`, `deltas` | per table: loaded, new, changed, unchanged, dead, invalid, retryable; appraisal reconciles as `seed = ready + dead + invalid` |
| `limitations[]` | `{source, availability, source_access_status, incomplete_reason, detail, evidence, records_request}` |
| `evidence_states`, `unlinked_reasons` | as in `/v1/meta` |
| `groups` | `{<group>: {cid, schema, tables}}`, one entry per published data group (CIDv1 base32) |
| `manifest_cid` | CIDv1 base32 |
| `atlas` | `{page_path, pr_url, validate_state, merge_state, revert_issue_url, ipns, index_cid, mcp_sync}` or null; `ipns` is the global `elephant-atlas` name |
| `cars[]` | `{root_cid, group, kind: "archive"|"tables", schema_cid, block_count, car_validation, path, size, sha256, readback_url}`: one entry per group archive and one per `tables.car`; the CAR file is an export of `root_cid`, not a separately pinned object; `car_validation` holds the six per-check counts of `elephant-cli validate` |
| `gateway_checks[]` | `{cid, codec, gateway, status, size, sha256, multihash, checked_at}` for ipfs.io and dweb.link, on roots; digests are compared as multihashes when codecs differ |
| `timings` | per stage, seconds |
| `cli_commit`, `lexicon_manifest_url`, `kit_commit` | the tool versions the run used |
| `readiness_report` | `{overall, gates}` from the readiness validator run before the run |

## Change control

- v1 freezes at the field level once the pre-implementation reviews are complete: `oracle` (done 2026-10-16;
  the corrections it required are applied in this version), then `mew`, `alakazam`, `metagross`. Until then
  this file changes in place and each change is dated here; after the freeze, new params and fields must be
  optional and nullable.
- 2026-10-16, after the oracle conventions review (`docs/reviews/2026-10-16-oracle-conventions-review.md`):
  `contractor_id` → `contractor_attribution_key` with `identity_status`; `business_match` →
  `registry_candidates[]` plus `official_identity`; `dataset_cid` and `ipns` → `groups` and `atlas`; `cid` →
  `record_cid` plus `property_cid` and `data_group_cid`; `source` gains `request_identifier` and
  `source_http_request`; `/v1/places` and `resolve_place` → `/v1/search-centers` and `resolve_search_center`;
  the regex tiers → `roof_work_class` and `work_classifier_version`; roof age gains confidence, anchor, as-of
  and caveats and loses the `issued_date` fallback; `status_group` gains `needs_review` and loses the default
  rule; `status_observed_at`, `status_source`, `completed_date_evidence`, `open_since_basis`,
  `open_duration_basis` and `property_link` added; `bbb.status` distinguishes `blocked` from `unavailable`;
  `counts.contractors` and `counts.businesses` → `permit_contractor_attributions` and `registry_rows_loaded`,
  with `permits_unmatched`, `permits_needs_review` and `roofing_permits_needs_review` added; `limitations[]`
  typed; Run gains `loader_watermarks[]`, `tombstones_consumed`, `atlas`, CAR validation and readback fields,
  `readiness_report`, `cli_commit`, `lexicon_manifest_url` and `kit_commit`.
- 2026-10-16, second look (`docs/reviews/2026-10-16-oracle-second-look.md`): one `atlas` shape; `limitations[]`
  carries `availability` and `source_access_status`; `property_link.method` → `match_method` plus
  `unlinked_reason`; `record_cid` wording; the seven evidence states; `status_evidence` → `status_source`;
  lifecycle mapping stated; `Cancelled*` enumerated in fixtures; `record_cid` always present (no
  query-tables-only rows); `registry_candidates` conditional on a published group; `evidence_states` and
  `unlinked_reasons` on `/v1/meta` and Run.
- 2026-10-16, after the `mew` lookup and the CRM agents' review: `API_BASE` lives in `docs/runbook.md`, not README.md;
  MCP tools enforce the REST per-operation throttles; `property_id` and `property_link` are always present on
  served permits and `unlinked_reason` is counts-only on `/v1/meta`; `geo_id`, `owner_name` and per-record
  `source_http_request` are sourced from the archive block (option ii) or the public export (iii).
- The CRM pins `v1`. If the CRM needs something new, change this file in this repository first, then the server, then the CRM.
- `GET /v1/openapi.json` must match this document; a mismatch is a bug in the server.
