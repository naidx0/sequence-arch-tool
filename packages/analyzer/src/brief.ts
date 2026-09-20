import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkScaffoldability,
  validateGraph,
  type ArchEdge,
  type ArchGraph,
  type ArchNode,
} from '@sequence/schema';

/**
 * Render a design-mode spec into a single self-sufficient scaffolding brief
 * (markdown). The brief embeds the load-bearing rules of
 * docs/SCAFFOLDING_CONTRACT.md inline — the agent executing it gets ONLY the
 * brief, never this repo — plus the spec's concrete per-service task list and
 * the exact docker-compose.yml to produce.
 *
 * Deterministic by construction: a pure function of the spec file's contents
 * (nodes/edges are walked in spec order; no timestamps, no randomness), so the
 * same spec always renders a byte-identical brief.
 */

/** Env var law: <TARGET_LABEL_UPPERCASED>_URL, non-alphanumerics -> '_'. */
function httpEnvVar(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_URL';
}

/** Port law: py (fastapi/uvicorn) -> 8000, everything else -> 3000. */
function portOf(node: ArchNode): number {
  return node.meta?.language === 'py' ? 8000 : 3000;
}

/** Realize a `*`-skeleton path with concrete parameters per style. */
function realizePath(
  pattern: string,
  style: 'express' | 'fastapi' | 'client-ts' | 'client-py'
): string {
  let n = 0;
  return pattern
    .split('/')
    .map((seg) => {
      if (seg !== '*') return seg;
      n++;
      switch (style) {
        case 'express':
          return `:p${n}`;
        case 'fastapi':
          return `{p${n}}`;
        case 'client-ts':
          return `\${p${n}}`;
        case 'client-py':
          return `{p${n}}`;
      }
    })
    .join('/');
}

interface Wire {
  key: string;
  value: string;
  target: string; // compose service name the wire points at
}

interface ServicePlan {
  node: ArchNode;
  language: string; // 'ts' | 'py'
  framework?: string;
  port: number;
  wires: Wire[];
  dependsOn: string[];
  inboundHttp: { edge: ArchEdge; from: ArchNode }[];
  outboundHttp: { edge: ArchEdge; to: ArchNode }[];
  publishes: { edge: ArchEdge; topic: string; broker: ArchNode }[];
  consumes: { edge: ArchEdge; topic: string; broker: ArchNode }[];
  dbEdges: { edge: ArchEdge; table: string; datastore: ArchNode }[];
}

function fail(msg: string): never {
  throw new Error(msg);
}

/**
 * Render a brief from an IN-MEMORY graph (the platform server's `/api/generate`
 * has the spec as a JS object, not a file). `renderBrief` is intentionally a
 * pure function of a spec FILE, so this wrapper stages the graph to a throwaway
 * temp file and delegates — mirroring how server/repoServer.ts stages diffs.
 * `renderBrief` itself is unchanged; this only adds an entry point.
 */
