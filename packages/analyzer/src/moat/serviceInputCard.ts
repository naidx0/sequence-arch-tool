/**
 * THE SERVICE-INPUT CARD — declared inputs against observed reads, per service.
 *
 * A service's inputs are declared in a manifest (compose `environment:`, a K8s
 * env block) and read in its source. The card puts the two side by side and
 * names the gap: an input nothing reads is dead wiring, and an input read but
 * never declared is a deployment that will fail somewhere the manifest cannot
 * warn you about.
 *
 * ── WHY THIS FILE IS MOSTLY ABOUT REFUSING TO SAY "NEVER" ──────────────────
 *
 * "Declared, never read" is a claim of ABSENCE, and this repository has spent
 * six probe bugs learning what absence is worth from an instrument that cannot
 * say what it failed to look at (`docs/research/service-input-card.md`). The
 * SECOND LAW in `docs/how-to-verify.md` is the rule: absence of a signal is not
 * evidence of absence. So every "never" here has to pass a gate, and when it
 * cannot, the answer is `not-scanned` — which is a different sentence, shown
 * differently, and never counted as dead wiring.
 *
 * The three ways a "never" is really a "don't know":
 *
 *   1. The service's source was not scanned at all — an image-only service, or
 *      a directory the walk never entered. `sequence`'s own repository is the
 *      worked example: the walk does not enter `tools/`, so nothing in there
 *      can be refuted, only reported as uncovered.
 *   2. Coverage is `unknown`, or the walk was truncated, or the service's own
 *      language sits in a coverage gap — `canRefuteExtension` decides this, and
 *      it is asked PER EXTENSION because a scan that skipped `docs/` still knows
 *      perfectly well what its Go services read.
 *   3. The variable is read through a layer that never names it: a config
 *      library, a build-time inlined public key, or a base image's own
 *      configuration. Those are excluded and LISTED — never silently dropped,
 *      because an exclusion nobody can see is indistinguishable from a bug.
 *
 * Counts travel with their denominators (the THIRD LAW). `neverRead` alone is
 * not a number this module will produce.
 */
import type { ScanCoverage, UnscannedRegion } from '@sequence/schema';
import { canRefuteExtension } from '@sequence/schema';

import type { EnvReadPosition, ServiceInfo } from '../types.js';

/** One env read the scanner actually saw, attributed to a service. */
export interface EnvReadFact {
  service: string;
  name: string;
  file: string;
  line?: number;
  /** Inferred from a SCREAMING_SNAKE member access, not read from the environment. */
  byConvention?: boolean;
  /** The read is in a test file, which configures the test, not the service. */
  fromTest?: boolean;
  /**
   * Where the read sits, from `FileFacts.envReads`. Present for reads the
   * expression-position slot found; absent for the older channels.
   */
  position?: EnvReadPosition;
}

/**
 * Positions that are evidence a read HAPPENED but not that an operator SETS the
 * variable.
 *
 * `if (process.env.NODE_TEST_CONTEXT)` is a switch a harness flips, not a
 * deployment input; a read the walk could not place at all says even less. Both
 * may CONFIRM a name the manifest already declares — the read is real — and
 * neither may INVENT one, which is the same asymmetry already applied to reads
 * inferred from a SCREAMING_SNAKE member access.
 */
const WEAK_POSITIONS: ReadonlySet<EnvReadPosition> = new Set(['condition', 'other']);

export const isWeakEnvPosition = (p: EnvReadPosition | undefined): boolean =>
  p !== undefined && WEAK_POSITIONS.has(p);

export type InputVerdict = 'read' | 'never-read' | 'not-scanned' | 'excluded';

export interface InputRow {
  name: string;
  verdict: InputVerdict;
  /** Where it was read, when it was. */
  evidence?: { file: string; line?: number };
  /** Which exclusion or gate produced a non-`read` verdict, in prose. */
  because?: string;
  /** The exclusion rule id, when `verdict === 'excluded'`. */
  rule?: ExclusionRule;
}

export type ExclusionRule =
  | 'base-image'
  | 'spa-public-key'
  | 'config-library'
  | 'toolchain'
  | 'os-provided';

export interface ServiceCard {
  service: string;
  dir?: string;
  role: ServiceInfo['role'];
  /** False when nothing under this service was parsed — the gate for "never". */
  scanned: boolean;
  rows: InputRow[];
  counts: {
    declared: number;
    read: number;
    neverRead: number;
    notScanned: number;
    excluded: number;
  };
}

