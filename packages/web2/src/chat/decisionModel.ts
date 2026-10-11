/* ══════════════════════════════════════════════════════════════════════════
   DECISIONS THE PERSON IS ASKED TO MAKE, FOUND IN AN ANSWER'S TAIL
   packages/web2/src/chat/decisionModel.ts

   An agent or Sequence's own ask often ends a turn with a plan and questions:
   "1. Should the cache be per user? 2. Keep the old route? (yes / no)", or a
   lead line and a list of options. The reader has to find the list, type an
   answer and send it. The decision card (DecisionCard.tsx) puts each option
   under the answer as a chip; this file finds them. No React, no DOM.

   WHAT COUNTS (all of it, or nothing; tightened by the 0.1.5 review, H2):
     the answer ENDS with a list: numbered (1. / 1)), lettered (a. / A)) or
     bulleted, followed by at most one short closing line that keeps the
     question open (it asks, or says "tell me" / "let me know");
     either most items are questions, "?" being their LAST character (so
     "Is it cached? No, it is wiped." is an answered question, not one
     asked): each is one question, its options read from sub-bullets, a
     trailing "(a / b / c)" or "A or B?"; a yes/no question gets Yes and No;
     or the LAST sentence of the line above the list asks (ends with "?",
     or choose / pick / prefer / decide; "what" and "which" only with a
     "?") and the items are short: one question, the items its options.
     With no list, an answer whose last sentence is a yes/no question put
     to the person ("Do you want me to ...?") gets Yes and No.
   A list inside a code fence, findings, FAQ and review notes that ask
   nothing are NOT decisions: a card on every answer would be noise the
   reader learns to skip.
   ══════════════════════════════════════════════════════════════════════════ */

export interface DecisionOption {
  /** The chip's text. */
  label: string;
  /** What the agent said after the label, for the chip's tooltip. */
  detail: string | null;
  /** What is sent when it is chosen. */
  send: string;
}

export interface DecisionQuestion {
  /** 1-based number as the agent numbered it. */
  n: number;
  text: string;
  options: DecisionOption[];
}

export interface DecisionSet {
  kind: 'questions' | 'options';
  /** The line above the list, when it asked something. */
  lead: string | null;
  questions: DecisionQuestion[];
}

const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 8;
const MAX_CLOSING = 240;

const ITEM = /^(\s*)(?:(\d{1,2})[.)]|([A-Za-z])[.)]|[-*•])\s+(.*\S)\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Markdown out of a phrase: bold, italics, code ticks and link syntax. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Item {
  marker: 'num' | 'let' | 'bul';
  text: string;
  subs: string[];
}

function parseTail(lines: string[]): { items: Item[]; before: string[]; closing: string[] } | null {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === '') end--;
  if (end === 0) return null;
  /* Walk back to the last list item; what lies after it is the closing line(s). */
  let last = -1;
  for (let i = end - 1; i >= 0 && end - i <= 4; i--) {
    if (ITEM.test(lines[i]!)) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;
  /* The list is contiguous items, their continuation lines and blank lines between items. */
  let start = last;
  for (let i = last - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.trim() === '') {
      let j = i - 1;
      while (j >= 0 && lines[j]!.trim() === '') j--;
      if (j >= 0 && (ITEM.test(lines[j]!) || /^\s{2,}\S/.test(lines[j]!))) continue;
      break;
    }
    if (ITEM.test(l) || /^\s{2,}\S/.test(l)) {
      start = i;
      continue;
    }
    break;
  }
  while (start < end && lines[start]!.trim() === '') start++;
  const block = lines.slice(start, last + 1);
  const top = Math.min(...block.filter((l) => ITEM.test(l)).map((l) => ITEM.exec(l)![1]!.length));
  const items: Item[] = [];
  for (const raw of block) {
    if (raw.trim() === '') continue;
    const m = ITEM.exec(raw);
    if (m && m[1]!.length <= top + 1) {
      items.push({ marker: m[2] ? 'num' : m[3] ? 'let' : 'bul', text: m[4]!, subs: [] });
    } else if (m && items.length) {
      items[items.length - 1]!.subs.push(m[4]!);
    } else if (items.length) {
      const it = items[items.length - 1]!;
      it.text = `${it.text} ${raw.trim()}`;
    }
  }
  return { items, before: lines.slice(0, start), closing: lines.slice(last + 1, end).filter((l) => l.trim() !== '') };
}

