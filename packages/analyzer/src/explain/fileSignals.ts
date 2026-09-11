/**
 * Deterministic, grounded one-line descriptions for a group of files (r183).
 *
 * WHY THIS EXISTS. The keyless (local-first) path used to describe every module
 * as `A group of ${n} related files.` The owner's words on a real repo:
 *
 * > "It says it's 11 TypeScript files in frontend-shared. Oh, cool, what it
 * > does: 'a group of 11 related files.' It does files. What does that mean?"
 *
 * The count is not a description — it is the same sentence for every module in
 * the repo, so the Process rail reads as N identical rows.
 *
 * WHAT THIS IS NOT. It is not an AI call and it is not a guess about business
 * meaning. It reads ONLY the file names and paths that are actually in the
 * group, matches them against a fixed token dictionary, and names what the
 * names themselves say. If the names say nothing recognisable it returns
 * `undefined` and the caller keeps the honest count sentence — the count is the
 * LAST resort, never the first answer, and we never invent domain context that
 * is not visible in the filenames.
 */

/** One recognisable signal: tokens that appear in filenames → what to call it. */
interface Signal {
  /** Stable id, used for dedupe + deterministic tie-breaks. */
  id: string;
  /** Short modifier used when composing ("Checkout and marketing components"). */
  label: string;
  /** Exact tokens (already normalised) that count as a hit. */
  tokens: string[];
  /**
   * r184 — THE NAME FORMS. The owner: "can we give it a system to name certain
   * objects if it sees patterns, if it's not explicitly called [something]? ...
   * for a backend purchasing system, can we just call it 'Purchasing workflow'".
   *
   * `solo` is what this signal is called when it is the only thing the filenames
   * say; `pair` is the short noun used when two signals share the name
   * ("Billing & catalog"). Both are titles for the SAME evidence the
   * description uses — one dictionary, two renderings, so a module's name and
   * its description can never claim different things.
   */
  solo: string;
  pair: string;
}

/**
 * Ordered most-specific-first. Order IS the tie-break: when two signals match
 * the same number of files, the one that says more about the domain wins, so
 * "checkout" beats "UI" and the output stays stable across runs.
 */
