import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { realpathContained } from '../server/jail.js';
import { toRelPosix } from '../relPosix.js';
import type { Discovery, ServiceInfo } from '../types.js';

/**
 * Jail guard for the code-first path. A scanned `package.json`'s `workspaces`
 * field (and any code-first app-root dir) is attacker-influenced: a `..`-prefixed
 * glob like `"workspaces": ["../../evil/*"]` resolves OUTSIDE the repo root, and
 * would otherwise become a `service.dir` the scanner walks + ingests. Every
 * candidate member dir must therefore realpath-resolve to inside (or equal to)
 * the canonical repo root before it is accepted. Escaping members are dropped
 * (never throw — a normal in-repo glob like `packages/*` is unaffected).
 */
function withinRoot(rootReal: string, candidateAbs: string): boolean {
  const real = realpathContained(candidateAbs);
  return real === rootReal || real.startsWith(rootReal + path.sep);
}

/**
 * Code-first discovery — the manifest-LESS path.
 *
 * Fires ONLY when a repo declares NO docker-compose / Kubernetes / Helm manifest
 * (see scan.ts, where this is reached strictly after both manifest discoverers
 * return nothing). It never runs for a manifest repo, so it cannot perturb the
 * six reference gates.
 *
 * It identifies "app root(s)" from PACKAGE manifests (package.json, pyproject/
 * requirements/setup, go.mod, Cargo.toml, pubspec.yaml, Podfile/*.xcodeproj,
 * build.gradle+AndroidManifest, serverless/SAM, *.tf, Gemfile, composer.json).
 * Each app root becomes one `app` service; the caller then reuses the SAME
 * downstream parse/detector/node pipeline to emit the real file/module tree,
 * import edges, and any interactions the existing detectors actually find. It
 * fabricates NO datastores, topics or runtime edges — a pure client-side SPA
 * legitimately yields a service with files/imports and few/no interaction edges.
 */

const IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  'vendor',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  '.gradle',
  'Pods',
  '.dart_tool',
  'DerivedData',
]);

/** Per-service framework/category signals the Phase-3b classifier will read.
 * Derived DETERMINISTICALLY from manifest deps + files. */
export interface FrameworkSignals {
  /** the single most salient framework label for the service card */
  framework?: string;
  /** every framework/library marker matched (react, next, express, …) */
  frameworks: string[];
  /** coarse category buckets (mobile, frontend, backend, cli, library, …) */
  signals: string[];
}

interface AppRoot {
  /** repo-relative dir ('.' for repo root) */
  dir: string;
  /** unique service name */
  name: string;
}

export interface CodeFirstResult {
  discovery: Discovery;
  /** framework signals per service name */
  frameworks: Map<string, FrameworkSignals>;
}

/** Manifest filenames that mark a directory as an app root. */
const ROOT_MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'go.mod',
  'Cargo.toml',
  'pubspec.yaml',
  'Podfile',
  'build.gradle',
  'build.gradle.kts',
  // Maven. Gradle was already here; its sibling was not, so a Maven-only Java
  // repo (the majority of them) had no app root at all and the code-first path
  // returned nothing for it. A pom.xml is a package manifest by exactly the
  // same argument build.gradle is.
  'pom.xml',
  'serverless.yml',
  'serverless.yaml',
  'template.yaml',
  'template.yml',
  'Gemfile',
  'composer.json',
];

/**
 * Manifests that exist but could not be parsed, relative to the repo root.
 *
 * Module-scoped and reset per scan by {@link discoverCodeFirst}, matching how the
 * rest of this file already accumulates per-scan state.
 */
const unparseableManifests: string[] = [];

/**
 * Read a JSON manifest.
 *
 * A malformed manifest used to be swallowed by a bare `catch` and returned as
 * `undefined` — indistinguishable from one that does not exist. That is not a
 * cosmetic difference: a root `package.json` with a single trailing comma made a
 * three-service monorepo scan as ONE service, with byte-identical warnings to the
 * healthy case. The user gets a plausible graph that is quietly wrong, which is the
 * exact failure "grounded, not guessed" and "honest errors" exist to prevent.
 *
 * A missing file is still silent — that is genuinely unremarkable. A file that is
 * PRESENT and unreadable is recorded, so the scan can say so.
 */
