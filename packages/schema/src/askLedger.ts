/* ══════════════════════════════════════════════════════════════════════════
   THE ASK LEDGER: EVERY REQUEST IN A MESSAGE GETS CLOSED, OR THE PAGE SAYS SO
   packages/schema/src/askLedger.ts

   People send one message with several requests in it, often dictated.
   Agents do the biggest one and the small ones fall out of the final report.

   The harness does not split the message itself. A splitter measured on a
   sealed set (harness-study/t3gap/asks) miscounted most messages and split
   single requests into several. Instead, a short private instruction asks the
   AGENT to end a multi-request reply with one closing line, naming each
   request in its own words:

     <asks>1 fix the login redirect: done; 2 add a test: not done: no runner</asks>

   The harness only parses that line. It must be the very last line of the
   reply, and every entry in it must match the grammar; anything else is left
   as the agent's text. A single-request reply has no line, and no line means nothing is
   shown. The line is the agent's self-report: advisory, never proof.
   ══════════════════════════════════════════════════════════════════════════ */

export const ASK_TRAILER_TAG = 'asks';

/** The private instruction appended after the person's words when the setting is on. */
export const ASK_LEDGER_INSTRUCTION = [
  '',
  '',
  '[Added by the app, not typed by the person; do not mention it.]',
  'If the message above contains several separate requests, end your reply with one final line, and nothing after it:',
  '<asks>1 <request in your own words>: done; 2 <request>: not done: <reason></asks>',
  'listing every request. For a single request, write no such line.',
].join('\n');

export interface AskClosure {
  n: number;
  /** The request in the agent's words ('' when it gave only a number). */
  text: string;
  done: boolean;
  reason: string | null;
}

/** What a turn's result carries when the ledger was on and the reply ended on the line. */
export interface AskLedgerResult {
  closures: AskClosure[];
  /** Numbers of the requests the agent reported as not done. */
  open: number[];
}

/**
 * The closing line, when the reply's last non-empty line is exactly one
 * `<asks>…</asks>`. Returns the line's body and the reply without it.
 */
function finalLine(reply: string): { body: string; rest: string } | null {
  const trimmed = reply.replace(/\s+$/, '');
  const nl = trimmed.lastIndexOf('\n');
  const last = trimmed.slice(nl + 1).trim();
  const m = /^<asks>([^<>]*)<\/asks>$/i.exec(last);
  if (!m) return null;
  /* Inside an open code fence the line is quoted text, not the closing line. */
  const before = nl >= 0 ? trimmed.slice(0, nl) : '';
  if (((before.match(/^\s*```/gm) ?? []).length) % 2 === 1) return null;
  return { body: m[1], rest: before.replace(/\s+$/, '') };
}

/** One entry: "1 x: done", "1 - done", "Ask 1: done", "1. done", "#2 not done: why", "2 y: failed, why". */
const ENTRY =
  /^\s*(?:ask|request|item)?\s*#?(\d+)\s*[.):\-–—]?\s*(?:(.*?)\s*[:\-–—=]\s*)?(not\s+done|done|completed|failed|blocked|skipped|declined|partly done|partial)\s*(?:[:\-–—,(]\s*(.*?)\)?\s*)?$/i;

/** A comma that starts the next entry: ", 2 …", ", #2 …", ", ask 2 …". */
const COMMA_ENTRY = /\s*,\s*(?=(?:ask|request|item)?\s*#?\d+\b)/i;

function entry(part: string): AskClosure | null {
  const m = ENTRY.exec(part);
  if (!m) return null;
  const done = /^(done|completed)$/i.test(m[3].trim());
  return { n: Number(m[1]), text: (m[2] ?? '').trim(), done, reason: done ? null : (m[4] ?? '').trim() || null };
}

/** Every entry of the line, or null when any one of them is outside the grammar. */
function entries(body: string): AskClosure[] | null {
  const closures: AskClosure[] = [];
  for (const part of body.split(/\s*;\s*|\s*\|\s*/)) {
    if (!part.trim()) continue;
    const pieces = part.split(COMMA_ENTRY);
    const split = pieces.length > 1 ? pieces.map(entry) : [];
    if (split.length > 1 && split.every((c) => c)) {
      closures.push(...(split as AskClosure[]));
      continue;
    }
    const one = entry(part);
    if (!one) return null;
    closures.push(one);
  }
  return closures.length ? closures : null;
}

/**
 * The agent's report. Null (nothing shown, nothing cut) unless the reply ends
 * on the closing line AND every entry in it parses: a line the app can't read
 * whole stays in the reply, so the agent's own "failed" is never hidden.
 */
export function parseAskLine(reply: string): AskLedgerResult | null {
  const line = finalLine(reply);
  const closures = line ? entries(line.body) : null;
  if (!closures) return null;
  return { closures, open: closures.filter((c) => !c.done).map((c) => c.n) };
}

/**
 * The reply as the person sees it on a ledger run: a well-formed closing line
 * at the very end is removed; while streaming, a line that has begun to be
 * "<asks…" at the very end is hidden too. Nothing else is ever touched.
 */
export function stripAskLine(reply: string, streaming = false): string {
  const line = finalLine(reply);
  if (line && entries(line.body)) return line.rest;
  if (streaming) {
    const m = /(^|\n)[ \t]*<(?:a(?:s(?:k(?:s(?:>[^<>\n]*(?:<(?:\/(?:a(?:s(?:k(?:s)?)?)?)?)?)?)?)?)?)?)?$/i.exec(reply);
    if (m) return reply.slice(0, m.index).replace(/\s+$/, '');
  }
  return reply;
}

const ASK_AGAIN_LEAD = 'Your reply marked';

/** Whether a message is the ledger's own follow-up. */
export function isAskAgain(message: string): boolean {
  return message.startsWith(ASK_AGAIN_LEAD);
}

/** The one follow-up turn: names the requests the agent reported as not done. */
export function followUpPrompt(open: readonly { text: string; reason?: string | null }[]): string {
  const lines = open.map((a) => `- ${a.text || '(unnamed request)'}${a.reason ? ` (you said: ${a.reason})` : ''}`);
  return `${ASK_AGAIN_LEAD} ${open.length === 1 ? 'this request' : 'these requests'} not done:\n${lines.join('\n')}\nDo ${open.length === 1 ? 'it' : 'them'} now if you can; otherwise say what you need from me.`;
}
