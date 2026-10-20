import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { Queries, DEFAULT_LIMITS, servingFromEnv } from '@travis/query';
import type { Meta } from '@travis/contract';
import { App, type HttpRequest } from '../app.js';
import { createObservability } from '../observability.js';

const { observer } = createObservability('travis-api');

function limitsFromEnv(): Meta['limits'] | undefined {
  const raw = process.env.LIMITS_JSON;
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<Meta['limits']>;
  return { ...DEFAULT_LIMITS, ...parsed } as Meta['limits'];
}

let queries: Promise<Queries> | null = null;
/**
 * Opened on first use and reused across warm invocations; a failed open is retried by the next request. With
 * SERVING_BASE set (the deployed functions), DUCKDB_PATH is the serving file and the large tables are read from the
 * private deploy bucket (decisions.md section 30).
 */
export function getQueries(): Promise<Queries> {
  if (!queries) {
    const p = Queries.open({
      dbPath: process.env.DUCKDB_PATH ?? '/opt/db/serving.duckdb',
      serving: servingFromEnv(),
      memoryLimit: process.env.DUCKDB_MEMORY_LIMIT,
      threads: process.env.DUCKDB_THREADS ? Number(process.env.DUCKDB_THREADS) : undefined,
      tempDirectory: '/tmp',
      extensionDirectory: process.env.DUCKDB_EXTENSION_DIR,
      limits: limitsFromEnv(),
    });
    p.catch(() => {
      queries = null;
    });
    queries = p;
  }
  return queries;
}

const app = new App({
  queries: getQueries,
  mcpLimits: limitsFromEnv()?.mcp ?? DEFAULT_LIMITS.mcp,
  observer,
});

/** `$default`, `GET /v1/permits/text-search` and `POST /v1/mcp`: the REST router and the MCP endpoint. */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
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
};
