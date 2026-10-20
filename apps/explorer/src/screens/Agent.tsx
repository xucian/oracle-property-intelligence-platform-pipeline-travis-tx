import { useState, type FormEvent } from 'react';
import { ApiError } from '@travis/api-client';
import { useApi } from '../api.js';
import { Section } from '../components/common.js';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const REASON: Record<string, string> = {
  model_unavailable: 'the model is not enabled yet',
  budget_exhausted: 'the daily model budget is used up',
  circuit_open: 'the model circuit breaker is open',
};

/** Demo step 9 (agent): stateless chat; until T9 the API answers 503 agent_unavailable and the panel says so. */
export function Agent() {
  const api = useApi();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState(
    'Which properties in Travis County within five miles of Austin have roofs older than 15 years?',
  );
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const next: Turn[] = [...turns, { role: 'user', content: draft }];
    setTurns(next);
    setBusy(true);
    setUnavailable(null);
    setError(null);
    try {
      const response = (await api.agentChat({ messages: next })) as { answer?: string };
      setTurns([...next, { role: 'assistant', content: response.answer ?? '' }]);
      setDraft('');
    } catch (err) {
      if (err instanceof ApiError && err.isAgentUnavailable) {
        const reason = typeof err.detail === 'string' ? err.detail : '';
        setUnavailable(
          `agent_unavailable: the agent cannot answer right now (${REASON[reason] ?? (reason || 'no reason given')}).${err.requestId ? ` Request ${err.requestId}.` : ''}`,
        );
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Agent chat">
      <p className="muted">
        The agent answers from the same API tools as the lead queries and cites source records. It
        is stateless: the whole conversation is sent each turn.
      </p>
      {turns.map((t, i) => (
        <p key={i} className={`turn ${t.role}`}>
          <strong>{t.role}:</strong> {t.content}
        </p>
      ))}
      <form onSubmit={(e) => void send(e)}>
        <textarea
          aria-label="Message"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={busy || draft.trim() === ''}>
          {busy ? 'Asking…' : 'Ask the agent'}
        </button>
      </form>
      {unavailable ? (
        <p className="notice" role="status" data-testid="agent-unavailable">
          {unavailable}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </Section>
  );
}
