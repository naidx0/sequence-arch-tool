/**
 * Language packs — per-language comprehension instructions, composed per repo mix.
 *
 * The seams that need "how do I read THIS language" already existed and each one
 * answered the question on its own: the labeller had an `extras` field nobody
 * filled, the explain/annotate prompts were language-blind, and the detectors
 * carried inline `f.language === 'java'` branches reasoned out independently at
 * three call sites. A pack is that knowledge stated ONCE, per language, and
 * handed to whichever seam asks.
 *
 * SELECTION IS PER SERVICE, not per repo. A 60% Python / 30% TypeScript repo is
 * not "a Python repo" — its Python service gets the Python pack and its React
 * service gets the TS pack, because the service boundary the scan already draws
 * is where the mix actually splits. `selectPacks` therefore takes one mix's
 * shares, and callers hand it the shares of the thing they are describing.
 *
 * HONESTY, binding:
 *  - a pack biases LABELS, PROMPTS and detector allowlists. It never writes
 *    `FileFacts.language`, never adds an edge, and never adds a detection
 *    category — every allowlist entry below already existed as a live branch;
 *  - packs exist for exactly the five languages that have a tree-sitter grammar
 *    (`parse/treesitter.ts`). Rust/Ruby/PHP/Kotlin/Swift have no parser, so a
 *    pack for them would be instructions for reading facts we never collected.
 *    `selectPacks` returns nothing for them and `languageMix` reports the share
 *    honestly as unparsed.
 */

import type { LanguageShare } from './mix.js';

export type PackId = 'ts' | 'py' | 'go' | 'java';

/** Callee/annotation names a detector may treat as an idiom of this language.
 *  Every list is the exact set the detector already hard-coded — moving it here
 *  removes the duplication, it does not widen detection. */
export interface CalleeAllowlists {
  /**
   * Producer calls whose FIRST positional literal is the topic
   * (`producer.send("orders", …)`). Empty where the language's clients pass the
   * topic some other way — kafkajs uses an object argument, which
   * `detectQueues` reads separately and must not double-fire on.
   */
  queuePublishFirstArg: readonly string[];
  /** Class annotations that mark an HTTP route controller. Empty where the
   *  language has no annotation-based routing. */
  routeControllerAnnotations: readonly string[];
  /** Method annotations that mark a queue consumer, mapped to the argument key
   *  holding the topic/queue name. */
  queueConsumerAnnotations: Readonly<Record<string, string>>;
}

export interface LanguagePack {
  id: PackId;
  /** Human name used in the instruction text handed to a model. */
  title: string;
  /** Does this pack read files of that `FileFacts.language`? */
  matches(language: string | undefined): boolean;
  /** Naming conventions to translate into native English, for label prompts. */
  labelHints: readonly string[];
  /** How to READ this language into architecture, for explain/annotate prompts. */
  promptGuidance: readonly string[];
  /** Idiomatic entrypoint file names. Advisory only: a caller must still find
   *  the file in the real graph before calling anything an entry point. */
  entrypointHints: readonly string[];
  calleeAllowlists: CalleeAllowlists;
}

const TS_PACK: LanguagePack = {
  id: 'ts',
  title: 'TypeScript/JavaScript',
  matches: (l) => l === 'ts' || l === 'js',
  labelHints: [
    'A directory of PascalCase .tsx files is a React component group — name it for the screen or feature it renders, not "components".',
    'routes/, api/, controllers/ and pages/api/ hold HTTP handlers; hooks/ holds React state logic; store/, slice/ and context/ hold shared client state.',
    'index.ts is usually a re-export barrel, so it names the module rather than describing it.',
  ],
  promptGuidance: [
    'TypeScript/JavaScript: Express/Fastify/Koa route files and Next.js app/ or pages/ directories are the HTTP surface; a file exporting a PascalCase function returning JSX is a UI component; .d.ts files are type declarations with no runtime behaviour.',
  ],
  entrypointHints: ['main.ts', 'main.js', 'index.ts', 'index.js', 'server.ts', 'server.js', 'app.ts'],
  calleeAllowlists: {
    // kafkajs passes { topic }, handled by the kwargs branch — a first-arg rule
    // here would double-fire on it.
    queuePublishFirstArg: [],
    routeControllerAnnotations: [],
    queueConsumerAnnotations: {},
  },
};

