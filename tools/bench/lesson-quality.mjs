#!/usr/bin/env node
/*
 * LESSON QUALITY — does a teach turn read as clear, visual, teaching and unthreatening?
 *
 * The teach grader (`gradeTeachTurn`) and the live battery judge answer "did the turn obey the
 * contract" and "did it reach the right parts of the repository". Neither answers the owner's
 * question about the OUTPUT itself: is this lesson easy to read, does the picture carry it, does it
 * teach rather than lecture, and does it avoid the voice that makes a learner feel stupid. This
 * file measures that, deterministically, from the text (and the chart when the caller has it).
 *
 * Length is NOT penalised. The owner wants lessons that are verbose in a way that is easy to
 * understand, so the scorer measures DENSITY (sentence length, walls of prose, identifiers per
 * sentence, shouting) rather than word count. A long lesson made of short, glossed, chunked
 * sentences scores well; a short one that is a single 60-word sentence full of backticks does not.
 *
 * No dependencies, no model, no network. Used three ways:
 *   node tools/bench/lesson-quality.mjs lesson.md               one lesson → table
 *   node tools/bench/lesson-quality.mjs runs/ --json             every .md/.txt/.jsonl under a dir
 *   node tools/bench/lesson-quality.mjs --ab A/ B/               two variants, matched by file name
 * and imported: `import { scoreLesson, compareVariants } from './lesson-quality.mjs'`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────── text preparation ─────────────────────────── */

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;

/** Split a lesson into prose (what a learner reads as sentences) and its fenced blocks. */
export function splitLesson(text) {
  const fences = [];
  const prose = String(text ?? '').replace(FENCE, (_m, lang, body) => {
    fences.push({ lang: (lang || '').toLowerCase(), body });
    return '\n\n';
  });
  return { prose, fences };
}