/** The label and detail of one option line. */
export function optionOf(raw: string): DecisionOption {
  const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:\-–—]?\s*(.*)$/.exec(raw.trim());
  let label: string;
  let detail: string;
  if (bold) {
    label = plain(bold[1]!).replace(/[:\-–—]\s*$/, '');
    detail = plain(bold[2]!);
  } else {
    const whole = plain(raw);
    const cut = /\s[—–-]\s/.exec(whole);
    if (cut && cut.index >= 2 && cut.index <= 60) {
      label = whole.slice(0, cut.index);
      detail = whole.slice(cut.index + cut[0].length);
    } else {
      label = whole;
      detail = '';
    }
  }
  /* The chip may be shortened; what is sent never is. */
  const full = label;
  if (label.length > 70) {
    detail = detail ? `${label}. ${detail}` : label;
    label = `${label.slice(0, 67).trimEnd()}...`;
  }
  /* "A" / "Option B" alone say little when sent: carry what it stands for. */
  const bare = /^(?:option\s+)?[A-Za-z0-9]$/i.test(label);
  const send = bare && detail ? `${label}: ${detail}` : full;
  return { label, detail: detail || null, send };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/* A question word or auxiliary: the left of "X or Y?" that starts with one is not itself a choice. */
const QWORD = /^(?:which|what|who|where|when|why|how|is|are|was|were|do|does|did|should|shall|can|could|would|will|has|have|may|must)\b/i;

const YES_NO = /^(?:do|does|did|is|are|was|were|should|shall|can|could|would|will|want|have|has|may)\b/i;

/** Choices written into the question itself: "(a / b / c)", "A or B?". */
function inlineOptions(q: string): string[] {
  const par = /\(([^()]{3,120})\)\s*\??\s*$/.exec(q);
  if (par) {
    const parts = par[1]!
      .split(/\s*(?:\/|,|;|\bor\b)\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2 && parts.length <= 5 && parts.every((p) => p.length <= 40 && p.split(/\s+/).length <= 5)) return parts;
  }
  /* "X or Y?": each side is a whole choice, verb kept ("Keep the old route" / "Remove it"). */
  const or = /^(.*?)\s+or\s+([^?]+?)\s*\?\s*$/i.exec(q);
  if (or && !/\sor\s/i.test(or[2]!)) {
    let left = or[1]!.trim();
    const right = or[2]!.trim();
    const colon = left.lastIndexOf(':');
    if (colon >= 0) left = left.slice(colon + 1).trim();
    const rw = right.split(/\s+/).length;
    /* "Should we ship today or wait ...?": the person picks one of two things to do. */
    const aux = /^(?:should|shall|do|would|will|can|could|must)\s+(?:we|i|you)\s+(.+)$/i.exec(left);
    if (aux && aux[1]!.split(/\s+/).length <= 8 && rw <= 8) return [cap(aux[1]!), cap(right)];
    const lw = left.split(/\s+/);
    /* "Keep the old route or remove it?", "SQLite or Redis?" */
    if (left && !QWORD.test(left) && lw.length <= 8 && rw <= 8) return [cap(left), cap(right)];
    /* "Should the cache be per user or shared?": which words the choice spans is unclear; only short ones. */
    if (lw.length <= 4 && rw <= 3) return [lw.slice(-3).join(' '), right];
  }
  return [];
}

/**
 * A question put to the reader: "?" is its LAST character (a trailing "(a / b)" of choices may follow it).
 * "Is it cached? No, the dir is wiped." is a question already answered, not one asked.
 */