const PY_PACK: LanguagePack = {
  id: 'py',
  title: 'Python',
  matches: (l) => l === 'py',
  labelHints: [
    'Django/Flask convention: views.py is the HTTP layer, models.py the database schema, serializers.py the wire format, urls.py the routing table, admin.py the internal console — name the module for the DOMAIN it serves ("Orders"), not the layer file.',
    'tasks.py / worker.py are Celery or arq background jobs; conftest.py and test_*.py are tests.',
    'A package is its directory plus __init__.py, so the directory name is the module name.',
  ],
  promptGuidance: [
    'Python: FastAPI/Flask decorators (@app.get, @router.post) and Django urls.py entries are the HTTP surface; a class inheriting from a Base/Model is a database table; @celery.task / arq functions are background work, not request handling.',
  ],
  entrypointHints: ['__main__.py', 'main.py', 'app.py', 'server.py', 'manage.py', 'wsgi.py', 'asgi.py'],
  calleeAllowlists: {
    // kafka-python / aiokafka producers: topic is the first positional literal.
    queuePublishFirstArg: ['send', 'send_and_wait'],
    routeControllerAnnotations: [],
    queueConsumerAnnotations: {},
  },
};

const GO_PACK: LanguagePack = {
  id: 'go',
  title: 'Go',
  matches: (l) => l === 'go',
  labelHints: [
    'cmd/<name>/ is a binary and names the program; internal/ and pkg/ hold libraries — name them for their domain package, which is the directory name.',
    'handler.go / *_handler.go is the HTTP layer, store.go / repository.go the persistence layer, *_test.go tests.',
  ],
  promptGuidance: [
    'Go: gin/echo/chi/fiber route registrations (r.GET, r.Post, mux.HandleFunc) are the HTTP surface; a struct with methods is the unit of responsibility; the package name, not the file name, is what a Go reader calls the module.',
  ],
  entrypointHints: ['main.go'],
  calleeAllowlists: {
    queuePublishFirstArg: [],
    routeControllerAnnotations: [],
    queueConsumerAnnotations: {},
  },
};

const JAVA_PACK: LanguagePack = {
  id: 'java',
  title: 'Java',
  matches: (l) => l === 'java',
  labelHints: [
    'Spring convention: @RestController/@Controller is the HTTP layer, @Service the business logic, @Repository the persistence layer, @Entity a database table, @Configuration wiring — name the module for the domain it serves, not for the stereotype.',
    'The package path (com.example.orders) names the domain; *Application.java is the boot class.',
    'DTO/VO/Mapper classes are wire shapes, not behaviour.',
  ],
  promptGuidance: [
    'Java: @RestController classes with @GetMapping/@PostMapping methods are the HTTP surface; @KafkaListener/@RabbitListener methods consume messages; @Entity/@Table classes are database tables; application.properties / application.yml hold the addresses of everything the service talks to.',
  ],
  entrypointHints: ['Application.java', 'Main.java'],
  calleeAllowlists: {
    // Spring KafkaTemplate.send(topic, …).
    queuePublishFirstArg: ['send'],
    routeControllerAnnotations: ['RestController', 'Controller'],
    queueConsumerAnnotations: { RabbitListener: 'queues', KafkaListener: 'topics' },
  },
};

export const LANGUAGE_PACKS: readonly LanguagePack[] = [TS_PACK, PY_PACK, GO_PACK, JAVA_PACK];

