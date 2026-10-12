#!/usr/bin/env node
/*
 * LESSON JUDGE — the half of lesson quality a regex cannot see.
 *
 * `lesson-quality.mjs` measures what text statistics can: sentence length, walls, shouting,
 * whether a picture exists and is pointed at. It cannot tell whether a lesson is TRUE to the
 * code, whether the picture shows the thing the question asked about, or whether a newcomer
 * would come away understanding it. Those need a reader. This file makes that reader repeatable:
 *
 *   1. A fixed rubric, five criteria, each with anchored 1/3/5 descriptions, so two judges (or one
 *      judge on two days) grade the same lesson the same way.
 *   2. PAIRWISE, not absolute: a judge is shown lesson X and lesson Y for the same question and
 *      picks one per criterion. Pairwise verdicts are far more stable than 1–10 scores, and an A/B
 *      is a pairwise question anyway.
 *   3. BOTH ORDERS. Every pair is judged X-then-Y and Y-then-X; a criterion where the two orders
 *      disagree is a tie, which removes the judge's position bias instead of averaging it in.
 *   4. A LEARNER CHECK: a second prompt gives a reader ONLY the lesson and asks the three questions
 *      the owner's ask implies ("what calls what, in order", "where does X happen", "what would
 *      break if Y"). The answers are graded against the repository, not against the lesson, so a
 *      fluent but wrong lesson loses.
 *
 * No provider is baked in. `--emit` writes the prompts as files for any model (or a person) to
 * answer; `--collect` reads the answers back and prints the tally. `judgePairs(pairs, ask)` takes
 * an async `ask(prompt) => text` for callers that have a model handle.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRITERIA = [
  {
    key: 'clear',
    name: 'Clear to a newcomer',
    1: 'Dense: long sentences, code names with no plain-words gloss, a reader must already know the system.',
    3: 'Mostly readable; a few unexplained names or one overloaded paragraph.',
    5: 'Short sentences; every code name is introduced with what it does in everyday words; one idea per paragraph.',
  },
  {
    key: 'visual',
    name: 'The picture carries it',
    1: 'No picture, or a picture unrelated to the question (a list of boxes, an order-of-mention chain).',
    3: 'A relevant picture the text mostly ignores, or a picture with the right parts in the wrong order.',
    5: 'The picture shows the flow the question asked about, in order, and the text walks through it step by step.',
  },
  {
    key: 'teaches',
    name: 'Teaches rather than reports',
    1: 'A status report or a file inventory; no "why", no example, no check of understanding.',
    3: 'Explains what and some why; an example or a question, not both.',
    5: 'Builds from what the learner knows, gives a concrete example or analogy, asks a question and answers it, closes on a check-in about a named part.',
  },
  {
    key: 'kind',
    name: 'Unthreatening voice',
    1: 'Shouts, lectures, interrogates, or makes the reader feel slow ("simply", "obviously", "you must").',
    3: 'Neutral and dry; neither warm nor harsh.',
    5: 'Warm and patient; long where it needs to be, but never a wall; invites rather than demands.',
  },
  {
    key: 'true',
    name: 'True to this repository',
    1: 'Invents files, routes or behaviour, or claims a flow the code does not have.',
    3: 'Real names, but at least one claim about behaviour is unsupported or wrong.',
    5: 'Every named part exists and every claim about what it does is supported by a cited file.',
  },
];

function rubricText() {
  return CRITERIA.map((c) => `- ${c.key} — ${c.name}\n    1: ${c[1]}\n    3: ${c[3]}\n    5: ${c[5]}`).join('\n');
}

/** The pairwise prompt. `first`/`second` are labelled 1 and 2 so the order is explicit. */
export function pairPrompt({ question, first, second, facts }) {
  return [
    'You are judging two answers to the same request from a person learning a codebase.',
    'The person wants to be taught: clear, visual, patient explanations, verbose if that helps, never a wall of text.',
    '',
    `THE REQUEST:\n${question}`,
    facts ? `\nFACTS ABOUT THE REPOSITORY (ground truth; use these to judge "true"):\n${facts}` : '',
    '\nRUBRIC (anchors for each criterion):',
    rubricText(),
    '\n=== ANSWER 1 ===',
    first,
    '\n=== ANSWER 2 ===',
    second,
    '\nFor EACH criterion, say which answer is better: 1, 2, or tie. Then one sentence on the single biggest difference.',
    'Reply with JSON only, exactly this shape:',
    '{"clear":"1|2|tie","visual":"1|2|tie","teaches":"1|2|tie","kind":"1|2|tie","true":"1|2|tie","overall":"1|2|tie","why":"..."}',
  ].join('\n');
}

