# Runbook

Everything the operator runs, in order, with the exact commands. Paths are absolute for this
machine; the kit checkout on branch `travis` is `/Users/luti/dev/ateam/role1-prism/kit-travis`
(the plugin checkout `/Users/luti/dev/ateam/role1-prism/kit` stays at the pin on `main` and is
never modified). The Travis files are mirrored under `oracle/travis/` here; `oracle/travis/apply-to-kit.sh`
rebuilds them into any kit checkout at `99c7bff`.

Increment state is in `docs/progress.md`. The stop-per-increment rule applies: T1 is handed to
the operator; nothing below past T1 runs until the operator has run T1 and replied.

## 0. One-time setup

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && npm ci && TZ=America/Chicago npm test
cd /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx && npm ci && ./node_modules/.bin/elephant-cli --version   # 1.58.1 (44bb182)
```

The Broward `coconut-creek` fixture test is timezone-sensitive at `99c7bff` (it expects a date one
day off outside US timezones); `TZ=America/Chicago` makes the whole suite green and does not touch
any Travis code (every Travis date is computed in UTC).

## 1. T1 readiness

The US egress window ran on 2026-10-16 (agent): the counts are in the catalog, the identifier is proven,
and the validator is BLOCKED on one thing only, the parcel gate's material GIS gap (12.51%, condo accounts
without their own polygons). Kit evidence: `skills/use-oracle/runtime/docs/travis-county-findings.md`
section 0 and `skills/use-oracle/runtime/docs/evidence/`.

### Observe the current state

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis
python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Prints `"overall": "BLOCKED"`; parcel `BLOCKED` with "GIS 386682.0 vs assessed 441961.0 is approximately
12.5% (threshold 2.0%); unresolved material discrepancy; GIS-only seeding is not allowed"; permit `PASS`
(23/23), destination `NOT_APPLICABLE`, enrichment `PASS` (kit `docs/travis-readiness-2026-10-16-us-egress.json`).

### Decide the parcel exception (operator decision), then observe PASS

The kit requires the cause, canonical denominator, seed decision, excluded population and coverage effect
of a gap above 2% to be documented **and approved**. They are documented in `travis-sources.yaml` under
`approved_exceptions` as `gate: parcel-pending-operator-approval` (the validator ignores that gate name).
Read it first. Running the next command **is** the approval: it renames the gate to `parcel`, marks it
approved, and re-runs the validator.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis && sed -i '' -e 's/^  - gate: parcel-pending-operator-approval$/  - gate: parcel/' -e 's/^    status: proposed-awaiting-operator-approval$/    status: approved-by-operator/' skills/use-oracle/runtime/docs/travis-sources.yaml && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Expect `"overall": "PASS"`, `"seed_allowed": true`, `"execution_allowed": true`, parcel `PASS`
(a dry run on a temporary copy returned exactly that). Commit the catalog change on the kit branch.

### Seed (only after PASS, under US egress; county-seed-data)

The TCAD files are already downloaded (free, sha256 receipts in kit `docs/evidence/travis-tcad-downloads-2026-10-16.jsonl`)
into the gitignored `skills/use-oracle/runtime/data/travis/export/`. The export is the PACS Legacy 8.0.33
fixed-width format; the script streams it from the archive and pages the TNR **MapServer** layer (the
FeatureServer path is not enabled) at 1,000 features per request, about 387 requests.

```bash
curl -s ipinfo.io/country          # must print US
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
node src/counties/travis/build-seed.mjs \
  --export-archive 'data/travis/export/2026 Certified Appraisal Export Supp 0_07182026.zip' \
  --export-url 'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip' \
  --tnr-cache data/travis/tnr --fetch-tnr \
  --output data/seeds/travis.csv \
  --pilot-output data/seeds/travis-pilot.csv --pilot-size 25
# prints travis_seed_complete: counts.rowsWritten (expected 441,961), gisFeatureCount, rowsWithGeometry,
# foldedOwnerRecords, confidentialOwners, tcadIdNormalizationProof.oneToOne and the 25 pilot PROP_IDs;
# data/seeds/travis-seed-manifest.json keeps the same. Re-run the validator right after.
```

Free files on the TCAD page, for the record: certified export
`https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip`,
layout `https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip`,
improvement report `https://traviscad.org/wp-content/largefiles/improvement_detail_2026.zip`, certified
totals `https://traviscad.org/wp-content/uploads/totals_2026_AsOfRollCorr_0_RunID_6885_20260718_171007.pdf`.

## 2. Preparation that is already done (not T2)