const SIGNALS: Signal[] = [
  {
    id: 'checkout',
    label: 'checkout and payment',
    tokens: [
      'checkout', 'payment', 'payments', 'cart', 'billing', 'invoice', 'invoices',
      'stripe', 'pricing', 'subscription', 'subscriptions', 'order', 'orders',
      // r184 - the vocabulary a real billing model layer actually uses, taken
      // from the owner's own backend/app/models: coupon_code.py,
      // coupon_redemption.py, entitlement.py, one_time_charge.py,
      // personal_subscription.py. Without these the module read "Models".
      'purchase', 'purchases', 'coupon', 'coupons', 'redemption', 'redemptions',
      'entitlement', 'entitlements', 'charge', 'charges', 'refund', 'refunds',
      'plan', 'plans', 'price', 'prices', 'discount', 'discounts', 'credit', 'credits',
    ], solo: 'Purchasing workflow', pair: 'Billing' },
  {
    id: 'marketing',
    label: 'marketing',
    tokens: ['marketing', 'landing', 'hero', 'seo', 'blog', 'campaign', 'campaigns', 'testimonial', 'testimonials'], solo: 'Marketing site', pair: 'Marketing' },
  {
    id: 'auth',
    label: 'sign-in and account',
    tokens: [
      'auth', 'login', 'signin', 'signup', 'session', 'sessions', 'oauth',
      'password', 'account', 'accounts', 'permission', 'permissions',
    ], solo: 'Sign-in & accounts', pair: 'Accounts' },
  {
    id: 'dashboard',
    label: 'dashboard and reporting',
    tokens: ['dashboard', 'dashboards', 'overview', 'analytics', 'metrics', 'metric', 'report', 'reports', 'chart', 'charts'], solo: 'Reporting & analytics', pair: 'Reporting' },
  { id: 'admin', label: 'admin', tokens: ['admin', 'moderation', 'backoffice'], solo: 'Admin tools', pair: 'Admin' },
  {
    id: 'chat',
    label: 'chat and messaging',
    tokens: ['chat', 'message', 'messages', 'thread', 'threads', 'conversation', 'conversations', 'inbox'], solo: 'Messaging', pair: 'Messaging' },
  { id: 'search', label: 'search', tokens: ['search', 'query', 'queries', 'indexer', 'autocomplete'], solo: 'Search', pair: 'Search' },
  {
    id: 'notify',
    label: 'email and notification',
    tokens: ['email', 'mail', 'mailer', 'notification', 'notifications', 'notify', 'sms'], solo: 'Email & notifications', pair: 'Notifications' },
  {
    id: 'upload',
    label: 'file and media',
    tokens: ['upload', 'uploads', 'media', 'image', 'images', 'storage', 'attachment', 'attachments'], solo: 'Files & media', pair: 'Media' },
  {
    id: 'queue',
    label: 'background job',
    tokens: ['queue', 'queues', 'worker', 'workers', 'job', 'jobs', 'cron', 'scheduler'], solo: 'Background jobs', pair: 'Background jobs' },
  { id: 'cache', label: 'caching', tokens: ['cache', 'caching', 'redis', 'memo', 'memoize'], solo: 'Caching', pair: 'Caching' },
  {
    id: 'catalog',
    label: 'course and catalog',
    // Same source: class_catalog.py, class_quiz_question.py, webinar_owner_count.py.
    tokens: [
      'catalog', 'catalogs', 'course', 'courses', 'lesson', 'lessons', 'quiz',
      'quizzes', 'question', 'questions', 'webinar', 'webinars', 'curriculum',
      'enrollment', 'enrollments', 'syllabus',
    ], solo: 'Courses & catalog', pair: 'Catalog' },
  {
    id: 'data',
    label: 'data model and schema',
    tokens: [
      'model', 'models', 'schema', 'schemas', 'migration', 'migrations', 'entity',
      'entities', 'repository', 'repositories', 'prisma', 'sql', 'database',
    ], solo: 'Data models', pair: 'Data models' },
  {
    id: 'api',
    label: 'API route',
    tokens: [
      'route', 'routes', 'router', 'endpoint', 'endpoints', 'controller',
      'controllers', 'handler', 'handlers', 'resolver', 'resolvers', 'middleware',
    ], solo: 'API routes', pair: 'API routes' },
  { id: 'client', label: 'API client', tokens: ['sdk', 'http', 'fetcher', 'apiclient'], solo: 'API clients', pair: 'API clients' },
  {
    id: 'form',
    label: 'form and validation',
    tokens: ['form', 'forms', 'field', 'fields', 'input', 'inputs', 'validation', 'validator', 'validate'], solo: 'Forms & validation', pair: 'Forms' },
  {
    id: 'nav',
    label: 'navigation',
    tokens: ['nav', 'navbar', 'navigation', 'menu', 'sidebar', 'header', 'footer', 'breadcrumb', 'breadcrumbs'], solo: 'Navigation', pair: 'Navigation' },
  {
    id: 'layout',
    label: 'layout and page',
    tokens: ['layout', 'layouts', 'page', 'pages', 'screen', 'screens', 'template', 'templates', 'shell'], solo: 'Pages & layout', pair: 'Pages' },
  {
    id: 'ui',
    label: 'UI',
    tokens: ['button', 'buttons', 'card', 'cards', 'modal', 'modals', 'dialog', 'badge', 'table', 'tooltip', 'dropdown', 'avatar', 'toast'], solo: 'UI components', pair: 'UI' },
  { id: 'style', label: 'styling and theme', tokens: ['style', 'styles', 'css', 'theme', 'themes', 'tailwind'], solo: 'Styling & theme', pair: 'Styling' },
  { id: 'hook', label: 'React hook', tokens: ['hook', 'hooks'], solo: 'React hooks', pair: 'Hooks' },
  {
    id: 'state',
    label: 'state and store',
    tokens: ['store', 'stores', 'reducer', 'reducers', 'slice', 'zustand', 'redux'], solo: 'State & stores', pair: 'State' },
  /*
   * r186 — FOUR SIGNALS WERE BUILT, MEASURED ON REAL REPOS, AND NOT SHIPPED.
   *
   * The coverage gap is real and was confirmed by scanning the pinned QA repos:
   * `gin` codec/json + render, `django` core/serializers + db/backends/{mysql,
   * oracle,postgresql,sqlite3}, `prometheus` promql/parser + codemirror-promql,
   * `vite` src/node/plugins and prometheus plugins/ all match NO signal today.
   * Candidate signals were written for serialization, parsing/compilation,
   * database engines and plugins, each token taken from a real filename.
   *
   * They were reverted because of what the before/after actually showed, not
   * because they were wrong:
   *
   *  1. `describeFileGroup` OUTRANKS the counted-symbol sentence
   *     (`describeCluster`) in `buildFeatureNode`. So every new token did not
   *     FILL a blank — it REPLACED a more specific sentence. gin/render went
   *     from "14 go files in render, defining Instance, loadTemplate, Render."
   *     to "Serialization format modules." `module-naming-honesty.test.ts`
   *     locks the opposite, from a real QA finding on that exact directory.
   *  2. The generalisation was sometimes less true than what it replaced: only
   *     7 of gin/render's 14 files are serializers; the rest render HTML, PDF,
   *     text and redirects.
   *  3. `plugin` earned nothing at all — both modules it hit are ALREADY titled
   *     "Plugins", so the summary just repeated the row's own name (HANDOFF §6),
   *     and `extension` fired on vite's `resolve/exact-extension` fixture, where
   *     the word means a FILE extension.
   *
   * The honest conclusion, recorded so the next round does not re-derive it:
   * the dictionary is not the binding constraint here. The two grounded facts
   * (domain pattern, counted symbols) COMPETED where they should complement,
   * and that precedence — not the token list — was what to change.
   *
   * r187 (G11) / G14 — FIXED in `buildFeatureNode`: both facts complement on
   * one line (`fromFacts — domain` since G14 — counted symbols lead so a narrow
   * row's ellipsis keeps the specific detail), and
   * is dropped when it only repeats the row title. `module-naming-honesty.test.ts`
   * locks gin/render and gin/binding. Re-adding these four dictionary tokens is
   * a separate round — each still needs its own measurement once precedence is
   * no longer the blocker.
   */
  {
    id: 'test',
    label: 'test',
    tokens: ['test', 'tests', 'spec', 'specs', 'fixture', 'fixtures', 'mock', 'mocks'], solo: 'Tests', pair: 'Tests' },
  {
    id: 'config',
    label: 'configuration',
    tokens: ['config', 'configuration', 'settings', 'setup', 'constants'], solo: 'Configuration', pair: 'Configuration' },
  { id: 'types', label: 'type declaration', tokens: ['types', 'typings', 'interfaces', 'dts'], solo: 'Type declarations', pair: 'Types' },
  { id: 'util', label: 'shared utility', tokens: ['util', 'utils', 'helper', 'helpers'], solo: 'Shared utilities', pair: 'Utilities' },
];

