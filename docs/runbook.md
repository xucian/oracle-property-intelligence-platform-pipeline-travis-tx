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

## 5. T3 — official identity baseline

Both US-egress windows are done: run `20261017T160716Z` (franchise statewide, sales-tax outlets, veteran-owned, TDLR,
detail-URL probe) and run `20261017T192341Z` (the TSBPE list and the two Comptroller record layouts). A later re-run,
VPN on, is resumable: `node src/counties/travis/t3-vpn-fetch.mjs [--only <source,source>]` in the kit runtime. Rulings:
decisions.md sections 23–24; run record: kit `docs/evidence/travis-t3-run-2026-10-17.json`.

**Record-id key.** `data/travis/keys/record-id.key` in the kit runtime (fingerprint `a85dc5bf94154a97`) keys the ids of
the sole-owner outlets (decisions.md 24.2). Keep one copy in your password manager; without it the loader stops.

### Hand-off checklist (offline, about 12 minutes)

Run in `/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`; nothing is sent. Not in this repo's
mirror `oracle/travis/kit/…/runtime`: it holds the code only, with no `node_modules` and no `data/`.

1. `for r in 20261017T160716Z 20261017T192341Z; do node src/counties/travis/t3-verify.mjs --run $r | tail -1; done` →
   `t3-verify: OK; 112 files, 112 receipts, 4,460,985 CSV rows, 888.0 MB; run <r>`, once per run. Without `| tail -1`,
   the TSBPE line reads `failed: … not CSV: responsible-master-plumber-responsible-master-plumber.csv`: the first run's
   saved HTML page, kept as evidence; its CSV came in the second run.
2. `node src/counties/travis/t3-record-id-key.mjs fingerprint` → `"fingerprint":"a85dc5bf94154a97"`.
3. `shasum -a 256 data/travis/registry/watermark.json data/travis/licensing/watermark.json` → `beb3d529…` and
   `ff62b029…`.
4. `node --max-old-space-size=16384 src/counties/travis/t3-load.mjs` (about 9 minutes) → each snapshot step ends
   `removed 0; no-op` with `diff new 0, changed 0`: `[franchise-statewide] 3,487,662 rows, 3,487,631 keys`
   (`2a102105f56e`), `[franchise-travis] 342,334 rows, 342,333 keys` (`942e8645eec3`), `[sales-tax] 49,025 rows, 49,025
   keys` (`8cc5583a80d5`), `[veteran] 27,205 rows, 27,205 keys` (`988727bb91ca`), `[tdlr] 887,715 rows, 459,993 keys`
   (`2e3ab26003d6`), `[tsbpe] 9,378 rows, 9,378 keys` (`11cf66bb169e`); then `[veteran-join] unchanged (25466 of 27205
   veteran rows joined (Travis 2343); …)`, `[layouts] consistent (2 layouts read; the privacy rule holds)`,
   `[name-index] unchanged (6 indexes; …)`, `[record-ids] no collapsed records (…)`, and last
   `t3-load: 10 steps; all no-op (0 new, 0 changed, 0 removed; identical bytes); …`.
5. Step 3 again → the same two digests.
6. `node src/counties/travis/t3-privacy-check.mjs` → exit 0; `"privacy_version":"travis-t3-privacy.v2"`,
   `"classed_rows_in_capture":9471`, `"withheld_values_in_capture":9088`, `"snapshot_rows":49025`,
   `"snapshot_rows_classed":9471`, `"keyed_record_ids_in_snapshot":9471`, `"keyed_record_ids_distinct":9471`,
   `"track_files_checked":5`, every other count 0, `"ok":true`.
7. `cd /Users/luti/dev/ateam/role1-prism/kit-travis && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml`
   → exit 0, `"overall": "PASS"`, `"seed_allowed": true`.
8. In the runtime directory, `npx vitest run tests/travis-*` → `Test Files 18 passed (18)`, `Tests 159 passed (159)`.

## 6. T4 — permit profile, permit pilot and feasibility