Committed on the kit branch `travis` and mirrored under `oracle/travis/`: the Travis adapter, the
transform with the Seed group, the permit profile and fixtures, the replay fixture, the seed script.
`elephant-county replay --county travis` proves the offline path:

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
node bin/elephant-county.mjs replay --county travis --fixture fixtures/travis-replay --output "$(mktemp -d)"
```

## 3. T2 — appraisal transform and appraisal-only pilot (offline)

Runs offline: no `--live-fetch`, so no request to traviscad.org, gis.traviscountytx.gov or data.texas.gov
(each seed row already carries its TNR geometry and the page query that returned it), and no egress check is
needed. The only network request is the public lexicon manifest, which the adapter reads from
`<run>/lexicon-manifest.json`. Blocker for `validate` to pass: the county enum lacks `Travis`
(elephant-xyz/lexicon#194, open); until it merges every property fails on exactly that error.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
cli=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli
{ head -1 data/seeds/travis-pilot.csv; grep '^830704,' data/seeds/travis-pilot.csv; } > data/seeds/travis-smoke.csv

# $1 = seed, $2 = smoke|pilot; prints the run directory
t2run() {
  run=data/travis/runs/$(date -u +%Y%m%dT%H%M%SZ)-$2; mkdir -p "$run/html"
  curl -sf https://lexicon.elephant.xyz/api/manifest -o "$run/lexicon-manifest.json"
  node bin/elephant-county.mjs ingest --county travis --seed "$1" --html-dir "$run/html" --output "$run" > "$run/ingest-stdout.json"
  node bin/elephant-county.mjs reconcile-export --county travis --seed "$1" --run "$run" --output "$run/reconciliation"
  for z in "$run"/*/transformed.zip; do id=$(basename "$(dirname "$z")"); mkdir -p "$run/validate/county/$id"; unzip -q -o "$z" -d "$run/validate/county/$id"; done
  (cd "$run/validate" && $cli validate ./county --output-csv ./travis-county-errors.csv > validate.log 2>&1; tail -2 validate.log)
  echo "$run"
}
t2run data/seeds/travis-smoke.csv smoke
t2run data/seeds/travis-pilot.csv pilot
```

Expect: smoke 1 = 1 + 0 + 0; pilot `reconciled` 25 = 25 success + 0 permanent + 0 retryable, `geometryCount` 13,
reconcile-export `rowCount` 25 = `expectedCount` 25; validate prints `Properties processed: 25, succeeded: 0,
failed: 25`, and `travis-county-errors.csv` has 25 rows, all `/relationships/property_seed/to/county_jurisdiction`
with value `Travis`. Inspect: `<run>/manifest.json` (`reconciled`, `timings`), one parcel's `data/` and its
`source-payload.json` (the lexicon-gap sidecar, never in the archive), and the error CSV. The agent's run is kit
`docs/evidence/travis-t2-run-20261016T215528Z.json`.

After lexicon#194 merges and the live manifest carries the new schema CIDs, re-run the pilot; `validate` must exit 0.
Then, in the pilot's `validate` directory (no Atlas clone, no PR in v1):

```bash
$cli hash ./county --output-zip ./travis-county-hashed --output-csv travis-county-hash.csv --output-car travis-county.car
$cli validate travis-county.car --output-csv travis-county-car-errors.csv
$cli export-tables travis-county.car --output ./travis-county-tables --part-size 128m --output-json travis-county-tables-export.json \
  --atlas-page ./atlas-page/counties/TX/travis.json --county travis --state TX --fips 48453     # local page file only
```

### Upload with readback (needs the credential mapping; no Atlas PR)

The kit CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and `FILEBASE_BUCKET`. The operator's
git-ignored `.env` in this repository holds `FILEBASE_ACCESS_TOKEN` and `FILEBASE_SECRET_KEY` (and the
Pinata variables); there is no bucket name yet. Operator action before the first upload: create or
pick the Filebase bucket, then export the variables in the shell that runs the upload, never in a
file that is committed:

```bash
set -a; . /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/.env; set +a
export FILEBASE_ACCESS_KEY="$FILEBASE_ACCESS_TOKEN"      # the token is the Filebase access key
export FILEBASE_BUCKET='<bucket name, to be created>'
$cli upload travis-county.car --api https://rpc.filebase.io --output-json travis-county-upload.json
$cli upload ./travis-county-tables --api https://rpc.filebase.io --output-json travis-county-tables-upload.json
# readback through a second public gateway on the archive root and the tables root:
root=$(python3 -c "import json;print(json.load(open('travis-county-upload.json'))['root'])")
curl -sI "https://dweb.link/ipfs/$root" | head -1; curl -sI "https://ipfs.io/ipfs/$root" | head -1
```

Pinata is the second pin (pin-by-CID of every root), run after the Filebase readback; the Pinata JWT
is `PINATA_JWT_SECRET_ACCESS_TOKEN` in `.env` (the CLI's `upload` reads `PINATA_JWT` for ZIP input
only; pin-by-CID goes through Pinata's API in the publication script of T6).

## 4. Requests the operator submits (drafted, not submitted)

- Lexicon: `kit docs/travis-lexicon-county-enum-request.md` (add `Travis` to the two county enums).
- BBB: `kit docs/travis-bbb-access-request.md` (API access through developer.bbb.org).
- Records requests for the 22 non-Austin jurisdictions: `kit docs/travis-sources.yaml`
  (`records_request` per row; the reusable body is in the kit's `request-routing.md`).