export interface RepoScope {
  /** The file the declarations came from, e.g. `.env.example`. */
  source: string;
  rows: InputRow[];
  counts: { declared: number; read: number; neverRead: number; notScanned: number; excluded: number };
}

export interface ServiceInputCard {
  services: ServiceCard[];
  /** Repository-scope declarations, when the repo declares any. */
  repo?: RepoScope;
  /**
   * Reads with no matching declaration — the other half of the card, ONE ROW PER
   * NAME. `services` lists every service reading it, because a missing
   * declaration is a fact about the name and each reader is evidence for the
   * same finding rather than another one.
   *
   * ABSENT — not empty — when the repository declares nothing anywhere. "Read
   * but never declared" is a comparison, and with nothing on the left there is
   * no comparison to report. See `declarationSource`.
   */
  undeclared?: Array<EnvReadFact & { services: string[] }>;
  /**
   * WHERE THE LEFT-HAND COLUMN CAME FROM, or that there is none.
   *
   * On a repository with no manifest and no `.env.example`, every read is
   * unmatched BY CONSTRUCTION — measured on this one, the card went from 4
   * accusations to 18 purely because the extractor got better at finding reads.
   * That number says nothing about the repository, and printing it invites
   * someone to act on it.
   *
   * So the card reports that it found no source, says what it looked for, lists
   * the reads AS READS, and omits the accusation column entirely. The SECOND
   * LAW, applied to the card's own left-hand side: absence of a declaration is
   * not evidence of a missing one when nothing declares anything.
   */
  declarationSource: { found: boolean; kinds: string[]; lookedFor: string[] };
  /**
   * Unmatched reads deliberately NOT accused, and why. Reported so `undeclared`
   * can never be smaller than it looks by omission.
   */
  notAccused: { byConvention: number; fromTest: number; osProvided: number; weakPosition: number };
  /** Every exclusion actually applied, with what it matched. Never empty-by-omission. */
  exclusions: { rule: ExclusionRule; why: string; matched: string[] }[];
  /** Stated whether or not anything was missed, so the reader never has to infer it. */
  coverage: {
    verdict: ScanCoverage['verdict'];
    reasons: string[];
    unscannedDirs: string[];
  };
  totals: {
    declared: number;
    read: number;
    neverRead: number;
    notScanned: number;
    excluded: number;
    services: number;
    servicesScanned: number;
  };
}

/**
 * Build-time inlined, by convention public, and therefore frequently absent
 * from the runtime source that "reads" them. A bundler substitutes the value at
 * build time, so `process.env.VITE_API_URL` may exist in no shipped file at all.
 */
const PUBLIC_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'REACT_APP_',
  'PUBLIC_',
  'EXPO_PUBLIC_',
  'NG_',
  'GATSBY_',
  'STORYBOOK_',
];

/**
 * Libraries that read the environment WITHOUT naming a variable at the read
 * site — `dotenv` populates `process.env` wholesale, pydantic's BaseSettings
 * maps fields to env by convention, viper binds by prefix, Spring resolves
 * `@Value` from a property name that may itself be indirected.
 *
 * A service using one of these cannot have its unread inputs refuted by source
 * scanning: the read exists, it is just not spelled out anywhere the parser can
 * see. Matched against import specifiers, so it says what it means.
 */
const CONFIG_LIBRARIES = [
  'dotenv',
  'pydantic_settings',
  'pydantic-settings',
  'BaseSettings',
  'viper',
  'envconfig',
  'config',
  'convict',
  'nconf',
  'dynaconf',
  'environ',
  'org.springframework.beans.factory.annotation.Value',
];

/**
 * Variables a Dockerfile's `ENV` bakes in for the BUILD, which compose discovery
 * merges into a service's env (deliberately — robot-shop's nginx conf reads
 * `${CATALOGUE_HOST}` set only that way). They are declarations, but not of
 * anything the application reads.
 *
 * Measured on Hoppscotch: six services share `build.context: .` and each
 * inherited `GOPATH`, `GOBIN`, `GOLANG_VERSION`, `PATH`, `XDG_CONFIG_HOME` and
 * `XDG_DATA_HOME` from the Dockerfile — sixty "declared, never read" lines from
 * one Go toolchain.
 *
 * A name list is cruder than reading the provenance, and it is here rather than
 * in `ServiceInfo` because that type merges both sources before the card sees
 * them: telling them apart properly means threading provenance through a shape
 * the joiner also uses. Recorded as the better fix, not done here.
 */
