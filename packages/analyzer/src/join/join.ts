import type { DbEngineFact } from '../detectors/db.js';
import { stampProvenance } from './instrument.js';
import type { ArchEdge, Evidence } from '@sequence/schema';
import type {
  ClientCallFact,
  ConnectionFact,
  Discovery,
  GrpcClientFact,
  GrpcServerFact,
  MountFact,
  Part,
  ProtoServiceFact,
  QueueOpFact,
  RouteFact,
  TableAccessFact,
  Wire,
} from '../types.js';

export interface JoinInput {
  discovery: Discovery;
  routes: RouteFact[];
  mounts: MountFact[];
  clients: ClientCallFact[];
  queueOps: QueueOpFact[];
  tables: TableAccessFact[];
  /** Engines the code demonstrably drives — see `detectDbEngines`. Optional so
   *  every existing caller keeps compiling and behaves identically. */
  dbEngines?: DbEngineFact[];
  connections: ConnectionFact[];
  grpcClients: GrpcClientFact[];
  grpcServers: GrpcServerFact[];
  protoServices: ProtoServiceFact[];
}

/**
 * A datastore no manifest declared, whose EXISTENCE the code proves.
 *
 * Every field is read off real table-access facts — the tables are the ones the
 * parser saw, each with a file and a line. The engine is deliberately absent: a
 * `SELECT` proves a database is there, it does not say which one.
 */
export interface InferredDatastore {
  /**
   * The engine, when a DRIVER proves it — `sqlite3.connect` is evidence of
   * SQLite, where a SELECT is only evidence that some database exists. Absent
   * when no driver was found, and absent is not "unknown engine, assume none":
   * a consumer must be able to tell "we know it is SQLite" from "we could not
   * tell", which is exactly the distinction the claim checker turns on.
   */
  engine?: DbEngineFact['engine'];
  /** file:line of the driver call, so the engine is as citable as everything else. */
  engineEvidence?: { file: string; line: number };
  /** The datastore NAME (not the node id) — `dsId()` is applied by the caller. */
  name: string;
  /** The app service whose code reaches it. */
  service: string;
  /** Distinct table names, sorted. Every one came from a parsed statement. */
  tables: string[];
  /** The first access, so the node can cite a line like every other node. */
  evidence: { file: string; line: number; snippet: string };
}

export interface JoinOutput {
  edges: ArchEdge[];
  /** topic name -> broker service name (if resolvable) */
  topics: Map<string, string | undefined>;
  warnings: string[];
  /**
   * Datastores the code demonstrably uses that no deployment manifest declares.
   * The caller mints the nodes; the joiner will not invent a node on its own.
   */
  inferredDatastores: InferredDatastore[];
}

const fileId = (path: string) => `file:${path}`;
const svcId = (name: string) => `svc:${name}`;
const dsId = (name: string) => `ds:${name}`;
const topicId = (name: string) => `topic:${name}`;

let edgeSeq = 0;
const nextEdgeId = (kind: string) => `e${++edgeSeq}:${kind}`;

/** Normalize a route path to comparable segments; params become "*". */
export function pathToSegments(p: string): string[] {
  return p
    .replace(/[?#].*$/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (/^:(\w+)/.test(seg) || /^\{.*\}$/.test(seg) || /^<.*>$/.test(seg) || seg === '*') return '*';
      return seg.toLowerCase();
    });
}

export function segmentsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && a[i] !== '*' && b[i] !== '*') return false;
  }
  return true;
}

/**
 * Does a caller's path fall under a route registered as a SUBTREE?
 *
 * Only ever consulted for a route the detector marked `prefix` — Go's ServeMux
 * with a trailing slash. Every segment of the registration must match, and the
 * caller may then have more: `/shipments/` covers `/shipments/{id}` and
 * `/shipments/a/b`, and does not cover `/ships`.
 */
