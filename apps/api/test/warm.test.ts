import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { imageFiles, prefetch } from '../src/warm.js';

describe('prefetch of the image files (decisions.md section 31)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'travis-warm-'));
  const ext = path.join(dir, 'ext', 'v1.5.6', 'linux_arm64');
  mkdirSync(ext, { recursive: true });
  writeFileSync(path.join(ext, 'httpfs.duckdb_extension'), Buffer.alloc(3_000_000, 1));
  writeFileSync(path.join(ext, 'httpfs.duckdb_extension.info'), 'x');
  writeFileSync(path.join(dir, 'serving.duckdb'), Buffer.alloc(5_000_001, 2));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the extensions first, then the serving file', async () => {
    expect(await imageFiles(path.join(dir, 'serving.duckdb'), path.join(dir, 'ext'))).toEqual([
      path.join(ext, 'httpfs.duckdb_extension'),
      path.join(dir, 'serving.duckdb'),
    ]);
  });

  it('reads every byte in chunks, and stops at the deadline', async () => {
    const files = await imageFiles(path.join(dir, 'serving.duckdb'), path.join(dir, 'ext'));
    expect(await prefetch(files, { chunkBytes: 1 << 20 })).toMatchObject({
      bytes: 8_000_001,
      complete: true,
    });
    expect(await prefetch(files, { deadlineMs: -1 })).toMatchObject({ bytes: 0, complete: false });
  });
});
