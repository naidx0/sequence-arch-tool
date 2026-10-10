/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT ASKS THE PERSON A QUESTION — codex's request_user_input
   packages/acp/src/questions.ts

   Live 2026-10-06 (lab/codex-live-gate.md): in Plan, codex asked "What should
   the health endpoint represent?" with three options, as the server request
   `item/tool/requestUserInput`. Sequence answered -32601, so codex went on
   with its own assumption and the person never saw the question.

   PROTOCOL SOURCE. The shapes are codex-cli 0.153.4's own generated types
   (`codex app-server generate-ts`, all marked EXPERIMENTAL):
     ToolRequestUserInputParams   { threadId, turnId, itemId, questions,
                                    isBlocking, autoResolutionMs }
     ToolRequestUserInputQuestion { id, header, question, isOther, isSecret,
                                    options: { label, description }[] | null }
     ToolRequestUserInputResponse { answers: { [questionId]: { answers: string[] } } }
   and the request frame recorded live is the fixture
   (src/test/fixtures/replay/codex-question/).

   No answer is `{ answers: {} }`: a valid response that says the person gave
   none. That is what Cancel, a turn that ends while the question waits, and a
   caller with no surface for questions all send, so codex is never left
   waiting on a request nobody will answer.

   PURE. Parsing and building only; codexAppServer.ts does the wire.
   ══════════════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;

export interface AgentQuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestion {
  id: string;
  /** A short heading ("Endpoint scope"). */
  header: string;
  question: string;
  /** The person may answer in their own words as well as by option. */
  isOther: boolean;
  /** The answer is a secret: never echoed back on screen. */
  isSecret: boolean;
  options: AgentQuestionOption[];
}

/** One request from the agent: one or more questions answered together. */
export interface AgentQuestionRequest {
  sessionId: string;
  turnId: string | null;
  /** The tool call the questions belong to. */
  itemId: string;
  questions: AgentQuestion[];
}

/** Question id -> the answers given (an option's label, or the person's own words). */
export type AgentQuestionAnswers = Record<string, string[]>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The questions in a `item/tool/requestUserInput` request's params; malformed entries are dropped. */
export function codexQuestionsOf(p: Json): AgentQuestion[] {
  const raw = Array.isArray(p.questions) ? (p.questions as unknown[]) : [];
  const out: AgentQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue;
    const x = q as Json;
    if (typeof x.id !== 'string' || x.id === '') continue;
    const options = Array.isArray(x.options)
      ? (x.options as unknown[])
          .filter((o): o is Json => !!o && typeof o === 'object' && typeof (o as Json).label === 'string')
          .map((o) => ({ label: o.label as string, description: str(o.description) }))
      : [];
    out.push({ id: x.id, header: str(x.header), question: str(x.question), isOther: x.isOther === true, isSecret: x.isSecret === true, options });
  }
  return out;
}

/** The request as the caller sees it. */
export function codexQuestionRequestOf(p: Json, fallbackSessionId: string): AgentQuestionRequest {
  return {
    sessionId: typeof p.threadId === 'string' ? p.threadId : fallbackSessionId,
    turnId: typeof p.turnId === 'string' ? p.turnId : null,
    itemId: str(p.itemId),
    questions: codexQuestionsOf(p),
  };
}

/**
 * The JSON-RPC result codex expects (ToolRequestUserInputResponse). Only
 * questions that were asked, and only non-empty strings, go back; null (no
 * answer) is `{ answers: {} }`.
 */
export function codexQuestionResponse(answers: AgentQuestionAnswers | null, asked: readonly AgentQuestion[]): { answers: Record<string, { answers: string[] }> } {
  const out: Record<string, { answers: string[] }> = {};
  if (!answers) return { answers: out };
  for (const q of asked) {
    const given = answers[q.id];
    if (!Array.isArray(given)) continue;
    const clean = given.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim());
    if (clean.length) out[q.id] = { answers: clean };
  }
  return { answers: out };
}

/** Whether `v` is a well-formed answers map (question id -> strings), for the server's endpoint. */
export function isQuestionAnswers(v: unknown): v is AgentQuestionAnswers {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Json).every((a) => Array.isArray(a) && a.every((s) => typeof s === 'string'));
}
