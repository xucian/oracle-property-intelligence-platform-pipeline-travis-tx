import { CITABLE, type EvidenceCollector } from './evidence.js';

/**
 * The citation check (api-contract.md, `POST /v1/agent/chat`): every `[[kind:id]]` token in the answer must name a record
 * a tool returned in this turn, and every CID written in the answer must be one a tool returned. Anything else fails
 * closed: the server returns no answer text and `outcome: "tool_error"`.
 */
export interface CitationCheck {
  ok: boolean;
  cited: { kind: string; id: string }[];
  failures: { token: string; reason: string }[];
}

const TOKEN = /\[\[([^\]\n]*)\]\]/g;
/** CIDv1 in base32 (`bafy…`, `bagu…`) as the dataset writes them. */
const CID = /\bba[a-z2-7]{40,}\b/g;

export function checkCitations(answer: string, evidence: EvidenceCollector): CitationCheck {
  const cited: CitationCheck['cited'] = [];
  const failures: CitationCheck['failures'] = [];
  for (const m of answer.matchAll(TOKEN)) {
    const token = m[0];
    const inner = m[1]!;
    const colon = inner.indexOf(':');
    if (colon <= 0) {
      failures.push({ token, reason: 'malformed citation token' });
      continue;
    }
    const kind = inner.slice(0, colon).trim();
    const id = inner.slice(colon + 1).trim();
    const evidenceKind = CITABLE[kind];
    if (!evidenceKind) {
      failures.push({ token, reason: `unknown citation kind ${kind}` });
      continue;
    }
    if (!id || !evidence.has(evidenceKind, id)) {
      failures.push({ token, reason: `no tool returned ${kind} ${id} in this turn` });
      continue;
    }
    cited.push({ kind, id });
  }
  for (const m of answer.matchAll(CID)) {
    if (!evidence.cids.has(m[0]))
      failures.push({ token: m[0], reason: 'no tool returned this CID in this turn' });
  }
  return { ok: failures.length === 0, cited, failures };
}
