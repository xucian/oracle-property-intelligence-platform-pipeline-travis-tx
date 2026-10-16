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

## 1. T1 readiness (operator runs this first)

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis
python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Today it prints `"overall": "BLOCKED"` with one blocker, the parcel gate ("canonical assessed-property
count is missing"); permit `PASS` (23/23), destination `NOT_APPLICABLE`, enrichment `PASS`
(`skills/use-oracle/runtime/docs/travis-readiness-2026-10-16.json`). The counts come from the US egress
window below.

### US egress window (TCAD and TNR counts, then the seed)

Every command checks egress first; stop if it is not `US`.

```bash
curl -s ipinfo.io/country          # must print US; otherwise do nothing below
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
mkdir -p data/travis/export data/travis/tnr data/seeds

# 1. Confirm the three geo-restricted hosts answer, and note whether the TCAD files are paid.
curl -sI https://traviscad.org/publicinformation | head -1
curl -s 'https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json'
curl -s 'https://data.texas.gov/resource/9cir-efmm.json?$select=count(*)'

# 2. Download the 2026 Certified Appraisal Export and the Export Layout from the public information
#    page (record the exact file URL you clicked; it becomes the bulk GET on every entity) and the
#    Improvement Details export; unzip into data/travis/export. A paid file is a payment decision:
#    record it in the run record; if declined, activate the GIS-only contingency in travis-sources.yaml.
#    (If the host still answers 403 under US egress, it is a paywall, not a geo-block.)

# 3. Page the TNR parcel layer and build the seed and the 25-row pilot (the script fails loudly on a
#    column it cannot resolve against the layout; nothing is guessed). Use the recorded export URL.
node src/counties/travis/build-seed.mjs \
  --export-dir data/travis/export \
  --export-url '<the exact TCAD export file URL downloaded in step 2>' \
  --export-archive '<path to the downloaded export archive>' \
  --layout '<path to the Export Layout file>' \
  --tnr-cache data/travis/tnr --fetch-tnr \
  --output data/seeds/travis.csv \
  --pilot-output data/seeds/travis-pilot.csv --pilot-size 25
# prints travis_seed_complete with counts.assessedParcelCount, counts.gisFeatureCount,
# tcadIdNormalizationProof and the pilot PROP_IDs; data/seeds/travis-seed-manifest.json keeps it.

# 4. Put the two counts into the catalog and re-run the validator (expect PASS, seed_allowed true):
#    parcel.assessed_parcel_count = counts.assessedParcelCount
#    parcel.gis_feature_count     = counts.gisFeatureCount   (plus discrepancy_explanation if they differ > 2%)
#    parcel.identifier_proven     = true  (after spot-checking 5 PROP_IDs on the TCAD property search)
cd /Users/luti/dev/ateam/role1-prism/kit-travis
python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Reply with: the validator's `overall` after step 4, the two counts, whether the export was paid or
free, and the first line of the layout's column list for the property file.

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
curl -s ipinfo.io/country   # US required: --live-fetch queries the TNR layer per parcel
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
