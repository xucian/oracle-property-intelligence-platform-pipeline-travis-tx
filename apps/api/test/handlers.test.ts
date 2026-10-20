import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { cachedFlag, createChatHandler } from '../src/handlers/chat.js';
import { TokenBucket } from '../src/limits.js';

const event = (requestId = 'rid-1'): APIGatewayProxyEventV2 =>
  ({
    requestContext: { requestId, http: { method: 'POST' } },
    headers: {},
    rawPath: '/v1/agent/chat',
    body: '{}',
  }) as unknown as APIGatewayProxyEventV2;

describe('chat placeholder (T7)', () => {
  it('answers 503 agent_unavailable / model_unavailable without any model call', async () => {
    const h = createChatHandler(async () => 'false');
    const r = await h(event());
    expect(r).toMatchObject({ statusCode: 503, headers: { 'x-request-id': 'rid-1' } });
    expect(JSON.parse((r as { body: string }).body)).toEqual({
      error: 'agent_unavailable',
      reason: 'model_unavailable',
      request_id: 'rid-1',
    });
  });
  it('reports budget_exhausted when the kill-switch flag is true', async () => {
    const r = await createChatHandler(async () => 'true')(event('rid-2'));
    expect(JSON.parse((r as { body: string }).body)).toEqual({
      error: 'agent_unavailable',
      reason: 'budget_exhausted',
      request_id: 'rid-2',
    });
  });
  it('reads the flag with a short cache and survives a failing read', async () => {
    let reads = 0;
    let t = 0;
    let value: string | Error = 'true';
    const f = cachedFlag(
      async () => {
        reads++;
        if (value instanceof Error) throw value;
        return value;
      },
      30_000,
      () => t,
    );
    expect(await f()).toBe('true');
    value = 'false';
    t = 10_000;
    expect(await f()).toBe('true');
    expect(reads).toBe(1);
    t = 40_000;
    expect(await f()).toBe('false');
    value = new Error('ssm down');
    t = 80_000;
    expect(await f()).toBe('false');
    expect(reads).toBe(3);
  });
});

describe('token bucket', () => {
  it('allows the burst, then the rate', () => {
    let t = 0;
    const b = new TokenBucket(1, 2, () => t);
    expect([b.take(), b.take()]).toEqual([0, 0]);
    expect(b.take()).toBeGreaterThanOrEqual(1);
    t += 1000;
    expect(b.take()).toBe(0);
  });
});
