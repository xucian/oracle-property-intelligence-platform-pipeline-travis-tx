import { readFileSync } from 'node:fs';
import { Run } from '@travis/contract';

for (const f of ['20261017T072132Z-pilot', '20261018T143520Z-t5-full']) {
  const rec = JSON.parse(readFileSync(new URL(`../../../runs/${f}.json`, import.meta.url), 'utf8'));
  const r = Run.safeParse(rec);
  console.log(f, r.success ? 'OK' : JSON.stringify(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 40), null, 1));
}
