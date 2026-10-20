import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { searchPermitsParams, searchPropertiesParams, textSearchParams } from '@travis/contract';
import type { Queries } from '@travis/query';

/** The files a cold instance reads from the image first: the bundled extensions, then the serving file. */
export async function imageFiles(dbPath: string, extensionDir?: string): Promise<string[]> {
  const out: string[] = [];
  if (extensionDir) {
    for (const e of await readdir(extensionDir, { recursive: true, withFileTypes: true }))
      if (e.isFile() && e.name.endsWith('.duckdb_extension'))
        out.push(path.join(e.parentPath, e.name));
    out.sort();
  }
  out.push(dbPath);
  return out;
}

export interface PrefetchResult {
  bytes: number;
  ms: number;
  complete: boolean;
}

/**
 * Reads `files` once in large chunks, a few at a time, and discards the bytes (decisions.md section 31). Lambda loads
 * an image's blocks over the network on first read; DuckDB's and the loader's later small reads of these files then
 * come from the instance instead. Bounded by `deadlineMs`: past it no new read starts and the caller goes on.
 * The reads use libuv's pool (4 threads by default), so `concurrency` stays at 4 and the caller opens DuckDB after.
 */
export async function prefetch(
  files: string[],
  o: { chunkBytes?: number; concurrency?: number; deadlineMs?: number } = {},
): Promise<PrefetchResult> {
  const chunk = o.chunkBytes ?? 4 * 1024 * 1024;
  const deadline = o.deadlineMs ?? 3000;
  const t0 = performance.now();
  const handles = await Promise.all(files.map((f) => open(f, 'r')));
  let bytes = 0;
  let complete = true;
  try {
    const jobs: { i: number; pos: number; n: number }[] = [];
    for (const [i, fh] of handles.entries()) {
      const size = (await fh.stat()).size;
      for (let pos = 0; pos < size; pos += chunk)
        jobs.push({ i, pos, n: Math.min(chunk, size - pos) });
    }
    let next = 0;
    const worker = async () => {
      const buf = Buffer.allocUnsafe(chunk);
      for (;;) {
        const j = jobs[next++];
        if (!j) return;
        if (performance.now() - t0 > deadline) {
          complete = false;
          return;
        }
        // read first, then add: `bytes += await …` would lose the other workers' updates
        const { bytesRead } = await handles[j.i]!.read(buf, 0, j.n, j.pos);
        bytes += bytesRead;
      }
    };
    await Promise.all(Array.from({ length: o.concurrency ?? 4 }, worker));
  } finally {
    await Promise.all(handles.map((h) => h.close()));
  }
  return { bytes, ms: Math.round(performance.now() - t0), complete };
}

/** Central Austin: the demo's and the CRM's default center (runbook section 9). */
const CENTER = { lat: 30.2672, lon: -97.7431 };

/**
 * The calls a warm-up runs once per instance, so the demo's default searches find their row groups, footers and text
 * index pages already in the instance's caches: the CRM's main call, the default property and permit searches, a
 * county-wide text search and meta.
 */
export const PRIME: { name: string; run: (q: Queries) => Promise<unknown> }[] = [
  { name: 'getMeta', run: (q) => q.getMeta() },
  {
    name: 'searchProperties crm',
    run: (q) =>
      q.searchProperties(
        searchPropertiesParams('rest').parse({
          ...CENTER,
          radius_miles: 5,
          roof_age_min: 15,
          open_permits: false,
          limit: 500,
        }),
      ),
  },
  {
    name: 'searchProperties',
    run: (q) => q.searchProperties(searchPropertiesParams('rest').parse({ ...CENTER, limit: 50 })),
  },
  {
    name: 'searchPermits',
    run: (q) => q.searchPermits(searchPermitsParams('rest').parse({ ...CENTER, limit: 50 })),
  },
  {
    name: 'searchPermitText',
    run: (q) => q.searchPermitText(textSearchParams('rest').parse({ q: 'reroof', limit: 50 })),
  },
];