/** The learner check: read only the lesson, answer the questions the ask implies. */
export function learnerPrompt({ lesson, questions }) {
  return [
    'You are a developer who has never seen this codebase. You have ONLY the lesson below; do not use outside knowledge of the project.',
    'Answer each question from the lesson alone. If the lesson does not tell you, answer exactly "not in the lesson".',
    '',
    '=== LESSON ===',
    lesson,
    '',
    ...questions.map((q, i) => `Q${i + 1}. ${q}`),
    '',
    'Reply with JSON only: {"answers":["...", "...", "..."]}',
  ].join('\n');
}

function parseJson(text) {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Merge the two orders of one pair into verdicts for A vs B.
 * `ab` is the judge's reply with A shown first; `ba` with B shown first.
 */
export function mergeOrders(ab, ba) {
  const out = {};
  for (const k of [...CRITERIA.map((c) => c.key), 'overall']) {
    const v1 = ab?.[k] === '1' ? 'A' : ab?.[k] === '2' ? 'B' : 'tie';
    const v2 = ba?.[k] === '1' ? 'B' : ba?.[k] === '2' ? 'A' : 'tie';
    out[k] = v1 === v2 ? v1 : 'tie';
  }
  return out;
}

/** Tally merged verdicts across pairs: wins per side per criterion. */
export function tally(merged) {
  const keys = [...CRITERIA.map((c) => c.key), 'overall'];
  const t = Object.fromEntries(keys.map((k) => [k, { A: 0, B: 0, tie: 0 }]));
  for (const m of merged) for (const k of keys) t[k][m[k] ?? 'tie']++;
  return t;
}

/**
 * Judge pairs with a live model. Each pair is {id, question, a, b, facts?}.
 * `ask` is `async (prompt) => string`.
 */
export async function judgePairs(pairs, ask) {
  const merged = [];
  for (const p of pairs) {
    const ab = parseJson(await ask(pairPrompt({ question: p.question, first: p.a, second: p.b, facts: p.facts })));
    const ba = parseJson(await ask(pairPrompt({ question: p.question, first: p.b, second: p.a, facts: p.facts })));
    merged.push({ id: p.id, ...mergeOrders(ab, ba), why: [ab?.why, ba?.why].filter(Boolean) });
  }
  return { merged, tally: tally(merged) };
}

/* ─────────────── offline mode: emit prompt files, collect answers ─────────────── */

function emit(pairsFile, outDir) {
  const pairs = JSON.parse(readFileSync(pairsFile, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const p of pairs) {
    writeFileSync(join(outDir, `${p.id}.ab.prompt.txt`), pairPrompt({ question: p.question, first: p.a, second: p.b, facts: p.facts }));
    writeFileSync(join(outDir, `${p.id}.ba.prompt.txt`), pairPrompt({ question: p.question, first: p.b, second: p.a, facts: p.facts }));
  }
  console.log(`wrote ${pairs.length * 2} prompts to ${outDir}; put each reply in <same name>.reply.txt`);
}

function collect(outDir) {
  const ids = [...new Set(readdirSync(outDir).filter((f) => f.endsWith('.ab.prompt.txt')).map((f) => f.replace('.ab.prompt.txt', '')))];
  const merged = [];
  for (const id of ids) {
    const r = (o) => {
      const f = join(outDir, `${id}.${o}.reply.txt`);
      return existsSync(f) ? parseJson(readFileSync(f, 'utf8')) : null;
    };
    const ab = r('ab');
    const ba = r('ba');
    if (!ab || !ba) continue;
    merged.push({ id, ...mergeOrders(ab, ba), why: [ab.why, ba.why].filter(Boolean) });
  }
  const t = tally(merged);
  console.log(`pairs judged in both orders: ${merged.length}`);
  for (const [k, v] of Object.entries(t)) console.log(`${k.padEnd(8)} A ${v.A}  B ${v.B}  tie ${v.tie}`);
  return { merged, tally: t };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === '--emit') emit(a, b);
  else if (cmd === '--collect') collect(a);
  else console.log('usage: lesson-judge.mjs --emit pairs.json outDir | --collect outDir\n  pairs.json: [{id, question, a, b, facts?}]');
}
