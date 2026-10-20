import { createRequire } from 'node:module';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createObservability } from '../observability.js';

const { observer } = createObservability('travis-chat');

export type FlagReader = () => Promise<string | null>;

/**
 * Reads the budget kill-switch parameter (`CHAT_FLAG_PARAM`, value `true`/`false`) with SSM. The AWS SDK v3 ships with the
 * Lambda base image, so the client is imported at run time and left out of the bundle.
 */
export const readFlagFromSsm: FlagReader = async () => {
  const name = process.env.CHAT_FLAG_PARAM;
  if (!name) return null;
  // createRequire, not import(): ESM resolution ignores NODE_PATH, which is how the Lambda base image exposes its bundled SDK
  const { SSMClient, GetParameterCommand } = createRequire(import.meta.url)(
    '@aws-sdk/client-ssm',
  ) as typeof import('@aws-sdk/client-ssm');
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: name }));
  return r.Parameter?.Value ?? null;
};

/** Short cache (30 s) of the flag, shared by warm invocations. */
export function cachedFlag(
  read: FlagReader,
  ttlMs = 30_000,
  now: () => number = Date.now,
): FlagReader {
  let value: string | null = null;
  let at = -Infinity;
  return async () => {
    if (now() - at < ttlMs) return value;
    try {
      value = await read();
    } catch {
      // a failed read keeps the previous value; the route answers 503 either way until T9
    }
    at = now();
    return value;
  };
}

/**
 * T7 placeholder for `POST /v1/agent/chat`: answers `503 agent_unavailable` without calling Bedrock, so the route, its
 * throttle, the kill switch and the alarms can be deployed and checked at no model cost. T9 replaces this handler.
 */
export function createChatHandler(readFlag: FlagReader) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const t0 = performance.now();
    const requestId = event.requestContext.requestId;
    const flag = await readFlag();
    const reason = flag === 'true' ? 'budget_exhausted' : 'model_unavailable';
    observer.record({
      operation: 'agentChat',
      status: 'ok',
      httpStatus: 503,
      durationMs: performance.now() - t0,
      requestId,
    });
    return {
      statusCode: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId },
      body: JSON.stringify({ error: 'agent_unavailable', reason, request_id: requestId }),
    };
  };
}

export const handler = createChatHandler(cachedFlag(readFlagFromSsm));
