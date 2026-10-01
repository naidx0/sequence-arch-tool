import type { ConnectionFact, FileFacts, Part, ServiceInfo, Wire } from '../types.js';
import { resolveParts } from '../parse/facts.js';

// Optional `jdbc:` prefix: JDBC URLs (`jdbc:postgresql://host:port/db`) wrap
// a normal scheme:// URL — matching (and stripping, via the same regex used
// for both) the prefix here keeps mysql/postgresql/mariadb JDBC URLs on the
// exact same hostname-extraction path as every other scheme.
const DB_SCHEMES =
  /^(?:jdbc:)?(mongodb(\+srv)?|redis|rediss|mysql|postgres|postgresql|mariadb|amqp|amqps|kafka|nats):\/\//i;

/**
 * Resolve a datastore/broker Part[] value (a DB/broker-scheme URL, a bare
 * hostname, or an env var pointing at one via `wireByEnv`) to a compose/
 * manifest infra service name. Shared by `detectConnections` (call-argument
 * host-shaped values) and `detectSpringConfig` (application.properties/yml
 * values) so both agree on exactly how a literal or env-wired hostname
 * resolves to a known datastore/broker.
 */
export function resolveDbHost(
  parts: Part[],
  infraByName: Map<string, ServiceInfo>,
  wireByEnv: Map<string, Wire>
): { target: string; how: ConnectionFact['how'] } | undefined {
  const first = parts.find((p) => !(p.t === 'lit' && p.v === ''));
  if (!first) return undefined;
  if (first.t === 'lit') {
    const literal = first.v.trim();
    const m = literal.match(DB_SCHEMES);
    if (m) {
      const stripped = literal.replace(DB_SCHEMES, '');
      // user:pass@host — take the part after the last @ before / or :
      const hostPart = stripped.split('/')[0].split('@').pop();
      const hostname = hostPart?.split(':')[0];
      if (hostname && infraByName.has(hostname)) return { target: hostname, how: 'literal' };
      return undefined;
    }
    // bare hostname, host:port, or a comma-separated broker list
    // (spring.kafka.bootstrap-servers=kafka1:9092,kafka2:9092) — take the
    // first item that resolves to a known infra service.
    for (const piece of literal.split(',')) {
      const hm = piece.trim().match(/^([A-Za-z0-9_.-]+)(?::\d+)?$/);
      if (hm && infraByName.has(hm[1])) return { target: hm[1], how: 'literal' };
    }
    return undefined;
  }
  if (first.t === 'env') {
    const wire = wireByEnv.get(first.name);
    if (wire && infraByName.has(wire.targetService)) {
      return { target: wire.targetService, how: 'env-wire' };
    }
    if (first.fallback) {
      const viaFallback = resolveDbHost(first.fallback, infraByName, wireByEnv);
      if (viaFallback) return { target: viaFallback.target, how: 'env-fallback' };
    }
  }
  return undefined;
}

/**
 * Detect datastore/broker connections that don't go through SQL/ORM/queue APIs:
 * MongoClient.connect('mongodb://mongo/db'), redis.createClient({host}),
 * pika.ConnectionParameters(host=...), mongoose.connect(URL), etc.
 * Gated hard on the resolved hostname being a compose datastore/broker service.
 */
export function detectConnections(
  service: ServiceInfo,
  facts: FileFacts[],
  infraByName: Map<string, ServiceInfo>,
  wires: Wire[]
): ConnectionFact[] {
  const out: ConnectionFact[] = [];
  const wireByEnv = new Map(wires.filter((w) => w.service === service.name).map((w) => [w.envKey, w]));
  const resolveHost = (parts: Part[]) => resolveDbHost(parts, infraByName, wireByEnv);

  for (const f of facts) {
    const snippet = (line: number) => (f.lines[line - 1] ?? '').trim().slice(0, 200);
    for (const call of f.calls) {
      // require('redis') / import('x'): module specifiers, not hostnames
      if (call.callee === 'require' || call.callee === 'import') continue;
      const candidates: Part[][] = [];
      for (const arg of call.args) candidates.push(resolveParts(arg, f.assignments));
      for (const key of [
        'host',
        'hostname',
        'url',
        'uri',
        'connectionString',
        'connection_string',
        // Go: go-redis Options{Addr}, amqp/pgx-style config structs
        'Addr',
        'Host',
      ]) {
        if (call.kwargs[key]) candidates.push(resolveParts(call.kwargs[key], f.assignments));
      }
      for (const parts of candidates) {
        const hit = resolveHost(parts);
        if (hit && hit.target !== service.name) {
          out.push({
            service: service.name,
            targetService: hit.target,
            how: hit.how,
            file: f.file,
            line: call.line,
            snippet: snippet(call.line),
          });
          break; // one connection fact per call site
        }
      }
    }
  }
  return out;
}
