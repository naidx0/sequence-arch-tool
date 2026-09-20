import type { ArchGraph, ArchNode, EdgeKind, NodeKind } from './index.js';

/**
 * Scaffoldability check (V5 Phase B3).
 *
 * `validateGraph` answers "is this a structurally well-formed archgraph?" — ids,
 * containment, evidence rules, design-mode rules, kind-constrained targets. A
 * spec can pass ALL of that and still be impossible to turn into a running
 * scaffold: a service with no `meta.language`, an `http` edge with no method, a
 * `grpc` edge the scaffolder cannot wire, a datastore whose tech is neither
 * postgres nor redis. Those are *scaffoldability* problems, and until now they
 * only surfaced when a user ran `scaffold-brief` — too late (see
 * docs/V4_CLOSING_REPORT.md item 4).
 *
 * This function is the single, authoritative home for those rules. It is a pure,
 * side-effect-free, Node-free structural predicate (no fs, no process) so it
 * runs unchanged in the browser (the web design panel imports it) AND is the
 * up-front guard `renderBrief` delegates to — so the two can never drift apart.
 *
 * Returns a list of problems, empty ⇒ scaffoldable, following the exact same
 * convention as `validateGraph`. The two checks are INDEPENDENT signals: neither
 * calls the other, and a graph can be structurally valid yet unscaffoldable (a
 * design-mode service missing `meta.language` is the canonical example — that is
 * a `validateGraph` *warning*, but a scaffoldability *problem*).
 *
 * The rules, mirroring exactly what `renderBrief` requires to emit a faithful,
 * runnable scaffold:
 *  1. mode must be 'design' (a scan graph describes code that already exists).
 *  2. every edge kind must be scaffoldable: http, queue_publish, queue_consume,
 *     db_access, db_read, db_write (grpc / import cannot be wired).
 *  3. every service/datastore/topic label must be a safe identifier (it is
 *     interpolated verbatim into compose keys, directory names, code literals).
 *  4. every db-edge `detail.table` must be a safe SQL identifier.
 *  5. there must be at least one service node (nothing to scaffold otherwise).
 *  6. every service node needs `meta.language` in { ts, py }.
 *  7. every datastore node needs `meta.tech` in { postgres, redis } (its compose
 *     entry is a stock image chosen from the tech).
 *  8. every http edge needs `detail.method` AND `detail.pathPattern`, and must
 *     target a service node.
 *  9. every queue edge (publish/consume) must target a topic node whose label
 *     equals the edge's `detail.topic`, and that topic must be parented under a
 *     datastore node with `meta.tech === 'redis'` (the broker).
 * 10. every db edge (db_access/db_read/db_write) must target a datastore node
 *     with `meta.tech === 'postgres'`, and needs `detail.table`.
 *
 * NOTE on the boundary with `renderBrief`: two brief failures are NOT static
 * preconditions and stay in brief.ts as generation-time invariants — a per-
 * service env-var collision (two edges demanding the same env key with
 * different values) and an authored `meta.framework` that contradicts the
 * language-derived framework. Both are emergent properties of the *generation*,
 * not of the spec in isolation, so they are not part of this predicate.
 */

/** Edge kinds the scaffolder can generate wiring for. grpc/import are out. */
const SCAFFOLDABLE_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>([
  'http',
  'queue_publish',
  'queue_consume',
  'db_access',
  'db_read',
  'db_write',
]);

/**
 * Labels are interpolated verbatim into compose keys, `build: ./<label>`,
 * directory names and inline code literals; a space/quote/newline scaffolds to
 * guaranteed syntax failure.
 */
const LABEL_RE = /^[a-zA-Z][a-zA-Z0-9._-]*$/;
/** Table names land inside SQL string literals. */
const TABLE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const LABELED_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'service',
  'datastore',
  'topic',
]);

function isQueue(kind: EdgeKind): boolean {
  return kind === 'queue_publish' || kind === 'queue_consume';
}

function isDb(kind: EdgeKind): boolean {
  return kind === 'db_access' || kind === 'db_read' || kind === 'db_write';
}

/**
 * Return the scaffoldability problems of `g` (empty ⇒ scaffoldable). Pure and
 * side-effect-free — does not mutate `g` (unlike `validateGraph`, which appends
 * advisory warnings). Robust on malformed input: missing endpoints are skipped
 * rather than throwing, since `validateGraph` already reports those.
 */