The harvest of record is the Austin export captured on 2026-10-17 (`v1792239863`, 270 partition requests, kit
`docs/evidence/travis-t4-harvest-v1792239863.json`). Everything below reads that capture, the T1 seed and the TCAD special
export captured for point 25.10 (`data/travis/t4-rulings/lineage/`, checked against its receipt, never re-fetched). No VPN is
needed: the only requests go to the public lexicon manifest and to data.austintexas.gov (steps 4 and 7), which answer from RO.
Run record: kit `docs/evidence/travis-t4-run-2026-10-17.json` (rebuilt after the rulings of 2026-10-18). Rulings: decisions.md
section 25 (all five ruled; 6, 7, 8 and 10 applied, 9 is T5's design); the before/after counts of 25.10 are in kit
`docs/evidence/travis-t4-ruling-10-tcad-listing-2026-10-18.json`.
`t4-permit-fetch.mjs` captures a newer version under its own `v<rowsUpdatedAt>`; it is not part of this checklist.

### Hand-off checklist (about 30 minutes)

Run in `/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`, not in the mirror. Each run writes a new
directory under `data/travis/runs/`. The roots below hold while the live lexicon manifest's SHA-256 is `7084b933…` (each run
records it in its `t4-run.json`); `total_s` and `elapsed_s` vary.

```bash
cli=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli
t4run() { node --max-old-space-size=12288 src/counties/travis/t4-run.mjs "$@"; }   # a function, so zsh runs it as bash does
export ELEPHANT_SKIP_UPDATE_CHECK=1   # elephant-cli exits with "update required" if npm has a newer version than 1.58.1
```

1. `node src/counties/travis/t4-permit-verify.mjs` → `t4-permit-verify: OK; 270 partitions, 274 receipts, 2,380,707 CSV
   rows, 1813.8 MB; v1792239863 (rowsUpdatedAt 2026-10-17T12:24:23.000Z)`.
2. TCAD's permit listing, offline from the receipted capture (about 3.5 minutes):
   `node --max-old-space-size=8192 src/counties/travis/t4-tcad-permit-listing.mjs` →
   `"accounts":493246,"accounts_listing_permits":341900,"permit_numbers":781459,"listed_pairs":1121918,"listing_sha256":"7b2bf8e62af758aad4bd1ca53557a4d1fd1f3fc87731a6ecad4ee05f8a96a999"`.
   It stops if the zip's bytes or SHA-256 differ from its receipt; steps 3 to 7 stop if the listing is missing.
3. `node --max-old-space-size=12288 src/counties/travis/t4-permit-links.mjs` (about 1.5 minutes) →
   `"rows":2380707,"linked":1986523,"link_method":{"exact":1978992,"normalized_digits":0,"tcad_permit_listing":7531},"unlinked_reasons":{"no_candidate":251888,"multiple_candidates":38249,"invalid_quarantined":178,"out_of_county":103869},"linked_parcels":237533,"digits_fallback_enabled":true,"tcad_permit_listing":{"retired":196400,"linked":7531,"overlap_agreement":0.973},"new_unmapped_statuses":[]`.
