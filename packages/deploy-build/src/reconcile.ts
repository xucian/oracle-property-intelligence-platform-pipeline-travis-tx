import { readFileSync } from 'node:fs';
import type { BuildOptions } from './build.js';
import type { Db } from './db.js';
import { MANIFEST_PATH, RUN_RECORD_PATH } from './env.js';
import type { PermitsInternalSummary } from './meta.js';
import type { PermitStageResult } from './stage.js';

/** The T5 record's own numbers (docs/decisions.md section 27; runs/20261018T143520Z-t5-full.json), stated by the task. */
export const T5 = {
  seed: 441961,
  properties: 441939,
  dead: 22,
  publishedPermits: 1986484,
  parcelsWithPermits: 237531,
  capturedPermits: 2380707,
  roofAgeEligible: 390212,
  high: 12199,
  medium: 96601,
  low: 281412,
  none: 51727,
} as const;

export interface ReconcileReport {
  ok: boolean;
  textIndexRows: number;
  numbers: Record<string, number>;
  checks: { name: string; expected: unknown; actual: unknown; ok: boolean }[];
}

/** Compares the built database with the T5 record, the manifest and the kit's own reference files; throws when anything is off. */
export async function reconcile(
  db: Db,
  o: BuildOptions,
  ctx: { staged: PermitStageResult; permitsInternal: PermitsInternalSummary },
): Promise<ReconcileReport> {
  const run = JSON.parse(readFileSync(RUN_RECORD_PATH, 'utf8'));
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const checks: ReconcileReport['checks'] = [];
  const numbers: Record<string, number> = {};
  const eq = (name: string, actual: unknown, expected: unknown) => checks.push({ name, expected, actual, ok: actual === expected });
  const n = (name: string, v: number) => (numbers[name] = v);

  const counts = Object.fromEntries((await db.rows<{ name: string; value: string }>('SELECT * FROM meta_counts')).map((r) => [r.name, Number(r.value)]));
  for (const [k, v] of Object.entries(counts)) n(k, v);

  // internal consistency of the pieces regardless of scope
  eq('privacy violations', await db.scalar('SELECT count(*) FROM v_privacy_violations'), 0);
  const ftsRows = await db.scalar('SELECT count(*) FROM fts_main_permit_text.docs');
  const textRows = await db.scalar('SELECT count(*) FROM permit_text');
  eq('fts docs = permit_text rows', ftsRows, textRows);
  eq('permit_text = text-indexed permits', textRows, await db.scalar('SELECT count(*) FROM permits WHERE is_text_indexed'));
  n('text_index_rows', textRows);

  // the kit's own roof-age estimates, parcel by parcel
  const refMismatch = await db.scalar(`SELECT count(*) FROM properties p JOIN roof_age_reference r USING (property_id)
    WHERE p.roof_year IS DISTINCT FROM r.roof_year OR p.roof_age_years IS DISTINCT FROM r.roof_age_years
      OR p.roof_age_basis IS DISTINCT FROM r.roof_age_basis OR p.roof_age_confidence IS DISTINCT FROM r.roof_age_confidence`);
  eq('roof age: parcels differing from the kit reference (reconcile-a1/roof-age.jsonl)', refMismatch, 0);
  eq('roof age reference rows = properties', await db.scalar('SELECT count(*) FROM roof_age_reference'), counts.properties);

  // the profile's classification vs the kit's permits-internal.jsonl, permit by permit
  const clsMismatch = await db.scalar(`SELECT count(*) FROM permits p JOIN permits_internal i ON i.permit_number = p.permit_id
    WHERE p.status_group <> i.status_group OR p.roof_work_class <> i.roof_work_class OR p.is_roofing <> i.is_roofing
      OR p.is_reroof <> i.is_reroof OR p.lifecycle_status <> i.lifecycle_status OR p.completed_date_evidence <> i.completed_date_evidence
      OR p.property_id <> i.property_id`);
  eq('permit classification: permits differing from permits-internal.jsonl', clsMismatch, 0);
  eq('every published permit is in permits-internal', await db.scalar('SELECT count(*) FROM permits p JOIN permits_internal i ON i.permit_number = p.permit_id'), counts.permits_published);

  // lexicon tables vs the manifest's own coverage
  if (!o.subset) {
    const cov = manifest.coverage.tables as Record<string, Record<string, number>>;
    for (const [group, tables] of Object.entries(cov)) {
      if (group === 'internal') continue;
      for (const [table, rows] of Object.entries(tables)) {
        const target = table === 'properties' ? null : `lex.${group === 'county' ? 'county' : 'pi'}_${table}`;
        if (!target) continue;
        eq(`manifest coverage ${group}.${table}`, await db.scalar(`SELECT count(*) FROM ${target}`), rows);
      }
    }
    // T5 totals
    eq('seed rows (properties + dead)', counts.seed_rows, T5.seed);
    eq('ready properties', counts.properties, T5.properties);
    eq('dead accounts', counts.properties_dead, T5.dead);
    eq('published permits', counts.permits_published, T5.publishedPermits);
    eq('parcels with permits', counts.parcels_with_permits, T5.parcelsWithPermits);
    eq('captured permits', counts.captured_permits, T5.capturedPermits);
    eq('permits-internal rows = capture rows', ctx.permitsInternal.total, T5.capturedPermits);
    eq('roof age on', counts.with_roof_age, T5.roofAgeEligible);
    eq('roof age high', counts.roof_age_high, T5.high);
    eq('roof age medium', counts.roof_age_medium, T5.medium);
    eq('roof age low', counts.roof_age_low, T5.low);
    eq('roof age none', counts.properties! - counts.with_roof_age!, T5.none);
    // and the run record itself still says the same
    eq('run record roof_age.eligible', run.roof_age.eligible, T5.roofAgeEligible);
    eq('run record published', run.counts.permits.published, T5.publishedPermits);
    eq('run record permits out_of_county', run.unlinked_reasons.out_of_county, ctx.permitsInternal.outOfCounty);
    eq('linked-to-dead permits skipped', ctx.staged.skippedNotLive, run.counts.permits.linked - run.counts.permits.published);
    // roofing counts: the profile's recount of the published permits vs the run record's linked-roofing numbers
    const g = run.counts.permits.roofing.by_status_group_linked as Record<string, number>;
    const linkedRoofing = await db.rows<{ status_group: string; n: string }>(`SELECT status_group, count(*) n FROM permits WHERE is_roofing GROUP BY 1`);
    for (const r of linkedRoofing) {
      const want = g[r.status_group] ?? 0;
      // 39 linked permits on dead accounts are not published (6 of them roofing)
      if (Math.abs(Number(r.n) - want) > 6) checks.push({ name: `roofing ${r.status_group}`, expected: want, actual: Number(r.n), ok: false });
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const report: ReconcileReport = { ok: failed.length === 0, textIndexRows: textRows, numbers, checks };
  if (failed.length) {
    throw new Error(`reconciliation failed:\n${failed.map((c) => `  ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`).join('\n')}`);
  }
  return report;
}
