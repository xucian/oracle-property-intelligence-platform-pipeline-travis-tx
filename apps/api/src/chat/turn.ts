import { createHash } from 'node:crypto';
import { isStepCount, type ModelMessage, type ToolLoopAgent, wrapLanguageModel } from 'ai';
import type { Limitation, Meta } from '@travis/contract';
import type { Queries } from '@travis/query';
import { BEDROCK_PROMPT_CACHE_METADATA } from './bedrock-prompt-cache.js';
import { checkCitations } from './citations.js';
import { EvidenceCollector, turnAssumptions, turnLimitations, type Evidence } from './evidence.js';
import {
  DeadlineError,
  OutputBudgetError,
  TurnBudget,
  classifyBedrockError,
  type BedrockFailure,
} from './governor.js';
import { CoordinateGuard } from './guard.js';
import type { LangSmithFacade } from './langsmith.js';
import { asksPersonal } from './projection.js';
import { PROMPT_VERSION, parseFinalMessage, systemPrompt } from './prompt.js';
import type { ChatMessageIn } from './request.js';
import { buildTurnTools, type ToolCallRecord } from './tools.js';

type WrappedModel = Parameters<typeof wrapLanguageModel>[0]['model'];

export type Outcome =
  | 'answered'
  | 'no_matches'
  | 'needs_clarification'
  | 'out_of_scope'
  | 'out_of_county'
  | 'limit_reached'
  | 'tool_error';

export interface ChatResponseBody {
  outcome: Outcome;
  answer: string;
  assumptions: string[];
  tool_calls: Omit<ToolCallRecord, 'ms'>[];
  evidence: Evidence[];
  limitations: Limitation[];
  run_id: string;
  manifest_cid: string;
  model_id: string;
  prompt_version: string;
  request_id: string;
}

/** What one turn reports to the log line and the metrics: ids, counts, hashes and timings, never text. */
export interface TurnStats {
  outcome: Outcome;
  steps: number;
  tool_calls: number;
  tool_errors: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model_ms: number;
  turn_ms: number;
  deadline_hit: boolean;
  citation_failures: number;
  bedrock_throttles: number;
  bedrock_denials: number;
  retries: number;
  evidence: number;
  cited: number;
  personal_view: boolean;
  answer_sha256: string | null;
  question_sha256: string;
  /** Per model step: milliseconds and output tokens. */
  step_ms: number[];
  step_output_tokens: number[];
  /** Per model step: characters of text the model wrote (commentary before a tool call shows here). */
  step_text_chars: number[];
}

export type TurnResult =
  | {
      kind: 'response';
      body: ChatResponseBody;
      stats: TurnStats;
      bedrockFailure: BedrockFailure | null;
    }
  | { kind: 'model_unavailable'; stats: TurnStats };

export interface TurnLimits {
  maxOutputTokens: number;
  turnDeadlineSeconds: number;
}

export interface TurnDeps {
  queries: () => Promise<Queries>;
  meta: () => Promise<Meta>;
  /** The Bedrock model wrapped with prompt caching (module scope); the turn adds its own budget around it. */
  model: WrappedModel;
  modelId: string;
  langsmith: LangSmithFacade;
  limits: TurnLimits;
  /** Output cap of one step. */
  stepOutputTokens?: number;
  /** Kept free at the end of the deadline to build the answer and flush the traces. */
  reserveMs?: number;
  maxSteps?: number;
  logToolCall?: (r: ToolCallRecord) => void;
  /** Local debugging only (the golden runner): the model's final text when the server withholds it. */
  onWithheld?: (e: {
    text: string;
    reason: string;
    failures: { token: string; reason: string }[];
  }) => void;
  now?: () => number;
}

export interface TurnInput {
  messages: ChatMessageIn[];
  sessionId: string | undefined;
  requestId: string;
  /** Epoch ms the request was received (`requestContext.timeEpoch`): the deadline counts from here. */
  receivedAt: number;
}