export function segmentsUnderPrefix(callerSegs: string[], routeSegs: string[]): boolean {
  if (routeSegs.length === 0) return false;
  if (callerSegs.length <= routeSegs.length) return false;
  for (let i = 0; i < routeSegs.length; i++) {
    if (callerSegs[i] !== routeSegs[i] && callerSegs[i] !== '*' && routeSegs[i] !== '*') return false;
  }
  return true;
}

export interface HostAndPath {
  host?: { type: 'env'; name: string; fallback?: Part[] } | { type: 'lit'; value: string };
  pathSkeleton: string;
}

/** Extract host + path skeleton from resolved URL parts. */
export function urlPartsToHostAndPath(parts: Part[]): HostAndPath {
  let host: HostAndPath['host'];
  let path = '';
  let i = 0;
  const meaningful = parts.filter((p) => !(p.t === 'lit' && p.v === ''));
  const first = meaningful[i];
  if (!first) return { pathSkeleton: '' };
  if (first.t === 'env') {
    host = { type: 'env', name: first.name, fallback: first.fallback };
    i = 1;
  } else if (first.t === 'lit') {
    const m = first.v.match(/^(https?:\/\/(?:[^@/\s]+@)?[A-Za-z0-9_.-]+(?::\d+)?)(\/.*)?$/);
    if (m) {
      host = { type: 'lit', value: m[1] };
      if (m[2]) path += m[2];
      i = 1;
    } else if (/^https?:\/\/$/.test(first.v)) {
      // 'http://' + <expr> + '/path' — host is the next part
      const next = meaningful[1];
      if (next?.t === 'env') {
        host = { type: 'env', name: next.name, fallback: next.fallback };
        i = 2;
      } else if (next?.t === 'lit') {
        // merged already by resolveParts; shouldn't happen, but be safe
        const m2 = next.v.match(/^([A-Za-z0-9_.-]+(?::\d+)?)(\/.*)?$/);
        if (m2) {
          host = { type: 'lit', value: `http://${m2[1]}` };
          if (m2[2]) path += m2[2];
          i = 2;
        }
      } else {
        return { pathSkeleton: '' }; // dynamic host — unknowable
      }
    }
  }
  for (; i < meaningful.length; i++) {
    const p = meaningful[i];
    if (p.t === 'lit') path += p.v;
    else path += '{*}';
  }
  // if the host came from an env/expr, the next literal may carry the port
  path = path.replace(/^:\d+/, '');
  return { host, pathSkeleton: path.replace(/\{\*\}/g, '*') };
}

function evidence(file: string, line: number, snippet: string, note?: string): Evidence {
  return { file, line, snippet, note };
}

/** Names the actual kind of manifest a wire's evidence points at, so the
 * joiner's "no code found" note is truthful about where the wiring was
 * declared: a Dockerfile `ENV` line (language-independent, v3), a compose
 * `environment:` entry, or a Kubernetes/Helm manifest. */
function manifestSourceLabel(discovery: Discovery, sourceFile: string | undefined): string {
  if (sourceFile && /Dockerfile(\.\w+)?$/i.test(sourceFile)) return 'a Dockerfile ENV line';
  if (discovery.manifestKind === 'kubernetes' || discovery.manifestKind === 'helm') {
    return 'the Kubernetes manifest';
  }
  return 'the compose environment';
}

/** Lowercase, alphanumerics-only normalization for gRPC-service-name-to-service-name matching. */
function normalizeGrpcName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SERVICE_SUFFIX = 'service';

/** SPA build-time public env keys — wired in compose/Dockerfile, not secrets. */
const SPA_PUBLIC_ENV_RE = /^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)/;

/** `CartService` <-> `cartservice`, in either direction, with/without the "service" suffix. */
function grpcNameMatches(a: string, b: string): boolean {
  const variants = (s: string): Set<string> =>
    new Set([s, s.endsWith(SERVICE_SUFFIX) ? s.slice(0, -SERVICE_SUFFIX.length) : s + SERVICE_SUFFIX]);
  const va = variants(a);
  for (const v of variants(b)) if (va.has(v)) return true;
  return false;
}

