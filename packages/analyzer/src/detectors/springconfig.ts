import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { toRelPosix } from '../relPosix.js';
import type { ClientCallFact, ConnectionFact, Part, ServiceInfo, Wire } from '../types.js';
import { relaxedBinding } from '../parse/facts.js';
import { resolveDbHost } from './connections.js';

const CONFIG_FILE_CANDIDATES = [
  'application.properties',
  'application.yml',
  'application.yaml',
  'bootstrap.properties',
  'bootstrap.yml',
  'bootstrap.yaml',
];

const CONFIG_DIR = path.join('src', 'main', 'resources');

/** Datastore/broker-pointing property keys worth resolving into ConnectionFacts. */
const DATASTORE_KEYS = [
  'spring.datasource.url',
  'spring.data.mongodb.uri',
  'spring.data.mongodb.host',
  'spring.redis.host',
  'spring.rabbitmq.host',
  'spring.rabbitmq.addresses',
  'spring.kafka.bootstrap-servers',
];

function parseProperties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = line.match(/^([^=:\s]+)\s*[:=]\s*(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** Spring Boot YAML routinely packs several `---`-separated documents into
 * one file: a base document plus per-profile overrides (e.g. a `docker`
 * profile activated via `spring.config.activate.on-profile: docker`) —
 * seen in every spring-petclinic-microservices service (see
 * docs/SPIKE_RESULTS.md v3 P2). Splitting on the separator (rather than
 * using the yaml package's own multi-document API) keeps each document's
 * own line numbers trivially recoverable — just add back its start offset —
 * without needing AST-position tracking the rest of this codebase doesn't
 * do either (see discovery/compose.ts's `lineOfEnvKey`, kubernetes.ts's
 * `lineOf`: both are plain regex-over-raw-lines, not position-tracking). */
function splitYamlDocuments(text: string): { text: string; startLine: number }[] {
  const lines = text.split('\n');
  const chunks: { text: string; startLine: number }[] = [];
  let chunkStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      chunks.push({ text: lines.slice(chunkStart, i).join('\n'), startLine: chunkStart });
      chunkStart = i + 1;
    }
  }
  chunks.push({ text: lines.slice(chunkStart).join('\n'), startLine: chunkStart });
  return chunks;
}

function flattenYaml(obj: unknown, prefix: string, out: Map<string, string>): void {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenYaml(item, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flattenYaml(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  out.set(prefix, String(obj));
}

/** `${some.prop:default}` / `${some.prop}` / `${ENV_NAME}` -> Part[], same
 * relaxed-binding convention as the `@Value` field binding in facts.ts —
 * Spring resolves an unset `${cart.endpoint}` placeholder from the
 * `CART_ENDPOINT` env var exactly the same way whether it appears in a
 * `@Value` annotation or a properties/yml file. */
export function resolvePlaceholders(raw: string): Part[] {
  const parts: Part[] = [];
  const re = /\$\{([^}:]+)(?::([^}]*))?\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m.index > last) parts.push({ t: 'lit', v: raw.slice(last, m.index) });
    parts.push({
      t: 'env',
      name: relaxedBinding(m[1]),
      fallback: m[2] !== undefined ? [{ t: 'lit', v: m[2] }] : undefined,
    });
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push({ t: 'lit', v: raw.slice(last) });
  if (parts.length === 0) parts.push({ t: 'lit', v: raw });
  return parts;
}

/** Sequential line finder: since flattening walks a properties/yml file in
 * document order, searching forward from the last match (rather than from
 * the top every time) picks the right occurrence among repeated keys —
 * e.g. multiple `uri:` entries under `spring.cloud.gateway.routes`. Same
 * "regex over raw lines" evidence strategy already used by
 * discovery/compose.ts's `lineOfEnvKey` and kubernetes.ts's `lineOf`. */
function makeLineFinder(rawLines: string[]): (re: RegExp) => number {
  let cursor = 0;
  return (re: RegExp): number => {
    for (let i = cursor; i < rawLines.length; i++) {
      if (re.test(rawLines[i])) {
        cursor = i + 1;
        return i + 1;
      }
    }
    for (let i = 0; i < rawLines.length; i++) {
      if (re.test(rawLines[i])) return i + 1;
    }
    return 1;
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isYaml(file: string): boolean {
  return file.endsWith('.yml') || file.endsWith('.yaml');
}

function findConfigFiles(serviceDirAbs: string): string[] {
  const dir = path.join(serviceDirAbs, CONFIG_DIR);
  const out: string[] = [];
  for (const name of CONFIG_FILE_CANDIDATES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// Matches both the classic `spring.cloud.gateway.routes[n].uri` and newer
// Spring Cloud Gateway layouts that nest routes deeper (e.g.
// `spring.cloud.gateway.server.webflux.routes[n].uri`, seen in
// spring-petclinic-microservices — verified by reading the actual
// application.yml rather than assuming the classic key path still holds;
// see docs/SPIKE_RESULTS.md v3 P2).
const GATEWAY_ROUTE_URI_RE = /^spring\.cloud\.gateway(?:\.[\w-]+)*\.routes\[\d+\]\.uri$/;

// `spring.config.import` values commonly wrap a real URL behind an
// `optional:`/`configserver:` prefix (e.g. `optional:configserver:http://
// config-server:8888`, or with an unresolved placeholder default:
// `optional:configserver:${CONFIG_SERVER_URL:http://localhost:8888/}`) and
// may list several comma-separated imports, only some of which are
// URL-shaped (`optional:classpath:/creds.yaml` is not). Strip the prefix
// and resolve placeholders on the piece(s) that remain URL/placeholder-shaped.
function extractConfigImportPieces(rawValue: string): string[] {
  const out: string[] = [];
  for (const piece of rawValue.split(',')) {
    const stripped = piece.trim().replace(/^optional:/, '').replace(/^configserver:/, '');
    if (/^https?:\/\//i.test(stripped) || /^\$\{/.test(stripped)) out.push(stripped);
  }
  return out;
}

/**
 * Parse a Spring Boot service's application.properties/yml (+ bootstrap.*)
 * for two kinds of architecturally-meaningful, zero-code-required facts:
 *
 *  1. ConnectionFacts from datastore/broker-pointing keys
 *     (spring.datasource.url, spring.data.mongodb.uri|host, spring.redis.host,
 *     spring.rabbitmq.host|addresses, spring.kafka.bootstrap-servers) —
 *     resolved through the same env-wire/fallback/literal path as code-level
 *     connections (`resolveDbHost`, shared with detectors/connections.ts).
 *  2. ClientCallFacts from Spring Cloud Gateway routes
 *     (`spring.cloud.gateway.routes[n].uri` = `lb://name` or
 *     `http://name[:port]`) and, generically, any property value that is a
 *     full http(s) URL (catches eureka `defaultZone` / config-server URIs) —
 *     the joiner's literal-host-must-be-a-known-service gate keeps this from
 *     producing edges to arbitrary external URLs.
 *
 * No-ops (returns empty arrays) for a service that ships no application.*
 * config under src/main/resources — cheap enough to run for every app
 * service unconditionally, same pattern as detectNginx.
 */
export function detectSpringConfig(
  service: ServiceInfo,
  repoRoot: string,
  infraByName: Map<string, ServiceInfo>,
  wires: Wire[]
): { connections: ConnectionFact[]; clients: ClientCallFact[] } {
  const connections: ConnectionFact[] = [];
  const clients: ClientCallFact[] = [];
  if (!service.dir) return { connections, clients };
  const serviceDirAbs = path.join(repoRoot, service.dir);
  const files = findConfigFiles(serviceDirAbs);
  if (files.length === 0) return { connections, clients };

  const wireByEnv = new Map(wires.filter((w) => w.service === service.name).map((w) => [w.envKey, w]));

  for (const fileAbs of files) {
    // POSIX at birth — this rel becomes a node id and an evidence ref. See relPosix.ts.
    const rel = toRelPosix(path.relative(repoRoot, fileAbs));
    let text: string;
    try {
      text = fs.readFileSync(fileAbs, 'utf8');
    } catch {
      continue;
    }

    // key -> (value, absolute file line, snippet). A later document/chunk
    // overwrites an earlier one's entry for the same key — Spring's own
    // "last one wins" precedence for profile-activated documents — and each
    // entry's line/snippet always reflects the chunk that actually produced
    // its final value (not wherever the key first appeared in the file).
    const resolved = new Map<string, { value: string; line: number; snippet: string }>();

    if (isYaml(fileAbs)) {
      for (const chunk of splitYamlDocuments(text)) {
        let obj: unknown;
        try {
          obj = parseYaml(chunk.text);
        } catch {
          continue;
        }
        if (!obj || typeof obj !== 'object') continue;
        const flat = new Map<string, string>();
        flattenYaml(obj, '', flat);
        if (flat.size === 0) continue;
        const chunkLines = chunk.text.split('\n');
        const findLine = makeLineFinder(chunkLines);
        for (const [key, value] of flat) {
          const leaf = key.split('.').pop()!.replace(/\[\d+\]$/, '');
          const localLine = findLine(new RegExp(`^\\s*${escapeRe(leaf)}\\s*:`));
          const line = chunk.startLine + localLine;
          resolved.set(key, { value, line, snippet: (chunkLines[localLine - 1] ?? '').trim().slice(0, 200) });
        }
      }
    } else {
      const rawLines = text.split('\n');
      const findLine = makeLineFinder(rawLines);
      for (const [key, value] of parseProperties(text)) {
        const line = findLine(new RegExp(`^\\s*${escapeRe(key)}\\s*[:=]`));
        resolved.set(key, { value, line, snippet: (rawLines[line - 1] ?? '').trim().slice(0, 200) });
      }
    }

    for (const [key, { value: rawValue, line, snippet }] of resolved) {
      if (!rawValue) continue;

      if (DATASTORE_KEYS.includes(key)) {
        const parts = resolvePlaceholders(rawValue);
        const hit = resolveDbHost(parts, infraByName, wireByEnv);
        if (hit && hit.target !== service.name) {
          connections.push({ service: service.name, targetService: hit.target, how: hit.how, file: rel, line, snippet });
        }
        continue;
      }

      if (GATEWAY_ROUTE_URI_RE.test(key)) {
        const m = rawValue.match(/^(?:lb|https?):\/\/([A-Za-z0-9_.-]+)(?::\d+)?/i);
        if (m) {
          clients.push({
            service: service.name,
            method: undefined,
            url: [{ t: 'lit', v: `http://${m[1]}/` }],
            file: rel,
            line,
            snippet,
          });
        }
        continue;
      }

      if (key === 'spring.config.import') {
        for (const piece of extractConfigImportPieces(rawValue)) {
          clients.push({ service: service.name, method: undefined, url: resolvePlaceholders(piece), file: rel, line, snippet });
        }
        continue;
      }

      // Generic: any remaining property value that is itself a full http(s)
      // URL — eureka `defaultZone`, misc config-server-style URIs not caught
      // by the two specific cases above. The joiner's literal-host-is-a-
      // known-service gate provides the precision; this is intentionally
      // broad on the input side.
      if (/^https?:\/\//i.test(rawValue)) {
        clients.push({ service: service.name, method: undefined, url: resolvePlaceholders(rawValue), file: rel, line, snippet });
      }
    }
  }

  return { connections, clients };
}
