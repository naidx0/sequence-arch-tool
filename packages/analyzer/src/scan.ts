import fs from 'node:fs';
import path from 'node:path';
import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';
import { validateGraph } from '@sequence/schema';
import { toRelPosix } from './relPosix.js';
import { buildWorkspaceIndex, resolveWorkspaceImport } from './workspaceImports.js';
import { unscannedRegions } from './lang/unscanned.js';
import type { WorkspacePackage } from './workspaceImports.js';
import { isTestFile } from './testFiles.js';
import { discover, findComposeFile } from './discovery/compose.js';
import { discoverKubernetes } from './discovery/kubernetes.js';
import { discoverCodeFirst, uncoveredAppRoots, type FrameworkSignals } from './discovery/codefirst.js';
import { detectConnections } from './detectors/connections.js';
import { detectDb, detectDbEngines } from './detectors/db.js';
import { stampProvenance } from './join/instrument.js';
import { UnfollowedTally } from './lang/unfollowed.js';
import { detectGrpc, parseProtoServices } from './detectors/grpc.js';
import { detectHttp } from './detectors/http.js';
import { detectNginx } from './detectors/nginx.js';
import { detectQueues } from './detectors/queues.js';
import { detectSpringConfig } from './detectors/springconfig.js';
import { joinAll, type JoinInput } from './join/join.js';
import { realpathContained } from './server/jail.js';
import {
  chooseAnchor,
  clusterDir,
  clusterFiles,
  describeCluster,
  labelCluster,
  mergeIndistinguishableModules,
  pageRank,
  uniqueModuleLabels,
} from './cluster/cluster.js';
import { llmLabels, type LabelRequest, type LabelModel } from './llm/label.js';
import { languageMix } from './lang/mix.js';
import { composeLabelHints } from './lang/packs.js';
import { factsSuggestScheduledJob } from './scheduledDetect.js';
import { extractRationale, rollUpRationale, type RationaleNote } from './rationale.js';
import { extractFacts } from './parse/facts.js';
import { publishSharedFacts, recordSharedFacts, resetSharedFacts } from './parse/sharedFacts.js';
import { initParser, ParserAbortedError, parserAbortedWith } from './parse/treesitter.js';
import { bump, count, phase, report, reset } from './parse/profile.js';
import { readGoModulePath, resolveGoImportToFile } from './functions/goResolve.js';
import type { Discovery, FileFacts, Lang, ServiceInfo } from './types.js';

// Imported for this module's own walk AND re-exported, because `server/graphCache.ts`
// and `server/tree.ts` both import it from here. One definition, in ./ignoreDirs.ts —
// a second copy is what let a test fixture assert facts about production.
import { IGNORE_DIRS } from './ignoreDirs.js';
export { IGNORE_DIRS };

const LANG_BY_EXT: Record<string, Lang> = {
  '.ts': 'ts',
  '.tsx': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
  '.go': 'go',
  '.java': 'java',
};

export const MAX_FILE_BYTES = 1_000_000; // skip generated monsters

/**
 * Thrown when a repo has NOTHING to scan: no docker-compose / Kubernetes / Helm
 * manifest AND no recognizable package manifest or source for the code-first
 * (manifest-less) path either. This is not an internal failure. Since Phase 3a,
 * manifest-less code repos (pure frontend / mobile / CLI / library) ARE scanned
 * via their package manifests, so this fires only for a genuinely empty or
 * unrecognized directory (e.g. `app/ components/ …` with no package.json).
 * Callers (the attach endpoint) special-case this to a calm, informational 4xx
 * with a friendly message instead of the internal-error / red-wall path.
 */
export class NoManifestsError extends Error {
  /** Stable discriminator for the HTTP/UI layer (never a generic scan failure). */
  readonly code = 'no-manifests' as const;
  /** Basename of the scanned repo, for the friendly message.  */
  readonly repoName: string;
  constructor(repoRoot: string) {
    const repoName = path.basename(repoRoot);
    super(
      `Sequence scans repos that declare services via docker-compose, Kubernetes, or Helm, ` +
        `and also manifest-less code repos via their package manifests (package.json, pyproject, ` +
        `go.mod, Cargo.toml, and friends). Neither a service manifest nor any recognizable package ` +
        `manifest or source was found in ${repoName}, so there's nothing to scan yet.`
    );
    this.name = 'NoManifestsError';
    this.repoName = repoName;
  }
}

export interface ScanOptions {
  cluster?: boolean;
  llm?: boolean;
  maxFiles?: number;
  /**
   * The model to use for the optional labelling pass — the SAME one the user
   * connected in Settings. Absent falls back to `ANTHROPIC_API_KEY`, which is
   * what every pre-r90 caller does, so their behaviour is unchanged.
   *
   * This exists because the two paths used to read different keys: the assistant
   * used the user's configured provider while the labeller read an env var the
   * user had never set, so connecting an OpenRouter key improved the assistant
   * and left every service still called "Backend".
   */
  labelModel?: LabelModel;
  /**
   * Receives the per-service parsed facts this scan produced, once the parse
   * pass is complete.
   *
   * Exists so the service-input card can ask "which env vars does this service
   * actually read" WITHOUT re-walking the repository. Attribution is the subtle
   * part — `excludedPrefixesFor` gives a nested app's files to the deeper
   * service, not to both — and a second copy of that rule would drift from this
   * one silently, then disagree about which service failed to read a variable.
   *
   * Purely an out-channel: the scan does not read it back, and omitting it
   * changes nothing.
   */
  onServiceFacts?: (perService: readonly ServiceFiles[], discovery: Discovery) => void;
}

export interface ServiceFiles {
  service: ServiceInfo;
  facts: FileFacts[];
}

function* walkFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

/**
 * Does this directory hold ANY file this scanner can actually parse?
 *
 * Bounded on purpose: it stops at the first hit and never walks more than
 * {@link SOURCE_PROBE_LIMIT} entries, so asking the question costs nothing on a
 * huge repo and cannot itself become the scan.
 *
 * This is the question the discovery paths never asked. A compose file that
 * declares only prebuilt images has no app service at all (spring-petclinic);
 * a compose file whose build context narrows to `docker/development` has one
 * app service pointing at a directory that holds a Dockerfile and nothing else
 * (sqlfluff). Both reported success and produced ZERO files, which is the
 * failure mode `CLAUDE.md` calls the worst one — an empty picture of a repo
 * that is full of code.
 */
