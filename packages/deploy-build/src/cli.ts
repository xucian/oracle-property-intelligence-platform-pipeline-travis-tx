import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { S3Client } from '@aws-sdk/client-s3';
import { buildDatabase } from './build.js';
import { DEPLOY_ROOT, REPO_ROOT, SCHEMA_DIR, shardIds } from './env.js';
import { buildFixture } from './fixture.js';
import { HashCache, sha256FileRaw, sha256Hex } from './hash.js';
import { mirror, stageInputs } from './mirror.js';
import { verifyInputs } from './verify.js';

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

function codeHash(): string {
  const files = [
    path.join(SCHEMA_DIR, 'schema.sql'),
    path.join(SCHEMA_DIR, 'post_load.sql'),
    path.join(SCHEMA_DIR, 'src', 'text.ts'),
    ...readdirSync(path.join(REPO_ROOT, 'packages', 'deploy-build', 'src'))
      .filter(
        (f) =>
          f.endsWith('.ts') &&
          f !== 'cli.ts' &&
          f !== 'fixture.ts' &&
          f !== 'mirror.ts' &&
          f !== 's3.ts',
      )
      .sort()
      .map((f) => path.join(REPO_ROOT, 'packages', 'deploy-build', 'src', f)),
  ];
  return sha256Hex(
    files.map((f) => `${path.basename(f)}:${sha256Hex(readFileSync(f))}`).join('\n'),
  );
}

function serverCommit(): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function pointCurrent(dir: string): void {
  const link = path.join(DEPLOY_ROOT, 'current');
  const tmp = `${link}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(path.basename(dir), tmp);
  if (
    existsSync(link) ||
    (() => {
      try {
        lstatSync(link);
        return true;
      } catch {
        return false;
      }
    })()
  )
    rmSync(link, { recursive: false, force: true });
  renameSync(tmp, link);
}

async function commandBuild(args: string[]): Promise<void> {
  const fixture = args.includes('--fixture');
  const force = args.includes('--force');
  const nShards = flag(args, '--shards');
  const shards = nShards ? shardIds().slice(0, Number(nShards)) : shardIds();
  const subset = shards.length !== 89;
  const t0 = performance.now();
  mkdirSync(DEPLOY_ROOT, { recursive: true });
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  log('verifying inputs');
  const v = await verifyInputs(cache, log, subset ? { shards } : {});
  log(`inputs ok: ${v.files.length} files, ${v.parts.length} Parquet parts match the manifest`);
  const inputsSha256 = sha256Hex(
    `${v.inputsSha256}\n${codeHash()}\n${subset ? shards.join(',') : 'all'}`,
  );
  const deployId = (subset ? 'dev-' : '') + inputsSha256.slice(0, 16);
  const dir = path.join(DEPLOY_ROOT, deployId);
  const dbFile = path.join(dir, 'travis.duckdb');
  if (!force && existsSync(dbFile) && existsSync(path.join(dir, 'deploy.json'))) {
    log(`inputs_sha256 unchanged (${deployId}): skipping the rebuild`);
    if (!subset) pointCurrent(dir);
  } else {
    mkdirSync(dir, { recursive: true });
    const work = path.join(dir, 'work');
    const report = await buildDatabase({
      dbFile,
      workDir: work,
      verified: v,
      deployId,
      inputsSha256,
      serverCommit: serverCommit(),
      shards,
      subset,
      memoryLimit: flag(args, '--memory') ?? '18GB',
      threads: Number(flag(args, '--threads') ?? 8),
      log,
    });
    const duckdbSha256 = await sha256FileRaw(dbFile);
    const manifestCid = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'runs', '20261018T143520Z-t5-full.publication.json'),
        'utf8',
      ),
    ).manifest.cid;
    const deployJson = {
      deploy_id: deployId,
      inputs_sha256: inputsSha256,
      deployed_at: new Date().toISOString(),
      server_commit: serverCommit(),
      duckdb_version: '1.5.6',
      duckdb_sha256: duckdbSha256,
      run_id: '20261018T143520Z-t5-full',
      manifest_cid: manifestCid,
      bytes: statSync(dbFile).size,
      build: {
        wall_seconds: Math.round((performance.now() - t0) / 1000),
        peak_rss_mb: report.peakRssMb,
        timings_ms: report.timings,
        subset,
      },
      reconcile: report.reconcile,
    };
    writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify(deployJson, null, 2) + '\n');
    rmSync(work, { recursive: true, force: true });
    if (!subset) pointCurrent(dir);
    log(
      `built ${dbFile} (${(deployJson.bytes / 1e6).toFixed(0)} MB) in ${deployJson.build.wall_seconds}s, peak RSS ${report.peakRssMb} MB`,
    );
  }
  cache.save();
  if (fixture) {
    const out = path.join(REPO_ROOT, 'packages', 'query', 'fixtures', 'travis-fixture.duckdb');
    const rep = await buildFixture({ fullDb: dbFile, outFile: out, log });
    log(`fixture ${out}: ${(rep.bytes / 1e6).toFixed(1)} MB, ${JSON.stringify(rep.counts)}`);
  }
}

async function commandMirror(args: string[]): Promise<void> {
  const bucket = flag(args, '--bucket');
  if (!bucket) throw new Error('mirror: --bucket <mirror bucket> is required');
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  const v = await verifyInputs(cache, log);
  const s3 = new S3Client({ region: flag(args, '--region') ?? 'us-east-2' });
  const r = await mirror(s3, bucket, v, { dryRun: args.includes('--dry-run'), log });
  log(
    `mirror: ${r.uploaded.length} uploaded, ${r.skipped.length} already present with the same checksum`,
  );
}

async function commandStage(args: string[]): Promise<void> {
  const bucket = flag(args, '--bucket');
  if (!bucket) throw new Error('stage-inputs: --bucket <private deploy bucket> is required');
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  const v = await verifyInputs(cache, log);
  const s3 = new S3Client({ region: flag(args, '--region') ?? 'us-east-2' });
  const r = await stageInputs(s3, bucket, v, { dryRun: args.includes('--dry-run'), log });
  log(
    `stage-inputs: ${r.uploaded.length} uploaded, ${r.skipped.length} already present; index key ${r.indexKey}`,
  );
}

const [cmd = 'build-db', ...rest] = process.argv.slice(2);
const main = cmd.startsWith('--')
  ? commandBuild([cmd, ...rest])
  : cmd === 'build-db'
    ? commandBuild(rest)
    : cmd === 'mirror'
      ? commandMirror(rest)
      : cmd === 'stage-inputs'
        ? commandStage(rest)
        : Promise.reject(new Error(`unknown command ${cmd}`));
main.catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