const TOKEN_TO_SIGNAL = new Map<string, string>();
for (const s of SIGNALS) {
  for (const t of s.tokens) if (!TOKEN_TO_SIGNAL.has(t)) TOKEN_TO_SIGNAL.set(t, s.id);
}
const SIGNAL_RANK = new Map(SIGNALS.map((s, i) => [s.id, i] as const));
const SIGNAL_BY_ID = new Map(SIGNALS.map((s) => [s.id, s] as const));

/** The real extension, with `.d.ts` kept whole. */
function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (/\.d\.ts$/i.test(base)) return 'd.ts';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Split a file name into lowercase word tokens: path segments, camelCase humps,
 * kebab/snake pieces, plus a `dts` marker for `*.d.ts`. `PaidCheckoutFields.tsx`
 * → `paid`, `checkout`, `fields`.
 */
export function tokenizeFileName(nameOrPath: string): string[] {
  const marked = nameOrPath.replace(/\.d\.ts$/i, '.dts');
  const out: string[] = [];
  for (const part of marked.split(/[/\\]/)) {
    // Drop a trailing real extension, but KEEP the `.dts` marker as a token.
    const cleaned = /\.dts$/i.test(part) ? part.replace(/\.dts$/i, '_dts') : part.replace(/\.[A-Za-z0-9]+$/, '');
    for (const chunk of cleaned.split(/[^A-Za-z0-9]+/)) {
      if (!chunk) continue;
      for (const word of chunk.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/)) {
        const w = word.toLowerCase();
        if (w) out.push(w);
      }
    }
  }
  return out;
}