const TOOLCHAIN = new Set([
  'PATH',
  'HOME',
  'HOSTNAME',
  'TERM',
  'SHELL',
  'PWD',
  'LANG',
  'LC_ALL',
  'TZ',
  'GOPATH',
  'GOBIN',
  'GOLANG_VERSION',
  'GOROOT',
  'GOTOOLCHAIN',
  'NODE_VERSION',
  'YARN_VERSION',
  'PYTHON_VERSION',
  'JAVA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
]);

/**
 * Variables the OPERATING SYSTEM provides. Reading one is not evidence that a
 * deployment forgot to declare it — nobody declares `LOCALAPPDATA`.
 *
 * Measured on this repository: `web2.LOCALAPPDATA` was accused of being read but
 * never declared, from `chromium.mjs` locating the Playwright browser cache. The
 * accusation is the card's, and it is wrong: the variable has no manifest to be
 * missing from.
 *
 * Separate from TOOLCHAIN because the two are different claims. A toolchain
 * variable IS declared — by the image build — and simply is not an application
 * input. An OS variable is never declared by anyone, so it belongs on the other
 * side of the card.
 */
const OS_PROVIDED = new Set([
  'LOCALAPPDATA',
  'APPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'LOGNAME',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
]);

export const CONFIG_LIBRARY_SPECIFIERS: readonly string[] = CONFIG_LIBRARIES;
export const PUBLIC_KEY_PREFIXES: readonly string[] = PUBLIC_PREFIXES;

const publicPrefix = (name: string): string | undefined =>
  PUBLIC_PREFIXES.find((p) => name.startsWith(p));

/** POSIX-normalised prefix test: is `dir` inside (or equal to) `region`? */
const withinRegion = (dir: string | undefined, region: string): boolean => {
  if (dir === undefined) return false;
  const d = dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const r = region.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (r === '(root)') return true;
  return d === r || d.startsWith(`${r}/`) || r.startsWith(`${d}/`);
};

/** The extension the service's own language would be read from, for the gate. */
const extensionFor = (lang: string | undefined): string | undefined => {
  switch ((lang ?? '').toLowerCase()) {
    case 'ts':
    case 'typescript':
      return '.ts';
    case 'js':
    case 'javascript':
      return '.js';
    case 'py':
    case 'python':
      return '.py';
    case 'go':
      return '.go';
    case 'java':
      return '.java';
    default:
      return undefined;
  }
};

export interface CardInput {
  services: ServiceInfo[];
  reads: EnvReadFact[];
  /** How many files were parsed under each service. Zero means unscanned. */
  filesScannedByService: Record<string, number>;
  /** Config-library import specifiers seen in each service's source. */
  configLibrariesByService: Record<string, string[]>;
  /** Per-service language, when known, for the per-extension coverage gate. */
  languageByService?: Record<string, string | undefined>;
  coverage: ScanCoverage;
  unscanned: readonly UnscannedRegion[];
  /**
   * Inputs declared for the repository as a whole (a `.env.example` and its
   * spellings), which is how a project without a container manifest says what it
   * expects. Held at repository scope because the file does not say which
   * service reads which — see `declaredInputs.ts`.
   */
  repoDeclared?: readonly { name: string; source: string }[];
}