function readJson(p: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return undefined; // absent — nothing to report
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    // First line only — V8's JSON errors can carry a multi-line excerpt, and a
    // warning that spans lines is unreadable wherever warnings are rendered.
    const why = /^[^\r\n]*/.exec((e as Error).message)?.[0] ?? 'invalid JSON';
    const entry = `${p} (${why})`;
    // Deduped: discovery reads the same root manifest from several call sites
    // (workspace globs, app-root mapping, framework signals), and the same file
    // reported three times reads as three broken manifests.
    if (!unparseableManifests.includes(entry)) unparseableManifests.push(entry);
    return undefined;
  }
}

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** Does `dir` (absolute) contain any recognized package manifest? */
/**
 * Which package ecosystem a manifest belongs to.
 *
 * Used for one decision only: whether a manifest nested under another root is a
 * SEPARATE application or a package of the same one. A `package.json` under a
 * `package.json` is a workspace member; a `package.json` under a
 * `pyproject.toml` is a user interface in front of a Python service.
 */
const ECOSYSTEM_BY_MANIFEST: Readonly<Record<string, string>> = {
  'package.json': 'js',
  'pyproject.toml': 'py',
  'requirements.txt': 'py',
  'setup.py': 'py',
  'setup.cfg': 'py',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pubspec.yaml': 'dart',
  Podfile: 'apple',
  'build.gradle': 'jvm',
  'build.gradle.kts': 'jvm',
  'pom.xml': 'jvm',
};

