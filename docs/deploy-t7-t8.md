# Deploying T7 (hosted query layer) and T8 (explorer hosting)

Draft for the coordinator. Everything here is run by the operator from the repository root; CI never deploys. The stacks
are `TravisApi` and `TravisWeb`, both pinned to `us-east-2` (decisions.md section 21). Replace `PROFILE` with your AWS
profile and `ACCOUNT` with the 12-digit account id.

Zsh paste blocks below contain no `#` comments.

## 1. Prerequisites

**Docker (colima).** The Lambda image is arm64 and carries the DuckDB file, so expect about 4 GB (the DuckDB file plus
roughly 0.5 GB for the Node 22 base, the DuckDB binding and the `fts` extension; Lambda's limit is 10 GB uncompressed).
Give colima enough disk for the build cache, the image and its layers.

```zsh
colima start --arch aarch64 --cpu 4 --memory 8 --disk 60
export PATH="/opt/homebrew/bin:$PATH"
docker info --format '{{.Architecture}} {{.MemTotal}}'
```

Prints `aarch64` (or `arm64`) and the memory in bytes. If colima already exists with a smaller disk, run
`colima stop` then `colima start --disk 60` (a disk can grow, not shrink).

**CDK bootstrap in us-east-2** (skip if the toolkit stack exists):

```zsh
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-2 --profile PROFILE --query 'Stacks[0].StackStatus' --output text
```

`CREATE_COMPLETE` or `UPDATE_COMPLETE` means bootstrapped. An error saying the stack does not exist means run:

```zsh
npx --prefix apps/api/cdk cdk bootstrap aws://ACCOUNT/us-east-2 --profile PROFILE
```

**Lambda account limits** (decisions.md section 21, Concurrency). Lambda keeps 100 executions unreserved, so a low
new-account limit makes any reservation fail.

```zsh
aws lambda get-account-settings --region us-east-2 --profile PROFILE --query 'AccountLimit.{concurrent:ConcurrentExecutions,unreserved:UnreservedConcurrentExecutions}'
```

Prints the two numbers. Leave `chatReservedConcurrency` at `0` (unreserved) unless `unreserved` is comfortably above 100.
To reserve, set R at most `min(5, Bedrock RPM x p95 turn seconds / 360)` and set the chat route throttle to about
`R / p95 turn seconds` with burst R, then redeploy `TravisApi`.

**Bedrock.** The chat route is a placeholder at T7 (503 `agent_unavailable`), so no model call is made until T9. The
role is already granted `bedrock:InvokeModel*` on the inference profile and its foundation-model ARNs, so T9 needs no
infrastructure change.

## 2. Configuration

```zsh
cp apps/api/cdk/config.example.json apps/api/cdk/config.json
```

Edit `apps/api/cdk/config.json` (gitignored). Fields to fill in:

| Field | What to set |
| --- | --- |
| `account` | the 12-digit AWS account id |
| `alarmEmails` | one or more addresses; each gets an SNS confirmation email that must be clicked |
| `chatReservedConcurrency` | `0` until the account settings above are read |
| `memoryMb`, `duckdb` | sized from the T7 measurements (defaults: 2048 MB each, `memoryLimit` 1GB, 2 threads) |
| `throttle` | stage and route limits, MCP per-tool limits and the chat output cap; published in `/v1/meta.limits` |
| `dailyChatRequestLimit` | chat invocations per UTC day before the kill switch trips (default 200) |
| `bedrockModelId`, `bedrockRoutingRegions` | default `us.anthropic.claude-opus-5-5` and `us-east-1`, `us-east-2`, `us-west-2`; confirm the regions the profile routes to |
| `viteApiUrl` | optional; the `ApiBase` output, a fallback only (`just build-explorer` reads the stack output) |

## 3. Build the DuckDB file

Run deploy-build as the runbook describes. It writes `data/deploy/<deploy_id>/travis.duckdb` and points the symlink
`data/deploy/current` at it.

```zsh
ls -l data/deploy/current/travis.duckdb
```

Prints the file and its size (this size decides the image size).

## 4. Deploy TravisApi

```zsh
npm ci
just profile=PROFILE deploy-api
```

The recipe bundles the handlers (`apps/api/dist/api.mjs`, `chat.mjs`), copies the DuckDB file to
`apps/api/build/db/travis.duckdb`, builds and pushes the image through CDK, and deploys. CDK asks for approval when
the change adds IAM permissions. The first deploy takes several minutes, mostly the image push. It prints these outputs
(also saved to `apps/api/cdk/cdk.out/TravisApi.outputs.json`):

- `ApiBase`: the `$default` execute-api URL, `https://<id>.execute-api.us-east-2.amazonaws.com`. This is `API_BASE`.
- `ApiFunctionName`, `ChatFunctionName`: the two Lambda functions.
- `DeployBucketName`: the private bucket for deploy inputs and captures.

Confirm each alarm email subscription (check the inbox of every address in `alarmEmails`); an unconfirmed subscription
receives nothing.

## 5. T7 checks

```zsh
API_BASE=$(aws cloudformation describe-stacks --stack-name TravisApi --region us-east-2 --profile PROFILE --query "Stacks[0].Outputs[?OutputKey=='ApiBase'].OutputValue" --output text)
curl -s "$API_BASE/v1/meta" | head -c 600
curl -s -o /dev/null -w '%{http_code}\n' "$API_BASE/v1/openapi.json"
curl -s -X POST "$API_BASE/v1/agent/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}'
curl -s -i -X OPTIONS "$API_BASE/v1/mcp" -H 'origin: https://example.org' -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type,mcp-protocol-version' | head -12
```

Expected: `/v1/meta` returns JSON whose `limits` equals the config; `/v1/openapi.json` prints `200`; chat returns
`{"error":"agent_unavailable","reason":"model_unavailable","request_id":"..."}` with status 503; the preflight returns
`204` with `access-control-allow-origin: *` and the two allowed headers.

Kill switch (optional, free):

```zsh
aws ssm put-parameter --name /travis/chat/budget-exhausted --value true --type String --overwrite --region us-east-2 --profile PROFILE
sleep 70
curl -s -X POST "$API_BASE/v1/agent/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}'
aws ssm put-parameter --name /travis/chat/budget-exhausted --value false --type String --overwrite --region us-east-2 --profile PROFILE
```

The second command's body carries `"reason":"budget_exhausted"` once the handler's short flag cache expires. The
EventBridge Scheduler job also clears the flag at 00:00 UTC.

## 6. Deploy TravisWeb and the explorer

```zsh
just profile=PROFILE build-explorer
just profile=PROFILE deploy-web
```

`build-explorer` prints `VITE_API_URL=<ApiBase>` and builds `apps/explorer/dist`. `deploy-web` creates the buckets and
the CloudFront distribution (the first create takes about 5 to 10 minutes), uploads the explorer, and invalidates only
`/index.html`. It prints:

- `ExplorerUrl`: `https://<id>.cloudfront.net`.
- `MirrorBucket`: the bucket for the Parquet mirror.
- `DistributionId`.

## 7. Fill the mirror

The mirror is filled by deploy-build's `mirror` command, not by CDK. Every object's SHA-256 is checked against the
manifest and sent as the S3 checksum.

```zsh
just profile=PROFILE mirror
```

Prints the bucket name, then deploy-build's own progress output. Objects are immutable and keyed by CID, so re-running is safe.

## 8. T8 checks

```zsh
EXPLORER=$(aws cloudformation describe-stacks --stack-name TravisWeb --region us-east-2 --profile PROFILE --query "Stacks[0].Outputs[?OutputKey=='ExplorerUrl'].OutputValue" --output text)
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$EXPLORER/some/spa/route"
curl -s -I "$EXPLORER/tables/does-not-exist.parquet" | head -3
```

The SPA route returns `200 text/html`; a missing mirror object returns `403` or `404`, never the HTML page.
With a real mirrored part (copy a key from `mirror_objects`):

```zsh
curl -s -i -H 'range: bytes=0-3' -H 'origin: https://example.org' "$EXPLORER/tables/TABLES_CID/address/part-00000.parquet" | head -14
```

Expected: `206`, `content-range: bytes 0-3/<size>`, `accept-ranges: bytes`, `access-control-allow-origin: *`,
`access-control-expose-headers` listing `Content-Range`, `Accept-Ranges`, `Content-Length`, `ETag`, and
`cache-control: public, max-age=31536000, immutable`. The body is `PAR1`.

The DuckDB-WASM files must be served as `application/wasm`:

```zsh
curl -s -I "$EXPLORER/$(ls apps/explorer/dist/assets | grep -m1 '\.wasm$' | sed 's#^#assets/#')" | grep -i content-type
```

## 9. Teardown and cost notes

The stacks have termination protection and stay up through the evaluation. Afterwards: disable protection, then
`npx --prefix apps/api/cdk cdk destroy TravisApi TravisWeb`, then `cdk gc` to drop old image and file assets. Removal
policies are `DESTROY` for the buckets (auto-emptied), and the log groups; the deploy bucket,
image and logs go with the personal data they hold, and the mirror can go because IPFS keeps the bytes.
