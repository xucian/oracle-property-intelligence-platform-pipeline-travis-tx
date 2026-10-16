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

## 3. T2 (only after T1 PASS and the operator's go-ahead)

Blocker before any `elephant-cli validate` can pass: the lexicon county enum lacks `Travis`
(`kit docs/travis-lexicon-county-enum-request.md`). Open that pull request on `elephant-xyz/lexicon`
and wait for the manifest to carry the new schema CIDs; until then every Travis property fails on
exactly that error (proved on the fixture, kit `docs/evidence/travis-fixture-validate-2026-10-16.txt`).

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
curl -s ipinfo.io/country   # US required: --live-fetch queries the TNR MapServer layer per parcel
head -2 data/seeds/travis-pilot.csv > data/seeds/travis-smoke.csv

# one-parcel smoke, then the 25-parcel appraisal-only pilot (no permit harvest; eligibility __NONE__)
run=data/travis/runs/smoke-1 && node bin/elephant-county.mjs ingest --county travis --seed data/seeds/travis-smoke.csv --html-dir "$run/html" --live-fetch --output "$run"
run=data/travis/runs/pilot-1 && node bin/elephant-county.mjs ingest --county travis --seed data/seeds/travis-pilot.csv --html-dir "$run/html" --live-fetch --output "$run"
node bin/elephant-county.mjs reconcile-export --county travis --seed data/seeds/travis-pilot.csv --run data/travis/runs/pilot-1 --output data/travis/runs/pilot-1/reconciliation

# publication steps on the pilot county group (CLI from this repository), no Atlas PR in v1
cli=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli
mkdir -p data/travis/publish/pilot-1/county && for d in data/travis/runs/pilot-1/*/; do id=$(basename "$d"); [ -d "$d/data" ] && mkdir -p "data/travis/publish/pilot-1/county/$id" && cp -R "$d/data" "data/travis/publish/pilot-1/county/$id/"; done
cd data/travis/publish/pilot-1
$cli validate ./county --output-csv travis-county-errors.csv
$cli hash ./county --output-zip ./travis-county-hashed --output-csv travis-county-hash.csv --output-car travis-county.car
$cli validate travis-county.car --output-csv travis-county-car-errors.csv
$cli export-tables travis-county.car --output ./travis-county-tables --part-size 128m --output-json travis-county-tables-export.json \
  --atlas-page ./atlas-page/counties/TX/travis.json --county travis --state TX --fips 48453     # local page file only; no Atlas clone, no PR
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