export function buildServiceInputCard(input: CardInput): ServiceInputCard {
  const {
    services,
    reads,
    filesScannedByService,
    configLibrariesByService,
    languageByService = {},
    coverage,
    unscanned,
    repoDeclared = [],
  } = input;

  /*
   * Index the strongest evidence, not the first. A direct `process.env.X` in
   * shipped source beats the same name inferred from a member access or seen
   * only in a test, so the citation the card prints is the best one available
   * rather than whichever file the walk reached first.
   */
  const strength = (r: EnvReadFact): number =>
    (r.byConvention === true ? 0 : 4) +
    (r.fromTest === true ? 0 : 2) +
    /* A read the walk could place beats one it could not, so the citation the
       card prints is the most explicable evidence available. */
    (isWeakEnvPosition(r.position) ? 0 : 1);
  const readIndex = new Map<string, EnvReadFact>();
  for (const r of reads) {
    const key = `${r.service} ${r.name}`;
    const held = readIndex.get(key);
    if (held === undefined || strength(r) > strength(held)) readIndex.set(key, r);
  }

  const exclusionHits = new Map<ExclusionRule, string[]>();
  const note = (rule: ExclusionRule, what: string): void => {
    const list = exclusionHits.get(rule) ?? [];
    list.push(what);
    exclusionHits.set(rule, list);
  };

  /*
   * A ROOT SERVICE IN A MONOREPO DOES NOT OWN ITS OWN SOURCE.
   *
   * `excludedPrefixesFor` gives a nested app's files to the DEEPER service —
   * correctly, or the outer service swallows the whole system. But it means a
   * service whose build context is the repo root, sitting above other app
   * services, is left with almost no files while the code it actually ships
   * lives under them.
   *
   * Measured on Hoppscotch: six services declare `build.context: .`, and each
   * was accused of never reading `DATABASE_URL` — which the repository reads at
   * `packages/hoppscotch-backend/src/prisma/prisma.service.ts:15`, in a
   * directory owned by a different service. Judging such a service against only
   * its own leftovers manufactures an accusation per service per key.
   *
   * So a root service is judged against every service's reads: it IS the
   * aggregate application, which is what `build.context: .` says.
   */
  const rootDirs = new Set(['.', '', './']);
  const hasDeeperApps = services.some(
    (s) => s.role === 'app' && s.dir !== undefined && !rootDirs.has(s.dir),
  );
  const readsAnywhere = new Map<string, EnvReadFact>();
  for (const r of reads) {
    const held = readsAnywhere.get(r.name);
    if (held === undefined || strength(r) > strength(held)) readsAnywhere.set(r.name, r);
  }

  const cards: ServiceCard[] = services.map((svc) => {
    const isAggregateRoot =
      hasDeeperApps && svc.role === 'app' && svc.dir !== undefined && rootDirs.has(svc.dir);
    const filesScanned = filesScannedByService[svc.name] ?? 0;
    const configLibs = configLibrariesByService[svc.name] ?? [];
    const inUnscannedRegion = unscanned.find((u) => withinRegion(svc.dir, u.dir));
    const ext = extensionFor(languageByService[svc.name]);
    const scanned = filesScanned > 0;

    const rows: InputRow[] = Object.keys(svc.env)
      .sort()
      .map((name): InputRow => {
        const hit =
          readIndex.get(`${svc.name} ${name}`) ??
          (isAggregateRoot ? readsAnywhere.get(name) : undefined);
        if (hit) {
          return {
            name,
            verdict: 'read',
            evidence: { file: hit.file, line: hit.line },
            /* The POSITION is the reason: "read — in a condition at store.ts:243"
               beats a bare tick, because a reader can disagree with it. */
            ...(hit.position === undefined
              ? {}
              : { because: `read — in a ${hit.position} at ${hit.file}:${hit.line ?? '?'}` }),
          };
        }

        /*
         * EXCLUSIONS COME BEFORE THE GATE, because they explain the absence
         * outright: there is nothing to be uncertain about when a base image
         * owns the variable. Each one is recorded so the card can list it.
         */
        if (svc.dir === undefined) {
          note('base-image', `${svc.name}.${name}`);
          return {
            name,
            verdict: 'excluded',
            rule: 'base-image',
            because: `${svc.name} is image-only (${svc.image ?? 'no build context'}); this configures the image, not our source`,
          };
        }
        if (OS_PROVIDED.has(name)) {
          /*
           * An OS variable can be DECLARED too — a compose file that pins
           * `TMPDIR` or `USERNAME` for a container declares something the
           * operating system already supplies. The undeclared path has excluded
           * these since they were added; the declared path did not, so the same
           * variable was noise on one side of the card and an accusation on the
           * other.
           */
          note('os-provided', `${svc.name}.${name}`);
          return {
            name,
            verdict: 'excluded',
            rule: 'os-provided',
            because: `${name} is supplied by the operating system, not by this application`,
          };
        }
        if (TOOLCHAIN.has(name)) {
          note('toolchain', `${svc.name}.${name}`);
          return {
            name,
            verdict: 'excluded',
            rule: 'toolchain',
            because: `${name} is build/toolchain configuration baked in by the image, not an application input`,
          };
        }
        const prefix = publicPrefix(name);
        if (prefix !== undefined) {
          note('spa-public-key', `${svc.name}.${name}`);
          return {
            name,
            verdict: 'excluded',
            rule: 'spa-public-key',
            because: `\`${prefix}\` keys are inlined at build time, so the shipped source need never name it`,
          };
        }
        if (configLibs.length > 0) {
          note('config-library', `${svc.name}.${name}`);
          return {
            name,
            verdict: 'excluded',
            rule: 'config-library',
            because: `${svc.name} reads config through ${configLibs.join(', ')}, which does not name variables at the read site`,
          };
        }

        /*
         * THE GATE. Everything below is a reason the scan CANNOT speak to this
         * variable, and each one produces `not-scanned` rather than a "never".
         */
        if (!scanned) {
          return {
            name,
            verdict: 'not-scanned',
            because:
              inUnscannedRegion !== undefined
                ? `${svc.dir} was never walked (${inUnscannedRegion.files} source files uncovered)`
                : `no source file under ${svc.dir} was parsed`,
          };
        }
        if (coverage.verdict === 'unknown') {
          return { name, verdict: 'not-scanned', because: 'the scan did not record its coverage' };
        }
        if (coverage.truncated) {
          return {
            name,
            verdict: 'not-scanned',
            because: 'the file walk stopped at its limit, so the rest was never seen',
          };
        }
        if (inUnscannedRegion !== undefined) {
          return {
            name,
            verdict: 'not-scanned',
            because: `${inUnscannedRegion.dir} holds ${inUnscannedRegion.files} source files nothing scanned`,
          };
        }
        if (ext !== undefined && !canRefuteExtension(coverage, ext)) {
          return {
            name,
            verdict: 'not-scanned',
            because: `${ext} files sit in a coverage gap, so an absence of ${ext} reads proves nothing`,
          };
        }

        return {
          name,
          verdict: 'never-read',
          because: `declared for ${svc.name}, and no source file under ${svc.dir} reads it`,
        };
      });

    const count = (v: InputVerdict): number => rows.filter((r) => r.verdict === v).length;
    return {
      service: svc.name,
      dir: svc.dir,
      role: svc.role,
      scanned,
      rows,
      counts: {
        declared: rows.length,
        read: count('read'),
        neverRead: count('never-read'),
        notScanned: count('not-scanned'),
        excluded: count('excluded'),
      },
    };
  });

  /*
   * REPOSITORY SCOPE. A key here counts as read when ANY scanned service reads
   * it, because the file that declared it does not say which service should.
   *
   * The gate is stricter than the per-service one for a reason: an unwalked
   * directory could contain the only read of a repo-wide key, so ANY unscanned
   * region makes "never read" unsayable. On this scanner's own repository that
   * is `tools/`, `examples/` and `docs/` — the case where the card has to say
   * "not scanned" and not "nothing reads it".
   */
  const anyServiceScanned = cards.some((c) => c.scanned);
  const readNames = new Set(reads.map((r) => r.name));
  const repo: RepoScope | undefined =
    repoDeclared.length === 0
      ? undefined
      : (() => {
          const rows: InputRow[] = [...repoDeclared]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((d): InputRow => {
              const hit = reads.find((r) => r.name === d.name);
              if (hit !== undefined && readNames.has(d.name)) {
                return { name: d.name, verdict: 'read', evidence: { file: hit.file, line: hit.line } };
              }
              const prefix = publicPrefix(d.name);
              if (prefix !== undefined) {
                note('spa-public-key', d.name);
                return {
                  name: d.name,
                  verdict: 'excluded',
                  rule: 'spa-public-key',
                  because: `\`${prefix}\` keys are inlined at build time, so the shipped source need never name it`,
                };
              }
              if (!anyServiceScanned) {
                return { name: d.name, verdict: 'not-scanned', because: 'no service source was parsed' };
              }
              if (coverage.verdict === 'unknown') {
                return { name: d.name, verdict: 'not-scanned', because: 'the scan did not record its coverage' };
              }
              if (coverage.truncated) {
                return {
                  name: d.name,
                  verdict: 'not-scanned',
                  because: 'the file walk stopped at its limit, so the rest was never seen',
                };
              }
              if (coverage.unparsedExtensions.size > 0) {
                /*
                 * A REPOSITORY-WIDE KEY CAN BE READ IN A FILE WE COULD NOT PARSE.
                 *
                 * Per-service the question is asked per extension, because a gap
                 * in Go says nothing about a TypeScript service. At repository
                 * scope there is no such narrowing: the key belongs to the whole
                 * app, so ANY unparsed extension can hide its only read.
                 * Hoppscotch is the case — `.vue` is not parsed, and it is most
                 * of the front end.
                 */
                return {
                  name: d.name,
                  verdict: 'not-scanned',
                  because:
                    `a repository-wide key could be read in any file, and ` +
                    `${[...coverage.unparsedExtensions].sort().join(', ')} were opened but not parsed`,
                };
              }
              if (unscanned.length > 0) {
                const worst = [...unscanned].sort((a, b) => b.files - a.files)[0];
                return {
                  name: d.name,
                  verdict: 'not-scanned',
                  because:
                    `a repository-wide key could be read anywhere, and ` +
                    `${unscanned.map((u) => u.dir).join(', ')} were never walked ` +
                    `(${worst.files} source files in ${worst.dir} alone)`,
                };
              }
              return {
                name: d.name,
                verdict: 'never-read',
                because: `declared in ${d.source}, and no scanned source reads it`,
              };
            });
          const c = (v: InputVerdict): number => rows.filter((r) => r.verdict === v).length;
          return {
            source: repoDeclared[0].source,
            rows,
            counts: {
              declared: rows.length,
              read: c('read'),
              neverRead: c('never-read'),
              notScanned: c('not-scanned'),
              excluded: c('excluded'),
            },
          };
        })();

  const declaredKeys = new Set(
    services.flatMap((s) => Object.keys(s.env).map((k) => `${s.name} ${k}`)),
  );
  /*
   * "READ BUT NEVER DECLARED" IS AN ACCUSATION, so only a real read may make it.
   *
   * Measured on this repository, the unfiltered version produced 37 of them and
   * the first eight were `Number.POSITIVE_INFINITY`, `EXIT.CANCELLED`,
   * `EXIT.USAGE` and friends — a heuristic's output presented as a missing
   * deployment variable. Most of the rest came from `*.test.ts` files setting
   * env for a test process, which says nothing about how the service is
   * deployed.
   *
   * Both still COUNT as reads against a name the manifest already declares —
   * they are evidence, just not enough to invent an input no manifest mentions.
   * The asymmetry is the point, and what was set aside is reported rather than
   * dropped.
   */
  /*
   * WHAT COUNTS AS A DECLARATION SOURCE: a service that declares at least one
   * env var, or a repository-level example file. A compose file listing only
   * images declares nothing, and neither does an empty `.env.example`.
   */
  const declaringServices = services.filter((svc) => Object.keys(svc.env).length > 0);
  const declarationKinds: string[] = [];
  if (declaringServices.length > 0) declarationKinds.push('service manifest (environment:)');
  if (repoDeclared.length > 0) {
    declarationKinds.push(repoDeclared[0].source);
  }
  const declarationSource = {
    found: declarationKinds.length > 0,
    kinds: declarationKinds,
    lookedFor: [
      'a service manifest with an environment: block (compose, Kubernetes, Helm)',
      '.env.example, .env.sample, .env.template, .env.defaults, .env.dist',
    ],
  };

  const repoNames = new Set(repoDeclared.map((d) => d.name));
  const unmatched = [...readIndex.values()].filter(
    (r) => !declaredKeys.has(`${r.service} ${r.name}`) && !repoNames.has(r.name),
  );
  const accusable = unmatched.filter(
    (r) =>
      r.byConvention !== true &&
      r.fromTest !== true &&
      !OS_PROVIDED.has(r.name) &&
      !isWeakEnvPosition(r.position),
  );
  /*
   * ONE ROW PER NAME, NOT PER SITE.
   *
   * `readIndex` is keyed by service AND name, so a variable two services read
   * appeared twice and the count said "2 undeclared" for one missing
   * declaration. A missing declaration is a fact about a NAME — the manifest
   * either mentions it or does not — and every service that reads it is
   * evidence for the same single finding, not a second one.
   *
   * The services are kept on the row rather than dropped: which services read it
   * is exactly what someone fixing the manifest needs.
   */
  const byName = new Map<string, EnvReadFact & { services: string[] }>();
  for (const r of accusable) {
    const held = byName.get(r.name);
    if (held === undefined) byName.set(r.name, { ...r, services: [r.service] });
    else if (!held.services.includes(r.service)) held.services.push(r.service);
  }
  const undeclared = [...byName.values()].map((r) => ({ ...r, services: [...r.services].sort() }));
  const notAccused = {
    byConvention: unmatched.filter((r) => r.byConvention === true).length,
    fromTest: unmatched.filter((r) => r.byConvention !== true && r.fromTest === true).length,
    osProvided: unmatched.filter(
      (r) => r.byConvention !== true && r.fromTest !== true && OS_PROVIDED.has(r.name),
    ).length,
    weakPosition: unmatched.filter(
      (r) => r.byConvention !== true && r.fromTest !== true && isWeakEnvPosition(r.position),
    ).length,
  };

  const why: Record<ExclusionRule, string> = {
    'base-image': 'image-only services: the variable configures the base image, not scanned source',
    'spa-public-key': 'build-time inlined public keys: the shipped source need never name them',
    'config-library':
      'the service reads config through a library that does not name variables at the read site',
    toolchain: 'build/toolchain variables an image bakes in — declarations, but not application inputs',
    'os-provided': 'variables the operating system supplies — nobody declares them and nothing is missing',
  };
  const exclusions = [...exclusionHits.entries()]
    .map(([rule, matched]) => ({ rule, why: why[rule], matched: matched.sort() }))
    .sort((a, b) => a.rule.localeCompare(b.rule));

  const sum = (k: keyof ServiceCard['counts']): number =>
    cards.reduce((a, c) => a + c.counts[k], 0) + (repo?.counts[k] ?? 0);

  return {
    services: cards,
    repo,
    declarationSource,
    /* Absent, not empty: with nothing declared anywhere there is no comparison
       to report, and a zero would read as "nothing is missing". */
    ...(declarationSource.found ? { undeclared } : {}),
    notAccused,
    exclusions,
    coverage: {
      verdict: coverage.verdict,
      reasons: coverage.reasons,
      unscannedDirs: unscanned.map((u) => u.dir),
    },
    totals: {
      declared: sum('declared'),
      read: sum('read'),
      neverRead: sum('neverRead'),
      notScanned: sum('notScanned'),
      excluded: sum('excluded'),
      services: cards.length,
      servicesScanned: cards.filter((c) => c.scanned).length,
    },
  };
}

