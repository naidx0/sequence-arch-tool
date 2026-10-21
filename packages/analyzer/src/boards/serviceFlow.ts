/* ══════════════════════════════════════════════════════════════════════════
   SERVICE FLOW — "generate workflow" for one service node
   packages/analyzer/src/boards/serviceFlow.ts

   A page-to-page user flow built from the SCAN, with no model in the loop:

     steps      the service's registered routes (graph.routes), minus health probes
     audience   admin or customer, from the path (/admin, /manage ...), the file's
                path, and role checks in the handler's own lines (isAdmin, hasRole
                ADMIN, admin_required ...); every step says WHY it was classed so
     edges      only from code: a redirect / link / form action in the handler that
                names another route, an http edge the graph already holds into or
                out of the handler; where the code names none, routes are chained by
                nesting (same first segment, shallow before deep, read before write)
                and those arrows are marked as ordering, not as found in code
     outcomes   a redirect target the scan cannot place, an error status the handler
                can return (shared per status), a call out to another service

   An honest empty result beats an invented flow: a service with no routes in the scan
   (a worker, a datastore) returns no steps and says so.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import type { ArchGraph, ArchNode, ArchRoute } from '@sequence/schema';
import {
  BOARD_CAPS,
  BoardError,
  applyBoardOps,
  createBoard,
  findBoard,
  listBoards,
  readBoard,
  type BoardOp,
} from './boardStore.js';
import { buildItem, composeOps, type DrawOp } from './compose.js';

export type FlowAudience = 'auto' | 'admin' | 'customer';

export interface FlowStep {
  id: string;
  kind: 'page' | 'action' | 'outcome' | 'entry' | 'call';
  label: string;
  method?: string;
  path?: string;
  file?: string;
  line?: number;
  audience?: 'admin' | 'customer';
  /** Why a route was classed admin or customer. */
  why?: string;
}

export interface FlowLink {
  from: string;
  to: string;
  /** `code`: found in the source or the graph. `order`: chained by route nesting, not found in code. */
  basis: 'code' | 'order';
  detail?: string;
}

export interface ServiceFlowPlan {
  service: { id: string; label: string };
  audience: 'admin' | 'customer';
  steps: FlowStep[];
  links: FlowLink[];
  grounded: { routes: number; edgesFromCode: number };
  notes: string[];
}

