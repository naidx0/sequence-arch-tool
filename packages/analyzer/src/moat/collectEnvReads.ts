/**
 * The OBSERVED half of the service-input card: which env vars a service's own
 * source actually reads, and what would stop us knowing.
 *
 * Pure over `FileFacts`, so it can be tested without a repository — and,
 * critically, it reads env parts from EVERY place the extractor puts them.
 * That sounds obvious and was not: the probe that first measured this card read
 * `args` and `assignments` and skipped `kwargs`, where `extractCallJs` puts an
 * object argument's pairs. Two of three reported "misses" were that omission,
 * published as a product finding. The three sources below are the complete set,
 * and a fourth appearing in `facts.ts` must be added here or this file starts
 * lying by omission again.
 */
import { isTestFile } from '../testFiles.js';
import type { ServiceFiles } from '../scan.js';
import type { FileFacts, Part } from '../types.js';

import type { CardInput, EnvReadFact } from './serviceInputCard.js';
import { CONFIG_LIBRARY_SPECIFIERS } from './serviceInputCard.js';

/**
 * `assignments` is a Map with no line numbers, so a module-level read had no
 * citation — the card printed `file:?` for it. Rather than leave the evidence
 * half-formed, find the line by looking for the variable's own name in the
 * file's source lines.
 *
 * This is a LOOKUP, not a guess: the line is only cited when that line really
 * does contain the name, and `undefined` stands when it does not. A citation
 * this repo cannot point at is the thing `docs/CANON.md` calls fabricated.
 */