/** The pack that reads this language, or undefined when nothing parses it. */
export function packFor(language: string | undefined): LanguagePack | undefined {
  if (!language) return undefined;
  return LANGUAGE_PACKS.find((p) => p.matches(language));
}

/** Empty allowlists, so a detector can ask for a pack it may not get without
 *  branching. Nothing detects on these — they are the "we don't parse it" answer. */
export const NO_ALLOWLISTS: CalleeAllowlists = {
  queuePublishFirstArg: [],
  routeControllerAnnotations: [],
  queueConsumerAnnotations: {},
};

/** Allowlists for a file's language — `NO_ALLOWLISTS` when no pack reads it. */
export function allowlistsFor(language: string | undefined): CalleeAllowlists {
  return packFor(language)?.calleeAllowlists ?? NO_ALLOWLISTS;
}

/**
 * A language must reach this share of a mix before its pack is composed in. Set
 * so the owner's own example (60% Python / 30% React) yields BOTH packs, while a
 * stray config script in a third language does not add a third voice to every
 * prompt. The top parsed language is always included regardless of share — a
 * service written entirely in one language we parse is never left packless.
 */
export const MIN_PACK_SHARE = 0.15;

/**
 * The packs for one mix — a service's, or the repo's — strongest share first.
 *
 * Unparsed shares are skipped: there is no pack to select. That is deliberate,
 * and it is why a Rust-dominated repo composes no Rust instructions instead of
 * inventing some — `languageMix` still reports the share so the honest answer is
 * available to whoever wants to state it.
 */
export function selectPacks(shares: readonly LanguageShare[], minShare = MIN_PACK_SHARE): LanguagePack[] {
  // ts and js share a pack, so shares are aggregated PER PACK before the
  // threshold is applied: a service that is 10% .ts + 10% .js is 20% of one
  // language as a reader experiences it, not two languages under the bar.
  const ranked = LANGUAGE_PACKS.map((pack) => ({ pack, share: coveredShare(pack, shares) }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share || a.pack.id.localeCompare(b.pack.id));
  return ranked.filter((r, i) => i === 0 || r.share >= minShare).map((r) => r.pack);
}

/** The share of a mix a pack actually covers — also states WHY it was picked. */
function coveredShare(pack: LanguagePack, shares: readonly LanguageShare[]): number {
  return shares
    .filter((s) => s.parsed && pack.matches(s.language))
    .reduce((sum, s) => sum + s.share, 0);
}

/**
 * The `LabelRequest.extras` line for a mix: what the module is written in, and
 * the naming conventions that language uses. Empty string when no pack applies,
 * so the caller can leave `extras` unset rather than pad the prompt.
 */
export function composeLabelHints(shares: readonly LanguageShare[]): string {
  const packs = selectPacks(shares);
  if (packs.length === 0) return '';
  const mixLine = packs
    .map((p) => `${Math.round(coveredShare(p, shares) * 100)}% ${p.title}`)
    .join(', ');
  return [`written in ${mixLine}`, ...packs.flatMap((p) => p.labelHints)].join(' | ');
}

/**
 * Prompt lines for the explain/annotate passes: one "how to read it" sentence
 * per selected pack, plus the idiomatic entrypoint names so the model can
 * recognise the entry file it is already being shown. Never asserts that any of
 * those files exist — the digest is the only source of what does.
 */
export function composePromptGuidance(perService: readonly (readonly LanguageShare[])[]): string[] {
  const packs: LanguagePack[] = [];
  for (const shares of perService) {
    for (const p of selectPacks(shares)) if (!packs.includes(p)) packs.push(p);
  }
  if (packs.length === 0) return [];
  const lines = packs.flatMap((p) => [...p.promptGuidance]);
  lines.push(
    `Entry points in these languages are conventionally named: ${packs
      .map((p) => `${p.title} — ${p.entrypointHints.join(', ')}`)
      .join('; ')}. Only treat a file as an entry point if it appears in the digest.`
  );
  return lines;
}