/**
 * One line per number, each with its denominator.
 *
 * Rendering lives here rather than in a surface because the THIRD LAW is a
 * property of the claim, not of the pixels: a caller must not be able to obtain
 * `neverRead` without also obtaining what it is out of.
 */
export function renderServiceInputCard(card: ServiceInputCard): string[] {
  const t = card.totals;
  const out: string[] = [
    `service inputs: ${t.read} of ${t.declared} declared are read (${t.services} services, ${t.servicesScanned} scanned)`,
    `declared, never read: ${t.neverRead} of ${t.declared}`,
    `not scanned — cannot say: ${t.notScanned} of ${t.declared}`,
    `excluded as noise: ${t.excluded} of ${t.declared}`,
    ...(card.declarationSource.found
      ? []
      : [
          'no declaration source found in this repository — looked for: ' +
            card.declarationSource.lookedFor.join('; ') +
            '. The reads below are listed as reads; there is nothing to compare them against.',
        ]),
    `read, never declared: ${card.undeclared === undefined ? 'n/a — nothing declares anything here' : card.undeclared.length}` +
      (card.notAccused.byConvention +
        card.notAccused.fromTest +
        card.notAccused.osProvided +
        card.notAccused.weakPosition >
      0
        ? ` (${card.notAccused.byConvention} inferred by convention, ` +
          `${card.notAccused.fromTest} test-only, ` +
          `${card.notAccused.osProvided} OS-provided, ` +
          `${card.notAccused.weakPosition} read only in a condition — not accused)`
        : ''),
    `coverage: ${card.coverage.verdict}${
      card.coverage.unscannedDirs.length > 0
        ? ` — not walked: ${card.coverage.unscannedDirs.join(', ')}`
        : ''
    }`,
  ];
  if (card.repo !== undefined) {
    const c = card.repo.counts;
    out.push(
      `  ${card.repo.source}: ${c.read} of ${c.declared} read, ` +
        `${c.neverRead} never read, ${c.notScanned} not scanned, ${c.excluded} excluded`,
    );
  }
  for (const e of card.exclusions) {
    out.push(`  excluded (${e.rule}, ${e.matched.length}): ${e.why}`);
  }
  return out;
}
