import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { Queries, DEFAULT_LIMITS, servingFromEnv } from '@travis/query';
import type { Meta } from '@travis/contract';
import { App, type HttpRequest } from '../app.js';
import { createObservability } from '../observability.js';
import { PRIME, imageFiles, prefetch, type PrefetchResult } from '../warm.js';

const { observer, logger } = createObservability('travis-api');
const dbPath = (): string => process.env.DUCKDB_PATH ?? '/opt/db/serving.duckdb';

function limitsFromEnv(): Meta['limits'] | undefined {
  const raw = process.env.LIMITS_JSON;
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<Meta['limits']>;
  return { ...DEFAULT_LIMITS, ...parsed } as Meta['limits'];
}

let prefetched: Promise<PrefetchResult | null> | null = null;
/** Once per instance in Lambda: the image files DuckDB opens first, read ahead in large chunks (section 31). */
function prefetchOnce(): Promise<PrefetchResult | null> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return Promise.resolve(null);
  prefetched ??= imageFiles(dbPath(), process.env.DUCKDB_EXTENSION_DIR)
    .then((files) => prefetch(files))
    .catch((err: unknown) => {
      logger.warn('prefetch failed', { error: String(err) });
      return null;
    });
  return prefetched;
}

let queries: Promise<Queries> | null = null;
/**
 * Opened on first use (in Lambda: at init, after the prefetch) and reused across warm invocations; a failed open is
 * retried by the next request. With SERVING_BASE set (the deployed functions), DUCKDB_PATH is the serving file and the
 * large tables are read from the private deploy bucket (decisions.md section 30).
 */
export function getQueries(): Promise<Queries> {
  if (!queries) {
    const t0 = performance.now();
    const p = prefetchOnce().then(async (pre) => {
      const q = await Queries.open({
        dbPath: dbPath(),
        serving: servingFromEnv(),
        memoryLimit: process.env.DUCKDB_MEMORY_LIMIT,
        threads: process.env.DUCKDB_THREADS ? Number(process.env.DUCKDB_THREADS) : undefined,
        tempDirectory: '/tmp',
        extensionDirectory: process.env.DUCKDB_EXTENSION_DIR,
        limits: limitsFromEnv(),
      });
      logger.info('cold start', {
        prefetch_ms: pre?.ms,
        prefetch_bytes: pre?.bytes,
        prefetch_complete: pre?.complete,
        open_ms: q.openMs,
        ready_ms: Math.round(performance.now() - t0),
      });
      return q;
    });
    p.catch(() => {
      queries = null;
    });
    queries = p;
  }
  return queries;
}
// Start at init, so the first request finds the instance ready or nearly so.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) getQueries().catch(() => undefined);

/** The scheduled warm-up's event (TravisApi `WarmApi<n>` schedules; `just deploy-api` sends the same). */
export interface WarmEvent {
  warm: { hold_ms?: number };
}
let primed = false;
/**
 * Opens the instance if needed and, once per instance, runs the demo's default calls (PRIME) so their data is cached.
 * Then holds until `hold_ms` has passed, so simultaneous warm-ups land on separate instances.
 */
async function warm(e: WarmEvent['warm']): Promise<{ warmed: true; primed_now: boolean }> {
  const t0 = performance.now();
  const q = await getQueries();
  const primedNow = !primed;
  if (!primed) {
    primed = true;
    for (const op of PRIME) {
      const t = performance.now();
      try {
        await op.run(q);
      } catch (err) {
        logger.warn('warm call failed', { operation: op.name, error: String(err) });
      }
      logger.info('warm call', { operation: op.name, ms: Math.round(performance.now() - t) });
    }
  }
  const hold = (e.hold_ms ?? 1500) - (performance.now() - t0);
  if (hold > 0) await new Promise((r) => setTimeout(r, hold));
  logger.info('warm', { primed_now: primedNow, ms: Math.round(performance.now() - t0) });
  return { warmed: true, primed_now: primedNow };
}

const app = new App({
  queries: getQueries,
  mcpLimits: limitsFromEnv()?.mcp ?? DEFAULT_LIMITS.mcp,
  observer,
});

/** `$default`, `GET /v1/permits/text-search` and `POST /v1/mcp`: the REST router and the MCP endpoint; and warm-ups. */
export async function handler(event: WarmEvent): Promise<{ warmed: true; primed_now: boolean }>;
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2>;
export async function handler(
  event: APIGatewayProxyEventV2 | WarmEvent,
): Promise<APIGatewayProxyStructuredResultV2 | { warmed: true; primed_now: boolean }> {
  if ('warm' in event) return warm(event.warm ?? {});
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;
  const req: HttpRequest = {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    headers,
    body: event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : null,
    requestId: event.requestContext.requestId,
  };
  const res = await app.handle(req);
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
}