const PROBE = /^\/(?:health|healthz|ready|readyz|live|livez|ping|metrics|status)\/?$/i;
const ADMIN_PATH = /(^|[/_-])(admin|backoffice|back-office|staff|internal|manage|console|superuser)([/_.-]|$)/i;
const ADMIN_CODE =
  /\b(?:isAdmin|is_admin|requireAdmin|require_admin|admin_required|adminOnly|admin_only|ensureAdmin|checkAdmin|IsAdminUser|is_staff|is_superuser|hasRole\(\s*['"]ADMIN|ROLE_ADMIN|hasAuthority\(\s*['"]ADMIN)\b|role\s*(?:===?|==|!==?)\s*['"]admin['"]|Depends\(\s*\w*admin\w*|PreAuthorize\([^)]*ADMIN/i;
const REDIRECT = [
  /\bredirect\(\s*(?:\d{3}\s*,\s*)?['"`]([^'"`]+)['"`]/g,
  /RedirectResponse\(\s*(?:url\s*=\s*)?['"]([^'"]+)['"]/g,
  /http\.Redirect\([^,]+,[^,]+,\s*"([^"]+)"/g,
  /["']redirect:([^"']+)["']/g,
  /\.Location\(\s*['"]([^'"]+)['"]/g,
];
const LINK = [/\bhref=["']([^"'#]+)["']/g, /\baction=["']([^"'#]+)["']/g];
const ERROR_STATUS = [
  /\.status\(\s*([45]\d\d)\s*\)/g,
  /status_code\s*=\s*([45]\d\d)/g,
  /\bhttp\.Error\([^)]*?,\s*(?:http\.Status\w+|([45]\d\d))\s*\)/g,
  /\babort\(\s*([45]\d\d)/g,
  /\breturn\s+(?:res\.sendStatus\()?\s*([45]\d\d)\b/g,
  /HttpStatus\.(NOT_FOUND|BAD_REQUEST|FORBIDDEN|UNAUTHORIZED|CONFLICT)/g,
  /http\.Status(NotFound|BadRequest|Forbidden|Unauthorized|Conflict)/g,
];
const NAMED: Record<string, string> = { NOT_FOUND: '404', NotFound: '404', BAD_REQUEST: '400', BadRequest: '400', FORBIDDEN: '403', Forbidden: '403', UNAUTHORIZED: '401', Unauthorized: '401', CONFLICT: '409', Conflict: '409' };
const REASON: Record<string, string> = { '400': 'bad request', '401': 'not signed in', '403': 'forbidden', '404': 'not found', '409': 'conflict', '422': 'invalid input', '500': 'server error' };
const METHOD_RANK: Record<string, number> = { GET: 0, '*': 1, POST: 2, PUT: 3, PATCH: 4, DELETE: 5 };
const MAX_STEPS = 60;
const MAX_ROUTES = 40;
const MAX_LINKS = 150;
/** Routes registered in tests, specs, fixtures and mocks are not the service's pages. */
const TEST_FILE = /(^|\/)(tests?|__tests__|__mocks__|specs?|fixtures?|mocks?|e2e|testdata)(\/|$)|\.(test|spec)\.|(^|\/)(test|spec|mock|fixture)[_-][^/]*$|[_-](test|spec)\.[^/.]+$/i;

/** A route with no literal segment (`/`, `/:id`) says nothing about where it is mounted. */
const ambiguous = (r: ArchRoute): boolean => !r.path.split('/').some((seg) => seg !== '' && !/^(?::\w+|\{[^}]+\}|<[^>]+>|\*+)$/.test(seg));
const fileTail = (file: string): string => file.split('/').slice(-2).join('/');
const labelOf = (r: ArchRoute): string => `${r.method} ${r.path}${ambiguous(r) ? ` (${fileTail(r.file)})` : ''}`;

/** The service node a ref names: an id (`svc:gateway`), a label, or a bare folder name. */
export function findService(graph: ArchGraph, ref: string): ArchNode | null {
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const low = ref.trim().toLowerCase();
  return (
    services.find((n) => n.id === ref) ??
    services.find((n) => n.id.toLowerCase() === low || n.id.toLowerCase() === `svc:${low}`) ??
    services.find((n) => n.label.toLowerCase() === low || (n.path ?? '').toLowerCase() === low) ??
    null
  );
}

function ownsRoute(svc: ArchNode, r: ArchRoute): boolean {
  return r.service === svc.id || r.service === svc.label || `svc:${r.service}` === svc.id || r.service === svc.path;
}

function routeRegex(r: ArchRoute): RegExp {
  const body = r.path
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => (/^(?::\w+|\{[^}]+\}|<[^>]+>|\*+)$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}${r.prefix || r.path.endsWith('/') ? '(?:/.*)?' : '/?'}$`, 'i');
}

function readRegions(root: string, routes: ArchRoute[]): Map<ArchRoute, string> {
  const byFile = new Map<string, ArchRoute[]>();
  for (const r of routes) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const out = new Map<ArchRoute, string>();
  const base = path.resolve(root);
  for (const [file, rs] of byFile) {
    const abs = path.resolve(base, file);
    if (abs !== base && !abs.startsWith(base + path.sep)) continue;
    let text: string;
    try {
      if (fs.statSync(abs).size > 512 * 1024) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const starts = rs.map((r) => r.line).sort((a, b) => a - b);
    for (const r of rs) {
      const next = starts.find((l) => l > r.line) ?? Infinity;
      /* The handler's own lines: two above (decorators, middleware) to the next registration or 40 below. */
      /* ...but never back into the previous registration's own lines. */
      const prev = starts.filter((l) => l < r.line).pop() ?? 0;
      const from = Math.max(0, r.line - 3, prev);
      const to = Math.min(lines.length, r.line - 1 + 40, next === Infinity ? Infinity : Math.max(r.line, next - 1));
      out.set(r, lines.slice(from, to).join('\n'));
    }
  }
  return out;
}

function all(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (let m = g.exec(text); m; m = g.exec(text)) out.push(m);
  return out;
}

function classify(r: ArchRoute, region: string): { audience: 'admin' | 'customer'; why: string } {
  if (ADMIN_PATH.test(r.path)) return { audience: 'admin', why: `path ${r.path} is an admin path` };
  if (ADMIN_PATH.test(r.file)) return { audience: 'admin', why: `registered in ${r.file}, an admin file` };
  const m = ADMIN_CODE.exec(region);
  if (m) return { audience: 'admin', why: `role check "${m[0].slice(0, 40)}" near ${r.file}:${r.line}` };
  return { audience: 'customer', why: 'no admin path or role check' };
}

/** Build the flow from the graph. Pure apart from reading the handler files under `root`. */
export function planServiceFlow(graph: ArchGraph, root: string, serviceRef: string, audience: FlowAudience): ServiceFlowPlan {
  const svc = findService(graph, serviceRef);
  if (!svc) throw new BoardError(`no service "${serviceRef}" in the scan`, 404);
  const notes: string[] = [];
  const own = (graph.routes ?? []).filter((r) => ownsRoute(svc, r));
  const probes = own.filter((r) => PROBE.test(r.path));
  const testOnly = own.filter((r) => !PROBE.test(r.path) && TEST_FILE.test(r.file));
  const seenRoute = new Set<string>();
  let duplicates = 0;
  const routes = own.filter((r) => {
    if (PROBE.test(r.path) || TEST_FILE.test(r.file)) return false;
    const key = `${r.method} ${r.path}${ambiguous(r) ? ` ${r.file}` : ''}`;
    if (seenRoute.has(key)) {
      duplicates += 1;
      return false;
    }
    seenRoute.add(key);
    return true;
  });
  const base = { service: { id: svc.id, label: svc.label } };
  if (graph.routes === undefined) notes.push('This scan did not record routes (an older or design graph); rescan to ground a flow.');
  if (routes.length === 0) {
    notes.push(
      own.length > 0
        ? `${svc.label} has only ${probes.length ? `health probes (${probes.map((p) => p.path).join(', ')})` : ''}${probes.length && testOnly.length ? ' and ' : ''}${testOnly.length ? `routes registered in test, spec or fixture files (${testOnly.length})` : ''} in the scan, so there is no user flow to draw.`
        : `The scanner found no routes it can read in this service's code, so there is no flow to ground. Nothing was drawn.`,
    );
    return { ...base, audience: audience === 'admin' ? 'admin' : 'customer', steps: [], links: [], grounded: { routes: 0, edgesFromCode: 0 }, notes };
  }
  const regions = readRegions(root, routes);
  const info = new Map(routes.map((r) => [r, classify(r, regions.get(r) ?? '')]));
  const adminN = routes.filter((r) => info.get(r)!.audience === 'admin').length;
  const custN = routes.length - adminN;
  const chosen: 'admin' | 'customer' = audience === 'auto' ? (adminN > custN ? 'admin' : 'customer') : audience;
  if (audience === 'auto') notes.push(`Audience chosen from the code: ${adminN} admin route${adminN === 1 ? '' : 's'}, ${custN} customer route${custN === 1 ? '' : 's'}.`);
  if (testOnly.length) notes.push(`Left out ${testOnly.length} route${testOnly.length === 1 ? '' : 's'} registered in test, spec or fixture files.`);
  if (duplicates) notes.push(`Merged ${duplicates} route${duplicates === 1 ? '' : 's'} registered twice with the same method and path.`);
  if (probes.length) notes.push(`Left out ${probes.length} health probe${probes.length === 1 ? '' : 's'} (${probes.map((p) => p.path).join(', ')}).`);
  let picked = routes.filter((r) => info.get(r)!.audience === chosen);
  if (picked.length === 0) {
    notes.push(`${svc.label} has no ${chosen} routes in the scan (${adminN} admin, ${custN} customer), so no ${chosen} flow was drawn.`);
    return { ...base, audience: chosen, steps: [], links: [], grounded: { routes: routes.length, edgesFromCode: 0 }, notes };
  }
  if (picked.length > MAX_ROUTES) {
    notes.push(`Showing the first ${MAX_ROUTES} of ${picked.length} routes.`);
  }
  picked = picked
    .slice()
    .sort((a, b) => {
      const sa = a.path.split('/').filter(Boolean);
      const sb = b.path.split('/').filter(Boolean);
      return (sa[0] ?? '').localeCompare(sb[0] ?? '') || sa.length - sb.length || (METHOD_RANK[a.method] ?? 9) - (METHOD_RANK[b.method] ?? 9) || a.path.localeCompare(b.path) || a.line - b.line;
    })
    .slice(0, MAX_ROUTES);
  const steps: FlowStep[] = [];
  const links: FlowLink[] = [];
  const seen = new Set<string>();
  const addLink = (l: FlowLink): void => {
    const k = `${l.from}>${l.to}`;
    if (seen.has(k) || l.from === l.to) return;
    seen.add(k);
    links.push(l);
  };
  const idOf = new Map<ArchRoute, string>();
  picked.forEach((r, i) => {
    const id = `s${i + 1}`;
    idOf.set(r, id);
    steps.push({
      id,
      kind: r.method === 'GET' ? 'page' : 'action',
      label: labelOf(r),
      method: r.method,
      path: r.path,
      file: r.file,
      line: r.line,
      audience: chosen,
      why: info.get(r)!.why,
    });
  });
  /* A root or bare-parameter route (`/`, `/:id`) would match every target: it is never the destination of a named link. */
  const known = picked.filter((r) => !ambiguous(r)).map((r) => ({ r, re: routeRegex(r) }));
  let codeEdges = 0;
  const outcome = new Map<string, string>();
  const addOutcome = (key: string, label: string, kind: FlowStep['kind']): string => {
    let id = outcome.get(key);
    if (!id) {
      id = `o${outcome.size + 1}`;
      outcome.set(key, id);
      steps.push({ id, kind, label });
    }
    return id;
  };
  for (const r of picked) {
    const from = idOf.get(r)!;
    const region = regions.get(r) ?? '';
    const targets = new Set<string>();
    for (const re of [...REDIRECT, ...LINK]) for (const m of all(re, region)) targets.add(m[1]!.replace(/\?.*$/, ''));
    for (const t of [...targets].sort()) {
      if (!t.startsWith('/')) continue;
      const hit = known.find((k) => k.r !== r && k.re.test(t));
      if (hit) {
        addLink({ from, to: idOf.get(hit.r)!, basis: 'code', detail: `names ${t} at ${r.file}` });
        codeEdges += 1;
      } else {
        addLink({ from, to: addOutcome(`go:${t}`, `Goes to ${t}`, 'outcome'), basis: 'code', detail: `names ${t} at ${r.file}` });
        codeEdges += 1;
      }
    }
    const codes = new Set<string>();
    for (const re of ERROR_STATUS) for (const m of all(re, region)) codes.add(m[1] ? NAMED[m[1]] ?? m[1] : '');
    codes.delete('');
    for (const c of [...codes].sort().slice(0, 3)) {
      addLink({ from, to: addOutcome(`err:${c}`, `Error ${c}${REASON[c] ? ` ${REASON[c]}` : ''}`, 'outcome'), basis: 'code', detail: `status ${c} in ${r.file}` });
      codeEdges += 1;
    }
  }
  /* Edges the graph holds: callers into a route (entry) and calls out of its handler file. */
  const apiOf = (r: ArchRoute): string => `api:${svc.id}:${r.method} ${r.path}`;
  const fileNodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id: string): string => {
    const n = fileNodes.get(id);
    let cur = n;
    while (cur && cur.kind !== 'service' && cur.parentId) cur = fileNodes.get(cur.parentId);
    return cur?.label ?? n?.label ?? id;
  };
  for (const e of graph.edges) {
    if (e.kind !== 'http' && e.kind !== 'grpc') continue;
    const into = picked.find((r) => e.apiId === apiOf(r));
    if (into) {
      const caller = label(e.srcId);
      if (caller !== svc.label) {
        const entry = addOutcome(`in:${caller}`, `From ${caller}`, 'entry');
        addLink({ from: entry, to: idOf.get(into)!, basis: 'code', detail: `${e.kind} edge ${e.srcId} -> ${e.apiId}` });
        codeEdges += 1;
      }
      continue;
    }
    const out = picked.find((r) => e.srcId === `file:${r.file}`);
    if (out && e.apiId) {
      const target = e.apiId.replace(/^api:svc:/, '').replace(/^api:/, '');
      const [tsvc, ...rest] = target.split(':');
      const call = addOutcome(`call:${e.apiId}`, `Calls ${tsvc}: ${rest.join(':')}`, 'call');
      addLink({ from: idOf.get(out)!, to: call, basis: 'code', detail: `${e.kind} edge ${e.srcId} -> ${e.apiId}` });
      codeEdges += 1;
    }
  }
  /* Where the code names no order, chain by nesting: same first segment, shallow before deep, read before write. */
  const hasCodeOut = new Set(links.filter((l) => l.basis === 'code').map((l) => l.from));
  for (let i = 0; i + 1 < picked.length; i += 1) {
    const a = picked[i]!;
    const b = picked[i + 1]!;
    const sa = a.path.split('/').filter(Boolean)[0] ?? '';
    const sb = b.path.split('/').filter(Boolean)[0] ?? '';
    const sameFile = a.file === b.file;
    if (sa === sb && (sa !== '' || sameFile) && !hasCodeOut.has(idOf.get(a)!)) {
      addLink({ from: idOf.get(a)!, to: idOf.get(b)!, basis: 'order', detail: 'chained by route nesting; the scan recorded no link between them' });
    }
  }
  if (!links.some((l) => l.basis === 'code')) {
    notes.push('The scan recorded no redirects, links or form actions between these routes; the arrows are route nesting only.');
  }
  if (steps.length > MAX_STEPS) {
    const keep = new Set(steps.slice(0, MAX_STEPS).map((x) => x.id));
    notes.push(`Capped at ${MAX_STEPS} steps; ${steps.length - MAX_STEPS} outcome or entry steps were left out.`);
    steps.length = MAX_STEPS;
    for (let i = links.length - 1; i >= 0; i -= 1) if (!keep.has(links[i]!.from) || !keep.has(links[i]!.to)) links.splice(i, 1);
  }
  if (links.length > MAX_LINKS) {
    const codeFirst = [...links.filter((l) => l.basis === 'code'), ...links.filter((l) => l.basis === 'order')].slice(0, MAX_LINKS);
    notes.push(`Capped at ${MAX_LINKS} arrows; ${links.length - MAX_LINKS} were left out (found-in-code arrows first).`);
    links.length = 0;
    links.push(...codeFirst);
  }
  const edgesFromCode = links.filter((l) => l.basis === 'code').length;
  return { ...base, audience: chosen, steps, links, grounded: { routes: picked.length, edgesFromCode }, notes };
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'service';

export interface WrittenFlow extends ServiceFlowPlan {
  board: string | null;
  group: string | null;
}

/**
 * Plan the flow and draw it on a Space as a titled frame of boxes and arrows (the draw tool's
 * compose logic). Drawing again replaces the same group, so a rescan updates in place.
 */
export function writeServiceFlow(
  root: string,
  graph: ArchGraph,
  serviceRef: string,
  audience: FlowAudience,
  boardRef?: string,
): WrittenFlow {
  const plan = planServiceFlow(graph, root, serviceRef, audience);
  if (plan.steps.length === 0) return { ...plan, board: null, group: null };
  const index = listBoards(root);
  let meta = boardRef ? findBoard(index, boardRef) : findBoard(index, 'Service flows');
  if (!meta) {
    if (boardRef) throw new BoardError(`no board "${boardRef}"`, 404);
    meta = createBoard(root, { name: 'Service flows' });
  }
  if (meta.kind === 'architecture') throw new BoardError('flows go on a whiteboard (the architecture board is the scanned graph); pick or create a Space', 409);
  const group = `flow-${slug(plan.service.label)}-${plan.audience}`;
  const doc = readBoard(root, meta.id);
  const existing = (doc?.items ?? []).filter((i) => i.group !== group);
  const index_ = new Map(plan.steps.map((s, i) => [s.id, i]));
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(plan.steps.length))));
  const items = plan.steps.map((s) => ({
    id: `${group}-${s.id}`,
    type: s.kind === 'outcome' || s.kind === 'entry' ? ('ellipse' as const) : ('rect' as const),
    text: s.label,
    w: 200,
    h: 64,
    ...(s.kind === 'action' ? { dash: 'dashed' as const } : {}),
    ...(s.kind === 'outcome' && /^Error/.test(s.label) ? { stroke: 'danger' } : {}),
    ...(s.kind === 'entry' || s.kind === 'call' ? { stroke: 'muted' } : {}),
    ...(s.kind === 'page' ? { stroke: 'accent' } : {}),
  }));
  const connect = plan.links.map((l) => [index_.get(l.from)!, index_.get(l.to)!]);
  let n = 0;
  const op: DrawOp = {
    op: 'compose',
    text: `${plan.service.label}: ${plan.audience} flow`,
    layout: 'grid',
    columns: cols,
    gap: 56,
    group,
    items,
    connect,
  };
  const expanded = composeOps(op, (type) => `${group}-${type}-${++n}`, 'flow', existing);
  /* Arrows from the plan: dashed when the order is ours, not the code's. */
  const dashed = new Set(plan.links.map((l, i) => (l.basis === 'order' ? i : -1)).filter((i) => i >= 0));
  let arrowNo = 0;
  /* Build every put first, so a refusal in the build leaves the old drawing alone. */
  const puts: BoardOp[] = [];
  for (const e of expanded) {
    const isArrow = e.type === 'arrow';
    const item = buildItem({ ...e, ...(isArrow && dashed.has(arrowNo) ? { dash: 'dashed' as const } : {}), id: e.id ?? `${group}-x${puts.length}` }, 'flow', false);
    if (isArrow) arrowNo += 1;
    puts.push({ op: 'put', item });
  }
  /* The store takes at most BOARD_CAPS.opsPerCall ops a call: the old group goes in its own batches, then the new one. */
  const removes: BoardOp[] = (doc?.items ?? []).filter((i) => i.group === group).map((old) => ({ op: 'remove' as const, id: old.id }));
  for (const batch of [removes, puts]) {
    for (let at = 0; at < batch.length; at += BOARD_CAPS.opsPerCall) applyBoardOps(root, meta.id, batch.slice(at, at + BOARD_CAPS.opsPerCall));
  }
  return { ...plan, board: meta.id, group };
}
