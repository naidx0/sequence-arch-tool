/**
 * Deterministic product-type classifier (v9 Phase 3b).
 *
 * Given a real {@link ArchGraph}, decide what KIND of product the repo is —
 * a mobile app, a single-page app, a microservice mesh, a CLI, a data
 * pipeline, and so on — via a fixed, FIRST-MATCH precedence cascade. This is a
 * PURE function of the graph: no filesystem, no network, no LLM. The same graph
 * always yields the same type, and the `matchedSignals` it returns make the
 * decision inspectable (the honest line: classification is a deterministic read
 * of detected signals + graph shape, never an AI guess).
 *
 * Two evidence sources feed the cascade:
 *  - **Framework / category signals** — `meta.signals` (coarse buckets: mobile /
 *    frontend / backend / serverless / pipeline / ml / infra / cli / library +
 *    language) and `meta.frameworks` / `meta.framework`, populated by the
 *    code-first (manifest-LESS) scan path for pure frontend/mobile/CLI/library
 *    repos. Manifest repos (compose/k8s/helm) do NOT carry these.
 *  - **Graph SHAPE** — service count, interaction edges (http/grpc/queue/db),
 *    datastores. This is how MANIFEST repos (which have no signals) are typed:
 *    ≥2 services or a service mesh ⇒ microservices; a single server with a data
 *    store ⇒ server-web; a single server with only a JSON API ⇒ monolith.
 */

import type { ArchGraph, ArchNode } from './index.js';

/** The product types the cascade can assign (research table). */
export type ProjectType =
  | 'mobile'
  | 'spa'
  | 'server-web'
  | 'microservices'
  | 'monolith'
  | 'cli'
  | 'library'
  | 'pipeline'
  | 'ml'
  | 'serverless'
  | 'game'
  | 'infra'
  | 'embedded'
  | 'generic';

export interface ClassifyResult {
  type: ProjectType;
  /** The concrete signals / shape facts that drove the decision (inspectable). */
  matchedSignals: string[];
  /**
   * How much the verdict rests on real domain evidence vs. bare graph shape:
   *  - `'high'` — a definite framework/category SIGNAL match (mobile / spa / cli /
   *    serverless / pipeline / ml / infra / library …).
   *  - `'thin'` — a pure graph-SHAPE match (the manifest-repo rules: ≥2 services ⇒
   *    microservices; single service + datastore ⇒ server-web; single service ⇒
   *    monolith). Deterministic and defensible, but low-information: a real mesh
   *    and a 2-process app read identically here.
   *  - `'low'` — the shape heuristics for a lone service with no signals, or the
   *    generic fallback.
   */
  confidence: 'high' | 'thin' | 'low';
}

/** Union of a string-array meta field across all nodes (e.g. `signals`). */
function collectMetaArray(graph: ArchGraph, key: string): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const v = n.meta?.[key];
    if (Array.isArray(v)) {
      for (const s of v) if (typeof s === 'string') out.add(s);
    }
  }
  return out;
}

/** Union of the single-label `meta.framework` across all nodes. */
function collectFrameworkLabels(graph: ArchGraph): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const fw = n.meta?.framework;
    if (typeof fw === 'string' && fw !== '') out.add(fw);
  }
  return out;
}

/**
 * Classify the product type of a repository from its {@link ArchGraph}.
 *
 * The precedence cascade (first match wins) mirrors the v9 research table:
 *   (1) IaC-only → infra
 *   (2) firmware toolchain → embedded
 *   (3) serverless (serverless.yml / SAM) → serverless
 *   (4) airflow/dbt/dagster/prefect → pipeline
 *   (5) ML (train + notebooks/tracking) → ml
 *   (6) game engine → game
 *   (7) mobile manifests (RN / Flutter / iOS / Android) → mobile
 *   (8) CLI (bin + parser, no server) → cli
 *   (9) published package, no app entrypoint/server → library
 *  (10) ≥2 services / mesh / k8s multi-service → microservices
 *  (11) server framework + datastore (ORM/migrations/templates) → server-web
 *  (12) server framework + JSON API only → monolith
 *  (13) frontend framework, no server → spa
 *  (14) fallback → generic
 *
 * Rules 1–9 and 13 read the code-first framework/category SIGNALS (absent on
 * manifest repos, so they never fire there); rules 10–12 read graph SHAPE, which
 * is how manifest repos — the six reference gates — are typed.
 */