/** Just the file's own name — the path is a filing decision, not a signal. */
function basenameOf(nameOrPath: string): string {
  return nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1);
}

/** Which signals a single file name carries (deduped per file). */
function signalsForFile(nameOrPath: string): Set<string> {
  const hits = new Set<string>();
  for (const tok of tokenizeFileName(nameOrPath)) {
    const id = TOKEN_TO_SIGNAL.get(tok);
    if (id) hits.add(id);
  }
  return hits;
}

/** Signal counts over a set of names, plus which files each signal covered. */
function tally(names: readonly string[]): {
  counts: Map<string, number>;
  coveredBy: Map<string, Set<number>>;
} {
  const counts = new Map<string, number>();
  const coveredBy = new Map<string, Set<number>>();
  names.forEach((name, i) => {
    for (const id of signalsForFile(name)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      let set = coveredBy.get(id);
      if (!set) coveredBy.set(id, (set = new Set()));
      set.add(i);
    }
  });
  return { counts, coveredBy };
}

/**
 * r184 — NAME a group of files from the pattern their names make, or `undefined`
 * when they make none.
 *
 * The owner: *"can we give it a system to name certain objects if it sees
 * patterns, if it's not explicitly called [something]? For example, if it sees a
 * pattern… for a backend purchasing system, can we just call it 'Purchasing
 * workflow'?"* — asked about modules that today read `Models`, `Src Admin` or
 * `Top level`: true statements about the filing, saying nothing about the code.
 *
 * SAME EVIDENCE AS {@link describeFileGroup}, deliberately: one dictionary, two
 * renderings, so a module's name and its description can never disagree. Two
 * differences, both about a name being a stronger claim than a sentence:
 *
 *  - IT READS BASENAMES ONLY. `describeFileGroup` tokenizes whole paths, which
 *    is right for a description; for a NAME it is a trap — every file under
 *    `backend/app/models/` carries the token `models`, so the path alone would
 *    name that module "Data models", which is the exact answer the owner
 *    rejected. What the FILES are called is the evidence; where they sit is not.
 *  - IT IS STRICTER. A name replaces the honest mechanical one for good, so it
 *    needs half the group behind it (not a quarter), at least 3 files to have a
 *    pattern at all, and no three-way tie at the top — when the evidence cannot
 *    pick, this returns undefined and the caller keeps the mechanical name. A
 *    mechanical name is not a failure state; a confident wrong one is.
 *
 * Deterministic and keyless: same files in, same name out, no network.
 */
export function nameFileGroup(namesOrPaths: readonly string[]): string | undefined {
  const names = namesOrPaths
    .filter((n) => typeof n === 'string' && n.trim() !== '')
    .map(basenameOf);
  // Fewer than three files is not a pattern, it is a coincidence.
  if (names.length < 3) return undefined;

  const { counts, coveredBy } = tally(names);
  if (counts.size === 0) return undefined;

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return (SIGNAL_RANK.get(a[0]) ?? 999) - (SIGNAL_RANK.get(b[0]) ?? 999);
  });
  // Three or more domains equally present: the files genuinely do several
  // things and no one name is true of them. Say nothing.
  if (ranked.length >= 3 && ranked[0][1] === ranked[2][1]) return undefined;

  const chosen = [ranked[0][0]];
  // A second domain joins the name only if it is really there (>= 2 files) and
  // is not itself tied with a third — "Billing & catalog" must not be a coin flip.
  if (ranked.length >= 2 && ranked[1][1] >= 2 && !(ranked.length >= 3 && ranked[1][1] === ranked[2][1])) {
    chosen.push(ranked[1][0]);
  }

  const covered = new Set<number>();
  for (const id of chosen) for (const i of coveredBy.get(id) ?? []) covered.add(i);
  if (covered.size < 2) return undefined;
  if (covered.size / names.length < 0.5) return undefined;

  const sigs = chosen.map((id) => SIGNAL_BY_ID.get(id)).filter((sig): sig is Signal => !!sig);
  if (sigs.length === 0) return undefined;
  if (sigs.length === 1) return sigs[0].solo;
  return `${sigs[0].pair} & ${sigs[1].pair.toLowerCase()}`;
}

