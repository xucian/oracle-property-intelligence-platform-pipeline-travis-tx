import { ENDPOINTS } from '@travis/contract';
import { Queries } from '../src/index.js';

const db = process.argv[2]!;
const q = await Queries.open({ dbPath: db, memoryLimit: '4GB', threads: 4 });
console.log('open ms', q.openMs, 'deploy', q.deployId);
const t = async (name: string, fn: () => Promise<any>) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    console.log(name, Math.round(performance.now() - t0), 'ms', JSON.stringify(r).slice(0, 300));
  } catch (e) {
    console.log(name, 'ERR', (e as Error).message);
  }
};
void ENDPOINTS;
await t('meta', () => q.getMeta());
await t('runs', () => q.listRuns());
await t('centers', () => q.searchCenters({ q: 'austin' }));
await t('props', () => q.searchProperties({ lat: 30.2672, lon: -97.7431, radius_miles: 5, roof_age_min: 15, open_permits: true, long_open_years: 5, limit: 3 } as any));
await t('permits', () => q.searchPermits({ lat: 30.2672, lon: -97.7431, radius_miles: 5, status_group: ['open', 'stalled'], roofing_only: true, limit: 3 } as any));
await t('text', () => q.searchPermitText({ q: 're-roof hail damage', match: 'all', radius_miles: 5, status_group: ['open', 'stalled', 'closed', 'needs_review'], roofing_only: false, limit: 3 } as any));
await t('prop', () => q.getProperty({ property_id: '100061' }));
await t('permit', () => q.getPermit('2026-104629 BP'));
