import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Discovery, ServiceInfo, ServiceRole, Wire } from '../types.js';
import { classify, inferSourceDir, parseWireValue } from './shared.js';

export { classify, inferSourceDir, parseWireValue } from './shared.js';

const COMPOSE_NAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

export function findComposeFile(repoRoot: string): string | undefined {
  for (const name of COMPOSE_NAMES) {
    const p = path.join(repoRoot, name);
    if (fs.existsSync(p)) return p;
  }
  // one level of subdirectories (common: deploy/, docker/)
  for (const sub of ['deploy', 'docker', 'infra', '.docker']) {
    for (const name of COMPOSE_NAMES) {
      const p = path.join(repoRoot, sub, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

/** Substitute ${VAR} / ${VAR:-default} / $VAR from a .env map. */
function substEnv(value: string, dotenv: Record<string, string>): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_m, braced, def, bare) => {
      const key = braced ?? bare;
      return dotenv[key] ?? def ?? '';
    }
  );
}

function loadDotenv(dir: string): Record<string, string> {
  const p = path.join(dir, '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Directories a `command:` token may name that are never a service's SOURCE root.
 * `serve dist` / `nginx public` would otherwise root a service at its own build
 * output — a directory that exists, but holds no code to attribute anything to.
 */
const NON_SOURCE_DIRS = new Set([
  'dist',
  'build',
  'out',
  'public',
  'static',
  'assets',
  'node_modules',
  'venv',
  '.venv',
  'target',
  'bin',
  'tmp',
  'logs',
]);

/**
 * Which piece of evidence a narrowing came from. Reported in the warning so the
 * user can check the claim — the four sources are not equally strong, and
 * "narrowed to backend" alone says nothing about whether that was the compose
 * file's own statement or a name that happened to match a folder.
 */
type NarrowWhy =
  | 'its Dockerfile path'
  | 'its own command'
  | 'the root Dockerfile COPY'
  | 'its service name';

/**
 * A `build.context: .` service is the whole repo — narrow it to its real source dir.
 *
 * A monorepo commonly builds its API from the repo root so the image can COPY
 * shared packages. The context is a BUILD concern, not an architectural one:
 * taken literally it made the scanner ingest every directory in the repo into
 * that ONE service. On a real 12-app monorepo that produced two services — both
 * rooted at `.` — with every sibling app (marketing site, learning platform,
 * admin console, CRM, forms) demoted to a `module` of each, and the same files
 * attributed to both. The board then had nothing real to draw, the Task Board
 * had nothing to import, and the Process rail had one bucket for the system.
 *
 * Four evidence sources, tried in order of how specific each one is to THIS
 * service. Ordering is the whole design, not an implementation detail: a
 * `dockerfile:` key and a `command:` are written per service, while a root
 * Dockerfile is read by every service that builds from `.`, and a name match is
 * a coincidence until something corroborates it. Reading the shared file before
 * the specific ones resolves every service to the same directory — the exact
 * mis-attribution this function exists to prevent.
 *
 * Returns undefined — leaving behaviour byte-identical — unless the context
 * really is the repo root AND some source names a directory that exists. A
 * service with its own context directory is never touched, so ordinary compose
 * repos are unaffected.
 */
function narrowRootContext(
  repoRoot: string,
  dir: string,
  dockerfileRel: string | undefined,
  serviceName?: string,
  command?: string,
): { dir: string; dockerfileRel: string; why: NarrowWhy } | undefined {
  if (dir !== '.') return undefined;
  /** Copied dirs we could not choose between — reported by the caller. */
  let ambiguous: string[] | undefined;
  const isDir = (rel: string): boolean => {
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    try {
      return fs.statSync(path.join(repoRoot, rel)).isDirectory();
    } catch {
      return false;
    }
  };

  // 1. The `dockerfile:` key names a subdirectory — the clearest statement.
  if (dockerfileRel) {
    const norm = path.normalize(dockerfileRel).split(path.sep).join('/');
    const slash = norm.lastIndexOf('/');
    if (slash > 0 && isDir(norm.slice(0, slash))) {
      return {
        dir: norm.slice(0, slash),
        dockerfileRel: norm.slice(slash + 1),
        why: 'its Dockerfile path',
      };
    }
  }

  // 2. The service's own `command:` names a module path (`arq books_worker.worker…`).
  //
  //    PRECEDENCE, deliberately above the root Dockerfile below: a `command:` is
  //    written per service, whereas a root Dockerfile is SHARED by every service
  //    that builds from `.`. Reading the shared file first made every one of them
  //    resolve to the same directory — a two-service compose where `api` and
  //    `arq_worker` both `build: .` off one Dockerfile collapsed the worker into
  //    the API's own source root, which is exactly the mis-attribution this whole
  //    function exists to prevent. Specific evidence beats shared evidence.
  if (command) {
    const token = command
      .split(/\s+/)
      .map((t) => t.split(/[.:]/)[0].replace(/^\.\//, ''))
      .find((t) => isDir(t) && !NON_SOURCE_DIRS.has(t.toLowerCase()));
    if (token) {
      return { dir: token, dockerfileRel: dockerfileRel ?? 'Dockerfile', why: 'its own command' };
    }
  }

  // 3. The root Dockerfile's own `COPY <src> …`. This is the COMMON form — plain
  //    `build: .` with a root Dockerfile and no `dockerfile:` key — which names
  //    no subpath at all and so slipped past the r81 check entirely, leaving the
  //    service rooted at the whole repo on a real 12-app monorepo.
  const dfPath = path.join(repoRoot, dockerfileRel ?? 'Dockerfile');
  try {
    const df = fs.readFileSync(dfPath, 'utf8');
    const copied = new Set<string>();
    let runLine = '';
    for (const line of df.split('\n')) {
      const m = line.match(/^\s*COPY\s+(?:--\S+\s+)*(\S+)\s+\S+\s*$/i);
      if (m) {
        const src = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
        if (isDir(src)) copied.add(src);
        continue;
      }
      // The image's own entry point names the app it runs. Captured for the
      // several-directories case below.
      const r = line.match(/^\s*(?:CMD|ENTRYPOINT)\s+(.*)$/i);
      if (r) runLine += ` ${r[1].replace(/[[\]",]/g, ' ')}`;
    }

    // Exactly one copied directory is unambiguous.
    if (copied.size === 1) {
      return { dir: [...copied][0], dockerfileRel: 'Dockerfile', why: 'the root Dockerfile COPY' };
    }

    // SEVERAL copied directories — the image ships an app plus its shared
    // libraries, which is the exact shape of the repo that reported this. The
    // old code gave up here and left the service rooted at the whole repository,
    // so one card swallowed every sibling app. It does not have to give up: the
    // Dockerfile's own CMD/ENTRYPOINT names which of them it actually RUNS, and
    // that is a statement by the same file, about this same image.
    if (copied.size > 1 && runLine.trim()) {
      const named = runLine
        .split(/\s+/)
        .map((t) => t.split(/[.:/]/)[0].replace(/^\.\//, ''))
        .filter((t) => copied.has(t) && !NON_SOURCE_DIRS.has(t.toLowerCase()));
      if (named.length > 0) {
        return {
          dir: named[0],
          dockerfileRel: 'Dockerfile',
          why: 'the root Dockerfile COPY',
        };
      }
    }

    // Still ambiguous. Record WHY, so a repo that keeps showing one mega-service
    // says so out loud instead of looking like a scanner that simply cannot read
    // it. Silence here is what made this take three rounds to find.
    if (copied.size > 1) {
      ambiguous = [...copied].sort();
    }
  } catch {
    /* no root Dockerfile — fall through */
  }

  // 4. Last resort: the service's own NAME matches a directory.
  if (serviceName && isDir(serviceName)) {
    return { dir: serviceName, dockerfileRel: dockerfileRel ?? 'Dockerfile', why: 'its service name' };
  }
  if (ambiguous) lastAmbiguity = ambiguous;
  return undefined;
}

/**
 * The candidates the last {@link narrowRootContext} call could not choose
 * between, so the caller can say so in a warning. Module-scoped rather than
 * returned because the function's `undefined` return means "changed nothing",
 * and widening that contract for a diagnostic would complicate every call site.
 * Read-and-clear: a stale value must never be attributed to a later service.
 */
let lastAmbiguity: string[] | undefined;
function takeAmbiguity(): string[] | undefined {
  const v = lastAmbiguity;
  lastAmbiguity = undefined;
  return v;
}

/** For built services, the Dockerfile FROM line reveals datastore/broker base images
 * (e.g. robot-shop builds its own mongo image with seed data). */
function classifyBuildDir(
  repoRoot: string,
  dir: string,
  dockerfile?: string
): { role: ServiceRole; tech?: string } {
  const df = path.join(repoRoot, dir, dockerfile ?? 'Dockerfile');
  if (!fs.existsSync(df)) return { role: 'app' };
  try {
    const first = fs
      .readFileSync(df, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^from\s/i.test(l));
    if (!first) return { role: 'app' };
    const image = first.replace(/^from\s+/i, '').split(/\s+/)[0];
    return classify(image);
  } catch {
    return { role: 'app' };
  }
}

/** Tolerant Dockerfile `ENV` parser — handles the single-pair legacy form
 * (`ENV KEY value`), the modern `KEY=value` form, multiple pairs on one `ENV`
 * line, and backslash line continuations (`ENV A=1 \\\n    B=2`). Used to fill
 * env vars a service's Dockerfile bakes in but compose never overrides —
 * e.g. robot-shop's web service nginx conf reads `${CATALOGUE_HOST}` etc.,
 * which the Dockerfile sets via `ENV CATALOGUE_HOST=catalogue ...` and compose
 * leaves entirely unset; robot-shop's Java `shipping` service similarly sets
 * `ENV DB_HOST=mysql` with no compose override. This runs independent of the
 * service's own source language — the Dockerfile is a manifest, not code. */
function parseDockerfileEnv(dockerfilePath: string): { key: string; value: string; line: number }[] {
  let raw: string;
  try {
    raw = fs.readFileSync(dockerfilePath, 'utf8');
  } catch {
    return [];
  }
  const rawLines = raw.split('\n');
  const out: { key: string; value: string; line: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (!/^\s*ENV\s+/i.test(rawLines[i])) continue;
    const startLine = i + 1;
    let combined = rawLines[i].replace(/^\s*ENV\s+/i, '').replace(/\\\s*$/, ' ');
    while (/\\\s*$/.test(rawLines[i]) && i + 1 < rawLines.length) {
      i++;
      combined += ' ' + rawLines[i].replace(/\\\s*$/, ' ');
    }
    combined = combined.trim();
    if (!combined) continue;
    if (combined.includes('=')) {
      const tokenRe = /([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(combined))) {
        out.push({ key: m[1], value: m[2].replace(/^["']|["']$/g, ''), line: startLine });
      }
    } else {
      const m = combined.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/);
      if (m) out.push({ key: m[1], value: m[2].trim().replace(/^["']|["']$/g, ''), line: startLine });
    }
  }
  return out;
}

function envToMap(env: unknown, dotenv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(env)) {
    for (const item of env) {
      if (typeof item !== 'string') continue;
      const i = item.indexOf('=');
      if (i > 0) out[item.slice(0, i)] = substEnv(item.slice(i + 1), dotenv);
    }
  } else if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = substEnv(String(v), dotenv);
    }
  }
  return out;
}

function dependsOnList(d: unknown): string[] {
  if (Array.isArray(d)) return d.map(String);
  if (d && typeof d === 'object') return Object.keys(d);
  return [];
}

export function discover(repoRoot: string): Discovery {
  const warnings: string[] = [];
  const composeFile = findComposeFile(repoRoot);
  if (!composeFile) {
    throw new Error(
      `No docker-compose file found in ${repoRoot} (looked for ${COMPOSE_NAMES.join(', ')} at root and in deploy/, docker/, infra/). ` +
        'Call discoverKubernetes() for Kubernetes/Helm-based repos — see scan.ts.'
    );
  }
  const dotenv = loadDotenv(path.dirname(composeFile));
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(composeFile, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${composeFile}: ${(e as Error).message}`);
  }
  const servicesRaw = (doc as { services?: Record<string, unknown> })?.services;
  if (!servicesRaw || typeof servicesRaw !== 'object') {
    throw new Error(`${composeFile} has no services: section`);
  }

  // Dockerfile-declared ENV defaults, per service, for env keys the compose
  // `environment:` block never sets — lowest precedence, and only used when
  // the wire-building pass below finds a real target service in the value.
  // Recorded here so the wire can cite the Dockerfile line as evidence
  // instead of falling back to the (wrong, since there's no compose env key)
  // composeFile line lookup.
  const dockerfileEnvSource = new Map<string, Map<string, { file: string; line: number }>>();

  const services: ServiceInfo[] = [];
  let rootContextNarrowed = false;
  for (const [name, rawUnknown] of Object.entries(servicesRaw)) {
    const raw = (rawUnknown ?? {}) as Record<string, unknown>;
    const image = typeof raw.image === 'string' ? raw.image : undefined;
    const build = raw.build;
    let dir: string | undefined;
    if (typeof build === 'string') dir = build;
    else if (build && typeof build === 'object') {
      const ctx = (build as Record<string, unknown>).context;
      if (typeof ctx === 'string') dir = ctx;
    }
    if (dir) {
      const norm = path.normalize(dir).replace(/^\.\//, '');
      const abs = path.resolve(path.dirname(composeFile), norm);
      const rel = path.relative(repoRoot, abs);
      if (rel.startsWith('..')) {
        warnings.push(`service ${name}: build context ${dir} is outside the repo — treating as image-only`);
        dir = undefined;
      } else {
        dir = rel === '' ? '.' : rel;
        if (!fs.existsSync(abs)) {
          warnings.push(`service ${name}: build context ${dir} does not exist`);
          dir = undefined;
        }
      }
    }
    let role: ServiceRole;
    let tech: string | undefined;
    let dockerfileRel: string | undefined;
    if (dir) {
      dockerfileRel =
        build && typeof build === 'object'
          ? ((build as Record<string, unknown>).dockerfile as string | undefined)
          : undefined;
      const rawCommand =
        typeof raw.command === 'string'
          ? raw.command
          : Array.isArray(raw.command)
            ? raw.command.map(String).join(' ')
            : undefined;
      const narrowed = narrowRootContext(repoRoot, dir, dockerfileRel, name, rawCommand);
      const ambiguity = takeAmbiguity();
      if (!narrowed && ambiguity) {
        warnings.push(
          `service ${name}: build context is the repo root and its Dockerfile copies ` +
            `${ambiguity.length} directories (${ambiguity.join(', ')}) with no CMD naming one — ` +
            `left at the repo root, so this service may look larger than it is`,
        );
      }
      if (narrowed) {
        rootContextNarrowed = true;
        warnings.push(
          `service ${name}: build context is the repo root — narrowed to ${narrowed.dir} from ${narrowed.why}`,
        );
        dir = narrowed.dir;
        dockerfileRel = narrowed.dockerfileRel;
      }
      ({ role, tech } = classifyBuildDir(repoRoot, dir, dockerfileRel));
      if (role !== 'app') dir = undefined; // built datastore image — nothing to parse
    } else {
      ({ role, tech } = classify(image));
      if (role === 'app') {
        // image-only app service: try to find its source in the monorepo
        const inferred = inferSourceDir(repoRoot, name);
        if (inferred) {
          dir = inferred;
          warnings.push(`service ${name}: no build context — inferred source dir ${inferred}`);
        }
      }
    }

    const composeEnv = envToMap(raw.environment, dotenv);
    let env = composeEnv;
    // Dockerfile ENV is a first-class, language-independent manifest source
    // (v3): a build-context Dockerfile's `ENV` defaults are merged into every
    // app service's env map, not just nginx-conf-bearing ones. This is the
    // same class of fact as a compose `environment:` entry — infra wiring
    // baked into the image at build time, analogous to a code-level
    // `process.env.X || 'default'` — and applies regardless of which language
    // the service's own source code is written in (v2 gated this to services
    // with an nginx conf, e.g. robot-shop's `web`, to keep language-scoped
    // scoring clean while only Go/JS/TS/Python were parsed; that gate has been
    // removed now that Dockerfile ENV wiring is scored the same way compose
    // env wiring is — see docs/ground-truth/robot-shop.json and
    // docs/SPIKE_RESULTS.md v3 P1).
    if (dir && role === 'app') {
      const dfPath = path.join(repoRoot, dir, dockerfileRel ?? 'Dockerfile');
      const dfEntries = parseDockerfileEnv(dfPath);
      if (dfEntries.length > 0) {
        const merged: Record<string, string> = {};
        const sourceMap = new Map<string, { file: string; line: number }>();
        const dfRel = path.relative(repoRoot, dfPath);
        for (const e of dfEntries) {
          if (!(e.key in composeEnv)) {
            merged[e.key] = e.value;
            sourceMap.set(e.key, { file: dfRel, line: e.line });
          }
        }
        Object.assign(merged, composeEnv); // compose env wins on conflict
        env = merged;
        if (sourceMap.size > 0) dockerfileEnvSource.set(name, sourceMap);
      }
    }

    services.push({
      name,
      dir,
      image,
      env,
      dependsOn: dependsOnList(raw.depends_on),
      role,
      tech,
    });
  }

  const names = new Set(services.map((s) => s.name));
  const composeLines = fs.readFileSync(composeFile, 'utf8').split('\n');
  const lineOfEnvKey = (key: string): number | undefined => {
    const i = composeLines.findIndex((l) => new RegExp(`^\\s+(- )?${key}[:=]`).test(l));
    return i >= 0 ? i + 1 : undefined;
  };
  const wires: Wire[] = [];
  for (const s of services) {
    const dfSource = dockerfileEnvSource.get(s.name);
    for (const [envKey, value] of Object.entries(s.env)) {
      const hit = parseWireValue(value, names);
      if (hit && hit.targetService !== s.name) {
        const dfEntry = dfSource?.get(envKey);
        wires.push({
          service: s.name,
          envKey,
          value,
          ...hit,
          composeLine: dfEntry ? dfEntry.line : lineOfEnvKey(envKey),
          sourceFile: dfEntry?.file,
        });
      }
    }
  }

  const appCount = services.filter((s) => s.role === 'app' && s.dir).length;
  if (appCount === 0) {
    warnings.push('no buildable app services found in compose file — nothing to analyze');
  }
  return {
    composeFile: path.relative(repoRoot, composeFile),
    services,
    wires,
    warnings,
    manifestKind: 'compose',
    rootContextNarrowed,
  };
}