/** Prose with inline code, paths and links reduced to a single placeholder word each. */
function plainWords(prose) {
  return prose
    .replace(/`[^`\n]+`/g, ' CODE ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?:[\w.-]+\/)+[\w.-]+(?::\d+(?:-\d+)?)?/g, ' PATH ')
    .replace(/[#>*_|]/g, ' ');
}

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|approx|cf|Mr|Dr|No)\.\s/g;

/** Sentences of the prose, one bullet or line item counting as one sentence. */
export function sentencesOf(prose) {
  const lines = plainWords(prose)
    .replace(ABBREV, (m) => m.replace('.', ''))
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-+•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(“])/)) {
      const t = s.trim();
      if (t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length >= 2) out.push(t);
    }
  }
  return out;
}

function wordsOf(s) {
  return s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
}

/** Syllables by vowel groups; good enough for a grade estimate, and stable across runs. */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w === 'code' || w === 'path') return 1;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Paragraphs of prose: blank-line separated, with list runs counted as one chunk per item. */
function paragraphsOf(prose) {
  const chunks = [];
  for (const block of prose.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const isList = lines.every((l) => /^\s*(?:[-+*•]|\d+[.)])\s+/.test(l) || /^\s{2,}\S/.test(l));
    if (isList) for (const l of lines) chunks.push(l);
    else chunks.push(lines.join(' '));
  }
  return chunks.map((c) => wordsOf(plainWords(c)).length).filter((n) => n > 0);
}

/* ─────────────────────────── vocabularies ─────────────────────────── */

/* Words that put a learner on the back foot. Each is ordinary in a code review and costly in a
 * lesson: "simply"/"just"/"obviously" tell a confused reader the confusion is theirs; "wrong" and
 * "failed" aimed at the reader are the d = −0.14 discouraging-feedback cell. */
const DISMISSIVE = /\b(?:simply|obviously|clearly|of course|trivially|trivial|just|easy|easily|everyone knows|as you (?:should )?know|needless to say)\b/gi;
const HARSH_AT_READER = /\b(?:you(?:'re| are)? (?:wrong|incorrect|mistaken|confused)|that(?:'s| is) (?:wrong|incorrect)|you (?:failed|missed|forgot)|no,)\b/gi;
const COMMANDS = /\b(?:you must|you need to|you have to|make sure you|do not|don't|never)\b/gi;
const WARM = /\b(?:you|your|we|let's|us|our)\b/gi;
const ANALOGY = /\b(?:like a|like an|think of|imagine|picture this|for example|for instance|e\.?g\.?|say you|suppose|it's as if|similar to|a real example|an example from)\b/gi;
const NOT_COVERING = /\b(?:skipping|not covering|leave (?:that|this) for|for now|later lesson|next turn|we'll come back|set aside)\b/gi;
const VISUAL_REF = /\b(?:chart|diagram|picture|drawing|the board|on the canvas|highlighted|arrow|arrows|box|boxes|step \d|hop|the flow (?:above|below|on)|left|right|top|bottom|lit|spotlight)\b/gi;

/* Our own tool vocabulary, which the belt already forbids aiming at a learner. Counted here as
 * output hygiene so an A/B can see it, not as a bounce. */
const TOOL_VOCAB = /\b(?:propose_chart|propose_topology|read_topology|trace_flow|read_file|search_code|canvas\.write_\w+|nodeId|focusItemId|seqd|SeqDiagram|sequence-tool|json blocks?|system-architecture|data-flow chart kind|tool call)\b/g;

const CLARIFYING = /\b(?:would you like|do you want|shall i|should i|which (?:one )?would you prefer|let me know (?:if|which|what)|what would you like|prefer (?:the|a) )/i;
const PLANNING_OPEN = /^\s*(?:okay[,.]?\s*)?(?:i need to|i'll (?:start|begin|first|now)|let me (?:start|first|check|look|read|search|think)|first,? i (?:will|need)|i am going to|i'm going to)\b/i;
const DRAW_PROMISE = /\b(?:let me|i(?:'| wi)ll|i will|i am going to|i'm going to|now i(?:'ll| will)?)\s+(?:draw|sketch|chart|render|put|show)\b[^.!?]{0,80}[.!?]?\s*$/i;
/* A turn that hands the work back instead of teaching: a greeting that asks what to do, a stop note,
 * a refusal that the surface or the file does not exist, or asking the learner to verify files.
 * All five were real minicpm5 turns in the owner's chat (09-22). */
const DEFLECT = /\b(?:i have not written an answer|rather than guess at one|can you confirm which files|isn't a valid surface|is not a valid surface|there is no readme|once i know what you need|what are you working on|nothing (?:was drawn|landed) on the)\b/i;
const LEAK = /<\/?think>|```sequence-tool|<tool_call>|"name"\s*:\s*"(?:read_file|propose_chart|trace_flow)"/i;
/* MiniCPM5's native tool calls are XML (<function name="x"><param name="p">). Ollama strips those
 * special tokens before any parser sees them (ollama#18483), so a call lands in the answer as
 * debris like `name="read_file"> name="path">app/main.py`. That is a serving fault, not the model
 * refusing to teach, and an A/B has to tell the two apart. */
const TOOL_DEBRIS = /<\/?(?:function|param|tool_response)\b|\bname="[\w.]+">\s*(?:name="|[\w./-]+)|sequence-tool \)/;

/* Acronyms a learner reads as words; everything else in ALL CAPS reads as shouting. */
const ACRONYMS = new Set(
  (
    'API APIS HTTP HTTPS JSON YAML HTML CSS CPU GPU TPU RAM VRAM LLM LLMS SQL URL URLS CLI UI UX SDK ' +
    'LORA QLORA RLHF DPO PPO GRPO SFT RL ML AI NLP OOM EOS BOS KV MLP CUDA ONNX GGUF REST RPC GRPC ' +
    'TCP UDP DNS SSH AWS GCP JWT OAUTH CRUD ORM IO README TODO PR CI CD NPM PNPM SSE WASM CORS CSRF ' +
    'SPA JSX TSX SQLITE UUID MCP'
  ).split(' '),
);

/* ─────────────────────────── the scorer ─────────────────────────── */

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const per100 = (n, words) => (words ? (100 * n) / words : 0);
const count = (re, s) => (s.match(re) || []).length;
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/* Map a raw measurement onto 0–100 between a "good" and a "bad" anchor, linearly. */
function band(x, good, bad) {
  if (x == null) return null;
  const t = (x - good) / (bad - good);
  return clamp(100 * (1 - t));
}

/**
 * Score one lesson.
 * @param {string} text the assistant's lesson as the learner reads it (markdown)
 * @param {{chart?: {items?: Array<{label?: string, id?: string}>, steps?: unknown[], links?: unknown[]} | null,
 *          drew?: boolean}} [opts] the chart the turn landed, when the caller has the stream events
 */
export function scoreLesson(text, opts = {}) {
  const raw = String(text ?? '');
  const { prose, fences } = splitLesson(raw);
  const sentences = sentencesOf(prose);
  const sentWords = sentences.map((s) => wordsOf(s).length);
  const words = sentWords.reduce((a, b) => a + b, 0);
  const allWords = sentences.flatMap(wordsOf);
  const syl = allWords.reduce((a, w) => a + syllables(w), 0);
  const paras = paragraphsOf(prose);

  // ── readability
  const avgSentence = sentWords.length ? words / sentWords.length : null;
  const longShare = sentWords.length ? sentWords.filter((n) => n > 28).length / sentWords.length : null;
  const fkGrade = sentWords.length && words ? 0.39 * (words / sentWords.length) + 11.8 * (syl / words) - 15.59 : null;
  const longestPara = paras.length ? Math.max(...paras) : 0;
  const walls = paras.filter((n) => n > 90).length;

  // ── jargon
  const inlineCode = count(/`[^`\n]+`/g, prose);
  const paths = count(/(?:[\w.-]+\/)+[\w.-]+\.\w+(?::\d+)?/g, prose.replace(/`[^`\n]+`/g, ''));
  const idPerSentence = sentences.length ? (inlineCode + paths) / sentences.length : null;
  const toolVocab = count(TOOL_VOCAB, prose);
  // a sentence with five or more comma-separated items is a list read aloud, not an explanation
  const listDumps = sentences.filter((s) => (s.match(/,/g) || []).length >= 4).length;
  const capsWords = (prose.replace(/`[^`\n]+`/g, '').match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !ACRONYMS.has(w));

  // ── tone
  const dismissive = count(DISMISSIVE, prose);
  const harsh = count(HARSH_AT_READER, prose);
  const commands = count(COMMANDS, prose);
  const exclaim = count(/!(?!\[)/g, prose);
  const warm = count(WARM, prose);

  // ── teaching shape
  const trimmed = prose.trim().replace(/\s+$/, '');
  const questionSentences = sentences.filter((s) => /\?["'”)\]]?$/.test(s));
  const lastSentence = sentences[sentences.length - 1] ?? '';
  const endsWithQuestion = /\?["'”)\]]?\s*$/.test(trimmed);
  const closingClarifying = endsWithQuestion && CLARIFYING.test(lastSentence);
  const closingConcrete = endsWithQuestion && (/`[^`]+`|[\w-]+\.\w{1,4}\b|\b[A-Z][a-z]+[A-Z]\w*|\b[a-z]+_[a-z_]+\b/.test(lastSentence) || /\b(?:the|this|that)\s+\w+\s+(?:service|module|file|function|step|layer|loop|queue|gate|model|trainer|adapter)\b/i.test(lastSentence));
  let midAnswered = 0;
  let midOpen = 0;
  questionSentences.forEach((q) => {
    const at = sentences.indexOf(q);
    if (at === sentences.length - 1) return;
    // the answer is the prose between this question and the next one, up to three sentences
    let after = 0;
    for (const s of sentences.slice(at + 1, at + 4)) {
      if (/\?["'”)\]]?$/.test(s)) break;
      after += wordsOf(s).length;
    }
    if (after >= 8) midAnswered++;
    else midOpen++;
  });
  const analogies = count(ANALOGY, prose);
  const notCovering = count(NOT_COVERING, prose) > 0;
  const numbers = count(/\b\d[\d,.]*\s*(?:%|ms|s|MB|GB|KB|files?|lines?|tokens?|edges?|params?|layers?|x)?\b/g, prose.replace(/`[^`\n]+`/g, '').replace(/(?:[\w.-]+\/)+[\w.-]+(?::\d+)?/g, ''));
  const citations = count(/[\w./-]+\.\w{1,5}:\d+/g, raw);
  const headings = count(/^#{1,4}\s+\S/gm, prose);
  const bullets = count(/^\s*(?:[-+*•]|\d+[.)])\s+\S/gm, prose);
  const boldLeads = count(/^\s*(?:[-+*•]\s+)?\*\*[^*]+\*\*/gm, prose);

  // ── visual
  const visualFences = fences.filter((f) => /^(?:seqd|flow|mermaid|d2|dot|graphviz|chart)$/.test(f.lang) || /^\s*[\w"-]+\s*(?:->|-->|=>)\s*[\w"-]+/m.test(f.body));
  const flowLines = count(/^\s*[\w"./-]+\s*->\s*[\w"./-]+\s*:/gm, raw);
  const chart = opts.chart ?? null;
  const drew = Boolean(opts.drew ?? chart) || visualFences.length > 0 || flowLines > 0;
  const visualRefs = count(VISUAL_REF, prose);
  let chartMentioned = null;
  if (chart && Array.isArray(chart.items) && chart.items.length) {
    const low = prose.toLowerCase();
    const labels = chart.items.map((i) => String(i.label ?? i.id ?? '').toLowerCase()).filter((l) => l.length > 2);
    chartMentioned = labels.length ? labels.filter((l) => low.includes(l) || low.includes(l.split(/[\s/]/).pop())).length / labels.length : null;
  }
  const chartSteps = chart && Array.isArray(chart.steps) ? chart.steps.length : null;

  // ── hygiene
  const planningOpen = PLANNING_OPEN.test(prose.trim().split('\n')[0] ?? '');
  const drawPromise = DRAW_PROMISE.test(lastSentence) || DRAW_PROMISE.test(trimmed.split('\n').pop() ?? '');
  const leak = LEAK.test(raw);
  const toolDebris = TOOL_DEBRIS.test(raw);
  const empty = words < 12;
  const deflects = DEFLECT.test(prose);
  const thin = !empty && words < 40;

  /* ─── sub-scores, 0–100, each with the anchor it is judged against ─── */
  const clarity = empty
    ? 0
    : (0.4 * (band(avgSentence, 14, 30) ?? 0) + 0.3 * (band(fkGrade, 8, 16) ?? 0) + 0.3 * (band(longShare, 0.05, 0.5) ?? 0));
  const chunking = empty ? 0 : 0.6 * (band(longestPara, 60, 160) ?? 0) + 0.4 * clamp(100 - 35 * walls);
  const jargon = empty
    ? 0
    : clamp(0.6 * (band(idPerSentence, 0.4, 2.5) ?? 0) + 0.4 * 100 - 25 * toolVocab - 6 * capsWords.length - 8 * listDumps);
  const tone = empty
    ? 0
    : clamp(
        100 -
          12 * harsh -
          per100(dismissive, words) * 12 -
          per100(commands, words) * 6 -
          6 * capsWords.length -
          4 * Math.max(0, exclaim - 1) -
          (per100(warm, words) < 1 ? 15 : 0),
      );
  const chartQ = scoreChart(chart);
  const visualBase = drew
    ? clamp(55 + Math.min(25, 8 * visualRefs) + (chartMentioned == null ? 10 : 20 * chartMentioned) + (chartSteps ? 10 : 0))
    : clamp(Math.min(20, 5 * visualRefs));
  // when the chart itself is known, half of the visual score is whether a person can read it
  const visual = chartQ ? 0.5 * visualBase + 0.5 * chartQ.score : visualBase;
  const teaching = empty
    ? 0
    : clamp(
        /* opts.product (2026-09-24): a product answer is not a lesson that owes a check-in, so a
           closing question is neutral there, neither a bonus nor a penalty. */
        (endsWithQuestion && !opts.product ? 30 : 0) +
          (closingConcrete && !opts.product ? 10 : 0) -
          (closingClarifying && !opts.product ? 30 : 0) +
          Math.min(20, 10 * midAnswered) -
          10 * midOpen +
          Math.min(20, 10 * analogies) +
          (notCovering ? 10 : 0) +
          Math.min(10, 3 * numbers),
      );
  const grounding = empty ? 0 : clamp(Math.min(70, 20 * citations) + Math.min(30, 6 * (inlineCode + paths)));
  const hygiene = clamp(100 - (leak ? 60 : 0) - (toolDebris ? 60 : 0) - (planningOpen ? 40 : 0) - (drawPromise ? 40 : 0) - (empty ? 100 : 0) - 20 * toolVocab);

  /* Weights say what the owner asked for: clear, visual, teaching, unthreatening. Grounding is
   * already enforced upstream by the grader, so it counts here only as a light tie-breaker. */
  const WEIGHTS = { clarity: 0.18, chunking: 0.12, jargon: 0.12, tone: 0.15, visual: 0.18, teaching: 0.15, grounding: 0.05, hygiene: 0.05 };
  const sub = { clarity, chunking, jargon, tone, visual, teaching, grounding, hygiene };
  /* A non-answer or a two-line turn can read cleanly and still teach nothing, so it is capped: a
   * clean deflection must never outscore a rough lesson. */
  let overall = Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * sub[k], 0);
  if (deflects) overall = Math.min(overall, 40);
  if (thin) overall = Math.min(overall, 50);

  return {
    overall: round(overall),
    sub: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, round(v)])),
    metrics: {
      words,
      sentences: sentences.length,
      avgSentenceWords: round(avgSentence),
      longSentenceShare: round(longShare, 2),
      fkGrade: round(fkGrade),
      longestParagraphWords: longestPara,
      walls,
      headings,
      bullets,
      boldLeads,
      inlineCode,
      paths,
      identifiersPerSentence: round(idPerSentence, 2),
      toolVocab,
      listDumps,
      shoutedWords: capsWords.slice(0, 8),
      dismissive,
      harshAtReader: harsh,
      commands,
      exclamations: exclaim,
      warmthPer100: round(per100(warm, words)),
      endsWithQuestion,
      closingClarifying,
      closingConcrete,
      midQuestionsAnswered: midAnswered,
      midQuestionsLeftOpen: midOpen,
      analogies,
      namesWhatItSkips: notCovering,
      numbers,
      citations,
      drew,
      visualFences: visualFences.length,
      flowLines,
      visualRefs,
      chartLabelsMentioned: round(chartMentioned, 2),
      chartSteps,
      chart: chartQ,
      planningOpen,
      drawPromise,
      leak,
      empty,
      deflects,
      thin,
      toolDebris,
    },
    flags: [...flagsFor({ listDumps, drawPromise, avgSentence, longShare, fkGrade, longestPara, walls, idPerSentence, toolVocab, capsWords, dismissive, harsh, drew, visualRefs, endsWithQuestion, closingClarifying, midOpen, analogies, planningOpen, leak, empty, deflects, thin, toolDebris }), ...(chartQ?.flags ?? []).map((f) => `picture: ${f}`)],
  };
}

/** Plain-language reasons, the first thing a person reads about a lesson that scored low. */
function flagsFor(m) {
  const f = [];
  if (m.empty) return ['no lesson: fewer than 12 words of prose'];
  if (m.deflects) f.push('hands the work back (asks, refuses or stops) instead of teaching');
  if (m.thin) f.push('under 40 words: too thin to teach anything');
  if (m.toolDebris) f.push('a tool call leaked into the text as debris (serving/template fault, not the model refusing)');
  if (m.leak) f.push('reasoning or a tool call leaked into the answer');
  if (m.planningOpen) f.push('opens by narrating its own plan instead of teaching');
  if (m.drawPromise) f.push('ends by promising a drawing in words; the drawing should just be there');
  if (m.listDumps) f.push(`${m.listDumps} sentence(s) read out a list of five or more names; make it bullets with a gloss each`);
  if (m.avgSentence > 24) f.push(`sentences average ${Math.round(m.avgSentence)} words; aim under 20`);
  if (m.fkGrade > 14) f.push(`reads at grade ${Math.round(m.fkGrade)}; aim at 8 to 11`);
  if (m.walls) f.push(`${m.walls} paragraph(s) over 90 words; break into steps or bullets`);
  if (m.idPerSentence > 1.5) f.push(`${m.idPerSentence.toFixed(1)} code names per sentence; gloss each in plain words`);
  if (m.toolVocab) f.push(`names ${m.toolVocab} internal tool term(s) at the learner`);
  if (m.capsWords.length) f.push(`shouts: ${m.capsWords.slice(0, 4).join(', ')}`);
  if (m.harsh) f.push('tells the learner they are wrong or failed, in so many words');
  if (m.dismissive >= 2) f.push(`${m.dismissive} dismissive words (simply, just, obviously…)`);
  if (!m.drew) f.push('no picture: nothing drawn and no flow in the text');
  else if (m.visualRefs === 0) f.push('draws a picture but the text never points at it');
  if (!m.endsWithQuestion) f.push('does not close on a check-in question');
  if (m.closingClarifying) f.push('closes by asking what the learner wants instead of checking understanding');
  if (m.midOpen) f.push(`${m.midOpen} mid-lesson question(s) never answered`);
  if (!m.analogies) f.push('no example or analogy');
  return f;
}

/* ─────────────────────────── the picture itself ─────────────────────────── */

const FLOW_KINDS = /^(?:data-flow|information-flow|user-flow|code-to-outcome|how-it-works|incident-reconstruction|swimlane|sankey)$/;
const RAW_ID = /^(?:svc|mod|file|fn|ds|topic|ext):/;

/**
 * How readable is a chart a person has to look at? Scored from the spec alone, so it works on a
 * `chart:proposal` frame from any run. Every rule here is a complaint the owner or a measurement
 * made about a real picture:
 *   - too many boxes ("hard for me to read"; the craft rule is at most 8)
 *   - raw ids as labels (`svc:ml-harness-app` is a key, not a name)
 *   - an inventory drawn as a hub ("service contains six modules": six arrows saying nothing)
 *   - a flow that loops back on itself (frontend → ml-harness → ml-harness-app → ml-harness)
 *   - a flow with no steps to play, and boxes joined to nothing
 * @param {{kind?: string, items?: Array<{id?: string, label?: string, nodeId?: string}>,
 *          links?: Array<{from: string, to: string, label?: string}>, steps?: unknown[]} | null} chart
 */
export function scoreChart(chart) {
  if (!chart || !Array.isArray(chart.items) || chart.items.length === 0) return null;
  const items = chart.items;
  const links = Array.isArray(chart.links) ? chart.links : [];
  const kind = String(chart.kind ?? '');
  const flow = FLOW_KINDS.test(kind) || Array.isArray(chart.steps);
  const ids = new Set(items.map((i) => i.id));
  const labels = items.map((i) => String(i.label ?? i.id ?? ''));
  const rawIdLabels = labels.filter((l) => RAW_ID.test(l)).length;
  const longLabels = labels.filter((l) => l.length > 28).length;
  const dupLabels = labels.length - new Set(labels.map((l) => l.toLowerCase())).size;
  const linked = new Set(links.flatMap((l) => [l.from, l.to]));
  const orphans = items.filter((i) => !linked.has(i.id)).length;
  const unlabeledLinks = links.filter((l) => !String(l.label ?? '').trim()).length;
  const outDeg = {};
  for (const l of links) outDeg[l.from] = (outDeg[l.from] ?? 0) + 1;
  const maxOut = Math.max(0, ...Object.values(outDeg));
  const containsHub =
    links.length >= 3 && links.every((l) => l.from === links[0].from) && links.every((l) => /^(?:contains|has|includes|part of)?$/i.test(String(l.label ?? '').trim()));
  // a directed cycle in a flow: DFS over item ids
  let cycle = false;
  if (flow) {
    const adj = {};
    for (const l of links) if (ids.has(l.from) && ids.has(l.to)) (adj[l.from] ??= []).push(l.to);
    const state = {};
    const visit = (n) => {
      state[n] = 1;
      for (const m of adj[n] ?? []) {
        if (state[m] === 1) cycle = true;
        else if (!state[m]) visit(m);
      }
      state[n] = 2;
    };
    for (const n of Object.keys(adj)) if (!state[n]) visit(n);
  }
  const steps = Array.isArray(chart.steps) ? chart.steps.length : 0;
  const grounded = items.filter((i) => i.nodeId).length / items.length;

  const n = items.length;
  let score = 100;
  if (n > 8) score -= Math.min(30, 5 * (n - 8));
  if (n < 3) score -= 20;
  score -= Math.min(30, 12 * rawIdLabels);
  score -= Math.min(15, 5 * longLabels);
  score -= Math.min(15, 8 * dupLabels);
  score -= Math.min(25, 10 * orphans);
  if (containsHub) score -= 35;
  if (cycle) score -= 25;
  if (flow && steps === 0) score -= 15;
  if (maxOut > 4) score -= 10;
  if (links.length > 0 && unlabeledLinks / links.length > 0.5) score -= 10;

  const flags = [];
  if (n > 8) flags.push(`${n} boxes; past 8 a picture stops reading at a glance`);
  if (rawIdLabels) flags.push(`${rawIdLabels} box(es) labelled with a raw id instead of a name`);
  if (containsHub) flags.push('an inventory drawn as a hub: every arrow says "contains"');
  if (cycle) flags.push('the flow loops back on itself, so there is no start or end to follow');
  if (flow && steps === 0) flags.push('a flow with no steps to play');
  if (orphans) flags.push(`${orphans} box(es) joined to nothing`);
  if (dupLabels) flags.push(`${dupLabels} duplicate label(s)`);
  if (maxOut > 4) flags.push(`one box fans out to ${maxOut} arrows`);
  return {
    score: round(clamp(score)),
    items: n,
    links: links.length,
    steps,
    flow,
    rawIdLabels,
    longLabels,
    dupLabels,
    orphans,
    containsHub,
    cycle,
    maxOut,
    groundedShare: round(grounded, 2),
    flags,
  };
}

/* ─────────────────────────── A/B comparison ─────────────────────────── */

function mean(xs) {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* Deterministic PRNG so a bootstrap interval is the same on every run of the same data. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function bootstrapDiffCI(a, b, iters = 4000) {
  if (!a.length || !b.length) return null;
  const r = rng(42);
  const diffs = [];
  for (let i = 0; i < iters; i++) {
    let sa = 0;
    let sb = 0;
    for (let j = 0; j < a.length; j++) sa += a[Math.floor(r() * a.length)];
    for (let j = 0; j < b.length; j++) sb += b[Math.floor(r() * b.length)];
    diffs.push(sb / b.length - sa / a.length);
  }
  diffs.sort((x, y) => x - y);
  return [round(diffs[Math.floor(0.025 * iters)]), round(diffs[Math.floor(0.975 * iters)])];
}

/**
 * Compare two variants. Each is an array of { id, text, chart? }. When ids match across the two,
 * the comparison is paired (same prompt, different variant) and a per-prompt win count is given.
 * The interval is a bootstrap on the difference of means (B − A); with three runs a side it will
 * usually span zero, and the report says so rather than naming a winner.
 */
export function compareVariants(A, B, labels = ['A', 'B']) {
  const sa = A.map((x) => ({ id: x.id, ...scoreLesson(x.text, x) }));
  const sb = B.map((x) => ({ id: x.id, ...scoreLesson(x.text, x) }));
  const dims = ['overall', ...Object.keys(sa[0]?.sub ?? sb[0]?.sub ?? {})];
  const pick = (s, d) => (d === 'overall' ? s.overall : s.sub[d]);
  const byDim = {};
  for (const d of dims) {
    const a = sa.map((s) => pick(s, d));
    const b = sb.map((s) => pick(s, d));
    const ci = bootstrapDiffCI(a, b);
    byDim[d] = {
      [labels[0]]: round(mean(a)),
      [labels[1]]: round(mean(b)),
      diff: round(mean(b) - mean(a)),
      ci95: ci,
      verdict: ci == null ? 'no data' : ci[0] > 0 ? `${labels[1]} better` : ci[1] < 0 ? `${labels[0]} better` : 'not separable',
    };
  }
  const paired = [];
  for (const x of sa) {
    const y = sb.find((s) => s.id === x.id);
    if (y) paired.push({ id: x.id, [labels[0]]: x.overall, [labels[1]]: y.overall, winner: y.overall > x.overall + 2 ? labels[1] : x.overall > y.overall + 2 ? labels[0] : 'tie' });
  }
  return { n: [sa.length, sb.length], byDim, paired, perLesson: { [labels[0]]: sa, [labels[1]]: sb } };
}

/* ─────────────────────────── loading runs ─────────────────────────── */

/**
 * Pull the learner-visible answer out of a raw stream log (`raw-r*.jsonl`) or a result JSON.
 * Accepts the shapes the ask stream emits: a final `result`/`answer` frame with text, or `delta`
 * frames whose text concatenates to the answer. A chart comes from a `chart:proposal` frame or a
 * successful propose_chart tool result.
 */
export function lessonFromEvents(lines) {
  let finalText = null;
  let deltas = '';
  let chart = null;
  for (const line of lines) {
    let ev;
    try {
      ev = typeof line === 'string' ? JSON.parse(line) : line;
    } catch {
      continue;
    }
    const e = ev?.data && typeof ev.data === 'object' ? { ...ev.data, type: ev.type ?? ev.event ?? ev.data.type } : ev;
    const type = String(e?.type ?? e?.event ?? '');
    if (/^(?:result|answer|done|final)$/.test(type) && typeof (e.text ?? e.answer ?? e.result?.text) === 'string') {
      finalText = e.text ?? e.answer ?? e.result.text;
    } else if (/delta|token|text/.test(type) && typeof (e.text ?? e.delta) === 'string') {
      deltas += e.text ?? e.delta;
    }
    const c = e?.chart ?? (type.includes('chart') ? e.proposal ?? e.spec ?? null : null);
    if (c && typeof c === 'object' && (c.items || c.links)) chart = c;
  }
  return { text: finalText ?? deltas, chart };
}

function loadOne(path) {
  const body = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();
  if (ext === '.jsonl' || ext === '.ndjson') return lessonFromEvents(body.split('\n').filter(Boolean));
  if (ext === '.json') {
    const j = JSON.parse(body);
    if (Array.isArray(j)) return lessonFromEvents(j);
    return { text: j.text ?? j.answer ?? j.result?.text ?? '', chart: j.chart ?? null };
  }
  return { text: body, chart: null };
}

export function loadLessons(path) {
  const st = statSync(path);
  const files = st.isDirectory()
    ? readdirSync(path)
        .filter((f) => /\.(?:md|txt|json|jsonl|ndjson)$/i.test(f))
        .sort()
        .map((f) => join(path, f))
    : [path];
  return files.map((f) => ({ id: basename(f).replace(/\.[^.]+$/, ''), file: f, ...loadOne(f) }));
}

/* ─────────────────────────── CLI ─────────────────────────── */

function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ')).join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  if (!args.length || args.includes('--help')) {
    console.log('usage: lesson-quality.mjs <file|dir> [--json] | --ab <dirA> <dirB> [--json]');
    return 0;
  }
  if (args[0] === '--ab') {
    const [a, b] = [loadLessons(args[1]), loadLessons(args[2])];
    const res = compareVariants(a, b, [basename(args[1]), basename(args[2])]);
    if (json) return console.log(JSON.stringify(res, null, 2)), 0;
    const [la, lb] = [basename(args[1]), basename(args[2])];
    console.log(`n = ${res.n[0]} vs ${res.n[1]}`);
    console.log(table([['dimension', la, lb, 'B−A', '95% CI', 'verdict'], ...Object.entries(res.byDim).map(([d, v]) => [d, v[la], v[lb], v.diff, v.ci95 ? `[${v.ci95.join(', ')}]` : '', v.verdict])]));
    return 0;
  }
  const lessons = args.flatMap(loadLessons);
  const scored = lessons.map((l) => ({ id: l.id, ...scoreLesson(l.text, l) }));
  if (json) return console.log(JSON.stringify(scored, null, 2)), 0;
  console.log(table([['lesson', 'overall', 'clarity', 'chunk', 'jargon', 'tone', 'visual', 'teach', 'words', 'grade'], ...scored.map((s) => [s.id, s.overall, s.sub.clarity, s.sub.chunking, s.sub.jargon, s.sub.tone, s.sub.visual, s.sub.teaching, s.metrics.words, s.metrics.fkGrade])]));
  for (const s of scored) if (s.flags.length) console.log(`\n${s.id}:\n  - ${s.flags.join('\n  - ')}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
