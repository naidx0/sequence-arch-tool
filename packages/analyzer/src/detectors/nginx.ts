import fs from 'node:fs';
import path from 'node:path';
import { toRelPosix } from '../relPosix.js';
import type { ClientCallFact, Part, ServiceInfo } from '../types.js';

/** Same ignore set as scan.ts's file walker — kept local to avoid a cross-module
 * coupling for one constant. */
import { IGNORE_DIRS } from '../ignoreDirs.js';

function isNginxConfFile(name: string): boolean {
  return (
    /\.conf$/i.test(name) ||
    /\.conf\.tpl$/i.test(name) ||
    /\.conf\.template$/i.test(name) ||
    name === 'nginx.conf'
  );
}

function* walkConfFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) yield* walkConfFiles(full);
    } else if (e.isFile() && isNginxConfFile(e.name)) {
      yield full;
    }
  }
}

type FrameKind = 'upstream' | 'location' | 'server' | 'other';
interface Frame {
  kind: FrameKind;
  name?: string; // upstream name
  path?: string; // location path
}

interface ProxyDirective {
  locationPath: string;
  target: string;
  line: number;
}

interface ParsedConf {
  upstreams: Map<string, string>; // upstream name -> first server host:port
  proxies: ProxyDirective[];
}

/** Small tolerant block parser: no full nginx grammar, just brace-depth tracking
 * with a stack of block kinds so we know, at any `proxy_pass`, which location
 * (or bare server block) it lives in, and — for upstream blocks — the name of
 * the upstream whose `server` line we're reading. */
function parseNginxConf(text: string): ParsedConf {
  const upstreams = new Map<string, string>();
  const proxies: ProxyDirective[] = [];
  const stack: Frame[] = [];
  const lines = text.split('\n');

  const currentLocationPath = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === 'location') return stack[i].path;
      if (stack[i].kind === 'server') return '/';
    }
    return undefined;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/#.*$/, '').trim();
    if (!line) continue;

    const upstreamOpen = line.match(/^upstream\s+(\S+)\s*\{/);
    if (upstreamOpen) {
      stack.push({ kind: 'upstream', name: upstreamOpen[1] });
      continue;
    }
    const locationOpen = line.match(/^location\s*(?:=|~\*|~|\^~)?\s*([^{]+?)\s*\{/);
    if (locationOpen) {
      stack.push({ kind: 'location', path: locationOpen[1].trim() });
      continue;
    }
    if (/^server\s*\{/.test(line)) {
      stack.push({ kind: 'server' });
      continue;
    }
    // `server <host:port>;` — only meaningful directly inside an upstream block.
    const upstreamServer = line.match(/^server\s+([^\s;]+)/);
    if (upstreamServer && stack.length > 0 && stack[stack.length - 1].kind === 'upstream') {
      const name = stack[stack.length - 1].name!;
      if (!upstreams.has(name)) upstreams.set(name, upstreamServer[1]);
      continue;
    }
    const proxyPass = line.match(/^proxy_pass\s+([^;]+);/);
    if (proxyPass) {
      const locPath = currentLocationPath();
      if (locPath !== undefined) {
        proxies.push({ locationPath: locPath, target: proxyPass[1].trim(), line: idx + 1 });
      }
      continue;
    }
    // Any other block opener (http {, events {, if (...) {, types {, ...) — track
    // depth so we don't lose our place, but it carries no meaning of its own.
    if (line.endsWith('{')) {
      stack.push({ kind: 'other' });
      continue;
    }
    if (line.startsWith('}')) {
      stack.pop();
      continue;
    }
  }
  return { upstreams, proxies };
}

/** Split a proxy_pass target into URL Parts. Handles:
 *  - a literal host: `http://catalogue:8080`
 *  - envsubst/nginx-var style hosts: `http://${CATALOGUE_HOST}:8080`, `http://$CATALOGUE_HOST`
 *  - a bare upstream name: `http://backend` where `upstream backend { server X; }` */
function partsFromProxyTarget(target: string, upstreams: Map<string, string>): Part[] {
  const bareUpstream = target.match(/^(https?:\/\/)([A-Za-z0-9_.-]+)(\/.*)?$/);
  if (bareUpstream) {
    const [, scheme, name, rest] = bareUpstream;
    const upstreamHost = upstreams.get(name);
    if (upstreamHost) {
      return [{ t: 'lit', v: `${scheme}${upstreamHost}${rest ?? ''}` }];
    }
  }

  const parts: Part[] = [];
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(target))) {
    if (m.index > last) parts.push({ t: 'lit', v: target.slice(last, m.index) });
    parts.push({ t: 'env', name: (m[1] ?? m[2])! });
    last = re.lastIndex;
  }
  if (last < target.length) parts.push({ t: 'lit', v: target.slice(last) });
  if (parts.length === 0) parts.push({ t: 'lit', v: target });
  return parts;
}

/** Cheap existence check: does this directory (recursively) contain any nginx
 * conf file? Used by discovery to decide whether a service's build-context
 * Dockerfile `ENV` defaults are worth merging into its env map at all —
 * scoped narrowly to "this service's own conf needs a default for an env var
 * compose never wires" rather than a blanket Dockerfile-ENV inference applied
 * to every app service (which would incorrectly start attributing Dockerfile
 * ENV vars to out-of-scope-language services that happen to also ship one). */
export function hasNginxConf(dirAbs: string): boolean {
  for (const _f of walkConfFiles(dirAbs)) return true;
  return false;
}

/** Detect `proxy_pass` targets in nginx conf files under a service's directory.
 * Each hit becomes a ClientCallFact that flows through the existing HTTP joiner
 * untouched — env wires, code-default fallbacks, literal host matching, route
 * confirmation, confidence, and evidence all apply exactly as they do for a
 * JS/Python/Go HTTP client call. */
export function detectNginx(service: ServiceInfo, repoRoot: string): ClientCallFact[] {
  if (!service.dir) return [];
  const dirAbs = path.join(repoRoot, service.dir);
  const facts: ClientCallFact[] = [];

  for (const fileAbs of walkConfFiles(dirAbs)) {
    // POSIX at birth — this rel becomes a node id and an evidence ref. See relPosix.ts.
    const rel = toRelPosix(path.relative(repoRoot, fileAbs));
    let text: string;
    try {
      text = fs.readFileSync(fileAbs, 'utf8');
    } catch {
      continue;
    }
    const { upstreams, proxies } = parseNginxConf(text);
    if (proxies.length === 0) continue;
    const lines = text.split('\n');

    for (const p of proxies) {
      const urlParts = partsFromProxyTarget(p.target, upstreams);
      const rawLine = (lines[p.line - 1] ?? '').trim();
      facts.push({
        service: service.name,
        method: undefined,
        url: urlParts,
        file: rel,
        line: p.line,
        snippet: `location ${p.locationPath} { ${rawLine} }`.slice(0, 200),
      });
    }
  }
  return facts;
}
