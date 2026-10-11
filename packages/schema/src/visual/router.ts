/* ══════════════════════════════════════════════════════════════════════════
   WHICH VISUAL COMPONENTS FIT THIS REQUEST (plain code, no model)
   packages/schema/src/visual/router.ts

   Reads the person's message and, only when it is clearly asking for a
   chart, a diagram, a forecast or a load/latency picture, returns a one-line
   hint for the agent's PRIVATE context ("prefer visual components: ..."). The
   hint is returned in `VisualRoute.hint`, SEPARATE from the message; the router
   never builds a prompt. Callers must keep it out of anything stored or shown
   (saved prompt, chat title, transcript). Silence is the default: a wrong hint costs the
   agent's attention on every turn it fires, a missed one costs nothing the
   agent could not do anyway.

   Two kinds of words:
     STRONG   chart, plot, gantt, forecast, "sequence diagram", ...
              name a picture by themselves.
     WEAK     latency, load, analytics, flow, architecture, timeline, ...
              are ordinary engineering nouns ("add analytics tracking", "fix
              the flow control"); they count only next to a request to SEE
              something (show, draw, visualise, diagram, "what does it look like").
   A message that asks for code ("implement a dashboard component") and does
   not ask to see anything gets no hint.

   Since the precision pass the message is cut into clauses ("fix the typo,
   and plot the weekly deploys") and each clause is scored on its own with a
   small linear model written by hand (weights below): intent features add
   (a drawing verb used as a verb, a deliverable noun after "a/as/me", "what
   does X look like", "show how", numbers and time words), code features take
   away (file paths, identifiers, error text, edit verbs, "slow/broken/bug").
   Only the clauses that pass 3 points choose the components.
   Measured on hand-labelled sets in router.test.ts (see t3gap/router/README.md).
   ══════════════════════════════════════════════════════════════════════════ */

export const VISUAL_HINT_PREFIX = 'For this request, prefer visual components';

export interface VisualRoute {
  /** Component ids, best first, at most three (a "+forecast" note is part of the label). */
  components: string[];
  hint: string;
}

/* ── clause split: a multi-ask message is judged one ask at a time ───────── */
const ASK_VERB = 'fix|debug|tell|list|summari[sz]e|plot|draw|chart|graph|show|make|give|open|check|read|run|explain|add|update|forecast|create|write|sketch|visuali[sz]e|illustrate|diagram|put|compare|rename|remove|delete|review|look';
/** A bare "and" splits only before a clear ask verb (not read/write/compare/list: "read and write latency"). */
const BARE_AND_VERB = 'fix|debug|tell|summari[sz]e|plot|draw|chart|graph|show|make|give|explain|add|update|forecast|create|sketch|visuali[sz]e|illustrate|diagram|rename|remove|delete|review';
const SPLIT = new RegExp(`(?<=[.!?;])\\s+|\\n+|\\s+and\\s+(?:please\\s+|also\\s+)?(?=(?:${BARE_AND_VERB})\\b)|,?\\s+(?:and then|and also|and second|and after that|then|also|after that|afterwards|finally|second(?:ly)?|next)\\s+|,\\s+(?:and\\s+)?(?=(?:please\\s+|also\\s+)?(?:${ASK_VERB})\\b)`, 'i');

