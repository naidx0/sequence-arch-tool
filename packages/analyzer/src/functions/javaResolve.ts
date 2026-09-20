/**
 * Java cross-file call resolution (U33).
 *
 * ─ WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Three repos in the 27-repo corpus name an entrypoint whose "Show main flow"
 * dead-ends. Two are Spring: `spring-petclinic-monolith` and `spring-boot`.
 * Measured on both at `main`, the FunctionGraph had **zero cross-file call
 * edges** — 182 function nodes and 33 edges on petclinic, every one of them
 * inside a single file. Not "few". Zero. So `detectStemCandidates` had no
 * grounded root to fall back to, and the user got *"the scan recorded no calls
 * out of it, and no other file in this scan has one either"* over a repo that
 * is nothing but controllers calling repositories.
 *
 * There were two independent reasons, and both are gaps in what we read, not
 * facts about Spring:
 *
 *  1. `resolveImport` returns `undefined` for every Java import, so
 *     `resolveCalleeCrossFile` never had a target file to look in.
 *  2. Even with a resolved import it would not have matched, because a Java
 *     call is recorded through its RECEIVER — `this.owners.findById`,
 *     `owner.getPet`, `EntityUtils.getById` — and never as the bare method
 *     name a `fn.name === callee` test compares against.
 *
 * ─ WHAT THIS DOES **NOT** CLAIM ─────────────────────────────────────────────
 * Spring's framework dispatch stays invisible, and deliberately so. Nothing
 * here invents an edge from `@SpringBootApplication` to a `@GetMapping`
 * method: that wiring is not in the code we parse, and manufacturing it to
 * make a metric go green would invert the point of the metric.
 * `PetClinicApplication.main` still calls exactly one thing — `SpringApplication
 * .run` — and that is still a call into a dependency we do not read, so it
 * still has no outbound edge. What changes is that the REST of the repo now has
 * the call graph it always had in its source, so the honest grounded fallback
 * in `stemFlow.detectStemCandidates` (a file nothing calls, that calls out) has
 * real evidence to offer instead of nothing.
 *
 * ─ THE RULES, AND HOW STRICT THEY ARE ───────────────────────────────────────
 * These mirror javac's own name resolution, restricted to what one file's text
 * proves, and every one of them resolves to nothing rather than to a guess:
 *
 *  - A TYPE resolves to a file when the file is in the caller's own package
 *    (Java's package IS its directory, the same language rule Go's
 *    `resolveCalleeInPackage` already encodes) or when a single-type import
 *    names it and exactly one file in the scan sits at that import's path.
 *    Wildcard imports (`a.b.*`) name no type and resolve nothing.
 *  - A RECEIVER resolves to a type only through a declaration in the same file
 *    (`parse/facts.ts` `varTypes`). A name declared with two different types
 *    resolves to nothing.
 *  - A METHOD resolves only when the target file declares that name exactly
 *    once. Overloads (two declarations, one name) resolve to nothing.
 *
 * Consequences we accept as honest misses, not as bugs to paper over: an
 * inherited method (`OwnerRepository.findById` comes from Spring Data's
 * `Repository`, not from the file) resolves to nothing; a chained receiver
 * (`a.b().c()`) resolves to nothing; a qualified type (`a.b.Owner o`) resolves
 * to nothing.
 */
import type { FunctionFact } from '../types.js';

/** The directory a repo-relative file sits in — a Java package IS its directory. */
function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

/** Unqualified Java type name: `Owner`, `OwnerRepository`. */
const SIMPLE_TYPE = /^[A-Z][A-Za-z0-9_$]*$/;
/** A local/field/parameter name — a lowercase-initial identifier. */
const RECEIVER_NAME = /^[a-z_$][A-Za-z0-9_$]*$/;

export interface JavaTypeIndex {
  /** Every `.java` file in the scan, repo-relative. */
  files: ReadonlySet<string>;
  /** Simple class name -> the files that declare it (one entry per path). */
  byClass: ReadonlyMap<string, string[]>;
}

/**
 * Index the Java files of a scan by their simple class name.
 *
 * The class name is taken from the FILE NAME, not from a parsed declaration:
 * javac requires a public top-level class to live in `<ClassName>.java`, so the
 * filename is the language's own statement of what the file declares. That also
 * makes the index exact for the import lookup below, which matches a
 * dotted import path against a slashed file path.
 */
