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
`<run>/lexicon-manifest.json`. `validate` passes against the live manifest: the Seed root is
`address_has_parcel` only (decisions.md section 22), so the missing `Travis` in the county enums
(elephant-xyz/lexicon#194, open) costs only the county label, not validation.

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

Expect: smoke 1 = 1 + 0 + 0 and `Properties processed: 1, succeeded: 1, failed: 0`; pilot `reconciled` 25 = 25
success + 0 permanent + 0 retryable, `geometryCount` 13, reconcile-export `rowCount` 25 = `expectedCount` 25;
validate prints `Properties processed: 25, succeeded: 25, failed: 0`, and `travis-county-errors.csv` has no data
rows. Inspect: `<run>/manifest.json` (`reconciled`, `timings`), one parcel's `data/` (the Seed root carries
`address_has_parcel` only; no `property_seed.json` or `unnormalized_address.json` inside `data/`) and its
`source-payload.json` (the lexicon-gap sidecar, never in the archive). The run of record is kit
`docs/evidence/travis-t2-run-20261017T072132Z.json`.

Then, in the pilot's `validate` directory (no Atlas clone, no PR in v1). Expect `CAR written … (471 blocks, root
baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta)`, "CAR passed every check" with the six error counts
at 0, and `Tables written … (23 tables, 23 parts, root baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq)`;
the roots are deterministic, so an unchanged seed and export reproduce them:

```bash
$cli hash ./county --output-zip ./travis-county-hashed --output-csv travis-county-hash.csv --output-car travis-county.car
$cli validate travis-county.car --output-csv travis-county-car-errors.csv
$cli export-tables travis-county.car --output ./travis-county-tables --part-size 128m --output-json travis-county-tables-export.json \
  --atlas-page ./atlas-page/counties/TX/travis.json --county travis --state TX --fips 48453     # local page file only
```

### Upload with readback (staged for the operator's go; not run)

Option B (decisions.md section 22): the run of record `20261017T072132Z` validated, hashed and exported against the
live manifest, so no amended schemas need pinning. Nothing below has been run. The credentials stay in the
git-ignored `.env` (`FILEBASE_ACCESS_TOKEN`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET=travis-tx-oracle-pipeline`,
`PINATA_JWT_SECRET_ACCESS_TOKEN`) and are loaded into the shell that runs the upload only; never echo them or write
them to a file. The CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and `FILEBASE_BUCKET` and composes the
Filebase token itself. In order:

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
RUNTIME=$PWD; A=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx
cli=$A/node_modules/.bin/elephant-cli
run_id=20261017T072132Z
car_root=baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta
tables_root=baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq
cd data/travis/runs/$run_id-pilot/validate

# 1. Credentials into this shell only
set -a; . $A/.env; set +a
export FILEBASE_ACCESS_KEY="$FILEBASE_ACCESS_TOKEN"        # the 20-character token is the Filebase S3 access key
[ "$FILEBASE_BUCKET" = travis-tx-oracle-pipeline ] && echo "bucket ok" || echo "STOP: FILEBASE_BUCKET is not travis-tx-oracle-pipeline"

# 2. The artifacts are the ones the run record holds
shasum -a 256 travis-county.car travis-county-tables/tables.car
#    expect 62456f387fd6b25466c63ba6f8b4bbf2020c2b1fa963f71a82b3541bf8a1ebc6  travis-county.car
#           d2aaf5fc2bbfdcf2f115c89b93bd2fc976a924b50a16e2dbff2b5ec4a3e960c9  travis-county-tables/tables.car

# 3. Upload the archive, then the tables (every part added and pinned, then tables.car), to Filebase over Kubo RPC;
#    the CLI reads each root back through https://ipfs.filebase.io
$cli upload travis-county.car --api https://rpc.filebase.io --output-json travis-county-upload.json
$cli upload ./travis-county-tables --api https://rpc.filebase.io --output-json travis-county-tables-upload.json

# 4. CID readback: the uploaded roots are the recorded ones, and the tables point back at the archive
python3 -c "import json,sys; c=json.load(open('travis-county-upload.json')); t=json.load(open('travis-county-tables-upload.json')); ok=c['root']=='$car_root' and t['root']=='$tables_root' and t.get('countyRoot')=='$car_root'; print('roots match' if ok else 'STOP: root mismatch'); sys.exit(0 if ok else 1)"

# 5. Second pin: Pinata pin-by-CID of every root, each confirmed pinned before the gateway checks
node $RUNTIME/src/counties/travis/publish.mjs pin --cids $car_root,$tables_root --name-prefix travis-county-$run_id --output pins.json

# 6. ipfs.io and dweb.link checks on both roots and every table part (sha2-256 against each CID's multihash)
parts=$(python3 -c "import json; print(','.join(p['cid'] for p in json.load(open('$RUNTIME/docs/evidence/travis-t2-run-$run_id.json'))['tables']['parts']))")
node $RUNTIME/src/counties/travis/publish.mjs gateway-check --cids $car_root,$tables_root,$parts --gateways https://ipfs.io,https://dweb.link --output gateway-checks.json

# 7. publish/<run_id>/manifest.json in this repository (never lists itself), then pin it (cidVersion 1; the CID
#    must equal its local raw CID)
node $RUNTIME/src/counties/travis/publish.mjs manifest --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json \
  --car-upload travis-county-upload.json --tables-upload travis-county-tables-upload.json \
  --gateway-checks gateway-checks.json --pins pins.json --hash-csv travis-county-hash.csv \
  --output $A/publish/$run_id/manifest.json
node $RUNTIME/src/counties/travis/publish.mjs pin-file --file $A/publish/$run_id/manifest.json --name travis-publish-manifest-$run_id
```

Expect: both uploads print their root with a successful readback; step 4 prints `roots match`; `pins.json` lists both
roots as pinned; every `gateway-checks.json` row is `match` (a timeout is `unverified`, never a mismatch; re-run it);
the manifest lists 26 objects (both roots, 23 table parts, the County schema). Reply with the two upload summaries,
`pins.json`, `gateway-checks.json` and the manifest CID; the agent records them in the run record (`readback_url`,
`gateway_checks[]`, `manifest_cid`). No Atlas PR in v1.

## 4. Requests the operator submits (drafted, not submitted)

- Lexicon: `kit docs/travis-lexicon-county-enum-request.md` (add `Travis` to the two county enums).
- BBB: `kit docs/travis-bbb-access-request.md` (API access through developer.bbb.org).
- Records requests for the 22 non-Austin jurisdictions: `kit docs/travis-sources.yaml`
  (`records_request` per row; the reusable body is in the kit's `request-routing.md`).