function hostnameOf(value: string): string | undefined {
  const url = value.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([A-Za-z0-9_.-]+)(?::\d+)?/i);
  if (url) return url[1];
  const bare = value.trim().match(/^([A-Za-z0-9_.-]+)(?::\d+)?$/);
  return bare ? bare[1] : undefined;
}

function pathPrefixOf(value: string): string {
  const m = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+(\/[^?#\s]*)/i);
  if (!m) return '';
  return m[1].replace(/\/$/, '');
}

export function joinAll(input: JoinInput): JoinOutput {
  const { discovery } = input;
  const warnings: string[] = [];
  const edges: ArchEdge[] = [];
  edgeSeq = 0;

  const serviceNames = new Set(discovery.services.map((s) => s.name));
  const infraByName = new Map(
    discovery.services.filter((s) => s.role !== 'app').map((s) => [s.name, s])
  );
  const appServiceNames = new Set(
    discovery.services.filter((s) => s.role === 'app').map((s) => s.name)
  );
  const wiresByService = new Map<string, Wire[]>();
  for (const w of discovery.wires) {
    const arr = wiresByService.get(w.service) ?? [];
    arr.push(w);
    wiresByService.set(w.service, arr);
  }
  const connsByService = new Map<string, ConnectionFact[]>();
  for (const c of input.connections) {
    const arr = connsByService.get(c.service) ?? [];
    arr.push(c);
    connsByService.set(c.service, arr);
  }

  // routes indexed by target service; include mount-prefixed variants
  const routesByService = new Map<string, { segs: string[]; method: string; r: RouteFact }[]>();
  for (const r of input.routes) {
    const arr = routesByService.get(r.service) ?? [];
    arr.push({ segs: pathToSegments(r.path), method: r.method, r });
    const prefixes = input.mounts.filter((m) => m.service === r.service).map((m) => m.prefix);
    for (const prefix of prefixes) {
      arr.push({ segs: pathToSegments(prefix + r.path), method: r.method, r });
    }
    routesByService.set(r.service, arr);
  }

  // ---------- HTTP ----------
  const httpSvcPairs = new Set<string>();
  for (const c of input.clients) {
    const { host, pathSkeleton } = urlPartsToHostAndPath(c.url);

    let target: string | undefined;
    let baseConf = 0;
    let viaNote = '';
    let wirePathPrefix = '';
    if (!host) {
      /*
       * A SAME-ORIGIN PATH HAS NO HOST, AND THAT IS INFORMATION, NOT ABSENCE.
       *
       * `fetch('/api/items')` in a browser can only reach the origin that served
       * the page; in a repo holding a UI and a server, that is the server. This
       * used to `continue`, so every same-origin call in every frontend was
       * dropped — without even the warning the env branch below emits.
       *
       * THE TARGET IS NOT GUESSED. The path must match a route another service
       * actually registered, and match exactly ONE service. Zero matches yields
       * no edge because the callee would be a guess; two or more yields no edge
       * because WHICH callee would be a guess. Confidence stays below the
       * literal-host case: this is an inference from same-origin semantics, not
       * a host somebody wrote down.
       */
      if (!pathSkeleton.startsWith('/')) continue;
      const segs = pathToSegments(pathSkeleton);
      const hits = [...routesByService.entries()].filter(
        ([svc, routes]) =>
          svc !== c.service &&
          routes.some(
            (r) => segmentsMatch(segs, r.segs) && (!c.method || r.method === '*' || r.method === c.method),
          ),
      );
      if (hits.length !== 1) continue;
      target = hits[0]![0];
      baseConf = 0.8;
      viaNote = 'same-origin path matched a registered route';
    } else if (host.type === 'env') {
      const wire = (wiresByService.get(c.service) ?? []).find((w) => w.envKey === host.name);
      if (wire) {
        if (wire.kind !== 'http' && wire.kind !== 'addr') continue; // DATABASE_URL etc — not an HTTP edge
        target = wire.targetService;
        baseConf = 0.9;
        viaNote = `via env ${host.name} = ${wire.value}`;
        wirePathPrefix = pathPrefixOf(wire.value);
      } else if (host.fallback) {
        // env not wired in compose, but the code ships a static default
        const fb = host.fallback.find((p) => !(p.t === 'lit' && p.v === ''));
        const hostname = fb?.t === 'lit' ? hostnameOf(fb.v) : undefined;
        if (hostname && serviceNames.has(hostname)) {
          target = hostname;
          baseConf = 0.85;
          viaNote = `env ${host.name} unset in compose; code default "${hostname}"`;
          if (fb?.t === 'lit') wirePathPrefix = pathPrefixOf(fb.v);
        } else {
          continue;
        }
      } else {
        warnings.push(
          `${c.service}: HTTP call at ${c.file}:${c.line} uses env ${host.name} with no compose wiring and no code default — skipped`
        );
        continue;
      }
    } else {
      const hostname = hostnameOf(host.value);
      if (hostname && serviceNames.has(hostname)) {
        target = hostname;
        baseConf = 0.85;
        viaNote = `literal host ${hostname}`;
      } else {
        /*
         * AN EXTERNAL HOST IS SEEN AND DISCARDED — SAY SO.
         *
         * This was a bare `continue`. The env branch above warns when it cannot
         * wire a host; this one said nothing at all, so a user was never told
         * that their code calls Ollama, Hugging Face or an payment API and that
         * we chose not to draw it. Silence reads as "there was nothing there".
         *
         * Still not an edge: `NodeKind` has no `external` member, so there is no
         * legal node to point at. This is an honesty fix, not a graph fix — the
         * call is named in warnings where a reader can find it.
         */
        if (hostname) {
          warnings.push(
            `${c.service}: HTTP call at ${c.file}:${c.line} targets external host ${hostname} — seen, not drawn (no in-repo service owns it)`
          );
        }
        continue;
      }
    }
    if (!target || target === c.service) continue;

    // path confirmation against the target's route table
    const clientSegs = pathToSegments(wirePathPrefix + pathSkeleton);
    const targetRoutes = routesByService.get(target) ?? [];
    const matched = targetRoutes.find(
      (tr) =>
        (segmentsMatch(clientSegs, tr.segs) ||
          /* A subtree registration covers everything beneath it — see
           * `segmentsUnderPrefix`. Gated on the flag the DETECTOR set, so this
           * cannot loosen matching for a framework where a trailing slash is
           * just part of the path. */
          (tr.r.prefix === true && segmentsUnderPrefix(clientSegs, tr.segs))) &&
        (!c.method || tr.method === '*' || tr.method === c.method)
    );
    const conf = matched ? Math.min(baseConf + 0.05, 0.98) : baseConf - 0.15;
    const dst = matched ? fileId(matched.r.file) : svcId(target);
    edges.push({
      id: nextEdgeId('http'),
      srcId: fileId(c.file),
      dstId: dst,
      kind: 'http',
      confidence: Number(conf.toFixed(2)),
      origin: 'deterministic',
      evidence: [
        evidence(c.file, c.line, c.snippet, viaNote),
        ...(matched
          ? [evidence(matched.r.file, matched.r.line, `${matched.r.method} ${matched.r.path}`, 'matched route')]
          : []),
      ],
      detail: {
        method: c.method,
        pathPattern: pathSkeleton,
        targetService: target,
        matchedRoute: matched ? `${matched.r.method} ${matched.r.path}` : undefined,
        // Carried through so the function-graph layer can attribute the
        // server side to the function that actually serves the request
        // rather than just the enclosing function at the registration call —
        // see functions/crossServiceEdges.ts's handler resolution.
        handlerName: matched?.r.handlerName,
      },
    });
    httpSvcPairs.add(`${c.service}|${target}`);
  }

  // ---------- gRPC ----------
  const serversByGrpcService = new Map<string, GrpcServerFact[]>();
  for (const s of input.grpcServers) {
    const arr = serversByGrpcService.get(s.grpcService) ?? [];
    arr.push(s);
    serversByGrpcService.set(s.grpcService, arr);
  }
  for (const c of input.grpcClients) {
    const servers = serversByGrpcService.get(c.grpcService) ?? [];
    const proto = input.protoServices.find((p) => p.grpcService === c.grpcService);

    // Resolve the channel address's hostname once — used both to upgrade
    // confidence when a grpcService-name-matched server exists, and as a
    // fallback destination (via the addr-wire fallback below) when it doesn't.
    let addrHostname: string | undefined;
    let addrNote = '';
    if (c.addr) {
      const first = c.addr.find((p) => !(p.t === 'lit' && p.v === ''));
      if (first?.t === 'env') {
        const wire = (wiresByService.get(c.service) ?? []).find((w) => w.envKey === first.name);
        addrHostname = wire?.targetService;
        if (addrHostname) addrNote = `, channel via env ${first.name}`;
      } else if (first?.t === 'lit') {
        addrHostname = first.v.split(':')[0];
      }
    }

    if (servers.length === 0) {
      // No server implementation found for this proto service name in the
      // repo — typically an out-of-scope language (C#/Java), or an in-scope
      // language whose server-registration pattern isn't detected yet. Two
      // deterministic fallbacks, in priority order:
      //
      // 1) the channel address resolves to a real service directly (0.8) —
      //    strongest, since it's independent of proto-name matching.
      const addrTarget = addrHostname ? discovery.services.find((s) => s.name === addrHostname) : undefined;
      if (addrTarget && addrTarget.name !== c.service) {
        const dst = addrTarget.role === 'app' ? svcId(addrTarget.name) : dsId(addrTarget.name);
        edges.push({
          id: nextEdgeId('grpc'),
          srcId: fileId(c.file),
          dstId: dst,
          kind: 'grpc',
          confidence: 0.8,
          origin: 'deterministic',
          evidence: [
            evidence(
              c.file,
              c.line,
              c.snippet,
              `no server implementation found in repo for ${c.grpcService}; resolved via channel address${addrNote}`
            ),
            ...(proto ? [evidence(proto.file, proto.line, `service ${proto.grpcService}`, 'proto contract')] : []),
          ],
          detail: { grpcService: c.grpcService, targetService: addrTarget.name },
        });
        continue;
      }
      // 2) service-name convention: CartService <-> cartservice (0.75).
      const norm = normalizeGrpcName(c.grpcService);
      const candidates = discovery.services.filter(
        (s) => s.name !== c.service && grpcNameMatches(norm, normalizeGrpcName(s.name))
      );
      if (candidates.length === 1) {
        const target = candidates[0];
        const dst = target.role === 'app' ? svcId(target.name) : dsId(target.name);
        edges.push({
          id: nextEdgeId('grpc'),
          srcId: fileId(c.file),
          dstId: dst,
          kind: 'grpc',
          confidence: 0.75,
          origin: 'deterministic',
          evidence: [
            evidence(
              c.file,
              c.line,
              c.snippet,
              `no server implementation found in repo for ${c.grpcService}; matched "${target.name}" by service-name convention`
            ),
            ...(proto ? [evidence(proto.file, proto.line, `service ${proto.grpcService}`, 'proto contract')] : []),
          ],
          detail: { grpcService: c.grpcService, targetService: target.name },
        });
        continue;
      }
      warnings.push(
        `${c.service}: gRPC client for ${c.grpcService} at ${c.file}:${c.line} — no server implementation found in repo` +
          (candidates.length > 1
            ? `; service-name convention match was ambiguous (${candidates.map((s) => s.name).join(', ')})`
            : '')
      );
      continue;
    }

    let chosen = servers[0];
    let conf = 0.85;
    let note = `stub ${c.grpcService}Stub -> ${chosen.service}`;
    if (addrHostname) {
      note += addrNote;
      const byAddr = servers.find((s) => s.service === addrHostname);
      if (byAddr) {
        chosen = byAddr;
        conf = 0.95;
      }
    }
    if (chosen.service === c.service) continue;
    edges.push({
      id: nextEdgeId('grpc'),
      srcId: fileId(c.file),
      dstId: fileId(chosen.file),
      kind: 'grpc',
      confidence: conf,
      origin: 'deterministic',
      evidence: [
        evidence(c.file, c.line, c.snippet, note),
        evidence(chosen.file, chosen.line, chosen.snippet, 'server implementation'),
        ...(proto ? [evidence(proto.file, proto.line, `service ${proto.grpcService}`, 'proto contract')] : []),
      ],
      detail: { grpcService: c.grpcService, targetService: chosen.service },
    });
  }

  // ---------- queues ----------
  // broker for a service: broker-kind wire, or a detected connection to a broker service
  const brokerFor = (service: string): string | undefined => {
    const wire = (wiresByService.get(service) ?? []).find((w) => {
      const t = infraByName.get(w.targetService);
      return t?.role === 'broker';
    });
    if (wire) return wire.targetService;
    const conn = (connsByService.get(service) ?? []).find(
      (c) => infraByName.get(c.targetService)?.role === 'broker'
    );
    return conn?.targetService;
  };

  const topics = new Map<string, string | undefined>();
  for (const op of input.queueOps) {
    if (op.literal) {
      if (!topics.has(op.topic)) topics.set(op.topic, brokerFor(op.service));
      edges.push({
        id: nextEdgeId(op.op === 'publish' ? 'queue_publish' : 'queue_consume'),
        srcId: fileId(op.file),
        dstId: topicId(op.topic),
        kind: op.op === 'publish' ? 'queue_publish' : 'queue_consume',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [evidence(op.file, op.line, op.snippet)],
        detail: { topic: op.topic },
      });
    } else {
      // topic is dynamic — draw a lower-confidence edge to the broker itself
      const broker = brokerFor(op.service);
      if (!broker) {
        warnings.push(
          `${op.service}: ${op.op} with dynamic topic at ${op.file}:${op.line} and no resolvable broker — skipped`
        );
        continue;
      }
      edges.push({
        id: nextEdgeId(op.op === 'publish' ? 'queue_publish' : 'queue_consume'),
        srcId: fileId(op.file),
        dstId: dsId(broker),
        kind: op.op === 'publish' ? 'queue_publish' : 'queue_consume',
        confidence: 0.7,
        origin: 'deterministic',
        evidence: [evidence(op.file, op.line, op.snippet, 'topic name is dynamic — edge drawn to broker')],
        detail: { topic: undefined, broker },
      });
    }
  }
  for (const [topic] of topics) {
    const pubs = input.queueOps.filter((o) => o.topic === topic && o.op === 'publish');
    const subs = input.queueOps.filter((o) => o.topic === topic && o.op === 'consume');
    if (pubs.length === 0) warnings.push(`topic "${topic}" has consumers but no publisher found`);
    if (subs.length === 0) warnings.push(`topic "${topic}" has publishers but no consumer found`);
  }

  // ---------- databases ----------
  // datastore for table facts: db-kind wire, or a detected datastore connection
  const datastoreFor = (service: string): string | undefined => {
    const wire = (wiresByService.get(service) ?? []).find((w) => w.kind === 'db');
    if (wire) return wire.targetService;
    const conn = (connsByService.get(service) ?? []).find(
      (c) => infraByName.get(c.targetService)?.role === 'datastore'
    );
    return conn?.targetService;
  };

  /*
   * A DATASTORE NO MANIFEST DECLARES IS STILL A DATASTORE.
   *
   * These edges used to require `datastoreFor(service)` to resolve, which needs
   * either a compose `Wire` of kind 'db' or a connection to a service the
   * discovery pass marked `role: 'datastore'`. Both come from a deployment
   * manifest. The code-first discoverer used for manifest-less repositories
   * emits every root as `role: 'app'` with `wires: []`, so on any repo without
   * docker-compose/Kubernetes/Helm this resolved to undefined for every service
   * and EVERY table access was discarded into `warnings`.
   *
   * Measured on ml-harness: **188 table accesses covering 28 distinct tables**,
   * every one carrying a real file and line — `fact_evidence`, `events`,
   * `quarantined_facts`, `retrieval_postings` — were detected correctly and then
   * thrown away, leaving a board with zero datastores for an application whose
   * entire product is a SQLite ledger. The scanner knew and did not say.
   *
   * It is also not fixable by the user: `resolveDbHost` matches a URL scheme or
   * a hostname, and SQLite has neither. A file-backed store can never have a
   * host to declare.
   *
   * So when nothing declares a store and the code plainly uses one, the store is
   * inferred FROM THE ACCESSES THEMSELVES. This is grounded rather than guessed:
   * the node exists because parsed statements read and write tables, it cites
   * the first of them, and it claims no engine — because a SELECT proves a
   * database is there, not which one it is.
   */
  const inferredByService = new Map<string, InferredDatastore>();
  const inferredDatastoreFor = (t: (typeof input.tables)[number]): string => {
    const existing = inferredByService.get(t.service);
    if (existing) {
      if (!existing.tables.includes(t.table)) existing.tables.push(t.table);
      return existing.name;
    }
    /* The engine, when a driver proved it in this same service. */
    const eng = (input.dbEngines ?? []).find((e) => e.service === t.service);
    const made: InferredDatastore = {
      name: `${t.service}-db`,
      service: t.service,
      tables: [t.table],
      evidence: { file: t.file, line: t.line, snippet: t.snippet },
      ...(eng ? { engine: eng.engine, engineEvidence: { file: eng.file, line: eng.line } } : {}),
    };
    inferredByService.set(t.service, made);
    return made.name;
  };

  for (const t of input.tables) {
    const ds = datastoreFor(t.service) ?? inferredDatastoreFor(t);
    const kind = t.access === 'read' ? 'db_read' : t.access === 'write' ? 'db_write' : 'db_access';
    edges.push({
      id: nextEdgeId(kind),
      srcId: fileId(t.file),
      dstId: dsId(ds),
      kind,
      confidence: t.via === 'orm' ? 0.85 : 0.9,
      origin: 'deterministic',
      evidence: [evidence(t.file, t.line, t.snippet, `${t.via} access to table "${t.table}"`)],
      detail: { table: t.table, database: ds },
    });
  }

  // connection facts to datastores become db_access edges (deduped per file+target).
  // Broker connections are normally represented by the queue edges above — but a
  // service that connects to a broker WITHOUT any queue ops is using it as a
  // plain datastore (redis-as-cache), so those become db_access edges too.
  const servicesWithQueueOps = new Set(input.queueOps.map((o) => o.service));
  const seenConn = new Set<string>();
  for (const c of input.connections) {
    const target = infraByName.get(c.targetService);
    if (!target) continue;
    if (target.role === 'broker' && servicesWithQueueOps.has(c.service)) continue;
    if (target.role !== 'datastore' && target.role !== 'broker') continue;
    const key = `${c.file}|${c.targetService}`;
    if (seenConn.has(key)) continue;
    seenConn.add(key);
    const conf = c.how === 'env-wire' ? 0.9 : c.how === 'literal' ? 0.85 : 0.8;
    edges.push({
      id: nextEdgeId('db_access'),
      srcId: fileId(c.file),
      dstId: dsId(c.targetService),
      kind: 'db_access',
      confidence: conf,
      origin: 'deterministic',
      evidence: [evidence(c.file, c.line, c.snippet, `connection (${c.how})`)],
      detail: { database: c.targetService },
    });
  }

  // ---------- manifest-declared datastore/broker wiring without code evidence ----------
  // Shared-library indirection (e.g. a common package owning the mongoose.connect call)
  // makes some connections unattributable from code. Compose declaring MONGO_URL on a
  // service is still a strong, evidence-backed signal — emit at reduced confidence.
  const svcTargetPairs = new Set<string>();
  for (const t of input.tables) {
    const ds = datastoreFor(t.service);
    if (ds) svcTargetPairs.add(`${t.service}|${ds}`);
  }
  for (const c of input.connections) svcTargetPairs.add(`${c.service}|${c.targetService}`);
  for (const op of input.queueOps) {
    const b = brokerFor(op.service);
    if (b) svcTargetPairs.add(`${op.service}|${b}`);
  }
  for (const w of discovery.wires) {
    // db/broker-kind wires are the classic case (DATABASE_URL etc); addr-kind
    // wires also count when the target is itself a datastore/broker service —
    // this is what catches e.g. a C# service's REDIS_ADDR pointing at a redis
    // manifest workload with zero C# parsing (Online Boutique's cartservice).
    if (w.kind !== 'db' && w.kind !== 'broker' && w.kind !== 'addr') continue;
    const target = infraByName.get(w.targetService);
    if (!target) continue;
    if (w.kind === 'addr' && target.role !== 'datastore' && target.role !== 'broker') continue;
    const appSvc = discovery.services.find((s) => s.name === w.service && s.role === 'app');
    if (!appSvc) continue;
    if (svcTargetPairs.has(`${w.service}|${w.targetService}`)) continue;
    edges.push({
      id: nextEdgeId('db_access'),
      srcId: svcId(w.service),
      dstId: dsId(w.targetService),
      kind: 'db_access',
      confidence: 0.7,
      origin: 'deterministic',
      evidence: [
        evidence(
          w.sourceFile ?? discovery.composeFile,
          w.composeLine ?? 1,
          `${w.envKey}: ${w.value}`,
          `declared in ${manifestSourceLabel(discovery, w.sourceFile)}; connection code not located (likely in a shared library or an out-of-scope language)`
        ),
      ],
      detail: { database: w.targetService, envVar: w.envKey },
    });
  }

  // ---------- SPA public env wiring (manifest-declared frontend → API) ----------
  // When compose/Dockerfile wires VITE_* / NEXT_PUBLIC_* / REACT_APP_* to an
  // in-graph HTTP target, emit a service-level edge even when client-call
  // detection missed import.meta.env (static bundle). No invented hosts.
  for (const w of discovery.wires) {
    if (!SPA_PUBLIC_ENV_RE.test(w.envKey)) continue;
    if (w.kind !== 'http') continue;
    if (!appServiceNames.has(w.service) || !appServiceNames.has(w.targetService)) continue;
    if (w.service === w.targetService) continue;
    const pairKey = `${w.service}|${w.targetService}`;
    if (httpSvcPairs.has(pairKey)) continue;
    httpSvcPairs.add(pairKey);
    edges.push({
      id: nextEdgeId('http'),
      srcId: svcId(w.service),
      dstId: svcId(w.targetService),
      kind: 'http',
      confidence: 0.75,
      origin: 'deterministic',
      evidence: [
        evidence(
          w.sourceFile ?? discovery.composeFile,
          w.composeLine ?? 1,
          `${w.envKey}: ${w.value}`,
          `SPA public env declared in ${manifestSourceLabel(discovery, w.sourceFile)}; client call not located (likely bundled import.meta.env)`
        ),
      ],
      detail: { targetService: w.targetService, envVar: w.envKey },
    });
  }

  /*
   * ══ PROVENANCE, STAMPED AT THE SINGLE EXIT ═════════════════════════════
   *
   * `origin` says how confidently an edge was derived and nothing about WHERE.
   * CANON records what that cost: `svc:gateway`'s only two inbound edges were
   * nginx confs inside TEST FIXTURES, both `origin: 'deterministic'` — honestly
   * produced, and wrong about the world.
   *
   * Stamped HERE rather than at the ten `edges.push` sites above, deliberately.
   * A field every producer must remember to set is a field that is right until
   * the eleventh producer, and the eleventh producer is the one whose edge
   * nobody checks. `actor` is read off the edge's own kind — which in this
   * joiner IS which detector's facts it came from — and `instrument` off its
   * evidence, so neither can drift from what the edge actually is.
   */
  stampProvenance(edges);

  return {
    edges,
    topics,
    warnings,
    // Sorted so a scan is byte-stable: the board's node order must not depend on
    // which file the parser happened to reach first.
    inferredDatastores: [...inferredByService.values()].map((d) => ({
      ...d,
      tables: [...d.tables].sort(),
    })),
  };
}