export function checkScaffoldability(g: ArchGraph): string[] {
  const problems: string[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  // 1. design mode
  if (g.mode !== 'design') {
    problems.push(
      `scaffolding requires a design-mode spec (this graph has mode: ${g.mode ?? 'scan'})`
    );
  }

  // 2. scaffoldable edge kinds
  for (const e of g.edges) {
    if (!SCAFFOLDABLE_EDGE_KINDS.has(e.kind)) {
      problems.push(
        `edge ${e.id} has kind '${e.kind}' which scaffold-brief cannot generate wiring for (supported: http, queue_publish, queue_consume, db_access, db_read, db_write)`
      );
    }
  }

  // 3. safe labels
  for (const n of g.nodes) {
    if (LABELED_KINDS.has(n.kind) && !LABEL_RE.test(n.label)) {
      problems.push(
        `node ${n.id} has label ${JSON.stringify(n.label)} which is not a safe identifier — it is interpolated verbatim into compose keys, directory names and code literals (must match ${LABEL_RE.source})`
      );
    }
  }

  // 4. safe db table names
  for (const e of g.edges) {
    if (e.detail?.table !== undefined && !TABLE_RE.test(e.detail.table)) {
      problems.push(
        `edge ${e.id} has db table ${JSON.stringify(e.detail.table)} which is not a safe identifier (must match ${TABLE_RE.source})`
      );
    }
  }

  // 5. at least one service
  const services = g.nodes.filter((n) => n.kind === 'service');
  if (services.length === 0) {
    problems.push('spec has no service nodes — nothing to scaffold');
  }

  // 6. every service has a supported language
  for (const n of services) {
    const language = n.meta?.language;
    if (language !== 'ts' && language !== 'py') {
      problems.push(
        `service ${n.id} has unsupported meta.language ${JSON.stringify(language)} — the scaffolder supports 'ts' | 'py'`
      );
    }
  }

  // 7. every datastore has a supported tech
  for (const n of g.nodes) {
    if (n.kind !== 'datastore') continue;
    const tech = n.meta?.tech;
    if (tech !== 'postgres' && tech !== 'redis') {
      problems.push(
        `datastore ${n.id} has unsupported meta.tech ${JSON.stringify(tech)} — the scaffolder supports 'postgres' | 'redis'`
      );
    }
  }

  // 8/9/10. per-edge detail + target rules
  for (const e of g.edges) {
    const dst = byId.get(e.dstId); // undefined ⇒ validateGraph already flags it
    if (e.kind === 'http') {
      if (!e.detail?.method || !e.detail?.pathPattern) {
        problems.push(
          `http edge ${e.id} is missing detail.method/pathPattern — the brief cannot be rendered unambiguously`
        );
      }
      if (dst && dst.kind !== 'service') {
        problems.push(`http edge ${e.id} must target a service node (got ${dst.kind})`);
      }
    } else if (isQueue(e.kind)) {
      if (dst) {
        if (dst.kind !== 'topic') {
          problems.push(`queue edge ${e.id} must target a topic node (got ${dst.kind})`);
        } else {
          if (e.detail?.topic !== dst.label) {
            problems.push(
              `queue edge ${e.id}: detail.topic ${JSON.stringify(e.detail?.topic)} must equal the topic node label ${JSON.stringify(dst.label)}`
            );
          }
          const broker: ArchNode | undefined = dst.parentId ? byId.get(dst.parentId) : undefined;
          if (!broker || broker.kind !== 'datastore') {
            problems.push(
              `topic ${dst.id} must be parented under a broker datastore node`
            );
          } else if (broker.meta?.tech !== 'redis') {
            problems.push(
              `broker ${broker.id} has unsupported tech ${JSON.stringify(broker.meta?.tech)} — queue scaffolding supports redis only`
            );
          }
        }
      }
    } else if (isDb(e.kind)) {
      if (dst) {
        if (dst.kind !== 'datastore') {
          problems.push(`db edge ${e.id} must target a datastore node (got ${dst.kind})`);
        } else if (dst.meta?.tech !== 'postgres') {
          problems.push(
            `datastore ${dst.id} has unsupported tech ${JSON.stringify(dst.meta?.tech)} — db scaffolding supports postgres only`
          );
        }
      }
      if (!e.detail?.table) {
        problems.push(`db edge ${e.id} is missing detail.table`);
      }
    }
  }

  return problems;
}