export function renderBriefFromGraph(graph: ArchGraph): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-brief-'));
  try {
    const specPath = path.join(dir, 'spec.json');
    fs.writeFileSync(specPath, JSON.stringify(graph));
    return renderBrief(specPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface ScopeResult {
  /** The carved sub-spec: the chosen nodes + their containment ancestors, and
   *  every edge whose BOTH endpoints survive. Still a design-mode graph. */
  scoped: ArchGraph;
  /** Edges with EXACTLY ONE endpoint inside the selection — excluded from the
   *  scoped graph and returned so the UI can warn that they cross the boundary. */
  droppedEdges: ArchEdge[];
}

/**
 * Carve a coherent sub-spec out of `graph` for "generate just this selection".
 *
 * The scoped graph contains:
 *  - every requested node id that exists in `graph`;
 *  - the repo root node, always (parentId chains must terminate there);
 *  - each kept node's containment ancestors — so a selected topic pulls in its
 *    broker datastore parent, and everything ultimately pulls the repo root.
 *    This auto-completion is what keeps the result's parentId chains closed, so
 *    it passes `validateGraph` unchanged;
 *  - every edge with BOTH endpoints in the kept set.
 *
 * Edges with exactly one endpoint inside are dropped and reported in
 * `droppedEdges` (they cross the selection boundary — e.g. a worker's
 * queue_consume of a selected topic when the worker itself was not selected).
 * Edges fully outside the selection are silently omitted (they are not part of,
 * and do not touch, the scope).
 *
 * Pure and side-effect-free; does not mutate `graph`. The caller is responsible
 * for re-running validateGraph / checkScaffoldability on `scoped` (the platform
 * server refuses an unscaffoldable scope with 422 before spending any tokens).
 */
export function scopeGraph(graph: ArchGraph, nodeIds: string[]): ScopeResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  for (const id of nodeIds) if (byId.has(id)) keep.add(id);
  // The repo root(s) always come along.
  for (const n of graph.nodes) if (n.kind === 'repo') keep.add(n.id);
  // Pull in the containment ancestors of every kept node (topic → broker → repo).
  for (const id of [...keep]) {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      keep.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges: ArchEdge[] = [];
  const droppedEdges: ArchEdge[] = [];
  for (const e of graph.edges) {
    const s = keep.has(e.srcId);
    const d = keep.has(e.dstId);
    if (s && d) edges.push(e);
    else if (s !== d) droppedEdges.push(e); // exactly one endpoint inside
    // neither endpoint inside ⇒ fully outside the scope; omit silently.
  }
  const scoped: ArchGraph = { ...graph, nodes, edges, warnings: [] };
  return { scoped, droppedEdges };
}

export function renderBrief(specPath: string): string {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as ArchGraph;

  // Two independent gates, in order:
  //   1. structural validity (ids, containment, evidence, kind-constrained
  //      targets) — `validateGraph`.
  //   2. scaffoldability (design mode, scaffoldable edge kinds, safe labels and
  //      tables, ≥1 service, per-service language, per-datastore tech, and every
  //      edge's detail/target requirements) — `checkScaffoldability`.
  // The second lives in @sequence/schema as the SINGLE source of truth for these
  // rules (the web design panel imports the same predicate), so the guards below
  // and the browser badge can never drift. Everything past this point may assume
  // both gates passed and use non-null assertions accordingly.
  const problems = validateGraph(spec);
  if (problems.length > 0) {
    fail(`invalid spec (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${problems.join('; ')}`);
  }
  const notScaffoldable = checkScaffoldability(spec);
  if (notScaffoldable.length > 0) {
    fail(notScaffoldable.join('; '));
  }

  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const services = spec.nodes.filter((n) => n.kind === 'service');
  const datastores = spec.nodes.filter((n) => n.kind === 'datastore');
  const topics = spec.nodes.filter((n) => n.kind === 'topic');

  // checkScaffoldability guarantees every topic is parented under a redis
  // datastore broker, so this is a plain lookup, not a guard.
  const brokerOfTopic = (t: ArchNode): ArchNode => byId.get(t.parentId!)!;

  // ---- build per-service plans (spec order everywhere) ----
  const plans: ServicePlan[] = services.map((node) => {
    // checkScaffoldability guarantees meta.language is 'ts' | 'py'.
    const language = node.meta!.language as 'ts' | 'py';
    // meta.framework is NOT trusted as-authored. In v4 it was a user-picked
    // dropdown (a manual opt-out for pure-consumer workers), which let a stale
    // value scaffold a phantom HTTP server — or, unset, let a real HTTP callee
    // fall through to the "no server needed" skeleton while its routes section
    // still demanded a handler. The framework is derived from the service's
    // actual http edges below (see the derivation after the edge loop); this
    // captured value is used only to detect an authored value that contradicts
    // the derivation and fail loudly.
    const declaredFramework = node.meta?.framework as string | undefined;
    const plan: ServicePlan = {
      node,
      language,
      framework: undefined, // DERIVED from http edges after the edge loop below
      port: portOf(node),
      wires: [],
      dependsOn: [],
      inboundHttp: [],
      outboundHttp: [],
      publishes: [],
      consumes: [],
      dbEdges: [],
    };
    const addWire = (key: string, value: string, target: string) => {
      const existing = plan.wires.find((w) => w.key === key);
      if (existing) {
        if (existing.value !== value) {
          fail(`service ${node.label}: env var ${key} would need two values (${existing.value} vs ${value}) — one ${key} per service`);
        }
        return;
      }
      plan.wires.push({ key, value, target });
      if (!plan.dependsOn.includes(target)) plan.dependsOn.push(target);
    };

    for (const e of spec.edges) {
      if (e.kind === 'import') continue;
      // Every scaffoldability precondition (edge kind, http detail, queue/db
      // targets and details, tech) was already enforced by checkScaffoldability
      // above; the non-null assertions below are safe as a result.
      if (e.dstId === node.id && e.kind === 'http') {
        const from = byId.get(e.srcId)!;
        plan.inboundHttp.push({ edge: e, from });
      }
      if (e.srcId !== node.id) continue;
      if (e.kind === 'http') {
        const to = byId.get(e.dstId)!;
        plan.outboundHttp.push({ edge: e, to });
        addWire(httpEnvVar(to.label), `http://${to.label}:${portOf(to)}`, to.label);
      } else if (e.kind === 'queue_publish' || e.kind === 'queue_consume') {
        const topicNode = byId.get(e.dstId)!;
        const broker = brokerOfTopic(topicNode);
        const entry = { edge: e, topic: topicNode.label, broker };
        if (e.kind === 'queue_publish') plan.publishes.push(entry);
        else plan.consumes.push(entry);
        addWire('REDIS_URL', `redis://${broker.label}:6379`, broker.label);
      } else if (e.kind.startsWith('db_')) {
        const ds = byId.get(e.dstId)!;
        plan.dbEdges.push({ edge: e, table: e.detail!.table!, datastore: ds });
        // Scheme is `postgresql://`, not the legacy `postgres://` alias: the
        // pinned SQLAlchemy (2.x) removed the `postgres://` dialect alias and
        // raises NoSuchModuleError on it at engine construction — a scaffold
        // wired with `postgres://` cannot boot its DB. `postgresql://` is the
        // canonical form accepted by libpq, psycopg2, node-pg and SQLAlchemy
        // alike, and the scanner's wire parser maps BOTH schemes to a db wire
        // (discovery/shared.ts SCHEME_KIND), so this change is boot-fixing and
        // scan-invisible. See the packaging law in docs/SCAFFOLDING_CONTRACT.md.
        addWire('DATABASE_URL', `postgresql://app:app@${ds.label}:5432/${spec.repoName}`, ds.label);
      }
    }

    // ---- derive the framework from actual HTTP participation ----
    // A service needs an HTTP-serving skeleton iff it participates in at least
    // one http edge — inbound (it is called, so it must serve routes) OR
    // outbound (an api-gateway / BFF that fans out; its reason to exist is to
    // receive external requests — callers the spec does not model as nodes —
    // and forward them, so it too needs the framework's server). Which
    // framework is then FULLY determined by language: ts ⇒ express, py ⇒
    // fastapi. A service with no http edge at all (a pure queue/db worker) gets
    // no framework and renders the plain long-running-process skeleton.
    //
    // Note this keys on http participation, not "inbound http" alone: the
    // v4-report phrasing said "infer from inbound http edges", but the ticketing
    // `gateway` is a genuine express server with ZERO inbound edges (only
    // outbound calls to `api`) — keying on inbound alone would wrongly demote it
    // to a plain process. Outbound-vs-none is exactly what separates a gateway
    // (express) from a pure consumer worker (plain), so http participation is
    // the correct, edge-derived signal.
    if (plan.inboundHttp.length > 0 || plan.outboundHttp.length > 0) {
      const derived: 'express' | 'fastapi' = language === 'py' ? 'fastapi' : 'express';
      // An authored meta.framework that disagrees with the language-derived
      // value (e.g. a `py` service tagged `express`, or a stray `next`) is a
      // genuine spec error. Fail loudly rather than silently overriding — a
      // silent override would mask an authoring mistake, and every other
      // guard in this file fails on contradictory input in the same style.
      if (declaredFramework !== undefined && declaredFramework !== derived) {
        fail(
          `service ${node.label}: meta.framework "${declaredFramework}" contradicts the framework derived from language "${language}" (⇒ "${derived}") for a service on an http edge — omit meta.framework (it is derived) or correct it`
        );
      }
      plan.framework = derived;
    }
    // else: no http edge — leave framework undefined. Any authored
    // meta.framework on such a service (a stale value from editing) is ignored:
    // the service cannot serve routes, so it renders the plain-process skeleton
    // and emits no "### Routes to expose" section (inboundHttp.length is 0).

    return plan;
  });

  // ---- docker-compose.yml, rendered in full ----
  const compose: string[] = ['services:'];
  for (const p of plans) {
    compose.push(`  ${p.node.label}:`);
    compose.push(`    build: ./${p.node.label}`);
    // Ports law (v5): publish a host port only for an *entry-point* service — one
    // that runs an HTTP server (a framework was derived) AND has zero inbound
    // http edges from other modeled services, so the only thing that can call it
    // is an external client the spec's vocabulary does not model as a node. Such
    // a service is mapped `"<port>:<port>"` (host == container, per the Port law)
    // so real traffic can reach it for testing. Services reached only internally
    // (they have an inbound http edge) stay on the compose network by name and
    // need no host surface; pure workers (no HTTP server) get no port at all.
    if (p.framework !== undefined && p.inboundHttp.length === 0) {
      compose.push('    ports:');
      compose.push(`      - "${p.port}:${p.port}"`);
    }
    if (p.wires.length > 0) {
      compose.push('    environment:');
      for (const w of p.wires) compose.push(`      ${w.key}: ${w.value}`);
    }
    if (p.dependsOn.length > 0) {
      compose.push('    depends_on:');
      for (const d of p.dependsOn) compose.push(`      - ${d}`);
    }
    compose.push('');
  }
  for (const ds of datastores) {
    const tech = ds.meta?.tech;
    if (tech === 'postgres') {
      compose.push(`  ${ds.label}:`);
      compose.push('    image: postgres:16');
      compose.push('    environment:');
      compose.push(`      POSTGRES_DB: ${spec.repoName}`);
      compose.push('      POSTGRES_USER: app');
      compose.push('      POSTGRES_PASSWORD: app');
      compose.push('');
    } else if (tech === 'redis') {
      compose.push(`  ${ds.label}:`);
      compose.push('    image: redis:7');
      compose.push('');
    } else {
      // Unreachable: checkScaffoldability rejects any datastore whose tech is
      // not postgres|redis. Guard the invariant rather than silently skip.
      fail(`internal: datastore ${ds.id} reached compose rendering with unsupported tech ${JSON.stringify(tech)} (checkScaffoldability should have rejected it)`);
    }
  }
  const composeYaml = compose.join('\n').trimEnd() + '\n';

  // ---- the brief ----
  const L: string[] = [];
  const out = (s = '') => L.push(s);

  out(`# Scaffolding brief: ${spec.repoName}`);
  out();
  out('Generated by `sequence scaffold-brief` from a design-mode architecture spec.');
  out('Execute every rule below exactly — they are what make the scaffold a faithful,');
  out('runnable implementation of the spec.');
  out();
  out('**What conformance actually checks.** `sequence diff` compares each edge as');
  out('service-pair + direction + kind, where kind is one of `http`, `queue_publish`,');
  out('`queue_consume`, `db_access` (only `db_read`/`db_write`/`db_access` collapse to');
  out('`db_access`; publish vs consume ARE distinguished). On top of that, for a');
  out('design-mode spec it now **also** compares detail: HTTP **method and path**, and');
  out('DB **table name** — wiring the wrong method, path, or table is reported as');
  out('"Wrong wiring details" and fails the diff (exit 3). Matching is tolerant: an');
  out('unspecified or wildcard field on either side (a `*` path segment, an omitted');
  out('method) imposes no constraint, and path shapes are compared structurally so');
  out('`/tickets/{id}`, `/tickets/:id` and `/tickets/*` are equivalent. Queue topics');
  out('are already identified by the edge itself, so there is no extra topic detail to');
  out('check. Follow every rule below: the method, path, and table ones are now gated.');
  out();
  out('## The law');
  out();
  out('1. **Naming law.** Service directories and compose service names are the spec');
  out('   labels **verbatim** (no prefixes/suffixes/case changes). Topic strings in');
  out('   code are the topic labels **verbatim**, as inline string literals at every');
  out('   publish/subscribe call site — no constants, no config indirection.');
  out('2. **Env var law.** Cross-service wiring uses exactly these env var names,');
  out('   declared in `docker-compose.yml` `environment:` blocks (nowhere else):');
  out('   `<TARGET_LABEL_UPPERCASED>_URL` for HTTP (non-alphanumerics become `_`),');
  out('   `DATABASE_URL` for the database, `REDIS_URL` for the broker.');
  out('3. **Port law.** Python/fastapi services listen on 8000; TypeScript services');
  out('   listen on 3000. HTTP env wires point at `http://<label>:<port>`. An');
  out('   entry-point service (runs an HTTP server AND is called by nothing else in');
  out('   the spec) also publishes its port to the host as `"<port>:<port>"` so real');
  out('   traffic can reach it; internally-reached services need no host mapping.');
  out('4. **No extra cross-service calls.** Any HTTP call, queue operation, or SQL');
  out('   statement reaching another service that is not listed below is a defect.');
  out('   A local `GET /health` route per service is allowed (it produces no edge),');
  out('   but never call another service\'s health endpoint.');
  out('5. **Both sides of every HTTP edge.** The caller ships the client call AND the');
  out('   callee ships the matching route (same method, matching path shape).');
  out('6. **Direct env access only.** `process.env.X` inside the call\'s template');
  out('   literal, or a module-level `X = os.environ["X"]` in the same file as the');
  out('   call. No dotenv files, no config modules, no re-exports.');
  out('7. **Dockerfile base images.** TypeScript services: `FROM node:20-slim`.');
  out('   Python services: `FROM python:3.12-slim`. Infra runs stock images and has');
  out('   no source directory.');
  out('8. **Packaging & start law.** TypeScript: **npm**, entry `index.ts`, `npm');
  out('   start` runs `tsx index.ts`. Python: **pip** + `requirements.txt`; an HTTP');
  out('   service starts with `uvicorn app.main:app --host 0.0.0.0 --port <port>`, a');
  out('   pure worker with `python main.py`. No committed lockfiles. The database');
  out('   wire uses the `postgresql://` scheme (the legacy `postgres://` alias is');
  out('   rejected by SQLAlchemy 2.x). Each service\'s per-service Packaging block');
  out('   below states its exact manager, manifest, start command and runtime.');
  out();
  out('## docker-compose.yml (produce this file verbatim at the repo root)');
  out();
  out('```yaml');
  out(composeYaml.trimEnd());
  out('```');

  for (const p of plans) {
    const hint = p.framework ? `${p.language} / ${p.framework}` : p.language;
    out();
    out(`## Service \`${p.node.label}\` (${hint})`);
    out();
    out(`Directory \`./${p.node.label}\`. Dockerfile first line: \`FROM ${p.language === 'py' ? 'python:3.12-slim' : 'node:20-slim'}\`.`);
    if (p.framework === 'express') {
      out(`Minimal skeleton: an express app (\`app.use(express.json())\`) listening on port ${p.port}, plus \`app.get('/health', (_req, res) => res.json({ ok: true }))\`.`);
    } else if (p.framework === 'fastapi') {
      out(`Minimal skeleton: \`app = FastAPI(title="${p.node.label}")\` served by uvicorn on port ${p.port}, plus a \`@app.get("/health")\` route.`);
    } else if (p.language === 'ts') {
      out('Minimal skeleton: a plain long-running node process (no HTTP server needed).');
    } else {
      out('Minimal skeleton: a plain long-running python process (no HTTP server needed).');
    }

    // ---- Packaging (deterministically derived from language + framework) ----
    out();
    out('### Packaging');
    out();
    if (p.language === 'py') {
      // py http services boot under uvicorn (module app.main:app); a pure worker
      // (no framework) is a plain `python main.py` process.
      const startCmd = p.framework
        ? `uvicorn app.main:app --host 0.0.0.0 --port ${p.port}`
        : 'python main.py';
      out('- Package manager: **pip**. No committed lockfile — `pip install -r');
      out('  requirements.txt` installs the exact `==`-pinned versions in that file.');
      out('- Dependency manifest: `requirements.txt` (exact `==` pins, one per line).');
      out(`- Start command: \`${startCmd}\`.`);
      out('- Runtime: `python:3.12-slim` (the Dockerfile base image; the container');
      out(`  \`CMD\` is this start command).`);
    } else {
      // ts: npm + tsx entrypoint. `npm start` is the single boot verb whether the
      // service is an express server or a plain worker — the entry file differs
      // in content, not in name.
      out('- Package manager: **npm**. No committed lockfile — `npm install` resolves');
      out('  the ranges in `package.json` at build time.');
      out('- Dependency manifest: `package.json` with `"scripts": { "start": "tsx');
      out('  index.ts" }` (the entry file is always `index.ts`).');
      out('- Start command: `npm start` (runs `tsx index.ts`).');
      out('- Runtime: `node:20-slim` (the Dockerfile base image; the container `CMD`');
      out('  is `["npm", "start"]`).');
    }

    if (p.inboundHttp.length > 0) {
      out();
      out('### Routes to expose');
      out();
      for (const { edge, from } of p.inboundHttp) {
        const d = edge.detail!;
        const method = d.method!;
        const pattern = d.pathPattern!;
        if (p.framework === 'fastapi') {
          const route = realizePath(pattern, 'fastapi');
          out(`- \`${method} ${pattern}\` (called by \`${from.label}\`):`);
          out();
          out('  ```python');
          out(`  @app.${method.toLowerCase()}("${route}")`);
          out(`  def handler${route.replace(/[^a-z0-9]+/gi, '_')}(...): ...`);
          out('  ```');
        } else {
          const route = realizePath(pattern, 'express');
          out(`- \`${method} ${pattern}\` (called by \`${from.label}\`):`);
          out();
          out('  ```ts');
          out(`  app.${method.toLowerCase()}('${route}', handler);`);
          out('  ```');
        }
        out();
        out('  The path must be an inline string literal; realize each `*` as a path');
        out('  parameter exactly as shown.');
      }
    }

    if (p.outboundHttp.length > 0) {
      out();
      out('### HTTP clients to write');
      out();
      for (const { edge, to } of p.outboundHttp) {
        const d = edge.detail!;
        const method = d.method!;
        const pattern = d.pathPattern!;
        const envVar = httpEnvVar(to.label);
        out(`- \`${method} ${pattern}\` against \`${to.label}\` via env \`${envVar}\`:`);
        out();
        if (p.language === 'py') {
          const path = realizePath(pattern, 'client-py');
          out('  ```python');
          out('  import os');
          out('  import httpx');
          out();
          out(`  ${envVar} = os.environ["${envVar}"]`);
          out();
          out('  async with httpx.AsyncClient() as client:');
          out(`      r = await client.${method.toLowerCase()}(f"{${envVar}}${path}")`);
          out('  ```');
        } else {
          const path = realizePath(pattern, 'client-ts');
          out('  ```ts');
          if (method === 'GET') {
            out(`  const r = await fetch(\`\${process.env.${envVar}}${path}\`);`);
          } else {
            out(`  const r = await fetch(\`\${process.env.${envVar}}${path}\`, {`);
            out(`    method: '${method}',`);
            out(`    headers: { 'content-type': 'application/json' },`);
            out('    body: JSON.stringify(payload),');
            out('  });');
            out('  ```');
            out();
            out(`  The \`method: '${method}'\` property must be an inline literal in the call's`);
            out('  options object.');
            continue;
          }
          out('  ```');
        }
      }
    }

    if (p.publishes.length > 0) {
      out();
      out('### Topics to publish');
      out();
      for (const { topic, broker } of p.publishes) {
        out(`- publish to \`${topic}\` on broker \`${broker.label}\` via env \`REDIS_URL\`:`);
        out();
        if (p.language === 'py') {
          out('  ```python');
          out('  import os');
          out('  import redis');
          out();
          out('  r = redis.from_url(os.environ["REDIS_URL"])');
          out(`  r.publish("${topic}", json.dumps(payload))`);
          out('  ```');
        } else {
          out('  ```ts');
          out(`  import { createClient } from 'redis';`);
          out('  const publisher = createClient({ url: process.env.REDIS_URL });');
          out('  await publisher.connect();');
          out(`  await publisher.publish('${topic}', JSON.stringify(payload));`);
          out('  ```');
        }
        out();
        out('  The topic string must be the inline literal shown — identical bytes.');
      }
    }

    if (p.consumes.length > 0) {
      out();
      out('### Topics to consume');
      out();
      for (const { topic, broker } of p.consumes) {
        out(`- subscribe to \`${topic}\` on broker \`${broker.label}\` via env \`REDIS_URL\`:`);
        out();
        if (p.language === 'py') {
          out('  ```python');
          out('  import os');
          out('  import redis');
          out();
          out('  r = redis.from_url(os.environ["REDIS_URL"])');
          out('  pubsub = r.pubsub()');
          out(`  pubsub.subscribe("${topic}")`);
          out('  for message in pubsub.listen(): ...');
          out('  ```');
        } else {
          out('  ```ts');
          out(`  import { createClient } from 'redis';`);
          out('  const subscriber = createClient({ url: process.env.REDIS_URL });');
          out('  await subscriber.connect();');
          out(`  await subscriber.subscribe('${topic}', (message) => {`);
          out('    // handle message');
          out('  });');
          out('  ```');
        }
        out();
        out('  The topic string must be the inline literal shown — identical bytes.');
      }
    }

    if (p.dbEdges.length > 0) {
      out();
      out('### Database');
      out();
      for (const { table, datastore } of p.dbEdges) {
        out(`- table \`${table}\` on \`${datastore.label}\` via env \`DATABASE_URL\`:`);
        out();
        if (p.language === 'py') {
          out('  ```python');
          out('  import os');
          out('  from sqlalchemy import create_engine, text');
          out();
          out('  engine = create_engine(os.environ["DATABASE_URL"])');
          out();
          out('  with engine.begin() as conn:');
          out(`      conn.execute(text("INSERT INTO ${table} (...) VALUES (...)"), params)`);
          out('  ```');
        } else {
          out('  ```ts');
          out(`  import pg from 'pg';`);
          out('  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });');
          out(`  await pool.query('INSERT INTO ${table} (...) VALUES ($1)', [value]);`);
          out('  ```');
        }
        out();
        out(`  Ship at least one SQL string literal naming \`${table}\` after`);
        out('  `FROM`/`INTO`/`UPDATE`. Any real statement on this table conforms.');
      }
    }
  }

  if (datastores.length > 0) {
    out();
    out('## Infrastructure (compose entries only — no source directories)');
    out();
    for (const ds of datastores) {
      const tech = ds.meta?.tech;
      out(`- \`${ds.label}\`: stock image \`${tech === 'postgres' ? 'postgres:16' : 'redis:7'}\` (already in the compose file above).`);
    }
  }
  if (topics.length > 0) {
    out();
    out('Topics are not artifacts — each exists only as its literal string in code:');
    for (const t of topics) {
      const broker = t.parentId ? byId.get(t.parentId) : undefined;
      out(`- \`${t.label}\` (broker: \`${broker?.label ?? '?'}\`)`);
    }
  }

  out();
  out('## Verify before you finish (mandatory)');
  out();
  out('From the scaffold, with the spec file available:');
  out();
  out('```bash');
  out('sequence scan <scaffold-dir> --out scanned.json');
  out('sequence diff <spec.json> scanned.json');
  out('```');
  out();
  out('`diff` must exit 0 and print `Implementation conforms to spec — no drift.`');
  out('"Missing from implementation" means a required artifact above is absent or');
  out('misnamed; "Not in spec" means you added an undeclared cross-service call.');
  out('Fix, rescan, re-diff — iterate until the report is clean. Do not stop with a');
  out('non-empty conformance report.');
  out();

  return L.join('\n');
}