const SOURCE_PROBE_LIMIT = 20_000;
export function hasParseableSource(dirAbs: string): boolean {
  let seen = 0;
  try {
    for (const fileAbs of walkFiles(dirAbs)) {
      if (++seen > SOURCE_PROBE_LIMIT) return false;
      if (!LANG_BY_EXT[path.extname(fileAbs)]) continue;
      if (isGenerated(fileAbs)) continue;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isGenerated(file: string): boolean {
  const base = path.basename(file);
  // Go gRPC stubs (*.pb.go, *_grpc.pb.go): usage sites live in app code, the
  // generated stubs themselves are noise. *_test.go isn't "generated" but is
  // filtered here too — test files are not part of the service's runtime graph.
  // Java gRPC stubs (protoc-gen-grpc-java's *Grpc.java, e.g. InventoryGrpc.java):
  // app code references XGrpc.XImplBase / XGrpc.newBlockingStub by name without
  // needing the (often huge, always generated) stub class itself parsed.
  return /_pb2(_grpc)?\.py$|\.min\.js$|\.bundle\.js$|_pb\.(js|ts)$|\.pb\.go$|_grpc\.pb\.go$|_test\.go$|Grpc\.java$/.test(
    base
  );
}

/** Resolve intra-service imports to repo-relative file paths. */
/**
 * Every file an import statement actually depends on.
 *
 * A list, not one path, because `from app import events, provenance` names two
 * real modules and the graph should carry two edges. See the python branch.
 */
export function resolveImportAll(
  fromFile: string,
  raw: string,
  lang: Lang,
  serviceDir: string,
  fileSet: Set<string>,
  goModulePath?: string,
  names?: readonly string[]
): string[] {
  if (lang === 'go') {
    if (!goModulePath) return [];
    const hit = resolveGoImportToFile(raw, goModulePath, serviceDir, fileSet);
    return hit ? [hit] : [];
  }
  if (lang === 'java') {
    // Java imports are fully-qualified package paths (e.g.
    // "org.springframework.web.bind.annotation.RestController"), not file
    // paths, and don't even encode the source file's own package-relative
    // location the way Go's do — resolving them would need classpath-aware
    // resolution we don't have. Directory-affinity clustering still groups
    // Java files by directory without needing this.
    return [];
  }
  if (lang === 'py') {
    // absolute module path rooted at the service dir: app.db -> app/db.py
    // relative: .db / ..pkg.mod from the importing file's package
    let baseParts: string[];
    let modPath = raw;
    if (raw.startsWith('.')) {
      const dots = raw.match(/^\.+/)![0].length;
      modPath = raw.slice(dots);
      const pkgParts = path.posix.dirname(fromFile).split('/');
      baseParts = pkgParts.slice(0, pkgParts.length - (dots - 1));
    } else {
      baseParts = serviceDir === '.' ? [] : serviceDir.split('/');
    }
    const rel = modPath ? modPath.split('.').join('/') : '';
    const joined = [...baseParts, rel].filter(Boolean).join('/');

    /*
     * `from PACKAGE import a, b` NAMES SUBMODULES, and they are the dependency.
     *
     * Without this the statement resolved to `PACKAGE/__init__.py` and stopped,
     * which on ml-harness put **550 of 969 edges** onto a package marker and gave
     * a TWO-LINE `app/__init__.py` the highest PageRank in the graph (0.1713, vs
     * 0.0202 for `app/main.py`). PageRank picks a cluster's anchor and the anchor
     * picks its label, so an artefact of unresolved imports was choosing the
     * words printed on the board.
     *
     * `names` has always been parsed (`parsePyFromImportNames` in parse/facts.ts)
     * and was simply never passed in. A name that turns out to be a SYMBOL rather
     * than a submodule resolves to nothing here and correctly falls through to
     * the module itself below — so `from app.tools.evidence import record_fact`
     * still yields `app/tools/evidence.py`.
     */
    if (names && names.length > 0) {
      const submodules: string[] = [];
      for (const name of names) {
        const base = joined ? `${joined}/${name}` : name;
        for (const cand of [`${base}.py`, `${base}/__init__.py`]) {
          if (fileSet.has(cand)) {
            submodules.push(cand);
            break;
          }
        }
      }
      if (submodules.length > 0) return submodules;
    }

    for (const cand of [`${joined}.py`, `${joined}/__init__.py`]) {
      if (fileSet.has(cand)) return [cand];
    }
    return [];
  }
  // JS/TS: only relative imports
  if (!raw.startsWith('.')) return [];
  /*
   * POSIX JOINS, BECAUSE `fileSet` IS POSIX.
   *
   * Every rel in the graph is POSIX on every platform (see relPosix.ts), so a
   * candidate built with the host's `path.join` can only match on POSIX hosts.
   * On Windows `path.join` answers with backslashes and EVERY lookup below
   * missed, so the import graph came out empty — no edges at all.
   *
   * The python branch below was already written this way (`.split('/')`), which
   * is the tell: this resolver always assumed POSIX rels, and the JS/TS branch
   * only appeared to work because both sides were natively wrong together.
   */
  const base = path.posix.join(path.posix.dirname(fromFile), raw);

  /**
   * TypeScript ESM writes the OUTPUT extension in the specifier.
   *
   * Under `"module": "NodeNext"` — which this repo and every modern TS ESM project
   * uses — `import { X } from './Thing.js'` refers to `Thing.ts` or `Thing.tsx` on
   * disk. The `.js` file does not exist and never will; it is what the specifier
   * will mean after compilation.
   *
   * Without these rewrites the resolver looked for `Thing.js` (absent) and then
   * `Thing.js.ts` (nonsense), so EVERY such import failed to resolve and produced no
   * edge. Measured on this repo before the fix: `packages/web/src` has 1545 relative
   * imports, 100% of them `.js`-suffixed, and the graph carried 51 edges touching
   * `svc:web` — the import graph of the largest package was essentially absent, and
   * the whole repo scanned to 0.069 edges per file.
   *
   * That is not a cosmetic gap. The grounded graph IS the product; an import graph
   * that silently drops a modern TS codebase's edges makes "what calls this" answer
   * "nothing in this scan" for almost every question worth asking.
   */
  const tsEsmRewrites = /\.(js|jsx|mjs|cjs)$/.test(base)
    ? [
        base.replace(/\.js$/, '.ts'),
        base.replace(/\.js$/, '.tsx'),
        base.replace(/\.jsx$/, '.tsx'),
        base.replace(/\.mjs$/, '.mts'),
        base.replace(/\.cjs$/, '.cts'),
      ]
    : [];

  const candidates = [
    base,
    ...tsEsmRewrites,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.posix.join(base, 'index.ts'),
    path.posix.join(base, 'index.tsx'),
    path.posix.join(base, 'index.js'),
  ];
  for (const cand of candidates) {
    const norm = path.posix.normalize(cand);
    if (fileSet.has(norm)) return [norm];
  }
  return [];
}

/**
 * The single best target for an import, or `undefined`.
 *
 * Kept because callers that only want one answer read better for it, and because
 * the TypeScript-ESM specifier rules are locked against this shape.
 */
export function resolveImport(
  fromFile: string,
  raw: string,
  lang: Lang,
  serviceDir: string,
  fileSet: Set<string>,
  goModulePath?: string
): string | undefined {
  return resolveImportAll(fromFile, raw, lang, serviceDir, fileSet, goModulePath)[0];
}

/**
 * THE ONE discovery decision, shared by `scanRepo` and `buildRepoFunctionGraph`.
 *
 * U23 — `buildRepoFunctionGraph` used to re-implement only the FIRST layer of
 * this (compose -> k8s -> code-first) and none of the corrections below it. On
 * sqlfluff, whose single compose service narrows its build context to
 * `docker/development` (one Dockerfile, no code), the scan correctly fell back
 * to the code-first roots and mapped 456 files while the function graph walked
 * the Dockerfile directory and returned ZERO nodes — so "Show main flow" had
 * nothing to work with on a repo that is 456 files of Python.
 *
 * One function, two callers: the two can no longer drift.
 */
export function resolveDiscovery(
  abs: string,
  withinRoot: (candidateAbs: string) => boolean
): { discovery: Discovery; codeFirstSignals?: Map<string, FrameworkSignals> } {
  let discovery: Discovery;
  // Framework/category signals for the code-first (manifest-less) path only,
  // keyed by service name. Undefined for every manifest repo — its presence is
  // the sole switch that injects enriched framework metadata below, so the
  // manifest path (compose/k8s/helm) stays byte-identical.
  let codeFirstSignals: Map<string, FrameworkSignals> | undefined;
  if (findComposeFile(abs)) {
    discovery = discover(abs);
    // A compose service that declared `build.context: .` has told us the repo is
    // BIGGER than the services compose lists. Left alone, every app that compose
    // does not deploy — a marketing site, an admin console, a CRM front end — is
    // simply absent from the graph, and the user is looking at a picture of their
    // system with most of it missing. So in exactly that case (and only then),
    // fold in the code-first app roots no compose service already covers.
    //
    // Scoped hard on purpose: `rootContextNarrowed` is false for every ordinary
    // compose repo, where each service has its own build directory, so the six
    // reference gates see byte-identical graphs.
    // Either signal means the same thing: a compose service's build context is the
    // WHOLE REPO. `rootContextNarrowed` catches the form that names a
    // `dockerfile: sub/Dockerfile` (r81); this second check catches the far more
    // common plain `build: .` with a root Dockerfile, which names no subpath at
    // all and so slipped straight through — on a real 12-app repo that still
    // produced two services, both rooted at `.`, with every sibling app as a
    // module of each.
    const buildsFromRepoRoot =
      discovery.rootContextNarrowed === true ||
      discovery.services.some((s) => s.role === 'app' && s.dir === '.');
    if (buildsFromRepoRoot) {
      const extra = uncoveredAppRoots(abs, discovery);
      if (extra.services.length > 0) {
        discovery = {
          ...discovery,
          services: [...discovery.services, ...extra.services],
          warnings: [
            ...discovery.warnings,
            `compose builds from the repo root — also mapped ${extra.services.length} app root(s) it does not deploy`,
          ],
        };
        codeFirstSignals = extra.frameworks;
      }
    }
  } else {
    const k8s = discoverKubernetes(abs);
    if (k8s) {
      discovery = k8s;
    } else {
      // No compose/K8s/Helm manifest. Before giving up, try the code-first
      // (manifest-less) path: identify app root(s) from package manifests and
      // build a real graph (files, imports, and whatever the existing detectors
      // find) instead of throwing. This path NEVER runs when a manifest exists,
      // so the six reference gates are untouched.
      const cf = discoverCodeFirst(abs);
      if (!cf) {
        // Truly nothing to scan — neither a service manifest NOR any recognizable
        // package manifest / source. Keep the distinct, catchable error so the
        // attach path can present a calm "nothing to scan yet" note.
        throw new NoManifestsError(abs);
      }
      discovery = cf.discovery;
      codeFirstSignals = cf.frameworks;
    }
  }

  /**
   * THE MANIFEST POINTED AT NO CODE — say so, and go and find the code.
   *
   * A manifest (compose / k8s / Helm) is a DEPLOYMENT statement, and a
   * deployment statement can be true while naming none of this repo's source:
   *
   *  - `spring-petclinic`'s compose file declares `mysql` and `postgres` from
   *    Docker Hub and nothing else, so discovery found zero buildable app
   *    services and reported "nothing to analyze" over a repo that is a full
   *    Java application;
   *  - `sqlfluff`'s single service narrows its build context to
   *    `docker/development`, a directory holding one Dockerfile — one app
   *    service, zero parseable files, and a scan that ended at nothing.
   *
   * Both reported SUCCESS with an empty graph. The honest answer is not to
   * fabricate services: it is to say the manifest covers no source in this
   * repo, and then use the code-first path — the same shipped discoverer used
   * for manifest-less repos — over the repo itself. Manifest services are kept
   * (the datastores compose declares are real and still carry their wiring);
   * only the app half is replaced, and only when the manifest's app half
   * covers nothing this scanner can read.
   */
  if (discovery.manifestKind !== 'code') {
    const appServices = discovery.services.filter((s) => s.role === 'app');
    const sourceless = appServices.filter(
      (s) => !s.dir || !withinRoot(path.join(abs, s.dir)) || !hasParseableSource(path.join(abs, s.dir)),
    );
    const dirNamed = appServices.filter((s) => s.dir);
    const noSourceAnywhere = sourceless.length === appServices.length;
    /**
     * A DEPLOYMENT-ONLY repo is not the same failure and must not get the same
     * answer. sock-shop declares 22 app workloads from prebuilt images and
     * carries none of their source: those 22 ARE the architecture, and the
     * first version of this fallback replaced them with `openapi`, `staging`
     * and a Terraform directory — four package manifests that are not services,
     * fabricating an architecture over a true one. So the code-first path is
     * only reached when the manifest NAMED a build directory (and it turned out
     * to hold no code) or named no app service at all. When every app service
     * is image-only, the honest output is the topology plus a sentence saying
     * the code is not here.
     */
    const manifestUnderDescribes = appServices.length === 0 || dirNamed.length > 0;
    if (noSourceAnywhere && manifestUnderDescribes) {
      const why =
        appServices.length === 0
          ? `the ${discovery.manifestKind} manifest declares no buildable app service`
          : `the build context(s) named by the ${discovery.manifestKind} manifest ` +
            `(${dirNamed.map((s) => s.dir).join(', ')}) hold no code this scanner can read`;
      const cf = discoverCodeFirst(abs);
      if (cf && cf.discovery.services.length > 0) {
        const used = new Set(discovery.services.map((s) => s.name));
        const adopted: ServiceInfo[] = [];
        const signals = new Map<string, FrameworkSignals>();
        for (const svc of cf.discovery.services) {
          let name = svc.name;
          while (used.has(name)) name = `${name}-app`;
          used.add(name);
          adopted.push({ ...svc, name });
          const sig = cf.frameworks.get(svc.name);
          if (sig) signals.set(name, sig);
        }
        discovery = {
          ...discovery,
          // Only the app services whose build directory turned out to hold no
          // code are replaced. Datastores keep their wiring, and an image-only
          // app service is still a declared part of the topology.
          services: [...discovery.services.filter((s) => s.role !== 'app' || !s.dir), ...adopted],
          // FIRST, not last. This sentence explains the whole shape of the
          // graph below it, and every consumer that shows "the scanner said"
          // shows warnings[0]. Burying it under per-file notes is how a
          // repo-level explanation goes unread.
          warnings: [
            `${why} — mapped ${adopted.length} app root(s) from this repo's own package manifests instead ` +
              `(${adopted.map((s) => s.dir ?? '.').join(', ')})`,
            ...discovery.warnings,
          ],
        };
        codeFirstSignals = signals;
      } else {
        discovery = {
          ...discovery,
          warnings: [
            `${why}, and no package manifest names one either — this looks like a deployment-only repo, ` +
              `so the graph shows the topology it declares and no code`,
            ...discovery.warnings,
          ],
        };
      }
    } else if (noSourceAnywhere && appServices.length > 0) {
      // Every app service is image-only: the manifest is complete, the SOURCE
      // simply lives in other repositories. Say that, rather than letting an
      // architecture with no code in it look like a scanner that failed.
      discovery = {
        ...discovery,
        warnings: [
          `all ${appServices.length} app service(s) in the ${discovery.manifestKind} manifest run prebuilt images ` +
            `and none has source in this repo — this is a deployment-only repo, so the graph is its declared ` +
            `topology, with no files behind it`,
          ...discovery.warnings,
        ],
      };
    }
  }
  return { discovery, codeFirstSignals };
}

export async function scanRepo(repoRoot: string, opts: ScanOptions = {}): Promise<ArchGraph> {
  /* What this scan could not read. See `lang/unfollowed.ts` — a confident
     silence about half a system is the failure one level up from a false edge.
     Declared before the walk, because the walk is what fills it. */
  const unfollowed = new UnfollowedTally();

  const abs = path.resolve(repoRoot);
  if (!fs.existsSync(abs)) throw new Error(`repo path does not exist: ${abs}`);
  // Canonical repo root for the jail check below: no app-service directory is
  // ever walked/ingested unless it realpath-resolves inside this root. Defence
  // in depth against a code-first `workspaces` glob (or symlinked dir) escaping.
  const rootReal = fs.realpathSync(abs);
  const withinRoot = (candidateAbs: string): boolean => {
    const real = realpathContained(candidateAbs);
    return real === rootReal || real.startsWith(rootReal + path.sep);
  };
  reset();
  /**
   * U23 — open a capture of this scan's parse output so the function graph can
   * reuse it instead of parsing the whole repo a second time. See
   * `parse/sharedFacts.ts`: plain fact objects only, never tree-sitter trees.
   */
  resetSharedFacts(rootReal);
  const tScanStart = performance.now();
  let tMark = tScanStart;
  /** Close the current phase bucket and open the next. */
  const mark = (name: string): void => {
    const now = performance.now();
    bump(name, now - tMark);
    tMark = now;
  };
  await initParser();
  mark('01 initParser');

  const resolved = resolveDiscovery(abs, withinRoot);
  let discovery: Discovery = resolved.discovery;
  // Framework/category signals for the code-first (manifest-less) path only,
  // keyed by service name. Undefined for every manifest repo — its presence is
  // the sole switch that injects enriched framework metadata below, so the
  // manifest path (compose/k8s/helm) stays byte-identical.
  const codeFirstSignals: Map<string, FrameworkSignals> | undefined = resolved.codeFirstSignals;

  mark('02 discovery');
  count('services', discovery.services.length);

  const warnings = [...discovery.warnings];

  // ---- parse all app-service files ----
  const perService: ServiceFiles[] = [];
  let fileCount = 0;
  const maxFiles = opts.maxFiles ?? 20_000;
  /**
   * Files the tree-sitter WASM runtime could not read because it had aborted.
   *
   * This is not "a file failed to parse" — it is "the parser is dead and every
   * remaining file in this process is unreadable". It gets a named, counted
   * warning rather than one identical line per file (456 of them, in the run
   * that found this) and rather than nothing at all.
   */
  const parserAborted = { count: 0, firstFile: '', detail: parserAbortedWith() ?? '' };
  /**
   * A service NEVER ingests files that belong to another service.
   *
   * Service dirs can nest — most often when one service's build context is the
   * repo root while real apps live in subdirectories beneath it. Without this,
   * the outer service walks the inner ones too: their files get attributed to
   * BOTH, the outer service grows a `module` per sibling app, and the board
   * shows one mega-service instead of the system. Whoever owns the deeper
   * directory owns the files in it.
   */
  const appDirs = discovery.services
    .filter((s) => s.role === 'app' && s.dir)
    .map((s) => (s.dir as string).replace(/\/+$/, ''));
  const excludedPrefixesFor = (dir: string): string[] => {
    const self = dir.replace(/\/+$/, '');
    return appDirs
      .filter((d) => d !== self && (self === '.' || d.startsWith(`${self}/`)) && d !== '.')
      .map((d) => path.join(abs, d) + path.sep);
  };

  for (const service of discovery.services) {
    if (service.role !== 'app' || !service.dir) continue;
    const facts: FileFacts[] = [];
    const dirAbs = path.join(abs, service.dir);
    const excluded = excludedPrefixesFor(service.dir);
    // Jail: never walk/ingest a service dir whose realpath escapes the repo root
    // (e.g. a `..`-prefixed code-first workspaces glob or a symlink out of tree).
    if (!withinRoot(dirAbs)) {
      warnings.push(
        `service ${service.name}: directory "${service.dir}" resolves outside the repo root — skipped`
      );
      continue;
    }
    let tWalk = performance.now();
    for (const fileAbs of walkFiles(dirAbs)) {
      bump('03 file walk', performance.now() - tWalk);
      if (excluded.some((p) => fileAbs.startsWith(p))) continue; // owned by a deeper service
      const ext = path.extname(fileAbs);
      const lang = LANG_BY_EXT[ext];
      if (!lang) {
        /* COUNTED, NOT JUST SKIPPED. This `continue` is where a C# payment
           service disappears without trace; the tally is what lets the graph
           say so afterwards. Non-source extensions are dropped by the tally
           itself, so a repo full of .md and .json reports nothing. */
        unfollowed.add(ext, service.name);
        tWalk = performance.now();
        continue;
      }
      if (isGenerated(fileAbs)) {
        tWalk = performance.now();
        continue;
      }
      if (++fileCount > maxFiles) {
        warnings.push(`file limit ${maxFiles} reached — remaining files skipped`);
        break;
      }
      // POSIX at birth: this rel becomes a node id and an evidence ref, so it must
      // not carry the host separator. See relPosix.ts.
      const rel = toRelPosix(path.relative(abs, fileAbs));
      try {
        const stat = fs.statSync(fileAbs);
        if (stat.size > MAX_FILE_BYTES) {
          warnings.push(`${rel}: >1MB, skipped`);
          tWalk = performance.now();
          continue;
        }
        const tRead = performance.now();
        const src = fs.readFileSync(fileAbs, 'utf8');
        bump('04 file read', performance.now() - tRead);
        const tFacts = performance.now();
        const f = extractFacts(src, rel, lang);
        bump('05 extractFacts', performance.now() - tFacts);
        recordSharedFacts(rel, stat.size, stat.mtimeMs, f);
        if (f.parseErrors > 0) {
          warnings.push(`${rel}: ${f.parseErrors} parse error region(s) — facts may be partial`);
        }
        facts.push(f);
      } catch (e) {
        if (e instanceof ParserAbortedError) {
          parserAborted.count += 1;
          if (!parserAborted.firstFile) parserAborted.firstFile = rel;
          if (!parserAborted.detail) parserAborted.detail = e.detail;
          continue;
        }
        warnings.push(`${rel}: failed to parse (${(e as Error).message}) — skipped`);
      }
      tWalk = performance.now();
    }
    perService.push({ service, facts });
  }
  opts.onServiceFacts?.(perService, discovery);
  mark('06 parse pass (total)');
  count('files parsed', fileCount);
  // Every file this scan read is now captured; hand it to the next
  // `buildRepoFunctionGraph` for this same root (U23).
  publishSharedFacts();

  if (parserAborted.count > 0) {
    warnings.push(
      `could not parse ${parserAborted.count} file(s) (first: ${parserAborted.firstFile}): ` +
        `the tree-sitter parser aborted (${parserAborted.detail || 'out of WASM memory'}). ` +
        `The runtime cannot be restarted inside a running process, so these files were skipped — ` +
        `re-run the scan in a fresh process to read them.`,
    );
  }

  // ---- proto contracts (repo-wide) ----
  const protoServices = [];
  for (const fileAbs of walkFiles(abs)) {
    if (fileAbs.endsWith('.proto')) {
      try {
        // POSIX at birth — this rel lands in edge evidence. See relPosix.ts.
        protoServices.push(...parseProtoServices(fileAbs, toRelPosix(path.relative(abs, fileAbs))));
      } catch (e) {
        warnings.push(
          `${toRelPosix(path.relative(abs, fileAbs))}: proto parse failed (${(e as Error).message})`,
        );
      }
    }
  }

  mark('07 proto walk (repo-wide)');

  // ---- detectors ----
  const joinInput: JoinInput = {
    discovery,
    routes: [],
    mounts: [],
    clients: [],
    queueOps: [],
    tables: [],
    dbEngines: [],
    connections: [],
    grpcClients: [],
    grpcServers: [],
    protoServices,
  };
  const infraByName = new Map(
    discovery.services.filter((s) => s.role !== 'app').map((s) => [s.name, s])
  );
  // nginx proxy_pass facts, per service — cheap enough to run for every app
  // service; it no-ops when the service has no *.conf/*.conf.tpl/*.conf.template
  // files. Kept aside from `joinInput.clients` (into which they're also pushed)
  // so the node-building pass below can attach a file node for each conf file
  // referenced — these files aren't part of `facts` (only ts/js/py/go are
  // parsed into FileFacts), so without this they'd have no node for the HTTP
  // joiner's `file:<path>` srcId to resolve against.
  const nginxClientsByService = new Map<string, ReturnType<typeof detectNginx>>();
  // application.properties/yml facts, per service — same "cheap no-op, extra
  // file nodes needed" shape as the nginx conf facts above: these config
  // files aren't part of `facts` (not source code), so the node-building
  // pass below gives each referenced one its own file node.
  const springConfigByService = new Map<string, ReturnType<typeof detectSpringConfig>>();
  for (const { service, facts } of perService) {
    const http = phase('08a detectHttp', () => detectHttp(service.name, facts));
    joinInput.routes.push(...http.routes);
    joinInput.mounts.push(...http.mounts);
    joinInput.clients.push(...http.clients);
    const nginxClients = phase('08b detectNginx', () => detectNginx(service, abs));
    if (nginxClients.length > 0) {
      nginxClientsByService.set(service.name, nginxClients);
      joinInput.clients.push(...nginxClients);
    }
    joinInput.queueOps.push(...phase('08c detectQueues', () => detectQueues(service.name, facts)));
    joinInput.tables.push(...phase('08d detectDb', () => detectDb(service.name, facts)));
    /* WHICH engine, not just that there is one. The driver call names it, and
       the scan was already reading the line. */
    joinInput.dbEngines!.push(
      ...phase('08d2 detectDbEngines', () => detectDbEngines(service.name, facts)),
    );
    joinInput.connections.push(
      ...phase('08e detectConnections', () =>
        detectConnections(service, facts, infraByName, discovery.wires)
      )
    );
    const grpc = phase('08f detectGrpc', () => detectGrpc(service.name, facts));
    joinInput.grpcClients.push(...grpc.clients);
    joinInput.grpcServers.push(...grpc.servers);

    const springConfig = phase('08g detectSpringConfig', () =>
      detectSpringConfig(service, abs, infraByName, discovery.wires)
    );
    if (springConfig.connections.length > 0 || springConfig.clients.length > 0) {
      springConfigByService.set(service.name, springConfig);
      joinInput.connections.push(...springConfig.connections);
      joinInput.clients.push(...springConfig.clients);
    }
  }

  mark('08 detectors (total)');

  const joined = joinAll(joinInput);
  warnings.push(...joined.warnings);
  mark('09 joinAll');

  // ---- nodes ----
  const nodes: ArchNode[] = [];
  const repoName = path.basename(abs);
  nodes.push({ id: 'repo', kind: 'repo', label: repoName });

  for (const s of discovery.services) {
    if (s.role === 'app') {
      nodes.push({
        id: `svc:${s.name}`,
        kind: 'service',
        label: s.name,
        parentId: 'repo',
        path: s.dir,
        meta: { framework: undefined },
      });
    } else {
      nodes.push({
        id: `ds:${s.name}`,
        kind: 'datastore',
        label: s.name,
        parentId: 'repo',
        meta: { tech: s.tech, role: s.role, image: s.image },
      });
    }
  }
  /*
   * DATASTORES THE CODE PROVES, THAT NO MANIFEST DECLARES.
   *
   * `discovery.services` above can only mint a `ds:` node from a compose /
   * Kubernetes / Helm entry, so a repository with no deployment manifest got a
   * board with no persistence layer at all — however much SQL it contained. On
   * ml-harness that discarded 188 parsed table accesses across 28 tables for an
   * application whose whole product is a ledger. See the note in join.ts.
   *
   * The node is stamped `inferred: true` and carries no `tech`, because the
   * accesses prove a database exists without saying which engine it is. It cites
   * the first access like any other node, and it hangs off the service whose
   * code reaches it rather than off the repo, because that IS what was proven —
   * this service talks to a store.
   */
  for (const ds of joined.inferredDatastores) {
    nodes.push({
      id: `ds:${ds.name}`,
      kind: 'datastore',
      // The service's own name is not repeated: the row would read "ml-harness"
      // under a card already called "ml-harness". What the reader needs is what
      // it IS, and how much of it there is.
      label: 'Database',
      parentId: `svc:${ds.service}`,
      meta: {
        evidenceRef: `${ds.evidence.file}:${ds.evidence.line}`,
        inferred: true,
        tables: ds.tables,
        tableCount: ds.tables.length,
        /* Recorded only when a DRIVER proved it. Absent means "could not tell",
           which a consumer must be able to distinguish from "no engine". */
        ...(ds.engine ? { tech: ds.engine } : {}),
        ...(ds.engineEvidence
          ? { techEvidenceRef: `${ds.engineEvidence.file}:${ds.engineEvidence.line}` }
          : {}),
      },
    });
  }
  for (const [topic, broker] of joined.topics) {
    nodes.push({
      id: `topic:${topic}`,
      kind: 'topic',
      label: topic,
      parentId: broker ? `ds:${broker}` : 'repo',
    });
  }

  const importEdges: ArchEdge[] = [];
  let importSeq = 0;
  const llmRequests: LabelRequest[] = [];
  // Two or more compose services can share ONE build context — a very common
  // Python shape is a FastAPI `api` and an arq/celery `worker` that both
  // `build: ./backend`, running the same image off one codebase. They are
  // DISTINCT services (distinct `svc:` node ids, and each gets its own
  // interaction edges from the detector pass above, keyed by service NAME), but
  // their SOURCE tree is a single directory that the parse pass walked once per
  // service. So the leaf `file:`/`mod:` nodes and the intra-service `import`
  // edges would be emitted once PER service and collide on id — `validateGraph`
  // rejects duplicate node ids, which is exactly what crashed the whole scan.
  //
  // Fix: emit each build context's file tree EXACTLY ONCE, parenting it under
  // the FIRST service that claims that dir (compose order). Later services that
  // share the context keep their own `svc:` node and their own interaction
  // edges but contribute no duplicate leaves. This cannot change the
  // service-level edge projection the reference gates ride on: `import` edges
  // are excluded from it (score.ts), the interaction edges above are unchanged,
  // and every reference repo gives each service its own build context, so
  // `processedDirs` never skips there (byte-identical output).
  const processedDirs = new Set<string>();
  /** Repo-wide language samples — one entry per EMITTED file, so a build context
   *  shared by two services is counted once, same as its file nodes. */
  const repoLanguageSamples: { language?: string; path: string; loc?: number }[] = [];
  for (const { service, facts } of perService) {
    // framework hint for the service card — set for EVERY service sharing the
    // context (both `api` and `worker` are e.g. fastapi), so each card is
    // labelled even though only the first emits the shared file tree below.
    const importsAll = facts.flatMap((f) => f.imports.map((i) => i.raw));
    const framework = importsAll.includes('express')
      ? 'express'
      : importsAll.includes('fastapi')
        ? 'fastapi'
        : importsAll.includes('flask')
          ? 'flask'
          : importsAll.some((i) => i.startsWith('next'))
            ? 'next.js'
            : undefined;
    // What this service is WRITTEN IN, counted from the same parse facts the
    // file nodes are stamped from (never re-derived, never guessed). It rides on
    // `meta.languages` — deliberately NOT `meta.language`, which is a
    // design-mode hint the placement engine reads and which this must not touch.
    const mix = languageMix(facts.map((f) => ({ language: f.language, path: f.file, loc: f.loc })));
    const tFind = performance.now();
    const svcNode = nodes.find((n) => n.id === `svc:${service.name}`);
    bump('10a nodes.find(svc)', performance.now() - tFind);
    if (svcNode) {
      svcNode.meta = {
        ...svcNode.meta,
        framework,
        files: facts.length,
        ...(mix.shares.length > 0 ? { languages: mix.shares } : {}),
        ...(factsSuggestScheduledJob(facts) ? { scheduled: true } : {}),
      };
    }

    // Already emitted this build context's file tree under an earlier service —
    // don't re-emit (would duplicate every `file:`/`mod:` node id).
    if (processedDirs.has(service.dir!)) continue;
    processedDirs.add(service.dir!);

    const fileSet = new Set(facts.map((f) => f.file));
    const goModulePath = facts.some((f) => f.language === 'go')
      ? readGoModulePath(abs, service.dir!)
      : undefined;
    const importPairs: [string, string][] = [];
    const tImports = performance.now();
    for (const f of facts) {
      for (const imp of f.imports) {
        // `imp.names` is what turns `from app import events, provenance` into two
        // real edges instead of one edge onto `app/__init__.py`. See resolveImportAll.
        const targets = resolveImportAll(
          f.file,
          imp.raw,
          f.language,
          service.dir!,
          fileSet,
          goModulePath,
          imp.names
        );
        for (const resolved of targets) {
          if (resolved && resolved !== f.file) {
          importPairs.push([f.file, resolved]);
          importEdges.push({
            id: `imp${++importSeq}`,
            srcId: `file:${f.file}`,
            dstId: `file:${resolved}`,
            kind: 'import',
            confidence: 1,
            origin: 'deterministic',
            evidence: [
              {
                file: f.file,
                line: imp.line,
                snippet: (f.lines[imp.line - 1] ?? '').trim().slice(0, 200),
              },
            ],
          });
          }
        }
      }
    }

    bump('10b import resolution', performance.now() - tImports);

    // rank + cluster
    const graphInput = { files: facts.map((f) => f.file), imports: importPairs };
    const ranks = phase('10c pageRank', () => pageRank(graphInput));

    /*
     * THE ARCHITECTURE VIEW IS THE PRODUCT, NOT ITS TEST SUITE.
     *
     * `clusterFiles` runs community detection over the import graph, and the
     * label a cluster gets is a plurality vote over its members' directories. On
     * ml-harness the test suite cast 576 of 969 edges (59%) and held 158 of 292
     * file nodes (54%), so it outvoted the product roughly 4:1 and NAMED the
     * modules: four of seven came back as the string "tests", including the one
     * holding `app/main.py` and `app/db.py` — the 51-route HTTP app and the only
     * door to the database. A reader who opens a row called "tests" and finds
     * `main.py` inside it has learned the tool cannot tell a product from its
     * tests, and will discount the rows that ARE right.
     *
     * So the boxes and their names are decided over the product subgraph only.
     * `ranks` above is deliberately left over the FULL graph — every file node is
     * still stamped with a real PageRank, and `who_calls` still answers with test
     * callers, which it should. Only the architecture picture changes.
     *
     * The fallback matters: a repository that is ALL tests still gets modules,
     * because "no boxes at all" is a worse answer than "boxes named after tests".
     */
    const productFiles = graphInput.files.filter((f) => !isTestFile(f));
    const architectureInput =
      productFiles.length > 0
        ? {
            files: productFiles,
            imports: importPairs.filter(([from, to]) => !isTestFile(from) && !isTestFile(to)),
          }
        : graphInput;
    const architectureRanks =
      architectureInput === graphInput
        ? ranks
        : phase('10c pageRank (product only)', () => pageRank(architectureInput));

    // The *why* the team already wrote down: `// WHY:` / `// HACK:` comments and
    // ADR/RFC references, mined from the source lines the parse already holds.
    // Deterministic, keyless, capped per file. Files that record nothing get no
    // entry at all, so a repo with no rationale is untouched by this pass.
    const rationaleByFile = new Map<string, RationaleNote[]>();
    const tRationale = performance.now();
    for (const f of facts) {
      const notes = extractRationale(f);
      if (notes.length > 0) rationaleByFile.set(f.file, notes);
    }
    bump('10d extractRationale', performance.now() - tRationale);

    let parentOf = (_file: string): string => `svc:${service.name}`;
    if ((opts.cluster ?? true) && facts.length > 8) {
      const { clusters } = phase('10e clusterFiles', () =>
        clusterFiles(architectureInput, service.dir!)
      );
      if (clusters.size >= 2) {
        const fileToModule = new Map<string, string>();
        const ordered = [...clusters.entries()].sort((a, b) => a[0] - b[0]);
        // Two passes, because both fixes below need to see ALL of this service's
        // clusters before naming any one of them:
        //  - identical labels ("Core" twice) must be told apart by their own real
        //    directories, which only collide-detection can decide;
        //  - each module gets a COUNTED description, so a breakout card says what
        //    the module holds instead of repeating its name with a MOD badge.
        //  - and when neither of those can separate two modules (every file sits
        //    in the service root, so there IS no directory), each carries its
        //    ANCHOR: the member the rest of the service depends on most, by the
        //    PageRank already computed above. Real signal, not a tiebreaker.
        /**
         * "The member the rest of the service depends on most" — and only when
         * that is a TRUE sentence.
         *
         * The old version sorted by rank and took the first, so when nothing in
         * the module depends on anything the alphabetical winner was crowned
         * anyway. On `gin` — 22 Go files in one package, where same-package
         * files import each other not at all — that named the whole core of the
         * library "Auth", after `auth.go`, ahead of `gin.go`, `context.go` and
         * `tree.go`. A confident wrong name is worse than a mechanical one
         * (HANDOFF §6), so a tie at the top now yields NO anchor and the honest
         * structural label stays.
         */
        const topRankedOf = (members: string[]): string | undefined =>
          [...members].sort(
            (a, b) =>
              (architectureRanks.get(b) ?? 0) - (architectureRanks.get(a) ?? 0) || a.localeCompare(b)
          )[0];
        const anchorOf = (members: string[]): string | undefined =>
          chooseAnchor(members, (f) => architectureRanks.get(f) ?? 0);
        const tLabel = performance.now();
        const rawDrafts = ordered.map(([, members]) => ({
          members,
          // r184: the anchor also names the root-level case, where there is no
          // directory to name it after — see `labelCluster`. Only the STRICT
          // anchor may NAME a module; the merely top-ranked member is still
          // handed to `uniqueModuleLabels`, whose job is the weaker one of
          // telling two identically-named siblings apart, where any real file
          // of the module beats leaving two rows reading the same.
          label: labelCluster(members, service.dir!, anchorOf(members), service.name),
          dir: clusterDir(members),
          anchor: topRankedOf(members),
        }));
        // G8 — the service's own name is passed as a VETO: a module that ends
        // up named after its container ("Api" inside service "Api") is a row
        // repeating its own name, not a distinguishing label.
        const rawLabels = uniqueModuleLabels(rawDrafts, service.name);
        // G13 — every disambiguator has now had its turn. Two modules that
        // still read the same AND name the same directory are one module; see
        // `mergeIndistinguishableModules` for why this cannot run any earlier.
        const { drafts, labels } = mergeIndistinguishableModules(rawDrafts, rawLabels);
        bump('10f labelCluster + uniqueModuleLabels', performance.now() - tLabel);
        const factsByFile = new Map(facts.map((f) => [f.file, f]));
        const tDescribe = performance.now();
        drafts.forEach((draft, i) => {
          const modId = `mod:${service.name}/${i}`;
          const label = labels[i];
          const rationale = rollUpRationale(draft.members, rationaleByFile);
          const description = describeCluster(draft.members, factsByFile, rationale);
          nodes.push({
            id: modId,
            kind: 'module',
            label,
            parentId: `svc:${service.name}`,
            path: draft.dir,
            meta: {
              files: draft.members.length,
              ...(description ? { description } : {}),
              ...(rationale.length > 0 ? { rationale } : {}),
            },
          });
          for (const m of draft.members) fileToModule.set(m, modId);
          // `extras` was built for exactly this and never filled, so every
          // labelling prompt asked a model to name a Django module without
          // telling it the module was Python. The hints are composed from the
          // MODULE's own language mix (not the service's), so a TypeScript
          // module inside a mostly-Python service is described as TypeScript.
          const extras = composeLabelHints(
            languageMix(
              draft.members.map((m) => {
                const f = factsByFile.get(m);
                return { language: f?.language, path: m, loc: f?.loc };
              })
            ).shares
          );
          llmRequests.push({
            id: modId,
            kind: 'module',
            heuristicLabel: label,
            memberFiles: draft.members,
            ...(extras ? { extras } : {}),
          });
        });
        bump('10g describeCluster + module nodes', performance.now() - tDescribe);
        parentOf = (file) => fileToModule.get(file) ?? `svc:${service.name}`;
      }
    }

    const tFileNodes = performance.now();
    for (const f of facts) {
      nodes.push({
        id: `file:${f.file}`,
        kind: 'file',
        label: path.basename(f.file),
        parentId: parentOf(f.file),
        path: f.file,
        meta: {
          language: f.language,
          loc: f.loc,
          pageRank: Number((ranks.get(f.file) ?? 0).toFixed(4)),
          // Only present when this file actually records a why — absent signal
          // must leave the node exactly as it was.
          ...(rationaleByFile.has(f.file) ? { rationale: rationaleByFile.get(f.file) } : {}),
        },
      });
      repoLanguageSamples.push({ language: f.language, path: f.file, loc: f.loc });
    }
    bump('10h file nodes', performance.now() - tFileNodes);

    // nginx conf files aren't part of `facts` (not source code) — give each one
    // referenced by a proxy_pass fact its own file node, directly under the
    // service, so the HTTP joiner's file:<path> srcId resolves.
    const seenConfFiles = new Set<string>();
    for (const nc of nginxClientsByService.get(service.name) ?? []) {
      if (seenConfFiles.has(nc.file)) continue;
      seenConfFiles.add(nc.file);
      nodes.push({
        id: `file:${nc.file}`,
        kind: 'file',
        label: path.basename(nc.file),
        parentId: `svc:${service.name}`,
        path: nc.file,
        meta: { language: undefined },
      });
    }

    // same reasoning for application.properties/yml files referenced by
    // spring config facts (connections and/or gateway/generic client calls).
    const springConfig = springConfigByService.get(service.name);
    const springFiles = [
      ...(springConfig?.connections.map((c) => c.file) ?? []),
      ...(springConfig?.clients.map((c) => c.file) ?? []),
    ];
    for (const file of springFiles) {
      if (seenConfFiles.has(file)) continue;
      seenConfFiles.add(file);
      nodes.push({
        id: `file:${file}`,
        kind: 'file',
        label: path.basename(file),
        parentId: `svc:${service.name}`,
        path: file,
        meta: { language: undefined },
      });
    }
  }

  /* ══ CROSS-PACKAGE IMPORTS — the edges this scan could not previously find ══

     MEASURED on this repository before this pass existed: 1,348 import edges,
     every single one inside one service, ZERO crossing two — while 218 source
     files import `@sequence/*`. The board looked bare because the graph was
     bare, and the graph was bare because of the loop above: it resolves each
     service's imports against `fileSet`, built from THAT SERVICE'S OWN facts,
     and its JS/TS branch refuses bare specifiers outright. A cross-package
     target is not in the set being searched. It could not resolve — by
     construction, not by accident.

     Every fixture in the suite is a single package, which is the only reason
     this survived: a monorepo is the one shape that exhibits it.

     THIS PASS RUNS ONCE, AFTER ALL SERVICES ARE PARSED, because that is the
     first moment a repo-wide file set exists. It adds only edges whose target
     is a package declared in THIS repository — `react` resolves to nothing,
     because an edge into node_modules would put the whole of npm on the board.

     It does not touch the per-service resolver, and it refuses relative
     specifiers, so no intra-package edge is produced twice. */
  {
    const tWs = performance.now();
    const allFiles = new Set<string>();
    for (const { facts } of perService) for (const f of facts) allFiles.add(f.file);

    const wsPackages: WorkspacePackage[] = [];
    const seenDirs = new Set<string>();
    for (const { service } of perService) {
      if (!service.dir || seenDirs.has(service.dir)) continue;
      seenDirs.add(service.dir);
      const pkgPath = path.join(abs, service.dir, 'package.json');
      try {
        const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          name?: unknown;
          main?: unknown;
          module?: unknown;
          types?: unknown;
        };
        if (typeof raw.name !== 'string' || raw.name.length === 0) continue;
        const entry = [raw.module, raw.main, raw.types].find((v) => typeof v === 'string') as
          | string
          | undefined;
        wsPackages.push({ name: raw.name, dir: service.dir, ...(entry ? { entry } : {}) });
      } catch {
        /* No package.json, or unreadable, or not JSON. A service without one is
           ordinary — Go and Python services have none — and it simply cannot be
           the TARGET of a bare specifier. Not a warning. */
      }
    }

    if (wsPackages.length > 0) {
      const index = buildWorkspaceIndex(wsPackages);
      /* Deduped on (from, to): a file importing three symbols from one package
         states one dependency, not three. The per-service resolver emits one
         edge per resolved target and that is right there, because each target
         is a different FILE; here every name lands on the same entry. */
      const seenPair = new Set<string>();
      for (const { facts } of perService) {
        for (const f of facts) {
          if (f.language !== 'ts' && f.language !== 'js') continue;
          for (const imp of f.imports) {
            const resolved = resolveWorkspaceImport(imp.raw, index, allFiles);
            if (!resolved || resolved === f.file) continue;
            const pair = `${f.file} -> ${resolved}`;
            if (seenPair.has(pair)) continue;
            seenPair.add(pair);
            importEdges.push({
              id: `imp${++importSeq}`,
              srcId: `file:${f.file}`,
              dstId: `file:${resolved}`,
              kind: 'import',
              confidence: 1,
              origin: 'deterministic',
              evidence: [
                {
                  file: f.file,
                  line: imp.line,
                  snippet: (f.lines[imp.line - 1] ?? '').trim().slice(0, 200),
                },
              ],
            });
          }
        }
      }
      count('cross-package imports', seenPair.size);
    }
    bump('10w workspace imports', performance.now() - tWs);
  }

  /* ══ WHERE THE WALK NEVER WENT ═════════════════════════════════════════

     One repo-wide pass, purely to count what the service walk did not reach.
     It reuses `walkFiles` and `LANG_BY_EXT`, so "source file" means exactly
     what it means everywhere else in this scan — a second definition would
     produce a coverage report that disagreed with the graph it describes.

     Cheap by construction: it reads directory entries and never opens a file.
     `IGNORE_DIRS` keeps it out of node_modules and dist, the same as the real
     walk. */
  const allSourceFiles: string[] = [];
  for (const fileAbs of walkFiles(abs)) {
    if (!LANG_BY_EXT[path.extname(fileAbs)]) continue;
    if (isGenerated(fileAbs)) continue;
    allSourceFiles.push(toRelPosix(path.relative(abs, fileAbs)));
  }
  const scannedDirs = [...new Set(
    discovery.services
      .filter((sv) => sv.role === 'app' && sv.dir)
      .map((sv) => sv.dir as string),
  )];

  mark('10 node build (total)');

  // Repo-wide breakdown on the repo node, so any surface that wants to say
  // "62% Python · 31% TypeScript" reads a counted fact instead of recomputing
  // one. Same arithmetic as the per-service mixes above.
  const repoMix = languageMix(repoLanguageSamples);
  if (repoMix.shares.length > 0) {
    const repoNode = nodes.find((n) => n.id === 'repo');
    if (repoNode) repoNode.meta = { ...repoNode.meta, languages: repoMix.shares };
  }

  // Code-first (manifest-less) enrichment: attach the deterministic framework +
  // category signals derived from package manifests onto each app service node.
  // This runs ONLY for the code-first path (codeFirstSignals is undefined for
  // every manifest repo), and is purely additive (a richer meta.framework plus
  // new meta.frameworks / meta.signals fields the Phase-3b classifier reads), so
  // it cannot change any manifest repo's output.
  if (codeFirstSignals) {
    for (const [name, fw] of codeFirstSignals) {
      const node = nodes.find((n) => n.id === `svc:${name}`);
      if (node) {
        node.meta = {
          ...node.meta,
          framework: fw.framework ?? node.meta?.framework,
          frameworks: fw.frameworks,
          signals: fw.signals,
        };
      }
    }
  }

  // optional LLM naming pass — labels/descriptions only, never membership
  if (opts.llm) {
    let readme = '';
    for (const cand of ['README.md', 'readme.md', 'README.rst']) {
      const p = path.join(abs, cand);
      if (fs.existsSync(p)) {
        readme = fs.readFileSync(p, 'utf8');
        break;
      }
    }
    const labels = await llmLabels(repoName, readme, llmRequests, warnings, opts.labelModel);
    for (const [id, l] of labels) {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        node.label = l.label;
        node.meta = { ...node.meta, description: l.description, llmLabeled: true };
      }
    }
  }

  // interaction edges may reference route files in services we parsed — all file
  // nodes exist. Edges to svc:/ds:/topic: ids also exist. Safe to assemble.
  const graph: ArchGraph = {
    version: 1,
    scannedAt: new Date().toISOString(),
    repoRoot: abs,
    repoName,
    nodes,
    /*
     * PROVENANCE COVERS THE WHOLE GRAPH, and this is why it is stamped here as
     * well as at the joiner's exit: `importEdges` are built in THIS file and
     * never pass through `joinAll`, so a stamp that lived only there left every
     * import edge unattributed. Found by the test, which is what a test for
     * "every edge carries an actor" is for.
     *
     * `stampProvenance` only fills what is absent, so the joiner's stamp wins
     * where it already ran and neither can overwrite the other.
     */
    edges: stampProvenance([...joined.edges, ...importEdges]),
    warnings,
    /* ALWAYS present on a scan, empty when everything was readable — absent
       would mean "not recorded", and a reader must be able to tell "nothing was
       skipped" from "nobody looked". */
    unfollowed: unfollowed.report(),
    /* WHERE THE WALK NEVER WENT — owner walk 2026-08-22 (A7), "Index is cool,
       missing a couple". Measured at 59 files, none of them parse failures:
       all of them outside every discovered service, because the walk only ever
       enters service directories.

       `unfollowed` reported `[]` the whole time, which its contract defines as
       "looked, and everything was readable" — so the graph asserted coverage
       over files it had never opened. This is what makes that sentence true. */
    unscanned: unscannedRegions(allSourceFiles, scannedDirs),
    /*
     * THE ROUTE INVENTORY, WHICH THE JOINER HAS ALWAYS BUILT AND ALWAYS THROWN
     * AWAY. It indexed these by service to match callers, returned the matched
     * edges, and dropped the rest — so the graph could say "this call reaches
     * that handler" and could not say "this handler exists". A route nothing
     * calls produces no edge at all, which made "is anything still using this
     * endpoint?" the one question about a route the graph could not be asked.
     *
     * Only the fields that describe the ROUTE come across. `handlerName` and the
     * mount bookkeeping stay behind: they are how the detector found it, not
     * what it is.
     *
     * Sorted so a scan is byte-stable, for the same reason the joiner sorts its
     * inferred datastores — the inventory must not depend on which file the
     * parser happened to reach first.
     */
    routes: joinInput.routes
      .map((r) => ({
        service: r.service,
        method: r.method,
        path: r.path,
        file: r.file,
        line: r.line,
        ...(r.prefix ? { prefix: true as const } : {}),
      }))
      .sort(
        (a, b) =>
          a.service.localeCompare(b.service) ||
          a.path.localeCompare(b.path) ||
          a.method.localeCompare(b.method) ||
          a.file.localeCompare(b.file) ||
          a.line - b.line,
      ),
  };

  mark('11 graph assembly');

  const problems = validateGraph(graph);
  if (problems.length > 0) {
    throw new Error(`internal error — emitted graph failed validation:\n${problems.join('\n')}`);
  }
  mark('12 validateGraph');
  count('nodes', nodes.length);
  count('edges', graph.edges.length);
  bump('ZZ TOTAL', performance.now() - tScanStart);
  report(`${repoName} (${fileCount} files)`);
  return graph;
}
