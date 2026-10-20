# Travis County pipeline: hosted layer (T7 API, T8 explorer).
# The kit's six recipes (format, lint, type-check, test, build, deploy) plus the hosted-layer steps.
# Deploy recipes are run by the operator only, never from CI:  just profile=<aws-profile> deploy-api

set shell := ["bash", "-euo", "pipefail", "-c"]

profile := env_var_or_default("AWS_PROFILE", "")
region := "us-east-2"
cdk_dir := justfile_directory() + "/apps/api/cdk"
cdk_config := env_var_or_default("CDK_CONFIG", cdk_dir + "/config.json")

default:
    @just --list

# ---- the kit's six recipes -------------------------------------------------

setup:
    PUPPETEER_SKIP_DOWNLOAD=1 npm ci

format:
    npx prettier --check .

lint:
    npm run lint

type-check:
    npm run typecheck

test:
    npm test

build:
    npm run build

# Full ordered hosted deploy: TravisApi, explorer build against its ApiBase, TravisWeb. Operator only.
deploy: deploy-api build-explorer deploy-web

# ---- hosted layer ----------------------------------------------------------

# Copy the DuckDB file into the Docker build context: `just stage-db` (data/deploy/current) or `just stage-db fixture`.
stage-db source="current":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ source }}" in
      current) src="data/deploy/current/travis.duckdb" ;;
      fixture) src="packages/query/fixtures/travis-fixture.duckdb" ;;
      *) echo "stage-db: source must be 'current' or 'fixture'" >&2; exit 1 ;;
    esac
    if [ ! -f "$src" ]; then
      echo "stage-db: $src does not exist." >&2
      if [ "{{ source }}" = "current" ]; then
        echo "  Run deploy-build first so data/deploy/current points at a deploy directory." >&2
      else
        echo "  The fixture DB is built by deploy-build (packages/query/fixtures)." >&2
      fi
      exit 1
    fi
    mkdir -p apps/api/build/db
    cp "$src" apps/api/build/db/travis.duckdb
    ls -l apps/api/build/db/travis.duckdb

# cdk synth --strict with no AWS calls. CI: just cdk_config=apps/api/cdk/config.example.json synth
synth:
    cd "{{ cdk_dir }}" && CDK_CONFIG="{{ cdk_config }}" npx cdk synth --strict --quiet

[private]
_need-profile:
    #!/usr/bin/env bash
    if [ -z "{{ profile }}" ]; then
      echo "Set the AWS profile: just profile=<name> <recipe>   (or export AWS_PROFILE)" >&2
      exit 1
    fi

[private]
_need-docker:
    #!/usr/bin/env bash
    export PATH="/opt/homebrew/bin:$PATH"
    docker info >/dev/null 2>&1 || { echo "Docker is not running. Start it: colima start --arch aarch64 --disk 60" >&2; exit 1; }

# Bundle the Lambda handlers, stage the deploy DuckDB file, then `cdk deploy TravisApi`. Operator only.
deploy-api: _need-profile _need-docker build-api (stage-db "current")
    export PATH="/opt/homebrew/bin:$PATH"; cd "{{ cdk_dir }}" && AWS_PROFILE="{{ profile }}" CDK_CONFIG="{{ cdk_config }}" npx cdk deploy TravisApi --outputs-file "{{ cdk_dir }}/cdk.out/TravisApi.outputs.json"

[private]
build-api:
    npm run build -w @travis/api

# Build the explorer with VITE_API_URL = the TravisApi ApiBase output (falls back to $VITE_API_URL).
build-explorer:
    #!/usr/bin/env bash
    set -euo pipefail
    url="${VITE_API_URL:-}"
    if [ -z "$url" ] && [ -n "{{ profile }}" ]; then
      url="$(aws cloudformation describe-stacks --stack-name TravisApi --region {{ region }} --profile "{{ profile }}" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiBase'].OutputValue" --output text)"
    fi
    if [ -z "$url" ] || [ "$url" = "None" ]; then
      echo "build-explorer: no API URL. Deploy TravisApi first, then: just profile=<name> build-explorer" >&2
      exit 1
    fi
    echo "VITE_API_URL=$url"
    VITE_API_URL="$url" npm run build -w @travis/explorer

# `cdk deploy TravisWeb` (explorer files from apps/explorer/dist, invalidating /index.html). Operator only.
deploy-web: _need-profile
    cd "{{ cdk_dir }}" && AWS_PROFILE="{{ profile }}" CDK_CONFIG="{{ cdk_config }}" npx cdk deploy TravisWeb --outputs-file "{{ cdk_dir }}/cdk.out/TravisWeb.outputs.json"

# Upload the Parquet mirror with deploy-build's `mirror` command (SHA-256 checked against the manifest). Operator only.
mirror: _need-profile
    #!/usr/bin/env bash
    set -euo pipefail
    bucket="$(aws cloudformation describe-stacks --stack-name TravisWeb --region {{ region }} --profile "{{ profile }}" \
      --query "Stacks[0].Outputs[?OutputKey=='MirrorBucket'].OutputValue" --output text)"
    echo "mirror bucket: $bucket"
    AWS_PROFILE="{{ profile }}" AWS_REGION={{ region }} npm run mirror -w @travis/deploy-build -- --bucket "$bucket"
