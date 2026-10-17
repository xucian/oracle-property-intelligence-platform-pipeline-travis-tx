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

### Upload with readback (run 2026-10-17 on the operator's go)

Option B (decisions.md section 22): the run of record `20261017T072132Z` validated, hashed and exported against the
live manifest, so no amended schemas need pinning. On the operator's go ("go upload", 2026-10-17, after the T2
approval) the oracle agent ran the steps below in order; the outcome is under "Result" below, in the kit run record's
`publication` and in `runs/20261017T072132Z-pilot.json`. The credentials stay in the
git-ignored `.env` (`FILEBASE_ACCESS_TOKEN`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET=travis-tx-oracle-pipeline`,
`PINATA_JWT_SECRET_ACCESS_TOKEN`) and are loaded into the shell that runs the upload only; never echo them or write
them to a file. The CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and `FILEBASE_BUCKET` and composes the
Filebase token itself. In order:

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
RUNTIME=$PWD; A=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx
cli=$A/node_modules/.bin/elephant-cli
publish="node $RUNTIME/src/counties/travis/publish.mjs"
run_id=20261017T072132Z
car_root=baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta
tables_root=baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq
schema=bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq
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

# 4b. Filebase holds every CID (the 23 parts are all added under the name part-00000.parquet): read-only pin/ls,
#    plus a never-uploaded control that must come back unpinned
parts=$(python3 -c "import json; print(','.join(p['cid'] for p in json.load(open('$RUNTIME/docs/evidence/travis-t2-run-$run_id.json'))['tables']['parts']))")
$publish filebase-pins --cids $car_root,$tables_root,$parts --output filebase-pins.json

# 5. Second pin: Pinata pin-by-CID of both roots, requested together, each waited on for at most 30 minutes; a refusal
#    or a pin still pending at the bound is written to pins.json with its exact status (exit code 1), never dropped
$publish pin --cids $car_root,$tables_root --name-prefix travis-county-$run_id --wait-minutes 30 --output pins.json

# 6. ipfs.io and dweb.link, every object in parallel: the raw block of both roots, every part and the schema against the
#    CID's multihash, and every part's full bytes (/ipfs/<cid>) against the run record's size and sha256; 404, 429, 5xx
#    and timeouts retried for up to 20 minutes per object (never sooner than Retry-After); then a short re-run
$publish gateway-check --cids $car_root,$tables_root,$parts,$schema --gateways https://ipfs.io,https://dweb.link \
  --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json --deadline-minutes 20 --concurrency 49 --output gateway-checks.json
$publish gateway-check --cids $car_root,$tables_root,$parts,$schema --gateways https://ipfs.io,https://dweb.link \
  --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json --deadline-minutes 3 --concurrency 49 --output gateway-checks-rerun.json
#    final rows: per object the re-run's row when it is definitive (match or mismatch), else the first pass's
python3 -c "import json; a=json.load(open('gateway-checks.json')); b={(r['cid'],r['gateway'],r['check']): r for r in json.load(open('gateway-checks-rerun.json'))}; res=lambda r: r['bytes'] if r['check']=='file' else r['multihash']; json.dump([b[k] if res(b[k]) in ('match','mismatch') else r for r in a for k in [(r['cid'],r['gateway'],r['check'])]], open('gateway-checks-final.json','w'), indent=2)"

# 7. publish/<run_id>/manifest.json in this repository (never lists itself; a directory entry carries its root block's
#    size and sha256, read from the local CAR; the schema's from its CID-verified bytes), then pin it (cidVersion 1;
#    the CID must equal its local raw CID). --accept-unpinned true only carries a refusal recorded in step 5.
$publish manifest --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json \
  --car-upload travis-county-upload.json --tables-upload travis-county-tables-upload.json \
  --gateway-checks gateway-checks-final.json --pins pins.json --hash-csv travis-county-hash.csv \
  --archive-car travis-county.car --tables-car travis-county-tables/tables.car \
  --schema-file ~/.elephant-cli/schema-cache/$schema.json --accept-unpinned true \
  --output $A/publish/$run_id/manifest.json
$publish pin-file --file $A/publish/$run_id/manifest.json --name travis-publish-manifest-$run_id --output manifest-pin.json
```

**Result, 2026-10-17** (the v1 pilot publication: "pilot scope, uploaded with readback, no Atlas PR"):

- Uploads with readback: archive root `baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta`, 471 blocks, uploaded
  09:08:06Z; tables root `baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq`, 23 parts, `countyRoot` the
  archive root, uploaded 09:08:31Z; both read back through `https://ipfs.filebase.io/ipfs/<root>`; step 4 printed
  `roots match`. `filebase-pins`: all 25 CIDs pinned (recursive), the control unpinned. cid.contact lists Filebase's
  provider records (bitswap and `trustless.filebase.io`) for all 25.
- Second pin: **refused.** Pinata answers pin-by-CID with `HTTP 403 {"reason":"PAID_FEATURE_ONLY","details":"You must be
  on a paid plan to pin by CID"}` for both roots, while `pinList` answers 200 (the plan, not the key's scope). Filebase
  is the only provider pinning the roots. Whether to buy a Pinata plan (decisions.md section 7.2 budgets a paid month) or
  use 7.2's Storacha fallback is the operator's decision; the agent switched no vendor and created no account.
- ipfs.io and dweb.link: **unverified on all 98 rows in both passes, nothing mismatched.** Both gateways stopped serving
  backend and automated HTTP clients (IPFS Foundation, "IPFS is moving beyond the sponsored gateways", 2026-08-25;
  `https://gatewaychanges.ipfs.io/`: retired for good on 2026-09-21): full-byte requests get `429` with
  `retry-after: 900` and "This IPFS gateway is switching to a service worker gateway only", and `?format=raw` is
  redirected to `trustless-gateway.link`, whose origin fails with Cloudflare 521, 522 and 525. README.md:69's two example
  gateways can no longer demonstrate retrieval; which two public gateways replace them is the operator's decision.
  Informational only (not in the manifest): the same checks on `https://gateway.pinata.cloud` (Pinata's gateway, which
  holds none of these blocks) matched every row, and `https://4everland.io` matched the rows it answered; see the run
  record's `publication.informational`.
- Manifest: `publish/20261017T072132Z/manifest.json`, 26 objects (both roots, 23 table parts, the County schema), 88,713
  bytes, CID `bafkreiaasx5bscxhvcpfyza2hzlwyfrmqrss6roa4btefom2usxopm2a44` (equal to its local raw CID), pinned with
  Pinata pinFileToIPFS. Run history: `runs/20261017T072132Z-pilot.json`. No Atlas PR in v1.

README demo step ("retrieve one published artifact by CID from a public gateway ... then again from a second independent
public gateway"): fetch one table part from two gateways and compare it with the manifest. With ipfs.io and dweb.link
retired this prints `FAILED` for both; put the two gateways the operator chooses in the `for` list:

```bash
m=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/publish/20261017T072132Z/manifest.json; read -r cid size sha < <(python3 -c "import json,sys; o=next(o for o in json.load(open(sys.argv[1]))['objects'] if o['name']==sys.argv[2]); print(o['cid'], o['size'], o['sha256'])" "$m" tables/property/part-00000.parquet); for gw in https://ipfs.io https://dweb.link; do f=$(mktemp); if curl -sSfL --retry 3 --retry-delay 5 --max-time 120 "$gw/ipfs/$cid" -o "$f"; then s=$(wc -c < "$f" | tr -d ' '); h=$(shasum -a 256 "$f" | cut -d' ' -f1); if [ "$s" = "$size" ] && [ "$h" = "$sha" ]; then echo "MATCH    $gw/ipfs/$cid size=$s sha256=$h"; else echo "MISMATCH $gw/ipfs/$cid size=$s sha256=$h (manifest $size $sha)"; fi; else echo "FAILED   $gw/ipfs/$cid"; fi; rm -f "$f"; done
```

## 4. Requests the operator submits (drafted, not submitted)

- Lexicon: `kit docs/travis-lexicon-county-enum-request.md` (add `Travis` to the two county enums).
- BBB: `kit docs/travis-bbb-access-request.md` (API access through developer.bbb.org).
- Records requests for the 22 non-Austin jurisdictions: `kit docs/travis-sources.yaml`
  (`records_request` per row; the reusable body is in the kit's `request-routing.md`).

## 5. T3 — the US-egress window (official identity baseline)

The offline part of T3 was done first (decisions.md section 23; `docs/progress.md`). With the VPN on, the operator ran
the one line below on 2026-10-17 (run `20261017T160716Z`: US egress at all 104 checks, 103 requests, 170 s; 5 of 6
sources ok). It asks `ipinfo.io/country` before every request and stops on anything but US (exit 3, nothing sent),
writes a receipt per request under the gitignored `data/travis/t3-window/`, only downloads, and is resumable.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && node src/counties/travis/t3-vpn-fetch.mjs
```

### Result (offline, agent, 2026-10-17)

Every receipt verified, every capture loaded into the private registry and licensing snapshots, re-loads are no-ops
(kit `docs/evidence/travis-t3-run-2026-10-17.json`). The four rulings of decisions.md section 24 are applied. Two
things wait for one more US window: the TSBPE Responsible Master Plumber CSV (the first run followed the site menu's
description page of the same name and saved its HTML, kept on disk and set aside by the loader; the resolver now takes
`https://tsbpe.texas.gov/download-csv/RMP/`) and the two Comptroller record layouts (decisions.md section 24.4).

**Keep a copy of the record-id key.** `data/travis/keys/record-id.key` in the kit runtime (fingerprint
`a85dc5bf94154a97`) keys the ids of the 9,471 sole-owner outlets (decisions.md section 24.2). Copy it once to your
password manager; never paste it anywhere else. Without it the loader stops rather than change those ids.

### The one window command (VPN on, US egress)

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && node src/counties/travis/t3-vpn-fetch.mjs --only tsbpe-responsible-master-plumber,comptroller-record-layouts
```

Expect a few seconds, two `[source] ok` lines and the last line
`t3-vpn-fetch: 2/2 ok; … 6 requests (0 resumed), 7 egress checks, …; record data/travis/t3-window/runs/<stamp>.json`
(a few more requests if a layout came from the fallback endpoint).
Paste the three lines back. Then, with the VPN off, in the same directory:

1. `node src/counties/travis/t3-verify.mjs` (checks every file again against its receipt and compares the newest run's
   record with its own files): expect exit 0 and `t3-verify: OK; 1xx files, …; run <stamp>`.
2. `node --max-old-space-size=16384 src/counties/travis/t3-load.mjs --only tsbpe,layouts,name-index,record-ids`: expect
   `[tsbpe] … rows, … keys; diff new …; merged (first load)` (the loader reads the CSV header and resolves the license
   number, licensee and company columns, or stops and prints the header), `[layouts] consistent (2 layouts read; the
   privacy rule holds)` or `[layouts] differs (…)` with the reason, the indexes and `[record-ids] no collapsed records`.
   A `differs` goes back to the agent, which proposes the rule change; nothing changes the rule on its own.

### Hand-off checklist (offline, no VPN; about 12 minutes)

All commands run in the kit runtime directory and send no request:
`cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`

1. Receipts: `node src/counties/travis/t3-verify.mjs --run 20261017T160716Z`. Expect exit 0 and the last line
   `t3-verify: OK; 106 files, 106 receipts, 4,451,607 CSV rows, 885.7 MB; run 20261017T160716Z`; the TSBPE line reads
   `failed: 2 files verified, 0 CSV rows, 0.2 MB, not CSV: responsible-master-plumber-responsible-master-plumber.csv`.
2. Key: `node src/counties/travis/t3-record-id-key.mjs fingerprint`. Expect `"fingerprint":"a85dc5bf94154a97"`.
3. Watermarks before: `shasum -a 256 data/travis/registry/watermark.json data/travis/licensing/watermark.json`. Expect
   `90b7f208…` (registry) and `6de1f4ba…` (licensing).
4. Re-load everything: `node --max-old-space-size=16384 src/counties/travis/t3-load.mjs` (about 10 minutes). Expect every
   snapshot step to say `diff new 0, changed 0` … `removed 0; no-op` with these rows and snapshot prefixes:
   `[franchise-statewide] 3,487,662 rows, 3,487,631 keys` (`2a102105f56e`), `[franchise-travis] 342,334 rows, 342,333
   keys` (`942e8645eec3`), `[sales-tax] 49,025 rows, 49,025 keys` (`e98bb767e181`), `[veteran] 27,205 rows, 27,205 keys`
   (`988727bb91ca`), `[tdlr] 887,715 rows, 459,993 keys` (`2e3ab26003d6`); `[veteran-join] unchanged (25466 of 27205
   veteran rows joined (Travis 2343); …)`; `[tsbpe] awaiting_capture (…)`; `[layouts] awaiting_capture (…)`;
   `[name-index] unchanged (…)`; `[record-ids] no collapsed records (…)`; last line `t3-load: 10 steps; all no-op (0 new,
   0 changed, 0 removed; identical bytes); awaiting capture: tsbpe, layouts; …`.
5. Watermarks after: the command of step 3 prints the same two digests.
6. Privacy: `node src/counties/travis/t3-privacy-check.mjs`. Expect exit 0 and a JSON line with
   `"classed_rows_in_capture":9471`, `"withheld_values_in_capture":9088`, `"keyed_record_ids_in_snapshot":9471`,
   `"keyed_record_ids_distinct":9471`, and 0 for every `withheld_values_in_…`, `captured_row_hashes_in_snapshot`,
   `keyed_record_ids_not_matching_the_key`, `plain_record_ids_found` and `key_material_in_track_files`; `"ok":true`.
7. Readiness: `cd /Users/luti/dev/ateam/role1-prism/kit-travis && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml`.
   Expect exit 0, `"overall": "PASS"`, `"seed_allowed": true`.
8. Tests: in the runtime directory, `npx vitest run tests/travis-*`. Expect `Test Files 18 passed (18)` and
   `Tests 157 passed (157)`.
9. Read the numbers: kit `docs/evidence/travis-t3-run-2026-10-17.json` (`counts`, `deltas`, `matcher`, `record_ids`,
   `limitations`) and `docs/evidence/travis-t3-withheld-record-ids-2026-10-17.json` (the ruling's collision counts).