export function classifyProject(graph: ArchGraph): ClassifyResult {
  const signals = collectMetaArray(graph, 'signals');
  const frameworks = collectMetaArray(graph, 'frameworks');
  const fwLabels = collectFrameworkLabels(graph);
  const allMarkers = new Set<string>([...frameworks, ...fwLabels]);

  const has = (s: string): boolean => signals.has(s);
  const marker = (m: string): boolean => allMarkers.has(m);

  // --- graph shape ---
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  const serviceCount = services.length;
  const edgeKinds = new Set(graph.edges.map((e) => e.kind));
  const hasMesh = edgeKinds.has('grpc') || edgeKinds.has('queue_publish') || edgeKinds.has('queue_consume');
  const hasDbEdge = edgeKinds.has('db_read') || edgeKinds.has('db_write') || edgeKinds.has('db_access');
  const hasHttp = edgeKinds.has('http');
  const hasDatastore = datastores.length > 0;

  // "App" signals that disqualify an IaC-only classification.
  const appSignal =
    has('frontend') ||
    has('backend') ||
    has('mobile') ||
    has('serverless') ||
    has('pipeline') ||
    has('ml') ||
    has('cli') ||
    has('library');

  const result = (
    type: ProjectType,
    matchedSignals: string[],
    confidence: 'high' | 'thin' | 'low' = 'high'
  ): ClassifyResult => ({
    type,
    matchedSignals,
    confidence,
  });

  // (1) IaC-only → infra. Infra signal present and no other app concern.
  if (has('infra') && !appSignal) {
    return result('infra', ['signal:infra']);
  }

  // (2) firmware toolchain → embedded (platformio / arduino / zephyr / esp-idf).
  if (marker('platformio') || marker('arduino') || marker('zephyr') || marker('esp-idf')) {
    return result('embedded', [...['platformio', 'arduino', 'zephyr', 'esp-idf'].filter(marker).map((m) => `framework:${m}`)]);
  }

  // (3) serverless (serverless.yml / SAM) → serverless.
  if (has('serverless')) {
    const m = ['signal:serverless'];
    if (marker('serverless')) m.push('framework:serverless');
    return result('serverless', m);
  }

  // (4) airflow/dbt/dagster/prefect → pipeline.
  if (has('pipeline')) {
    const m = ['signal:pipeline'];
    for (const f of ['airflow', 'dbt', 'dagster', 'prefect']) if (marker(f)) m.push(`framework:${f}`);
    return result('pipeline', m);
  }

  // (5) ML (train + notebooks/tracking) → ml.
  if (has('ml')) {
    const m = ['signal:ml'];
    for (const f of ['pytorch', 'tensorflow', 'scikit-learn', 'jax']) if (marker(f)) m.push(`framework:${f}`);
    return result('ml', m);
  }

  // (6) game engine files → game (unity / unreal / godot / phaser).
  if (marker('unity') || marker('unreal') || marker('godot') || marker('phaser')) {
    return result('game', ['unity', 'unreal', 'godot', 'phaser'].filter(marker).map((m) => `framework:${m}`));
  }

  // (7) mobile manifests → mobile.
  if (has('mobile')) {
    const m = ['signal:mobile'];
    for (const f of ['react-native', 'flutter', 'ios', 'android']) if (marker(f)) m.push(`framework:${f}`);
    return result('mobile', m);
  }

  // (8) CLI (bin + parser, no server) → cli.
  if (has('cli') && !has('backend')) {
    return result('cli', ['signal:cli', ...(marker('cli') ? ['framework:cli'] : [])]);
  }

  // (9) published package, no app entrypoint/server → library.
  if (has('library') && !has('backend') && !has('frontend')) {
    return result('library', ['signal:library']);
  }

  // (10) ≥2 services / mesh / k8s multi-service → microservices.
  if (serviceCount >= 2 || (hasMesh && serviceCount >= 1)) {
    const m = [`services:${serviceCount}`];
    if (edgeKinds.has('grpc')) m.push('edge:grpc');
    if (edgeKinds.has('queue_publish') || edgeKinds.has('queue_consume')) m.push('edge:queue');
    if (edgeKinds.has('http')) m.push('edge:http');
    // Pure graph-SHAPE match (no domain signal) → 'thin': a genuine mesh and a
    // 2-process app are indistinguishable here.
    return result('microservices', m, 'thin');
  }

  // (11) server framework + datastore (ORM/migrations/templates) → server-web.
  if (serviceCount === 1 && (hasDatastore || hasDbEdge)) {
    const m = ['services:1', 'datastore'];
    const fw = [...fwLabels].find((f) => f !== '');
    if (fw) m.push(`framework:${fw}`);
    // Shape rule (single service + datastore) → 'thin'.
    return result('server-web', m, 'thin');
  }

  // (12) server framework + JSON API only → monolith.
  if (serviceCount === 1 && (has('backend') || hasHttp || fwLabels.size > 0) && !has('frontend')) {
    const m = ['services:1', 'json-api'];
    const fw = [...fwLabels].find((f) => f !== '');
    if (fw) m.push(`framework:${fw}`);
    // Shape rule (single service, JSON API only) → 'thin'.
    return result('monolith', m, 'thin');
  }

  // (13) frontend framework, no server → spa.
  if (has('frontend') && !has('backend')) {
    const m = ['signal:frontend'];
    for (const f of ['react', 'vue', 'svelte', 'angular', 'next.js', 'nuxt', 'remix', 'solid']) {
      if (marker(f)) m.push(`framework:${f}`);
    }
    return result('spa', m);
  }

  // Single-service repos that reach here (frontend service, no explicit signals)
  // are still an spa if the lone service looks frontend; otherwise generic.
  if (serviceCount === 1) {
    const svc = services[0];
    if (looksFrontend(svc)) return result('spa', ['services:1', 'shape:frontend'], 'low');
    return result('monolith', ['services:1', 'shape:service'], 'low');
  }

  // (14) fallback → generic.
  return result('generic', ['no-decisive-signal'], 'low');
}

/** Cheap frontend heuristic for a lone service with no category signals. */
function looksFrontend(svc: ArchNode): boolean {
  const fw = typeof svc.meta?.framework === 'string' ? svc.meta.framework : '';
  if (/next|nuxt|remix|react|vue|svelte|angular|solid/i.test(fw)) return true;
  const hay = `${svc.label} ${svc.path ?? ''}`;
  return /(^|[-_/\s])(web|www|frontend|front-end|ui|client|site|spa|dashboard|portal|storefront)($|[-_/\s])/i.test(hay);
}