const lineMentioning = (facts: FileFacts, name: string, from?: number): number | undefined => {
  const lines = facts.lines ?? [];
  /*
   * A CALL'S LINE IS WHERE THE CALL STARTS, not where the variable is read.
   *
   *   const r = await fetch('https://api.stripe.com/v1/charges', {   <- call.line
   *     method: 'POST',
   *     headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },  <- the read
   *
   * Citing the call line put STRIPE_KEY and REDIS_ADDR on lines that do not
   * contain them. So search forward from the call for the first line that
   * actually mentions the name, then fall back to the whole file, and cite
   * nothing when nothing matches.
   */
  /*
   * A LINE THAT MENTIONS THE NAME IS NOT NECESSARILY THE READ. On this
   * repository the first line mentioning `SEQUENCE_USER_DIR` is a doc comment
   * explaining it, six lines above the `process.env` that reads it — so the
   * card cited prose as evidence of a read. Prefer a line that also carries an
   * environment accessor, and fall back to a bare mention only when none does.
   */
  const accessor = /process\.env|os\.environ|os\.getenv|getenv|System\.getenv|ENV\[/;
  const scan = (pred: (l: string) => boolean): number | undefined => {
    if (from !== undefined) {
      for (let i = Math.max(0, from - 1); i < lines.length; i++) if (pred(lines[i])) return i + 1;
    }
    const idx = lines.findIndex(pred);
    return idx >= 0 ? idx + 1 : undefined;
  };
  return (
    scan((l) => l.includes(name) && accessor.test(l)) ?? scan((l) => l.includes(name))
  );
};

const envPartsOf = (facts: FileFacts): { name: string; line?: number; byConvention?: boolean }[] => {
  const out: { name: string; line?: number; byConvention?: boolean }[] = [];
  const take = (parts: readonly Part[] | undefined, line?: number): void => {
    for (const p of parts ?? []) {
      if (p?.t === 'env') {
        out.push({
          name: p.name,
          line: lineMentioning(facts, p.name, line),
          byConvention: p.byConvention === true,
        });
      }
    }
  };
  // 1. module-level constants: `const A = process.env.X`
  for (const [, parts] of facts.assignments) {
    for (const p of parts ?? []) {
      if (p?.t === 'env') {
        out.push({
          name: p.name,
          line: lineMentioning(facts, p.name),
          byConvention: p.byConvention === true,
        });
      }
    }
  }
  for (const call of facts.calls ?? []) {
    // 2. positional arguments: `fetch(process.env.X)`
    for (const arg of call.args ?? []) take(arg, call.line);
    // 3. object-literal arguments, which the extractor lifts into kwargs:
    //    `new Pool({ connectionString: process.env.X })`
    for (const key of Object.keys(call.kwargs ?? {})) take(call.kwargs[key], call.line);
    // 4. a config accessor naming the variable as a literal:
    //    `configService.get('WHITELISTED_ORIGINS')`
    const named = configAccessorName(call);
    if (named !== undefined) out.push({ name: named, line: lineMentioning(facts, named, call.line) });
  }
  return out;
};

/**
 * `configService.get('TRUST_PROXY')` IS a read, and a common one.
 *
 * Measured on Hoppscotch: `TRUST_PROXY` and `WHITELISTED_ORIGINS` are declared
 * in `.env.example` and read exactly this way, and the card called both
 * "declared, never read" — two false accusations out of four. NestJS is the
 * example; the shape is general, and Java's `@Value("${NAME}")` is the same idea
 * already handled at the parse layer.
 *
 * This lives in the card's collector rather than in `facts.ts` on purpose. The
 * joiner draws edges from env parts, and teaching the extractor that any
 * `.get('X')` is an environment read would change what it draws everywhere. The
 * card asks a narrower question and can afford a narrower rule.
 *
 * Tight on both sides, because the failure mode of a loose rule is on record in
 * this same file — the SCREAMING_SNAKE member convention turned
 * `Number.POSITIVE_INFINITY` into an environment variable:
 *
 *   - the callee must name a config object (`configService.get`, `config.get`,
 *     `this.configService.getOrThrow`), so a plain `map.get('k')` cannot match;
 *   - the argument must be a single SCREAMING_SNAKE string literal, which is the
 *     naming convention environment variables actually use.
 */
const CONFIG_ACCESSOR = /(^|\.)(config|configService|cfg|conf|settings|env)\.(get|getOrThrow|require|mustGet)$/i;
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

const configAccessorName = (call: FileFacts['calls'][number]): string | undefined => {
  if (!CONFIG_ACCESSOR.test(call.callee)) return undefined;
  const first = (call.args ?? [])[0];
  if (first === undefined || first.length !== 1) return undefined;
  const only = first[0];
  if (only?.t !== 'lit' || !ENV_NAME.test(only.v)) return undefined;
  return only.v;
};

const configLibrariesIn = (facts: FileFacts): string[] => {
  const hits = new Set<string>();
  for (const imp of facts.imports ?? []) {
    const raw = imp.raw ?? '';
    for (const lib of CONFIG_LIBRARY_SPECIFIERS) {
      // Match the module, not a substring of a path: `dotenv` and `dotenv/config`
      // count, `my-dotenv-helper` does not.
      if (raw === lib || raw.startsWith(`${lib}/`) || raw.endsWith(`.${lib}`)) hits.add(lib);
    }
  }
  return [...hits].sort();
};

export interface CollectedReads {
  reads: EnvReadFact[];
  filesScannedByService: Record<string, number>;
  configLibrariesByService: Record<string, string[]>;
  languageByService: Record<string, string | undefined>;
}

export function collectEnvReads(perService: readonly ServiceFiles[]): CollectedReads {
  const reads: EnvReadFact[] = [];
  const filesScannedByService: Record<string, number> = {};
  const configLibrariesByService: Record<string, string[]> = {};
  const languageByService: Record<string, string | undefined> = {};

  for (const { service, facts } of perService) {
    filesScannedByService[service.name] = facts.length;
    const libs = new Set<string>();
    const langs = new Map<string, number>();
    for (const f of facts) {
      for (const lib of configLibrariesIn(f)) libs.add(lib);
      langs.set(f.language, (langs.get(f.language) ?? 0) + 1);
      const fromTest = isTestFile(f.file);
      /*
       * THE SLOT FIRST. `FileFacts.envReads` records a read WHEREVER it sits, so
       * it subsumes what the Part channels below can see and adds the positions
       * they never could — a condition, a call chain, a return. Measured on this
       * repository, that is 28 names against 51.
       *
       * The Part channels stay for what the slot does NOT match: reads inferred
       * from a SCREAMING_SNAKE member access and from a config accessor, both of
       * which are confirmation-only. Duplicates across the two are collapsed by
       * `readIndex`, which keys on service and name and keeps the strongest.
       */
      for (const r of f.envReads ?? []) {
        reads.push({
          service: service.name,
          name: r.name,
          file: f.file,
          line: r.line,
          position: r.position,
          fromTest,
        });
      }
      for (const { name, line, byConvention } of envPartsOf(f)) {
        reads.push({
          service: service.name,
          name,
          file: f.file,
          line,
          byConvention,
          fromTest,
        });
      }
    }
    configLibrariesByService[service.name] = [...libs].sort();
    // The service's language is whichever one most of its files are in — the
    // per-extension coverage gate needs one answer, and a stray .js config file
    // in a Python service must not decide it.
    languageByService[service.name] =
      [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? undefined;
  }

  return { reads, filesScannedByService, configLibrariesByService, languageByService };
}

/** Assemble everything `buildServiceInputCard` needs from a completed scan. */
export function cardInputFrom(
  perService: readonly ServiceFiles[],
  services: CardInput['services'],
  coverage: CardInput['coverage'],
  unscanned: CardInput['unscanned'],
): CardInput {
  const collected = collectEnvReads(perService);
  return {
    services,
    coverage,
    unscanned,
    ...collected,
  };
}