export function buildJavaTypeIndex(files: readonly string[]): JavaTypeIndex {
  const set = new Set<string>();
  const byClass = new Map<string, string[]>();
  for (const file of files) {
    if (typeof file !== 'string' || !file.endsWith('.java')) continue;
    if (set.has(file)) continue;
    set.add(file);
    const base = file.slice(file.lastIndexOf('/') + 1, -'.java'.length);
    if (!base) continue;
    const bucket = byClass.get(base);
    if (bucket) bucket.push(file);
    else byClass.set(base, [file]);
  }
  return { files: set, byClass };
}

/**
 * Resolve a simple type name to the file that declares it, or `undefined`.
 * Own package first, then single-type imports; exactly one match or nothing.
 */
export function resolveJavaType(
  simple: string,
  callerFile: string,
  importRaws: readonly string[],
  index: JavaTypeIndex
): string | undefined {
  if (!SIMPLE_TYPE.test(simple)) return undefined;

  const dir = dirOf(callerFile);
  const samePackage = dir ? `${dir}/${simple}.java` : `${simple}.java`;
  if (index.files.has(samePackage)) return samePackage;

  const declaring = index.byClass.get(simple);
  if (!declaring || declaring.length === 0) return undefined;

  const suffix = `${simple}.java`;
  let found: string | undefined;
  for (const raw of importRaws) {
    if (typeof raw !== 'string' || !raw.endsWith(`.${simple}`)) continue;
    // `org.x.y.Owner` -> `org/x/y/Owner.java`; a repo file is a match when it
    // IS that path or ends with it under some source root (`src/main/java/…`).
    const asPath = `${raw.split('.').join('/')}.java`;
    for (const file of declaring) {
      if (!file.endsWith(suffix)) continue;
      if (file !== asPath && !file.endsWith(`/${asPath}`)) continue;
      if (found && found !== file) return undefined; // two imports, two files
      found = file;
    }
  }
  return found;
}

export interface JavaCalleeTarget {
  file: string;
  fn: FunctionFact;
}

/**
 * Resolve one Java `CallFact.callee` to a declared method.
 *
 * Handles the three receiver shapes a Java call is recorded in:
 *   `Type.method`        static / type-qualified call
 *   `name.method`        call through a field, local, parameter or for-each var
 *   `this.name.method`   the same, written explicitly
 *   `this.method`        an own method, named through `this`
 *
 * Anything else — a chained receiver, a qualified type, an unknown name —
 * returns `undefined`.
 */
export function resolveJavaCallee(
  callee: string,
  callerFile: string,
  varTypes: ReadonlyMap<string, string | null> | undefined,
  importRaws: readonly string[],
  index: JavaTypeIndex,
  uniqueMethodsByFile: (file: string) => ReadonlyMap<string, FunctionFact | null> | undefined
): JavaCalleeTarget | undefined {
  const cut = callee.lastIndexOf('.');
  if (cut <= 0) return undefined;
  const method = callee.slice(cut + 1);
  if (!method) return undefined;

  let receiver = callee.slice(0, cut);
  if (receiver === 'this') {
    // `this.method(...)` — the caller's own file, if it declares it once.
    return targetIn(callerFile, method, uniqueMethodsByFile);
  }
  if (receiver.startsWith('this.')) receiver = receiver.slice('this.'.length);
  if (receiver.includes('.')) return undefined; // chained or qualified receiver

  let typeName: string | undefined;
  if (SIMPLE_TYPE.test(receiver)) {
    typeName = receiver;
  } else if (RECEIVER_NAME.test(receiver)) {
    const declared = varTypes?.get(receiver);
    if (typeof declared !== 'string') return undefined; // unknown or ambiguous
    typeName = declared;
  }
  if (!typeName) return undefined;

  const file = resolveJavaType(typeName, callerFile, importRaws, index);
  if (!file) return undefined;
  return targetIn(file, method, uniqueMethodsByFile);
}

function targetIn(
  file: string,
  method: string,
  uniqueMethodsByFile: (file: string) => ReadonlyMap<string, FunctionFact | null> | undefined
): JavaCalleeTarget | undefined {
  const fn = uniqueMethodsByFile(file)?.get(method);
  // `null` is the index's marker for an overloaded name — two declarations, so
  // no single target. Same "unique or nothing" rule as every resolver here.
  return fn ? { file, fn } : undefined;
}