const LIMIT_TEXT =
  'This turn reached its time or output limit before the answer was complete. The evidence gathered so far is listed below; ask again, or narrow the question.';
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.meta();
  const runId = meta.run.run_id;
  const deadline = input.receivedAt + deps.limits.turnDeadlineSeconds * 1000;
  const reserve = deps.reserveMs ?? 1500;
  const budget = new TurnBudget({
    deadlineAt: deadline - reserve,
    maxOutputTokens: deps.limits.maxOutputTokens,
    stepOutputTokens: deps.stepOutputTokens ?? 600,
    now,
  });
  const question = input.messages[input.messages.length - 1]!.content;
  const personal = asksPersonal(question);
  const evidence = new EvidenceCollector(runId);
  const guard = new CoordinateGuard(
    input.messages.filter((m) => m.role === 'user').map((m) => m.content),
  );
  const { tools, records, usedCenters } = buildTurnTools({
    queries: deps.queries,
    evidence,
    guard,
    personal,
    remainingMs: () => budget.remainingMs(),
    log: deps.logToolCall ?? (() => {}),
  });
  const maxSteps = deps.maxSteps ?? 6;
  const sessionKey = input.sessionId ?? input.requestId;
  const AgentClass: typeof ToolLoopAgent = deps.langsmith.ToolLoopAgent;
  const agent = new AgentClass({
    model: budget.wrap(deps.model),
    instructions: systemPrompt(meta),
    tools,
    stopWhen: isStepCount(maxSteps),
    maxRetries: 0,
    providerOptions: {
      langsmith: deps.langsmith.providerOptions({
        session_id: sessionKey,
        thread_id: sessionKey,
        request_id: input.requestId,
        bedrock_model_id: deps.modelId,
        ls_provider: 'amazon_bedrock',
        ls_model_name: deps.modelId,
        prompt_version: PROMPT_VERSION,
        personal_view: personal,
        ...BEDROCK_PROMPT_CACHE_METADATA,
      }),
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - reserve - now()));
  const messages: ModelMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let text = '';
  let finishReason = 'other';
  let stoppedBy: 'deadline' | 'output_budget' | 'steps' | null = null;
  let stepText: number[] = [];
  let failure: unknown = null;
  try {
    const r = await agent.generate({ messages, abortSignal: controller.signal });
    text = r.text ?? '';
    finishReason = r.finishReason ?? 'other';
    stepText = r.steps.map((x) => x.text?.length ?? 0);
    const last = r.steps[r.steps.length - 1];
    if ((last?.toolCalls?.length ?? 0) > 0 && r.steps.length >= maxSteps) stoppedBy = 'steps';
  } catch (e) {
    if (e instanceof DeadlineError || controller.signal.aborted || budget.remainingMs() <= 0)
      stoppedBy = 'deadline';
    else if (e instanceof OutputBudgetError || hasCause(e, OutputBudgetError))
      stoppedBy = 'output_budget';
    else if (hasCause(e, DeadlineError)) stoppedBy = 'deadline';
    else failure = e;
  } finally {
    clearTimeout(timer);
  }

  const totals = budget.totals();
  const baseStats = (
    outcome: Outcome,
    answer: string | null,
    extra: Partial<TurnStats> = {},
  ): TurnStats => ({
    outcome,
    steps: totals.steps,
    tool_calls: records.length,
    tool_errors: records.filter((r) => r.status !== 'ok').length,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_read_tokens: totals.cacheReadTokens,
    cache_write_tokens: totals.cacheWriteTokens,
    model_ms: totals.modelMs,
    turn_ms: now() - input.receivedAt,
    deadline_hit: stoppedBy === 'deadline',
    citation_failures: 0,
    bedrock_throttles: budget.throttles,
    bedrock_denials: budget.denials,
    retries: budget.retries,
    evidence: evidence.items.length,
    cited: 0,
    personal_view: personal,
    answer_sha256: answer ? sha(answer) : null,
    question_sha256: sha(question),
    step_ms: budget.steps.map((x) => x.ms),
    step_output_tokens: budget.steps.map((x) => x.outputTokens),
    step_text_chars: stepText,
    ...extra,
  });

  let bedrockFailure: BedrockFailure | null = null;
  if (failure) {
    bedrockFailure = classifyBedrockError(failure);
    if (bedrockFailure === 'denied')
      return { kind: 'model_unavailable', stats: baseStats('tool_error', null) };
  }
  if (budget.modelTimeouts > 0 && !bedrockFailure) bedrockFailure = 'server_error';

  const okCalls = records.filter((r) => r.status === 'ok').length;
  const assumptions = turnAssumptions(evidence, usedCenters);
  const limitations = turnLimitations(meta, evidence);
  const respond = (
    outcome: Outcome,
    answer: string,
    extraAssumptions: string[],
    extra: Partial<TurnStats> = {},
  ): TurnResult => ({
    kind: 'response',
    bedrockFailure,
    stats: baseStats(outcome, answer || null, extra),
    body: {
      outcome,
      answer,
      assumptions: [...extraAssumptions, ...assumptions],
      tool_calls: records.map(({ ms: _ms, ...r }) => r),
      evidence: evidence.items,
      limitations,
      run_id: runId,
      manifest_cid: meta.manifest_cid,
      model_id: deps.modelId,
      prompt_version: PROMPT_VERSION,
      request_id: input.requestId,
    },
  });

  if (stoppedBy) return respond('limit_reached', LIMIT_TEXT, []);
  if (failure) return respond('tool_error', '', []);

  const parsed = parseFinalMessage(text);
  let answer = parsed.answer;
  if (finishReason === 'length' && answer) answer = `${answer} …`;
  if (!answer) {
    deps.onWithheld?.({ text, reason: 'empty_answer', failures: [] });
    return respond('tool_error', '', parsed.assumptions);
  }
  const check = checkCitations(answer, evidence);
  if (!check.ok) {
    deps.onWithheld?.({ text, reason: 'citation_check', failures: check.failures });
    return respond('tool_error', '', parsed.assumptions, {
      citation_failures: check.failures.length,
    });
  }
  // Without an OUTCOME line: a reply that cites nothing and asks something is a clarification question.
  const asks = check.cited.length === 0 && /\?/.test(answer);
  let outcome: Outcome =
    parsed.outcome ??
    (asks ? 'needs_clarification' : okCalls > 0 ? 'answered' : 'needs_clarification');
  // `answered` (and `no_matches`, which also reports on the data) requires at least one successful tool call.
  if ((outcome === 'answered' || outcome === 'no_matches') && okCalls === 0) {
    deps.onWithheld?.({ text, reason: 'answered_without_tool', failures: [] });
    return respond('tool_error', '', parsed.assumptions);
  }
  if (outcome === 'answered' && check.cited.length === 0 && evidence.items.length === 0)
    outcome = 'no_matches';
  return respond(outcome, answer, parsed.assumptions, { cited: check.cited.length });
}

function hasCause(e: unknown, cls: new (...a: never[]) => Error): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof cls) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