4. Pilot, `__ALL__` (2 minutes; 27 Socrata requests):
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-pilot.csv --label pilot --cli $cli --cross-check-socrata`
   → `"appraisal":{"seedRows":25,"success":25,"permanentFailure":0,"retryableFailure":0}`,
   `"permit_states":{"done_zero_permits":19,"done":6},"permits_linked":155,"permits_published":155,"by_link_method":{"exact":145,"tcad_permit_listing":10},"property_cid_check":true,"socrata_cross_check":"25/25 equal through 2026-10-16"`,
   then `county validate 25/25 (0 error rows), CAR 471 blocks root baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta, checks pass, 23 tables root baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq`
   (T2's roots) and `property_improvement validate 6/6 (0 error rows), CAR 348 blocks root baguqeeranegqm7efvvxckwfltf6ewzxsuwmmf7kuk2obi6r5svbgw7cqk22q, checks pass, 7 tables root baguqeeraxyla6jami62bqvc46xitp4tkyu2boive5b4esf2n5vuwfk2gmafa`.
   Inspect two parcels, with `p=$(ls -d data/travis/runs/*-t4-pilot | tail -1)`:
   - `ls $p/830704/permit-data` lists 5 `property_improvement_*.json`, their relationships, the Property Improvement root
     `bafkreicyzy…json`, the Seed root and the copied property, address and parcel files; `permit-source-payload.json` beside
     it holds the printed rows, the profile and the capture locator. The five records of permit `2013-084591` carry
     `improvement_type` GeneralBuilding, RightOfWayPermit, Electrical, MechanicalHVAC and Plumbing (BP, DS, EP, MP, PP),
     `improvement_status` Completed, `improvement_action` New on the BP only, and `contractor_type` GeneralContractor (BP, DS)
     or Specialist (the trades) (`travis-improvement-enums-v1`).
   - `748284` is the parcel the listing adds: its 10 permits print the retired id `0108032001`. In
     `$p/748284/permit-source-payload.json` every `link.property_link` reads `tcad_permit_listing` / `official_listing`,
     and `link.listing_entries` holds TCAD's own entry for the permit.
5. Appraisal only, `__NONE__`: `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__NONE__ t4run --seed data/seeds/travis-pilot.csv --label pilot-none --cli $cli`
   → `"permit_states":{"not_eligible":25}`, the same County line as step 4, and `property_improvement no parcel in this group`.
6. Failure paths: `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-pilot.csv --label pilot-drill --cli $cli --fault-drill permanent:547839,retryable:830704`
   → `"permit_states":{"done_zero_permits":19,"failed_permanent":1,"done":4,"failed_retryable":1}` and
   `property_improvement validate 4/4`; then
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --resume "$(ls -d data/travis/runs/*-t4-pilot-drill | tail -1)" --cli $cli`
   → `"attempt":2`, `"permit_states":{"done_zero_permits":19,"failed_permanent":1,"done":5}`, `property_improvement validate 5/5`.
7. Feasibility, 1,000 parcels (about 13 minutes; 1,001 Socrata requests). The sample is reproducible:
   `node src/counties/travis/t4-sample.mjs` → `"rows":1000,"sha256":"5fccc9c2deaca758c1f585a90621a56105f093ca445d72c1304748161ed9990c"`. Then
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-feasibility-1000.csv --label feasibility-1000 --cli $cli --cross-check-socrata`
   → `"appraisal":{"seedRows":1000,"success":1000,…}`, `"permit_states":{"done":542,"done_zero_permits":458},"permits_linked":4173,"permits_published":4173,"by_link_method":{"exact":4151,"tcad_permit_listing":22},"property_cid_check":true,"socrata_cross_check":"998/998 equal through 2026-10-16"`,
   `county validate 1000/1000 (0 error rows), CAR 20138 blocks root baguqeerajznciv64kds7dilxfyy5mg33klp4ap2wxfe2frrag7cwhb6gau4a, checks pass, 24 tables root baguqeerag4dmbm2gzcqhvlzetfng4je6v6oklp2ny45azubq4ewv45sizrba`
   and `property_improvement validate 542/542 (0 error rows), CAR 11600 blocks root baguqeerahbiu3sp5wrgqnnugp4dcgsrn3iifuljet5ruumkt4izy3vrg6qyq, checks pass, 7 tables root baguqeerab4phy3thmss6fweimqiprjf72aruewhnvmfi33wokx3vutq6ybrq`.
8. Projection (about 2 minutes):
   `f=$(ls -d data/travis/runs/*-t4-feasibility-1000 | tail -1); for g in county property_improvement; do node src/counties/travis/t4-shard-bench.mjs --group-dir $f/validate/$g --shards 8 --cli $cli --out $f/shard-bench-$g-8.json; done; node src/counties/travis/t4-projection.mjs --feasibility $f --bench-county $f/shard-bench-county-8.json --bench-property_improvement $f/shard-bench-property_improvement-8.json`
   → two `"all_passed":true` bench lines, then `"within_gate":false` for the sequential run (about 62 hours, `cli_county_validate`
   about 46 of them), `"sharded":{… "within_gate":true …}` and `"source_acquisition_h":0.089`. Hours depend on the machine's free
   memory (decisions.md 25.9): the run record projects 62.45 sequential and 19.01 on 8 shards (the 25.9 benchmarks with the
   current link counts; the 8/10/12-shard passes are in kit `docs/evidence/travis-t4-point-9-measurements-2026-10-18.json`).
9. `cd /Users/luti/dev/ateam/role1-prism/kit-travis && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml`
   → exit 0, `"overall": "PASS"`, `"seed_allowed": true`.
10. In the runtime directory, `npx vitest run tests/travis-*` → `Test Files 28 passed (28)`, `Tests 201 passed (201)`.

## 7. T5 — full run, reconciliation and signals

The design is decisions.md section 25.9 (approved 2026-10-18); what phase A built and measured is section 26. One command
runs the whole roll (441,961 accounts) through every stage, offline except for the public lexicon manifest: the readiness
validator (the run stops unless `PASS`), the manifest (its SHA-256 is recorded and checked again on every resume and at
the end; a change stops the run), the shard plan (89 shards of at most 5,000 sorted PROP_IDs), one link pass over the
2,380,707 captured permits, then up to 8 shards in flight, each through the appraisal transform (v4), the permit transform,
roof age and the internal query table, the County and the Property Improvement `elephant-cli` chains (validate, hash, CAR
validate, export-tables) and the Loader's merge. Every stage writes an atomic `<stage>.done.json` with its input and output
digests, so an interruption redoes only the shards in flight. The runner holds `caffeinate -dimsu -w <its pid>`, sets
`ELEPHANT_SKIP_UPDATE_CHECK=1` and writes `run.json` (the `runs/<run_id>.json` record) at the end. Nothing is uploaded,
pinned or registered (T6). Measured on the dry run: about 14.5 hours on this machine with swap at 5.5 of 7 GB, about
125 GB on disk, a peak of about 9 GB for the 8 `elephant-cli` processes and the runner together (kit
`docs/evidence/travis-t5-dry-run-2026-10-18.json`).

### Preflight (about 5 minutes)

1. `colima stop` (or quit Docker Desktop), then quit heavy apps (browsers with many tabs, other IDEs). Keep the Mac on AC
   power with the lid open: `caffeinate` prevents idle and system sleep on AC; on battery a lid close still sleeps (that
   counts as an interruption, see below).
2. `sysctl vm.swapusage` → `used` well under half of `total`. The run warns above half or 4 GB, and a nearly full swap
   doubled the County time in T4 (decisions.md 25.9). If `used` stays high after quitting apps, restart the Mac.
3. `df -h /Users/luti` → at least 160 GB available (the run writes about 125 GB).

The run repeats these checks at its start as warnings (`[t5] preflight warning: …`) and starts anyway.

### Start: the one command

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && node --max-old-space-size=12288 src/counties/travis/t5-run.mjs --cli /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli --eligibility __ALL__ --label full
```

It prints `[t5] starting data/travis/runs/<timestamp>-t5-full (attempt 1, pid <n>); no-sleep caffeinate -dimsu -w <n>;
ELEPHANT_SKIP_UPDATE_CHECK=1; loader scope full`, then about 3 minutes of global stages (the runner alone uses up to about
6 GB during the link pass), then the shard pool. Leave the terminal open.

### Watch

- The terminal prints one line a minute and one per finished shard, for example
  `[t5 2026-10-19T02:10:04Z] shards | shards 23/89 done, 8 in flight (s0024 county.validate, …) | parcels 115000/441961 | elapsed 3h48m | ETA 10h41m (about 12:51 local) | elephant-cli 8 procs 7.4 GB, runner 0.4 GB, swap 1.2 GB`.
- From another terminal: `cat "$(ls -d data/travis/runs/*-t5-full | tail -1)/progress.txt"` (the same line), or
  `tail -f "$(ls -d data/travis/runs/*-t5-full | tail -1)/progress.jsonl"`.
- A shard that fails is logged as `[t5] s00NN failed: …` and in `failures.jsonl` of the run directory; the other shards go
  on.

### Interrupted (Ctrl-C, a crash, `kill`, a sleep, a reboot)

Run the same start command again. It finds the unfinished `full` run and prints `[t5] resuming
data/travis/runs/<timestamp>-t5-full (attempt 2, …)`; it stops any `elephant-cli` process a killed runner left behind,
checks the lexicon manifest against the one recorded at the start, skips every stage whose done-marker still matches and
reruns only what was in flight. The ETA counts only the shards that still run. A run that ends with `[t5] N shard(s)
failed (…)` is resumed the same way, after fixing the cause named in `failures.jsonl` (for example disk space). Do not add
`--new`: that starts the run over in a new directory.

### What "done" prints

```
{"travis_t5_run":"<timestamp>-t5-full","status":"finished","seed":441961,"ready":441936,"dead":25,"invalid":0,"reconciles":true,"shards":89,"cars":356,"permits_published":1986484,"roof_age_eligible":…,"wall_h":…,"run_record":"data/travis/runs/<timestamp>-t5-full/run.json"}
[t5] done: data/travis/runs/<timestamp>-t5-full/run.json
```

The 25 dead accounts are the roll rows without a situs street (T2); 39 linked permits sit on 2 of them and stay internal.
`invalid` other than 0 means `elephant-cli validate` rejected some properties: they are left out of the archives,
tombstoned as invalid and listed in `run.json`. The post-run checklist (reconciliation, counts per table, the run record
in this repository's `runs/`) is written in phase B, after the run.