/** The head noun the composed sentence ends with, from the real extensions. */
function headNoun(names: readonly string[]): string {
  let view = 0;
  let style = 0;
  let code = 0;
  for (const n of names) {
    const ext = extensionOf(n);
    if (ext === 'tsx' || ext === 'jsx' || ext === 'vue' || ext === 'svelte') view++;
    else if (ext === 'css' || ext === 'scss' || ext === 'less') style++;
    else if (ext) code++;
  }
  if (view > style && view > code) return 'components';
  if (style > view && style > code) return 'stylesheets';
  if (code > 0 && view === 0 && style === 0) return 'modules';
  return 'files';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compose two signal labels without doubling "and".
 *
 * G15 — labels like `checkout and payment` are already conjunctions; naïvely
 * joining with `and` produced "Test and checkout and payment". When either side
 * already carries a conjunction, comma-join reads cleanly.
 */
function joinSignalLabels(a: string, b: string): string {
  if (/\band\b/.test(a) || /\band\b/.test(b)) return `${a}, ${b}`;
  return `${a} and ${b}`;
}

/**
 * A grounded one-line description of what a group of files is, or `undefined`
 * when the names carry no recognisable pattern (caller keeps its honest
 * count-only sentence).
 *
 * Honesty rules, deliberately conservative:
 *  - a signal must be visible in the file names — nothing is inferred from
 *    counts, siblings, edges, or the module's own name;
 *  - the named signals must together cover a real share of the group (>= 25%,
 *    and at least 2 files unless the group is tiny), so one stray `config.ts`
 *    in an 11-file group never gets to call the whole group "configuration";
 *  - at most two signals are named — the bar is the terse SPOF copy, not prose.
 */
export function describeFileGroup(namesOrPaths: readonly string[]): string | undefined {
  const found = fileGroupSignal(namesOrPaths);
  if (!found) return undefined;
  return `${capitalize(found.phrase)} ${found.head}.`;
}

/**
 * The same evidence {@link describeFileGroup} renders as a sentence, handed back
 * in PARTS.
 *
 * r187 (G11) — the sentence was the only thing this module exposed, and a
 * sentence can only ever REPLACE another sentence. `buildFeatureNode` chose it
 * over the counted-symbol description, so adding a domain pattern made a module
 * row vaguer, not richer: gin's `render/` went from "14 go files in render,
 * defining Instance, loadTemplate, Render." to "Serialization format modules."
 * Two grounded facts were competing where they should complement. With the
 * parts split out, the caller can put counted symbols first and domain context
 * after — one line, both facts, neither invented (G14: symbols lead for ellipsis).
 *
 *  - `phrase` — the domain modifier alone, lowercase ("form and validation").
 *  - `head` — the noun the extensions justify ("modules" / "components").
 *  - `words` — the phrase's content words, for a caller that needs to check
 *    whether the row's own title already says this (HANDOFF §6: a row must not
 *    just repeat its own name).
 */
export function fileGroupSignal(
  namesOrPaths: readonly string[]
): { phrase: string; head: string; words: string[] } | undefined {
  const names = namesOrPaths.filter((n) => typeof n === 'string' && n.trim() !== '');
  if (names.length === 0) return undefined;

  // Same tally the naming pass uses — one mechanism, two renderings.
  const { counts, coveredBy } = tally(names);
  if (counts.size === 0) return undefined;

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return (SIGNAL_RANK.get(a[0]) ?? 999) - (SIGNAL_RANK.get(b[0]) ?? 999);
  });
  const chosen = ranked.slice(0, 2).map(([id]) => id);
  const covered = new Set<number>();
  for (const id of chosen) for (const i of coveredBy.get(id) ?? []) covered.add(i);

  const minFiles = names.length <= 2 ? 1 : 2;
  if (covered.size < minFiles) return undefined;
  if (covered.size / names.length < 0.25) return undefined;

  const labels = chosen.map((id) => SIGNAL_BY_ID.get(id)?.label ?? id);
  const head = headNoun(names);
  const joined = labels.length === 2 ? joinSignalLabels(labels[0], labels[1]) : labels[0];
  const words = [...new Set(joined.split(/\s+/).filter((w) => w !== '' && w !== 'and'))];
  return { phrase: joined, head, words };
}