export function endsAsking(s: string): boolean {
  const t = s.trim();
  return /\?$/.test(t) || /\?\s*\([^()]{1,120}\)$/.test(t);
}

function questionOf(it: Item, n: number): DecisionQuestion {
  const text = plain(it.text);
  let options: DecisionOption[];
  if (it.subs.length >= 2) options = it.subs.slice(0, MAX_OPTIONS).map(optionOf);
  else {
    const inline = inlineOptions(text);
    if (inline.length) options = inline.map((l) => optionOf(l));
    else if (YES_NO.test(text) && endsAsking(text)) options = [optionOf('Yes'), optionOf('No')];
    else options = [];
  }
  return { n, text, options };
}

/* Words that ask for a choice without a "?". "what" and "which" are not here: "Here is what I found:"
   asks nothing; they ask only in a sentence that ends with "?". */
const ASKS = /\b(choose|pick|prefer|decide|select|how would you|how do you|want me to|would you like|let me know|your call|up to you)\b/i;

/** Sentences of a line of prose (a ":" ends the lead-in sentence of a list). */
function sentences(s: string): string[] {
  return s
    .split(/(?<=[.!?:])\s+(?=\S)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The lead's LAST sentence, when it asks (ends with "?", or uses a word that asks for a choice). Earlier sentences do not count. */
function askingSentence(lead: string): string | null {
  const last = sentences(lead).pop();
  if (!last) return null;
  const bare = last.replace(/:\s*$/, '').trim();
  if (endsAsking(bare)) return bare;
  if (ASKS.test(bare) && !/[.!]$/.test(bare)) return bare;
  return null;
}

/** A closing line after the list still leaves the decision open: it asks, or invites the answer. */
function closingInvites(closing: string): boolean {
  if (!closing) return true;
  const last = sentences(closing).pop() ?? '';
  return endsAsking(last) || /\b(tell me|let me know|reply|answer|once you|your call|pick|choose|which)\b/i.test(closing);
}

/* A yes/no question put to the person, as the answer's very last sentence: "Do you want me to also update the docs?". */
const DIRECT_ASK = /^(?:do you want me to|would you like me to|want me to|should i|shall i|can i go ahead|may i|ok to|okay to)\b/i;

/** The decisions the answer's tail puts to the person, or null. */
export function detectDecisions(answer: string): DecisionSet | null {
  if (!answer || answer.length < 12) return null;
  const lines = answer.split(/\r?\n/);
  /* An unclosed fence: the tail is code, not a list. */
  if (lines.filter((l) => FENCE.test(l)).length % 2 === 1) return null;
  const tail = parseTail(lines);
  if (!tail || tail.items.length === 0) return lastQuestion(lines);
  const { items, before, closing } = tail;
  if (closing.join(' ').length > MAX_CLOSING || closing.some((l) => ITEM.test(l))) return null;
  /* A line that only looks like a list item inside a fence that closes after it. */
  if (closing.some((l) => FENCE.test(l))) return null;
  const ordered = items.filter((i) => i.marker !== 'bul').length >= Math.ceil(items.length / 2);
  let leadLine = '';
  for (let i = before.length - 1; i >= 0; i--) {
    const l = before[i]!.trim();
    if (l === '') {
      if (leadLine) break;
      continue;
    }
    if (FENCE.test(l)) break;
    if (/^#{1,6}\s/.test(l)) {
      if (!leadLine) leadLine = l.replace(/^#{1,6}\s+/, '');
      break;
    }
    leadLine = leadLine ? `${l} ${leadLine}` : l;
    if (leadLine.length > 400) break;
  }
  const lead = plain(leadLine);
  const closingText = plain(closing.join(' '));
  /* The question must be the last thing said: anything after the list has to keep it open. */
  if (!closingInvites(closingText)) return null;
  const asked = askingSentence(lead);

  const questionItems = items.filter((i) => endsAsking(plain(i.text)));
  if (questionItems.length >= Math.max(1, Math.ceil(items.length / 2)) && (ordered || questionItems.length === items.length)) {
    const qs = items
      .map((it, i) => questionOf(it, i + 1))
      .filter((q) => endsAsking(q.text) && q.options.length > 0)
      .slice(0, MAX_QUESTIONS);
    if (qs.length === 0) return null;
    return { kind: 'questions', lead: asked, questions: qs };
  }

  const closingAsk = sentences(closingText).pop() ?? '';
  const short = items.every((i) => plain(i.text).length <= 180 && i.subs.length === 0);
  if (short && items.length >= 2 && items.length <= MAX_OPTIONS && (asked || (ordered && endsAsking(closingAsk)))) {
    const question = asked ?? closingAsk;
    return {
      kind: 'options',
      lead: null,
      questions: [{ n: 1, text: question, options: items.map((i) => optionOf(i.text)) }],
    };
  }
  return null;
}

/** No list at the end: a card only when the answer's last sentence is a yes/no question put to the person. */
function lastQuestion(lines: string[]): DecisionSet | null {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === '') end--;
  if (end === 0 || FENCE.test(lines[end - 1]!)) return null;
  const last = sentences(plain(lines[end - 1]!)).pop() ?? '';
  if (!/\?$/.test(last) || !DIRECT_ASK.test(last) || last.length > 200) return null;
  return { kind: 'questions', lead: null, questions: [{ n: 1, text: last, options: [optionOf('Yes'), optionOf('No')] }] };
}

/**
 * The message that carries the chosen answers back, each with its question ("1. Should I bump the version? Yes"),
 * so a bare "No" never lands without what it answers. One question is one line; several are numbered.
 */
export function composeAnswer(set: DecisionSet, chosen: Readonly<Record<number, string>>): string | null {
  const given = set.questions.filter((q) => (chosen[q.n] ?? '').trim());
  if (given.length === 0) return null;
  const line = (q: DecisionQuestion): string => `${q.text} ${chosen[q.n]!.trim()}`;
  if (set.questions.length === 1) return line(given[0]!);
  return given.map((q) => `${q.n}. ${line(q)}`).join('\n');
}

export interface PlanRow {
  text: string;
  status: 'pending' | 'active' | 'done';
}

/**
 * The plan an answer lays out in words: a list under a short heading or lead line that says "plan",
 * "steps" or "approach" (and holds no question). Used only when the agent gave no structured plan.
 */
export function planFromText(answer: string): PlanRow[] {
  const lines = answer.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) inFence = !inFence;
    if (inFence) continue;
    const head = lines[i]!.trim();
    if (!head || head.length > 80 || ITEM.test(lines[i]!) || !/\b(plan|steps|approach)\b/i.test(head)) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    const rows: string[] = [];
    for (; j < lines.length; j++) {
      const m = ITEM.exec(lines[j]!);
      if (m && m[1]!.length <= 1) rows.push(plain(m[4]!));
      else if (lines[j]!.trim() === '' && rows.length) continue;
      else if (m || /^\s{2,}\S/.test(lines[j]!)) continue;
      else break;
    }
    if (rows.length >= 2 && rows.length <= 12 && !rows.some((r) => r.includes('?'))) return rows.map((text) => ({ text, status: 'pending' as const }));
  }
  return [];
}

/** ACP plan entries (pending / in_progress / completed) as checklist rows. */
export function planRowsFromEntries(entries: readonly { content: string; status: string }[]): PlanRow[] {
  return entries
    .filter((e) => e.content.trim())
    .map((e) => ({ text: e.content.trim(), status: e.status === 'completed' ? 'done' : e.status === 'in_progress' ? 'active' : 'pending' }));
}

/** Sequence's own todo list as checklist rows. */
export function planRowsFromTodos(items: readonly { title: string; status: string }[]): PlanRow[] {
  return items.map((t) => ({ text: t.title, status: t.status === 'done' ? 'done' : t.status === 'active' ? 'active' : 'pending' }));
}