/* ── features ────────────────────────────────────────────────────────────── */
const DRAW_WORDS = /\b(draw|plot|chart|graph|sketch|visuali[sz]e|illustrate|diagram|map out|lay out|mock ?up|forecast|project)\b/gi;
/** A word before a drawing word that means it is being used as a verb (a request), not as a noun ("the plot function"). */
const VERB_CTX = new Set(['', 'please', 'you', 'to', 'and', 'then', 'just', 'also', 'me', 'us', 'it', 'lets', "let's", 'can', 'could', 'would', 'will', 'should', 'now', 'so', 'okay', 'ok', 'um', 'hey', 'right', 'first', 'second', 'instead', 'maybe']);
/** What follows a drawing word when it is not a request: a call/member/index ("draw(ctx)", "chart.render", "plot[0]", "plot = x") or an idiom ("draw on your experience", "plot twist"). */
const NOT_A_VERB_AFTER = /^(?:\(|\.\w|\[|\s*=(?!=)|\s+(?:on|upon|a conclusions?|conclusions|attention|inspiration|a blank|the line|a line|twist|holes?|armou?r)\b)/i;
const NOUN_AFTER = /^\s*(function|functions|component|components|helper|class|module|layout code|library|libraries|dependency|dependencies|axis|label|labels|options|config|import|code|logic|service|parser|skill|renderer|package|script|file|method|tests?|docstrings?|comments?)\b/i;
const VNOUN = '(?:(?:bar|line|area|pie|donut|stacked|column|flow|gantt|sequence|architecture|system|block|network|bubble|scatter)[ -]?)?(?:chart|graph|plot|diagram|gantt|sparkline|histogram|donut|pie(?![ -]?chart)|flow ?chart|dashboard|timeline|roadmap|swim ?lane|tiles|bars|stacked bar|picture|heat ?map|distribution|forecast|capacity plan|one-page view|kpi summary|kpi row|kpis|trend(?= of\\b)|scorecard|overview)';
/** A deliverable noun: "a bar chart", "as tiles", "on a graph", "give me bars". */
const DELIVERABLE = new RegExp(`\\b(?:a|an|some|another|as|into|me|us|one)\\s+(?:[\\w-]+\\s+){0,2}?${VNOUN}\\b`, 'i');
/** The ask is just the picture, named first: "bar chart of errors by endpoint", "a dashboard with ...". */
const FRONTED = new RegExp(`^\\s*(?:(?:a|an|some)\\s+)?(?:(?!the\\b)[\\w-]+\\s+){0,2}?${VNOUN}\\b(?!\\s+(?:component|helper|class|module|library|parser|function|skill|renderer|package|file|import|code|logic|is|are|was|were|has|have|crash\\w*|throws?|fails?))(?!(?:-style)?\\s+(?:docstrings?|comments?|docs?|names?|description|prefix|suffix|variable))`, 'i');
/** "... show it", "... draw me": the picture is asked for, the subject is the clause before. */
const SHOW_IT = /\b(?:show|draw|plot|chart|graph|visuali[sz]e)\s+(?:it|this|that|them|me)(?:\s+please)?\s*[.!?]*\s*$/i;
const LOOKS_LIKE = /\b(?:what|whats|what's|how)\b[^.?!]{0,60}\blook(?:s|ed)? like\b|\bshape of\b|\bshow (?:me )?(?:how|where|when|what)\b|\blet me see\b|\b(?:want|like|love) to see\b|\b(?:a )?picture of\b|\bvisually\b|\bvisual of\b|\bat a glance\b/i;
const SHOW = /\b(show|turn|make a|make an|display|give me|make me|put together|create|generate|produce|build me|i need|i want|i would like|i'?d like|i'?d love|i would love|please|can you|could you|just)\b/i;
const CONCEPT = /\b(sequence of|capacity|headroom|forecast|latency|load|traffic|architecture|topology|data flow|call order|order of calls|request path|per[- ]hop|bottleneck|saturat\w+|talk to each other|fit together|hang together|milestones?|rollout|trend(?:ing|s)?|growth)\b/i;
const DATA = /\b(over (?:the )?(?:last|past|time)|per (?:day|hour|week|month|quarter|release|service|region)|by (?:day|hour|week|month|quarter|team|plan|region|service|endpoint|category|status)|against|vs\.?|versus|compar(?:e|ing|ison)|for the last|since|\d+x)\b|(?<![\d,.])[,.]*\d[\d,.]*\s*(?:[km]\b|users|people|rps|ms|%|percent|megabytes|gb|mb)|(?:ten|twenty|fifty|hundred|thousand|million)\b/i;
/** Numbers start only where a run of digits, commas and dots starts (a match from inside a run implies one from its start; DATA's number too), so a long run is not rescanned from every digit. */
const MANY_NUMBERS = /(?<![\d,.])[,.]*\d[\d,.]*\b[^\d]{1,25}\d[\d,.]*\b[^\d]{1,25}\d[\d,.]*/;

/** "compare A and B across regions ... side by side": a comparison asked to be laid out next to each other. */
const SIDE_BY_SIDE = /\bside[- ]by[- ]side\b/i;
const COMPARE = /\b(compar\w+|vs\.?|versus|across|per|by)\b/i;
/** The one non-English phrasing covered: Spanish "muéstrame/dibuja/haz ... un gráfico/diagrama". German, French, Japanese etc. are not covered (silence). */
const SPANISH_ASK = /\b(?:mu[eé]str(?:ame|a)|dibuja(?:me)?|haz(?:me)?|genera|grafica|traza)\b[^.?!]{0,40}\b(?:gr[aá]fico|gr[aá]fica|diagrama|l[ií]nea de tiempo)\b/i;
const EDIT = /\b(fix|debug|refactor|rename|implement|update|remove|delete|migrate|install|bump|revert|squash|deploy|rewrite|review (?:my|this|the|our|that)|summari[sz]e|explain|list|open|profile|trace|log (?:the|every|all|a)|investigate|rebase|merge|commit|lint|(?:change|set|move|hide|tweak|swap|replace|adjust|resize|style) (?:the|it|this|that|our|my)|defer|memo|downloads?|translate|add (?:a |an |the )?(?:[\w-]+ )?(?:tests?|docstrings?|comments?|logging|tracking|route|endpoint|column|field|prop|flag|handler|hook|retry|dependency)|write (?:a |an |the )?(?:[\w-]+ )?(?:tests?|script|function|query|migration)|check why|find out why|find (?:the )?regression|look at (?:the )?(?:code|\w+\.\w+)|tell me (?:why|which)|create (?:a )?(?:new )?(?:branch|migration|pr|pull request|test)|can you (?:look|find) (?:at )?why)\b/i;
const PATH = /(?:(?<![\w.\/-])(?:\.{0,2}\/)?(?!p\d+\/)[A-Za-z_][\w.-]*\/[A-Za-z_][\w.-]*\/[\w.-]+|(?<![\w-])[A-Za-z_][\w-]*\/[A-Za-z_][\w-]*\.\w+|\b\w+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|rb|yml|yaml|json|md|css|html|sql|toml|lock|sh)\b)/;
const IDENT = /\b[a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b|\b[A-Z][a-z]+[A-Z]\w*\b|\w\(\)|\bconst\b|\bimport\b/;
const ERRORISH = /\b(TypeError|ReferenceError|Error:|ECONN\w*|ETIMEDOUT|EADDR\w*|exit code|stack ?trace|exception|undefined|null pointer|segfault|NaN|N\+1)\b|\b(?:returns?|status|http|code|error|gets?|got|with|a)\s+(?:50[0-4]|40[0-4])\b/;
const CODEWORDS = /\b(files?|(?:the|this|my|our|source) code|codebase|repo|module|function|handler|middleware|component|reducer|hook|query|route|config|yaml|css|dependency|library|lockfile|schema|class|helper|script|branch|pull request|exporter|loader|store|sidebar|safari|lighthouse|main thread|prometheus|webhook parser|parser|cookie|session|settings page|admin page|dashboard page|admin page|dashboard page)\b/i;
/** The subject is a piece of code: "... in this handler". Counts even next to a drawing verb. */
const IN_CODE = /\b(?:in|inside|from|of) (?:this|the|my|our|that) (?:handler|function|file|module|class|query|code|component|method|middleware|reducer|hook|script)\b/i;
const TROUBLE = /\b(slow|bug|buggy|broken|crash(?:es|ed)?|fails?|failing|failed|regression|flaky|stuck|loops? forever|throws?|blank|misaligned|clunky|wrong|typos?|leak|re-?renders?|stale|overlaps?|flush|lock)\b/i;
const EXPLAIN = /^\s*(?:why|what is|what's|how does|how do i|how should i|which|where is|where's)\b|\bexplain\b|\bin words\b/i;

export interface ClauseScore {
  clause: string;
  score: number;
  features: string[];
}

const FIRE = 3;

/** Score one clause. Every feature is a named weight so a miss can be read off `features`. */
export function scoreClause(clause: string): ClauseScore {
  const f: string[] = [];
  let s = 0;
  const add = (name: string, w: number): void => {
    s += w;
    f.push(`${w > 0 ? '+' : ''}${w} ${name}`);
  };
  /* a drawing word used as a verb: "plot p95 latency", "can you chart ..." (not "the plot function") */
  let drawVerb = false;
  let drawAt = Infinity;
  for (const m of clause.matchAll(DRAW_WORDS)) {
    /* only a short window before the word is read, so a clause full of drawing words stays linear */
    const lead = clause.slice(Math.max(0, m.index! - 64), m.index).trimEnd();
    const before = lead.split(/\s+/).pop()?.toLowerCase().replace(/[,.:;]$/, '') ?? '';
    const prevCh = lead.slice(-1);
    if ((VERB_CTX.has(before) || /[:;,—-]/.test(prevCh)) && !NOUN_AFTER.test(clause.slice(m.index! + m[0].length)) && !NOT_A_VERB_AFTER.test(clause.slice(m.index! + m[0].length))) {
      drawVerb = true;
      drawAt = Math.min(drawAt, m.index!);
    }
  }
  const deliverable = DELIVERABLE.test(clause) && !FRONTED.test(clause);
  const looks = LOOKS_LIKE.test(clause);
  const concept = CONCEPT.test(clause);
  const show = SHOW.test(clause) || /^\s*(?:show|display)\b/i.test(clause);
  const fronted = !drawVerb && FRONTED.test(clause);
  if (drawVerb) add('drawing verb', 3);
  if (fronted) add('picture named first', 3);
  if (SHOW_IT.test(clause)) add('show it', 3);
  if (SIDE_BY_SIDE.test(clause) && COMPARE.test(clause.replace(SIDE_BY_SIDE, " "))) add('compare side by side', 3);
  if (SPANISH_ASK.test(clause)) add('spanish ask', 3);
  if (deliverable) add('deliverable noun', 2);
  if (looks) add('looks-like / show how', 3);
  if (!drawVerb && !deliverable && !looks && /^\s*(?:please\s+)?(?:show|display)\b/i.test(clause) && concept) add('show + concept', 2);
  if ((drawVerb || deliverable || looks || concept) && show && !fronted) add('request phrase', 1);
  if ((drawVerb || deliverable || looks) && concept) add('concept noun', 1);
  if ((drawVerb || deliverable || looks || concept) && (DATA.test(clause) || MANY_NUMBERS.test(clause))) add('data / numbers', 1);
  if (deliverable && clause.split(/\s+/).length <= 8) add('short ask for a picture', 1);
  if (s === 0) return { clause, score: 0, features: f };
  const edit = EDIT.exec(clause);
  if (edit) add('edit verb', edit.index > drawAt ? -1 : -3);
  const pic = drawVerb || fronted;
  const code = (PATH.test(clause) ? 3 : 0) + (IDENT.test(clause) ? 3 : 0) + (ERRORISH.test(clause) ? 3 : 0) + (!pic && CODEWORDS.test(clause) ? 2 : 0) + (IN_CODE.test(clause) ? 3 : 0);
  if (code) add('code cues', -Math.min(5, code));
  if (TROUBLE.test(clause)) add('trouble words', pic ? -1 : -3);
  if (EXPLAIN.test(clause)) add('explain', -2);
  return { clause, score: s, features: f };
}

/* ── pasted material is never a request ─────────────────────────────────── */
const LOG_LINE = /^\s*(?:\[?\d{4}-\d\d-\d\d[T ]|\[?\d\d:\d\d:\d\d|\[?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\]?\b|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S* +\d{3}\b|at\s+\S.*(?:\([^()]*:\d+(?::\d+)?\)|:\d+:\d+)|File ".*", line \d+|Traceback \(|\$ \S|>>> |(?:Uncaught )?\w*(?:Error|Exception)\b.*:|\w+\.\w+\(\d+,\d+\): )/;
const DIFF_LINE = /^\s*(?:\+\+\+ |--- |@@ |diff --git |index [0-9a-f]+\.\.|\+(?!\s*$)|-\s+(?:[\w.]+\s*(?:[=(]|\.\w+\()|(?:const|let|var|import|return|if|for)\b))/;
const CODE_LINE = /^(?: {4,}|\t)\S|^\s*(?:(?:const|let|var)\s+[\w${[]+\s*(?:[=:;]|$).*|function\s+\w*\s*\(.*|import\s+(?:.*\sfrom\s+)?['"].*|from\s+\S+\s+import\b.*|export\s+(?:default|const|function|class|type|interface|async)\b.*|(?:async\s+)?def\s+\w+\(.*|class\s+\w+\s*(?:\(.*|\{.*|extends\b.*|:)|return\b.*;|(?:public|private|protected)\s+\w+.*[({;]|(?:if|for|while|switch)\s*\(.*|[\w$.]+\s*(?:=|\+=|-=)\s*[^=\s].*|[\w$.]+\([^)]*\)\s*;?|[{}\]);,]+)$|[;{}]\s*$/;
const QUOTE_LINE = /^\s*>\s?/;
/** Column-aligned tool output (kubectl get, docker ps, ls -l): two or more gaps of 2+ spaces that do not follow sentence punctuation. Counted with one global match, linear. */
const TABLE_GAP = /[^\s.!?,:;] {2,}(?=\S)/g;
const isTableRow = (line: string): boolean => (line.match(TABLE_GAP)?.length ?? 0) >= 2;
const DATA_ROW = /^\s*[\w:.\/-]+(?:[^\S\t\n]*[,\t|][^\S\t\n]*[\w:.\/-]+){2,}\s*$|^\s*[\w:.\/-]+[^\S\n]*,[^\S\n]*[\w:.\/-]+\s*$/;

/**
 * The message with the pasted material taken out: fenced code, diffs, stack traces, log lines, quoted text,
 * indented code and lists of commit lines. What is left is what the person typed to us. Linear in the message.
 * A single `chart: p99 per day` line is kept (a terse ask); two or more `type: subject` lines in a row are a commit list.
 */
export function stripPasted(message: string, insideFence = false): string {
  const lines = message.split('\n');
  const keep: string[] = [];
  let fenced = insideFence;
  let commitRun = 0;
  const pending: string[] = [];
  const flushCommits = (): void => {
    if (commitRun === 1) keep.push(pending[0]!);
    pending.length = 0;
    commitRun = 0;
  };
  for (const raw of lines) {
    const line = raw.length > 2000 ? `${raw.slice(0, 1000).trimEnd()} ${raw.slice(-1000).trimStart()}` : raw;
    if (/^\s*(```|~~~)/.test(line)) {
      flushCommits();
      fenced = !fenced;
      keep.push('');
      continue;
    }
    if (fenced) continue;
    if (line.trim() === '') {
      flushCommits();
      keep.push('');
      continue;
    }
    if (/^\s*(?:[-*]\s+)?[0-9a-f]{7,40}\s+\S/.test(line)) {
      flushCommits();
      keep.push('');
      continue;
    }
    if (/^\s*(?:[-*]\s+)?\w+(?:\([\w/.-]+\))?!?:\s+\S/.test(line) && !/^\s*(?:[-*]\s+)?(?:note|todo|ps|update|question|ask|step \d+|first|second|third|then|context|goal|error|output):/i.test(line)) {
      commitRun += 1;
      pending.push(line);
      if (commitRun >= 2) pending.length = 0;
      continue;
    }
    flushCommits();
    /* "I changed: graph layout spacing, chart padding": a list after a report verb is what was done, not asks */
    const listed = line.replace(/\b(?:changed|touched|updated|renamed|fixed|tweaked|added|removed|moved|edited|bumped|includes?|contains?|affects?|covers?)\s*:\s*[^.!?]*/gi, '');
    if (LOG_LINE.test(line) || DIFF_LINE.test(line) || QUOTE_LINE.test(line) || CODE_LINE.test(line) || DATA_ROW.test(line) || isTableRow(line)) {
      keep.push('');
      continue;
    }
    keep.push(listed);
  }
  flushCommits();
  return keep.join('\n');
}

/** How much of a long message is read: the first HEAD and the last TAIL characters of what is left after the paste is taken out (the ask usually follows the paste). */
const HEAD = 1500;
const TAIL = 2500;
const MAX_CLAUSE = 600;
const MAX_CLAUSES = 60;
/** A long message is stripped in two windows of this many characters, its start and its end, never as a whole: the router runs before every send and must stay fast on a 200 KB paste. */
const RAW_WINDOW = 16_000;
const FENCE_LINES = /^[^\S\n]*(?:```|~~~)/gm;

/** What the person typed, read from the start and the end of the message only (see RAW_WINDOW). A fence opened before the end window is carried into it. */
function typedWindows(message: string): string {
  if (message.length <= 2 * RAW_WINDOW) return stripPasted(message);
  const nl = message.indexOf('\n', message.length - RAW_WINDOW);
  const tailStart = nl === -1 ? message.length - RAW_WINDOW : nl + 1;
  const opened = (message.slice(0, tailStart).match(FENCE_LINES)?.length ?? 0) % 2 === 1;
  return `${stripPasted(message.slice(0, RAW_WINDOW))}\n${stripPasted(message.slice(tailStart), opened)}`;
}

/** Runs of spaces become one space and runs of blank lines one newline (linear), so no pattern below ever walks a long whitespace run from every position (SPLIT's \\s+ alternatives did: quadratic). */
function squeezeSpace(text: string): string {
  return text.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n');
}

function clip(text: string): string {
  return text.length > HEAD + TAIL ? `${text.slice(0, HEAD)}\n${text.slice(-TAIL)}` : text;
}

/** A message split into the clauses that are separate asks. */
export function splitAsks(message: string): string[] {
  const parts = squeezeSpace(message).split(SPLIT).map((c) => c.trim()).filter((c) => c.length > 0);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && SHOW_IT.test(p) && p.split(/\s+/).length <= 4) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

interface Rule {
  id: string;
  /** Names a picture by itself. */
  noun?: RegExp;
  /** An ordinary engineering word: counts only next to a request to see something. */
  weak?: RegExp;
}

const RULES: Rule[] = [
  { id: 'capacity', noun: /\b(capacity (?:plan|planning|forecast|model)|load forecast|sizing|headroom|load test(?:ing)? plan)\b/i, weak: /\b(?:how many (?:gateway |server |api )?(?:instances|nodes|replicas)|run out|hit limits|\d[\d,.]*\s*[km]?\s*(?:concurrent |active |daily |monthly )?users|scal(?:e|ing) (?:to|up to|for)\b.{0,20}\d|how many (?:users|requests|servers|instances)|load (?:at|on|hits?|lands?)|where (?:the |does )?load|saturat\w+|bottleneck)\b/i },
  { id: 'line+forecast', noun: /\b(forecast(?:s|ed|ing)?|projection|project(?:ed)? (?:growth|usage|traffic|cost|revenue|storage)|growth (?:curve|chart)|time[- ]series|trend ?line)\b/i, weak: /\b(trend|growth|grow|volume|over time|across the day|per (?:day|week|month)|week over week|month over month|usage|traffic|cost|spend|signups?|project(?:ion)?)\b/i },
  { id: 'line', noun: /\b(line (?:chart|graph)|area chart)\b/i },
  { id: 'bar', noun: /\b(bar (?:chart|graph)|stacked bar|column chart)\b/i, weak: /\b(compare|comparison|vs\.?|versus|breakdown|by (?:service|team|region|endpoint|feature))\b/i },
  { id: 'kpi', noun: /\b(kpis?|stat tiles?|scorecard)\b/i },
  { id: 'dashboard', noun: /\b(analytics (?:view|overview|summary|report)|metrics (?:overview|summary|report)|(?:kpi|metrics|ops|status|executive) dashboard)\b/i, weak: /\b(dashboard|analytics|metrics)\b/i },
  { id: 'histogram', noun: /\b(histogram|latency (?:distribution|percentiles?|chart|histogram))\b/i, weak: /\b(latency|response times?|distribution|where the .{0,12}ms goes|percentiles?|p ?(?:50|90|95|99))\b/i },
  { id: 'sparkline', noun: /\bsparklines?\b/i },
  { id: 'donut', noun: /\b(pie chart|donut|doughnut)\b/i },
  { id: 'loadpath', noun: /\b(load path|per[- ]hop)\b/i, weak: /\b(request (?:flow|journey|path)|hop by hop|end to end latency|network (?:analytics|traffic|path)|timings?|hop by hop)\b/i },
  { id: 'sequence', noun: /\b(sequence diagram|swim ?lane|message flow)\b/i, weak: /\b(sequence of (?:calls|requests|messages)|order of calls|who calls whom|swim ?lane|handshake|auth flow|login flow)\b/i },
  { id: 'timeline', noun: /\b(gantt|roadmap chart|timeline of|a (?:project |release )?timeline)\b/i, weak: /\b(timeline|roadmap|schedule|milestones?|rollout plan|release plan|lines up across)\b/i },
  { id: 'flow', noun: /\b(flow ?chart|architecture diagram|system diagram|block diagram|box(?:es)? and arrows|deployment topology)\b/i, weak: /\b(architecture|flow|data flow|pipeline|topology|hang together|how .{0,30} (?:fit|connect)s? together)\b/i },
];

/** The components a message points at, or null when it does not ask for a picture. The message is cut into asks; an ask fires at 3 points (see scoreClause); only fired asks choose the components. */
export function routeVisualIntent(message: string): VisualRoute | null {
  const typed = typedWindows(message);
  const text = clip(squeezeSpace(typed));
  let asks = splitAsks(text).map((c) => (c.length > MAX_CLAUSE ? `${c.slice(0, MAX_CLAUSE / 2)} ${c.slice(-MAX_CLAUSE / 2)}` : c));
  if (asks.length > MAX_CLAUSES) asks = [...asks.slice(0, MAX_CLAUSES / 2), ...asks.slice(-MAX_CLAUSES / 2)];
  const fired = asks.filter((c) => scoreClause(c).score >= FIRE);
  if (fired.length === 0) return null;
  const ask = fired.join(' . ');
  const hits: string[] = [];
  for (const r of RULES) if ((r.noun?.test(ask) ?? false) || (r.weak?.test(ask) ?? false)) hits.push(r.id);
  if (hits.length === 0) {
    const structural = /\b(diagram|boxes|arrows|talk to|talks to|fit together|call order|order of calls|path|connect|services?|workers?|queues?|components?|moves? through|draw (?:it|this|that|them) out|map (?:it|this|that|them) out|lay (?:it|this|that|them) out)\b/i.test(ask);
    const dataish = DATA.test(ask) || MANY_NUMBERS.test(ask) || /\b(chart|plot|graph|sparkline|trend|per|by)\b/i.test(ask);
    hits.push(structural && !(dataish && !/\b(diagram|connect|talk|arrows|boxes)\b/i.test(ask)) ? 'flow' : /\b(pie|donut|share|breakdown|by (?:browser|category|status))\b/i.test(ask) ? 'donut' : !dataish && /\b(draw|sketch|illustrate|visuali[sz]e|map out|lay out)\b/i.test(ask) ? 'flow' : 'line');
  }
  /* forecast wins over plain line; capacity subsumes the load pictures; dashboard subsumes kpi */
  let ids = hits.filter((h, _i, all) => !(h === 'line' && all.includes('line+forecast')) && !(h === 'kpi' && all.includes('dashboard')));
  if (ids.includes('capacity')) ids = ['capacity', ...ids.filter((x) => x !== 'capacity' && x !== 'line+forecast' && x !== 'loadpath' && x !== 'kpi' && x !== 'bar')];
  ids = ids.slice(0, 3);
  const label = (id: string): string => (id === 'line+forecast' ? 'line (with forecast)' : id);
  const real = (id: string): string => (id === 'line+forecast' ? 'line' : id);
  return { components: ids.map(real), hint: `${VISUAL_HINT_PREFIX}: ${ids.map(label).join(', ')}. Call visual({help:"${real(ids[0]!)}"}) for the spec, or write a visual fence.` };
}
