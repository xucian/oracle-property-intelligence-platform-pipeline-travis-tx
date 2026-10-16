# Travis County property intelligence API — contract v1

This is the hosted query surface that the explorer, the pipeline agent, the MCP server and the
[roofing-crm](https://github.com/prismteam-ai/roofing-crm) consume. It is the only coupling between
the two repositories. Changes to v1 are additive only (new optional params, new nullable fields).
Anything else is v2.

## Transport

- HTTPS, JSON, UTF-8. No authentication. CORS `*`.
- Base URL: recorded in `README.md` after deploy as `API_BASE`. OpenAPI 3.1 served at `GET /v1/openapi.json`
  and kept identical to this file.
- MCP (Streamable HTTP, stateless JSON responses, no SSE) at `POST /mcp`, exposing the same operations as
  tools (see "MCP tools").
- Throttling is per API stage, shared by all clients: 20 requests/s steady, burst 40. Route throttles:
  `/v1/agent/chat` 1 request/s, burst 3; `/v1/permits/text-search` 5 requests/s, burst 10. Chat output is
  capped per request (1,500 output tokens) and a CloudWatch alarm watches daily chat invocations and token
  usage. Over limit → `429`; the body is API Gateway's own throttling message and a `Retry-After` header may be
  absent, so clients back off on the status code alone (1 s, then 2 s, then 4 s). Tool calls the pipeline's own
  agent makes inside its Lambda do not pass through the HTTP API; the CRM's agent calls over HTTP and must
  back off on `429` like any client.
- Errors: `400 {error, detail}` for invalid params, `404 {error}` for unknown ids, `429`, `5xx {error, request_id}`.
- Path ids are URL-encoded; `permit_id` contains a space (`2026-102216%20EP`).

## Shared definitions

| Term | Definition |
| --- | --- |
| `property_id` | TCAD **Property ID** (`PROP_ID`, integer in the roll and the GIS layer), canonical as a digit string without leading zeros. |
| `geo_id` | TCAD **Geographic ID** (`geo_id`, string, e.g. `0222210299`), kept exactly as printed. Austin permits carry it as `tcad_id`; **permits join to properties on `geo_id`**, never on `property_id`. The join compares the two values with every non-digit character removed, since the roll and the permit feed may print separators differently; the printed forms stay in `source`. |
| `permit_id` | Austin permit number as printed, e.g. `2026-102216 EP`. |
| `contractor_id` | Pipeline-assigned stable id: hash of normalized company name + phone. Printed names are kept on each permit. |
| `run_id` | Pipeline run id, `YYYYMMDDTHHMMSSZ`. |
| Distances | Miles, great-circle. Coordinates WGS84 `lat`, `lon`. |
| Dates | ISO-8601. Date-only where the source is date-only. |
| `source` | `{dataset, record_id, url, fetched_at, run_id}` on every record; `record_id` is the id as printed by the source. `cid` = CID of the published table that holds the row. |
| Re-roof permit (strict) | `is_reroof` = `permittype = 'BP'` **and** `description`, `work_class` or `permit_class` matches `\bre-?\s?roof|\bshingle|roof\s+replacement|\breplace\w*\s+(the\s+)?roof|\bnew\s+roof` (case-insensitive; the leading `\b` keeps "severe roof" and "entire roof" from matching as "re roof") **and** none of them matches `waterproof|fireproof|soundproof|weatherproof|damp-?proof`. A permit that merely mentions roofing inside a larger remodel is not a re-roof; a re-roof that also mentions solar panels still is. The only tier that may change a roof's age. At least 22,057 building permits match on 2026-10-16. |
| Roofing permit (broad) | `is_roofing` = `is_reroof` **or** (`permittype = 'BP'` **and** the same fields match `\b(re-?roof\w*|roof\w*)\b` **and** none of them matches `waterproof|fireproof|soundproof|weatherproof|damp-?proof|solar|photovoltaic|\bpv\b|roof\s*deck|roof\s*drain|roof\s*hatch|roof\s*access|roof\s*top\s*unit|rooftop\s*unit`). Drives the open/stalled permit signal and the counts. Trade permits (`EP`, `MP`, `PP`) are loaded as permits but are not roofing permits. About 33,000 building permits mention a roof on 2026-10-16, before exclusions. |
| Roof age | `last_roof_permit_year` = year of `completed_date`, else `issue_date`, of the latest `Final` permit with `is_reroof`. `roof_year` = the later of `year_built` and `last_roof_permit_year`; `roof_age_basis` = `last_roof_permit` when the permit year wins, `year_built` otherwise, `null` when neither exists. `roof_age_years` = current year − `roof_year`. |
| Age threshold | "Older than N years" is **strict**: a property matches when `roof_age_years > roof_age_min`. |
| Status group | `open` = `Active`, `Pending Permit`, `On Hold`, `Re Review`, `Suspended`, `Inactive Pending Revision`. `stalled` = `Expired` without `completed_date`. `closed` = `Final`, `Withdrawn`, `Cancelled*`, `VOID`, `Aborted`, and `Expired` with a `completed_date`. Any other value: `closed` when `completed_date` is set, else `open`; such values are logged and listed under `/v1/meta.limitations`. |
| `open_since` | `issue_date`, else `applieddate`. |
| `open_duration_days` | `open`: today − `open_since`. `stalled`: `expires_date` − `open_since`, or `statusdate` − `open_since` when `expires_date` is missing (how long it stayed open before lapsing). `closed`: `null`. |
| `days_since_expiry` | `stalled` only: today − `expires_date`; `null` otherwise. |
| Long-open | `open_duration_days ≥ long_open_years × 365`, default 5 years. |
| Owner tenure | `owner_tenure_years` from the deed/sale date in the appraisal export when present, else `null`. |
| Absentee owner | `owner_absentee` = normalized mailing address ≠ normalized situs address, when the roll has both, else `null`. |
| Out-of-area owner | `owner_out_of_area` = mailing state ≠ `TX`, or mailing ZIP not in the set of situs ZIPs present in the roll; `null` when the roll lacks mailing fields. |
| BBB | `bbb.rating` is `null` and `bbb.status` is `unavailable` while the source is blocked (see limitations). The field is always present so clients render "unavailable" honestly. |
| Place | A named search center derived from the loaded roll, never from an external geocoder: for each distinct situs city and each situs ZIP, the centroid of its parcels with coordinates and the parcel count. "Austin" resolves to the Austin situs-city centroid. |

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
  "counts": {"properties": 0, "with_coordinates": 0, "with_roof_age": 0, "permits": 0, "permits_joined_to_property": 0,
             "roofing_permits": 0, "open_roofing_permits": 0, "stalled_roofing_permits": 0, "owners": 0,
             "contractors": 0, "businesses": 0, "bbb_profiles": 0},
  "dataset_cid": "bafy…", "manifest_cid": "bafy…", "ipns": null,
  "limitations": [{"source": "bbb.org", "status": "blocked", "detail": "…", "evidence": "runs/…"}]
}
```

### `GET /v1/places`

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
(`open_permits` and the property has an `open` or `stalled` roofing permit)). `owner_tenure_min`,
`absentee_owner` and `out_of_area_owner` narrow further.

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
`status_group` (comma list of `open`, `stalled`, `closed`; default `open,stalled`), `roofing_only` (default
`true`), `min_open_years`, `contractor_id`, `limit`, `cursor`.
Sort: `open` before `stalled` before `closed`, then `open_duration_days` desc. Response: `{items: PermitSummary[], total, next_cursor}`.

### `GET /v1/permits/text-search`

Full-text retrieval over building permits' `description`, `permit_class` and `work_class` (DuckDB full-text
index, no embeddings; trade permits are not indexed). Params: `q` (required, plain words), `lat`, `lon`, `radius_miles` (optional), `status_group`,
`roofing_only` (default `false`), `limit`, `cursor`. Response: `{items: PermitSummary[], total, next_cursor}`;
each item adds `match_snippet` and `score`. This is the retrieval tool behind free-text questions
("hail damage re-roofs near Pflugerville").

### `GET /v1/permits/{permit_id}` → `PermitDetail`

### `GET /v1/contractors/{contractor_id}` → `Contractor`

### `GET /v1/runs`

`{items: Run[]}`, newest first. Every run that ever published stays listed with its CIDs.

### `GET /v1/runs/{run_id}/manifest`

The run's artifact manifest JSON, byte-identical to the object pinned as `manifest_cid`.

### `POST /v1/agent/chat`

Request `{messages: [{role, content}], session_id?: string}`. The server is stateless: the client sends the
full history every time; `session_id` only correlates logs.
Response `{answer: string, tool_calls: [{name, args, result_summary}], evidence: [{property_id?, permit_id?, source}], limitations: string[]}`.
The agent answers only from the tools below, cites ids, and states what is missing. Out-of-county or
off-topic questions get a clear miss, never invented rows.

## MCP tools (`POST /mcp`)

| Tool | Equivalent REST | Notes |
| --- | --- | --- |
| `resolve_place` | `GET /v1/places` | the agent calls this first when a question names a city or ZIP |
| `search_properties` | `GET /v1/properties/search` | same params and result |
| `get_property` | `GET /v1/properties/{id}` | also accepts `geo_id` |
| `search_permits` | `GET /v1/permits/search` | |
| `search_permit_text` | `GET /v1/permits/text-search` | |
| `get_permit` | `GET /v1/permits/{id}` | |
| `get_contractor` | `GET /v1/contractors/{id}` | |
| `get_run_summary` | `GET /v1/meta` + `GET /v1/runs` | |

Server `instructions` describe the county, the run, the counts and the limitations.

## Schemas

**PropertySummary**

| Field | Type | Notes |
| --- | --- | --- |
| `property_id` | string | canonical TCAD Property ID |
| `geo_id` | string | TCAD Geographic ID as printed |
| `address` | `{line1, city, zip}` | situs address from the roll, fields null when absent |
| `lat`, `lon` | number | parcel centroid; permit coordinates only when the parcel has none |
| `coordinate_basis` | `parcel_centroid`, `permit` | |
| `year_built` | int or null | from improvement details |
| `roof_year`, `roof_age_years`, `roof_age_basis` | see definitions | |
| `last_roofing_permit` | `{permit_id, date, status_group, is_reroof}` or null | latest roofing permit of any tier |
| `roofing_permit_counts` | `{open, stalled, closed}` | |
| `owner_tenure_years` | number or null | |
| `owner_absentee`, `owner_out_of_area` | bool or null | |
| `has_bbb_contractor` | bool | `false` while BBB is unavailable |
| `source`, `cid` | | |
| `distance_miles`, `match_reasons` | | only in search results; `distance_miles` null for county-wide searches |

**PropertyDetail** = PropertySummary + `owner` + `permits: PermitSummary[]` + `improvements[]` (optional).

**Owner** (public appraisal-roll fields only; the roll carries no phones or emails)

| Field | Type |
| --- | --- |
| `owner_name` | string or null |
| `mailing_address` | `{line1, line2, city, state, zip}` or null |
| `deed_date` | date or null |
| `owner_tenure_years` | number or null |
| `owner_absentee`, `owner_out_of_area` | bool or null |
| `source` | |

**PermitSummary**

| Field | Type | Notes |
| --- | --- | --- |
| `permit_id` | string | as printed |
| `geo_id` | string or null | `tcad_id` as printed |
| `property_id` | string or null | resolved through `geo_id`; null when no parcel matches |
| `permit_type`, `permit_class`, `work_class`, `description` | string | as printed |
| `is_roofing`, `is_reroof` | bool | broad and strict tiers, see definitions |
| `status` | string | `status_current` as printed |
| `status_group` | `open`, `stalled`, `closed` | |
| `applied_date`, `issued_date`, `expires_date`, `completed_date` | date or null | |
| `open_since`, `open_duration_days`, `days_since_expiry` | | see definitions |
| `contractor` | `{contractor_id, printed_name, company_name, trade, phone}` | `printed_name` = `contractor_full_name` as printed, never blanked |
| `bbb` | `{rating, status, note}` | |
| `lat`, `lon` | number or null | permit coordinates |
| `source` | `{dataset: "austin-issued-construction-permits/3syk-w9eu", record_id, url, fetched_at, run_id}` | `url` = the permit's public page |
| `cid` | string | |
| `match_snippet`, `score` | | text-search results only |

**PermitDetail** = PermitSummary + `property: PropertySummary|null` + `applicant` (as printed) + `valuations` (optional).

**Contractor**

| Field | Type |
| --- | --- |
| `contractor_id` | string |
| `company_name`, `printed_names[]`, `trade`, `phone`, `address` | from permits |
| `permit_count`, `open_permit_count`, `roofing_permit_count` | int |
| `business_match` | `{source: "tx-comptroller-franchise-tax/9cir-efmm", taxpayer_number, name, status}` or null, exact unique normalized-name match only |
| `bbb` | `{rating, status, note}` |

**Run**

| Field | Type |
| --- | --- |
| `run_id`, `started_at`, `finished_at` | |
| `window` | `{source: {from, to}}` per source |
| `sources[]` | `{dataset, url, watermark, fetched_at, status}` |
| `counts`, `deltas` | per table: loaded, new, changed, unchanged |
| `limitations[]` | `{source, status, detail, evidence}` |
| `dataset_cid`, `manifest_cid`, `ipns` | CIDv1 base32 |
| `cars[]` | `{root_cid, path, size, sha256}`: one CAR per directory root; the CAR file is an export of `root_cid`, not a separately pinned object |
| `gateway_checks[]` | `{cid, gateway, status, size, sha256, checked_at}` for ipfs.io and dweb.link |
| `timings` | per stage, seconds |

## Change control

- v1 is frozen at the field level on 2026-10-16 (revised the same day after review). New params and fields must be optional and nullable.
- The CRM pins `v1`. If the CRM needs something new, change this file in this repository first, then the server, then the CRM.
- `GET /v1/openapi.json` must match this document; a mismatch is a bug in the server.