/** The ecosystem this directory's manifest declares, or undefined for none. */
function ecosystemOf(dirAbs: string): string | undefined {
  for (const f of ROOT_MANIFEST_FILES) {
    if (fs.existsSync(path.join(dirAbs, f))) return ECOSYSTEM_BY_MANIFEST[f] ?? 'other';
  }
  try {
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (e.name.endsWith('.xcodeproj')) return 'apple';
      if (e.name.endsWith('.tf')) return 'terraform';
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function hasManifest(dirAbs: string): boolean {
  for (const f of ROOT_MANIFEST_FILES) {
    if (fs.existsSync(path.join(dirAbs, f))) return true;
  }
  // *.xcodeproj is a directory
  try {
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (e.name.endsWith('.xcodeproj') || e.name.endsWith('.tf')) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Normalize a package.json `workspaces` field (array or {packages:[]}). */
function workspaceGlobs(pkg: Record<string, unknown> | undefined): string[] {
  if (!pkg) return [];
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) return ws.filter((x): x is string => typeof x === 'string');
  if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
    return (ws as { packages: unknown[] }).packages.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

/** pnpm-workspace.yaml `packages:` list. */
function pnpmWorkspaceGlobs(abs: string): string[] {
  const raw = readText(path.join(abs, 'pnpm-workspace.yaml'));
  if (!raw) return [];
  try {
    const doc = parseYaml(raw) as { packages?: unknown };
    if (Array.isArray(doc?.packages)) {
      return doc.packages.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** Resolve a small subset of workspace globs to member directories (relative).
 * Supports `dir`, `dir/*` and `dir/**` — the shapes real monorepos use. */
function resolveWorkspaceMembers(abs: string, globs: string[]): string[] {
  const members = new Set<string>();
  // Canonical repo root for the containment (jail) check below. `abs` is the
  // already-resolved, existing repo root, so realpathSync cannot throw here.
  const rootReal = fs.realpathSync(abs);
  // Only accept a member whose realpath is contained in the repo root — this is
  // what blocks a `..`-prefixed workspaces glob from escaping the jail.
  const accept = (memberAbs: string): void => {
    if (!withinRoot(rootReal, memberAbs)) return; // escapes the repo — drop it
    if (fs.existsSync(path.join(memberAbs, 'package.json'))) {
      members.add(toRelPosix(path.relative(abs, memberAbs)));
    }
  };
  for (const g of globs) {
    const norm = g.replace(/\/+$/, '');
    if (norm.endsWith('/*') || norm.endsWith('/**')) {
      const base = norm.replace(/\/\*\*?$/, '');
      const baseAbs = path.join(abs, base);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(baseAbs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || IGNORE.has(e.name) || e.name.startsWith('.')) continue;
        accept(path.join(baseAbs, e.name));
      }
    } else {
      accept(path.join(abs, norm));
    }
  }
  return [...members].sort();
}

/** Walk the repo (bounded, IGNORE-aware) collecting dirs that hold a manifest,
 * then reduce to the top-most roots (drop any dir nested under another root). */
/**
 * Walk the repo (bounded, IGNORE-aware) collecting app roots.
 *
 * A ROOT IS CLAIMED BY ITS ECOSYSTEM, AND A DIFFERENT ECOSYSTEM BENEATH IT IS A
 * SEPARATE APPLICATION.
 *
 * This used to stop at the first manifest and return, with a comment saying a
 * root holding sibling app roots was "handled by workspace mode earlier".
 * Workspace mode covers a DECLARED monorepo. It does not cover the commonest
 * shape in the world: a Python or Go service at the root with a JavaScript UI in
 * a subdirectory, declared by nothing at all.
 *
 * MEASURED on ml-harness — `pyproject.toml` at the root, `frontend/package.json`
 * one level down, 60 React files. The walk stopped at the root, the frontend was
 * never seen, and the scan returned ONE service carrying the backend's
 * framework. Worse than a label: an http edge needs a second named service to
 * point at, so the frontend→backend call was unrepresentable and a real two-tier
 * app produced zero http edges AND zero warnings about it.
 *
 * ECOSYSTEM CHANGE, NOT DEPTH, is the rule. Descending past every manifest would
 * turn an undeclared JS monorepo into a service per package — a behaviour change
 * nobody asked for. Carrying the claiming ecosystem down the walk means
 * py-then-js splits and js-then-js does not, which is asserted both ways in
 * `nested-app-roots.test.ts`.
 */
function collectManifestRoots(abs: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (dirAbs: string, depth: number, claimedBy?: string): void => {
    if (depth > maxDepth) return;
    const eco = ecosystemOf(dirAbs);
    if (eco !== undefined && eco !== claimedBy) {
      found.push(toRelPosix(path.relative(abs, dirAbs)) || '.');
      /* Everything below now belongs to THIS ecosystem until another one
       * appears, so a sibling package of the same kind is not a second app. */
      claimedBy = eco;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue;
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dirAbs, e.name), depth + 1, claimedBy);
    }
  };
  walk(abs, 0);
  return found;
}

/** Make service names unique and node-id-safe. */
function uniqueName(raw: string, used: Set<string>): string {
  let base = raw
    .replace(/^@[^/]+\//, '') // strip npm scope
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'app';
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}-${i++}`;
  used.add(name);
  return name;
}

/** Human-ish service name for an app root. */
function nameForRoot(abs: string, dir: string, repoName: string, used: Set<string>): string {
  const dirAbs = path.join(abs, dir);
  const pkg = readJson(path.join(dirAbs, 'package.json'));
  const pkgName = typeof pkg?.name === 'string' ? (pkg.name as string) : undefined;
  const raw = pkgName ?? (dir === '.' ? repoName : path.basename(dir));
  return uniqueName(raw, used);
}

export function discoverCodeFirst(abs: string): CodeFirstResult | undefined {
  unparseableManifests.length = 0; // per-scan state, same as `used` below
  const repoName = path.basename(abs);
  const used = new Set<string>();
  let rootDirs: string[] = [];

  // --- JS/TS workspace (monorepo) mode: one service per member package ---
  const rootPkg = readJson(path.join(abs, 'package.json'));
  const globs = [...workspaceGlobs(rootPkg), ...pnpmWorkspaceGlobs(abs)];
  if (globs.length > 0) {
    const members = resolveWorkspaceMembers(abs, globs);
    if (members.length > 0) rootDirs = members;
  }

  // --- non-workspace: top-most manifest roots (single-package ⇒ one) ---
  if (rootDirs.length === 0) {
    rootDirs = collectManifestRoots(abs);
  }

  if (rootDirs.length === 0) return undefined;

  const appRoots: AppRoot[] = rootDirs
    .sort()
    .map((dir) => ({ dir, name: nameForRoot(abs, dir, repoName, used) }));

  const services: ServiceInfo[] = appRoots.map((r) => ({
    name: r.name,
    dir: r.dir,
    env: {},
    dependsOn: [],
    role: 'app' as const,
  }));

  const frameworks = new Map<string, FrameworkSignals>();
  for (const r of appRoots) {
    frameworks.set(r.name, detectFrameworkSignals(abs, r.dir));
  }

  const discovery: Discovery = {
    composeFile: '',
    services,
    wires: [],
    warnings: [
      `no docker-compose / Kubernetes / Helm manifest found — mapped ${appRoots.length} app root(s) from package manifests (code-first)`,
      // A manifest that is present but unparseable changes the RESULT — workspace
      // globs, names and app roots all come from these files — so it has to be said
      // out loud rather than degraded into silence.
      ...unparseableManifests.map(
        (m) => `manifest could not be parsed and was ignored: ${path.relative(abs, m) || m}`,
      ),
    ],
    manifestKind: 'code',
  };

  return { discovery, frameworks };
}

/* ============================================ framework / category signals == */

/** Collect a lowercased set of dependency tokens declared in an app root's
 * manifests, plus flags for marker files. Best-effort + deterministic. */
function collectDeps(dirAbs: string): {
  deps: Set<string>;
  flags: Set<string>;
  binish: boolean;
  publishedLib: boolean;
} {
  const deps = new Set<string>();
  const flags = new Set<string>();
  let binish = false;
  let publishedLib = false;

  // package.json
  const pkg = readJson(path.join(dirAbs, 'package.json'));
  if (pkg) {
    flags.add('js');
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const d = pkg[field];
      if (d && typeof d === 'object') for (const k of Object.keys(d)) deps.add(k.toLowerCase());
    }
    if (pkg.bin) binish = true;
    // a published library: has a main/exports entry, is not private, and
    // declares no app framework (checked later against `deps`).
    const notPrivate = pkg.private !== true;
    if (notPrivate && (pkg.main || pkg.module || pkg.exports) && !pkg.bin) publishedLib = true;
  }

  // requirements.txt
  const reqs = readText(path.join(dirAbs, 'requirements.txt'));
  if (reqs) {
    flags.add('py');
    for (const line of reqs.split('\n')) {
      const m = line.trim().match(/^([A-Za-z0-9._-]+)/);
      if (m && !line.trim().startsWith('#')) deps.add(m[1].toLowerCase());
    }
  }
  // pyproject.toml / setup.py / setup.cfg (regex — no TOML dep)
  const pyproject = readText(path.join(dirAbs, 'pyproject.toml'));
  if (pyproject) {
    flags.add('py');
    for (const m of pyproject.matchAll(/["']([A-Za-z0-9._-]+)\s*(?:[<>=!~ )]|["'])/g)) {
      deps.add(m[1].toLowerCase());
    }
    if (/\[project\.scripts\]|\[tool\.poetry\.scripts\]|console_scripts/.test(pyproject)) binish = true;
  }
  if (fs.existsSync(path.join(dirAbs, 'setup.py')) || fs.existsSync(path.join(dirAbs, 'setup.cfg'))) {
    flags.add('py');
  }

  // go.mod
  const gomod = readText(path.join(dirAbs, 'go.mod'));
  if (gomod) {
    flags.add('go');
    for (const m of gomod.matchAll(/^\s*([\w.\-/]+)\s+v\d/gm)) deps.add(m[1].toLowerCase());
  }

  // Cargo.toml
  const cargo = readText(path.join(dirAbs, 'Cargo.toml'));
  if (cargo) {
    flags.add('rust');
    const depSection = cargo.split(/\[dependencies\]/)[1];
    if (depSection) {
      for (const m of depSection.matchAll(/^\s*([A-Za-z0-9._-]+)\s*=/gm)) deps.add(m[1].toLowerCase());
    }
    if (fs.existsSync(path.join(dirAbs, 'src', 'main.rs'))) binish = true;
  }

  // pubspec.yaml (Flutter/Dart)
  const pubspec = readText(path.join(dirAbs, 'pubspec.yaml'));
  if (pubspec) {
    flags.add('dart');
    if (/(^|\n)\s*flutter\s*:/.test(pubspec) || /\bflutter\b/.test(pubspec)) flags.add('flutter');
  }

  // iOS: Podfile or *.xcodeproj
  if (fs.existsSync(path.join(dirAbs, 'Podfile'))) flags.add('ios');
  try {
    for (const e of fs.readdirSync(dirAbs)) {
      if (e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace')) flags.add('ios');
    }
  } catch {
    /* ignore */
  }

  // Android: build.gradle(.kts) + AndroidManifest.xml (anywhere under the root)
  const hasGradle =
    fs.existsSync(path.join(dirAbs, 'build.gradle')) ||
    fs.existsSync(path.join(dirAbs, 'build.gradle.kts')) ||
    fs.existsSync(path.join(dirAbs, 'settings.gradle')) ||
    fs.existsSync(path.join(dirAbs, 'settings.gradle.kts'));
  if (hasGradle) {
    flags.add('gradle');
    if (findFile(dirAbs, 'AndroidManifest.xml', 4)) flags.add('android');
  }

  // serverless / SAM
  if (
    fs.existsSync(path.join(dirAbs, 'serverless.yml')) ||
    fs.existsSync(path.join(dirAbs, 'serverless.yaml'))
  ) {
    flags.add('serverless');
  }
  for (const t of ['template.yaml', 'template.yml']) {
    const raw = readText(path.join(dirAbs, t));
    if (raw && /AWS::Serverless/.test(raw)) flags.add('serverless');
  }

  // terraform / infra
  try {
    for (const e of fs.readdirSync(dirAbs)) if (e.endsWith('.tf')) flags.add('terraform');
  } catch {
    /* ignore */
  }

  // pipeline markers
  if (fs.existsSync(path.join(dirAbs, 'dbt_project.yml'))) flags.add('dbt');
  if (fs.existsSync(path.join(dirAbs, 'dags')) || deps.has('apache-airflow')) flags.add('airflow');

  // Ruby / PHP
  if (fs.existsSync(path.join(dirAbs, 'Gemfile'))) {
    flags.add('ruby');
    const gem = readText(path.join(dirAbs, 'Gemfile')) ?? '';
    if (/\brails\b/.test(gem)) flags.add('rails');
  }
  const composer = readJson(path.join(dirAbs, 'composer.json'));
  if (composer) {
    flags.add('php');
    const cdeps = composer.require && typeof composer.require === 'object' ? Object.keys(composer.require) : [];
    if (cdeps.some((d) => /laravel/.test(d))) flags.add('laravel');
  }

  return { deps, flags, binish, publishedLib };
}

/** shallow bounded search for a marker file. */
function findFile(dirAbs: string, name: string, maxDepth: number): boolean {
  const walk = (d: string, depth: number): boolean => {
    if (depth > maxDepth) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === name) return true;
    }
    for (const e of entries) {
      if (e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.')) {
        if (walk(path.join(d, e.name), depth + 1)) return true;
      }
    }
    return false;
  };
  return walk(dirAbs, 0);
}

/**
 * Deterministically derive the framework label + category signals for one app
 * root. Precedence (first match wins for the single `framework` label):
 *   mobile-native → web meta-framework → frontend lib → backend → serverless
 *   → pipeline → ml → cli → library → language default.
 * `frameworks` lists every marker matched; `signals` lists coarse buckets the
 * classifier consumes.
 */
export function detectFrameworkSignals(abs: string, dir: string): FrameworkSignals {
  const dirAbs = path.join(abs, dir);
  const { deps, flags, binish, publishedLib } = collectDeps(dirAbs);
  const has = (t: string): boolean => deps.has(t);
  const hasAny = (...t: string[]): boolean => t.some((x) => deps.has(x));

  const frameworks: string[] = [];
  const signals: string[] = [];
  const add = (fw: string) => {
    if (!frameworks.includes(fw)) frameworks.push(fw);
  };
  const sig = (s: string) => {
    if (!signals.includes(s)) signals.push(s);
  };

  // --- language signals ---
  for (const l of ['js', 'py', 'go', 'rust', 'dart', 'php', 'ruby']) if (flags.has(l)) sig(l);

  // --- mobile-native (highest precedence) ---
  const isReactNative = hasAny('react-native', 'expo');
  const isFlutter = flags.has('flutter');
  const isIos = flags.has('ios');
  const isAndroid = flags.has('android');
  if (isReactNative) add('react-native');
  if (isFlutter) add('flutter');
  if (isIos) add('ios');
  if (isAndroid) add('android');

  // --- web meta-frameworks & frontend libs ---
  const isNext = has('next');
  const isNuxt = has('nuxt');
  const isRemix = hasAny('@remix-run/react', '@remix-run/node');
  const isAngular = has('@angular/core');
  const isReact = hasAny('react', 'react-dom') && !isReactNative;
  const isVue = has('vue');
  const isSvelte = hasAny('svelte', '@sveltejs/kit');
  const isSolid = has('solid-js');
  if (isNext) add('next.js');
  if (isNuxt) add('nuxt');
  if (isRemix) add('remix');
  if (isAngular) add('angular');
  if (isReact) add('react');
  if (isVue) add('vue');
  if (isSvelte) add('svelte');
  if (isSolid) add('solid');

  // --- backend web frameworks ---
  const isExpress = has('express');
  const isFastify = has('fastify');
  const isNest = has('@nestjs/core');
  const isKoa = has('koa');
  const isFastapi = has('fastapi');
  const isFlask = has('flask');
  const isDjango = hasAny('django', 'django-rest-framework', 'djangorestframework');
  const isRails = flags.has('rails');
  const isLaravel = flags.has('laravel');
  const isGoWeb = hasAny('github.com/gin-gonic/gin', 'github.com/labstack/echo/v4', 'github.com/gofiber/fiber/v2');
  for (const [cond, name] of [
    [isExpress, 'express'],
    [isFastify, 'fastify'],
    [isNest, 'nestjs'],
    [isKoa, 'koa'],
    [isFastapi, 'fastapi'],
    [isFlask, 'flask'],
    [isDjango, 'django'],
    [isRails, 'rails'],
    [isLaravel, 'laravel'],
    [isGoWeb, 'go-web'],
  ] as [boolean, string][]) {
    if (cond) add(name);
  }

  // --- serverless / pipeline / ml / infra ---
  const isServerless = flags.has('serverless');
  const isPipeline = flags.has('airflow') || flags.has('dbt') || hasAny('apache-airflow', 'dbt-core');
  const isMl = hasAny('torch', 'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'sklearn', 'jax');
  const isInfra = flags.has('terraform');
  if (isServerless) add('serverless');
  if (flags.has('airflow') || has('apache-airflow')) add('airflow');
  if (flags.has('dbt') || has('dbt-core')) add('dbt');
  if (has('torch') || has('pytorch')) add('pytorch');
  if (has('tensorflow') || has('keras')) add('tensorflow');
  if (hasAny('scikit-learn', 'sklearn')) add('scikit-learn');
  if (isInfra) add('terraform');

  // --- category signals (buckets the classifier reads) ---
  if (isReactNative || isFlutter || isIos || isAndroid) sig('mobile');
  if (isNext || isNuxt || isRemix || isAngular || isReact || isVue || isSvelte || isSolid) sig('frontend');
  if (isNext || isNuxt || isRemix) sig('ssr');
  if (isExpress || isFastify || isNest || isKoa || isFastapi || isFlask || isDjango || isRails || isLaravel || isGoWeb)
    sig('backend');
  if (isServerless) sig('serverless');
  if (isPipeline) sig('pipeline');
  if (isMl) sig('ml');
  if (isInfra) sig('infra');

  // --- cli / library (lowest precedence, only when no app framework) ---
  const hasAppFramework = frameworks.length > 0;
  if (binish && !isReactNative && !isFlutter) {
    add('cli');
    sig('cli');
  }
  if (!hasAppFramework && publishedLib && !binish) {
    add('library');
    sig('library');
  }

  // --- single most-salient framework label (precedence order) ---
  const framework =
    (isReactNative && 'react-native') ||
    (isFlutter && 'flutter') ||
    (isIos && 'ios') ||
    (isAndroid && 'android') ||
    (isNext && 'next.js') ||
    (isNuxt && 'nuxt') ||
    (isRemix && 'remix') ||
    (isAngular && 'angular') ||
    (isReact && 'react') ||
    (isVue && 'vue') ||
    (isSvelte && 'svelte') ||
    (isSolid && 'solid') ||
    (isExpress && 'express') ||
    (isFastify && 'fastify') ||
    (isNest && 'nestjs') ||
    (isKoa && 'koa') ||
    (isFastapi && 'fastapi') ||
    (isFlask && 'flask') ||
    (isDjango && 'django') ||
    (isRails && 'rails') ||
    (isLaravel && 'laravel') ||
    (isGoWeb && 'go-web') ||
    (isServerless && 'serverless') ||
    ((flags.has('airflow') || has('apache-airflow')) && 'airflow') ||
    ((flags.has('dbt') || has('dbt-core')) && 'dbt') ||
    (isMl && (has('tensorflow') ? 'tensorflow' : has('scikit-learn') || has('sklearn') ? 'scikit-learn' : 'pytorch')) ||
    (isInfra && 'terraform') ||
    (binish && 'cli') ||
    (publishedLib && 'library') ||
    undefined;

  return { framework: framework || undefined, frameworks, signals };
}

/**
 * App roots that a compose Discovery does NOT already cover.
 *
 * Used only when a compose service declared `build.context: .` (see
 * `Discovery.rootContextNarrowed`) — the compose file's own admission that the
 * repo is bigger than the services it deploys. A monorepo typically ships only
 * its API and workers through compose while the marketing site, admin console
 * and product front-ends are deployed elsewhere entirely; without this they are
 * absent from the graph, and the board shows a picture of the system with most
 * of it missing.
 *
 * Grounded: every returned root has a real package manifest of its own. Roots
 * already covered by a compose service are skipped, so nothing is duplicated,
 * and a root that merely CONTAINS a compose service dir is skipped too (it is
 * the parent, not a peer). Names are de-duplicated against the compose service
 * names so no id can collide.
 */
export function uncoveredAppRoots(
  abs: string,
  discovery: Pick<Discovery, 'services'>,
): { services: ServiceInfo[]; frameworks: Map<string, FrameworkSignals> } {
  const empty = { services: [] as ServiceInfo[], frameworks: new Map<string, FrameworkSignals>() };
  const cf = discoverCodeFirst(abs);
  if (!cf) return empty;

  /* Separator-proof on purpose: compose dirs are POSIX by construction and
     code-first dirs are POSIX at birth (relPosix), but ONE backslashed dir
     slipping through here made the cover check miss, the same package tree was
     walked under two services, and validateGraph refused the whole scan on
     duplicate file: ids — measured on hoppscotch, 2026-08-28. */
  const norm = (d: string) => d.replace(/\\/g, '/').replace(/\/+$/, '') || '.';
  const covered = new Set(
    discovery.services.filter((s) => s.dir).map((s) => norm(s.dir as string)),
  );
  const used = new Set(discovery.services.map((s) => s.name));

  const services: ServiceInfo[] = [];
  const frameworks = new Map<string, FrameworkSignals>();
  for (const svc of cf.discovery.services) {
    const dir = norm(svc.dir ?? '.');
    if (covered.has(dir)) continue;
    // The repo root (or any ancestor of a compose service) is a container, not a
    // peer app — adopting it would re-create the very swallowing this fixes.
    if (dir === '.' || [...covered].some((c) => c !== '.' && c.startsWith(dir + '/'))) continue;
    const name = uniqueName(svc.name, used);
    services.push({ ...svc, name });
    const signals = cf.frameworks.get(svc.name);
    if (signals) frameworks.set(name, signals);
  }
  return { services, frameworks };
}
