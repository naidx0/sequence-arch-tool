import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, parseAllDocuments } from 'yaml';
import type { Discovery, ServiceInfo, ServiceRole, Wire } from '../types.js';
import { classify, inferSourceDir, parseWireValue } from './shared.js';

/** Plain-manifest directories, in priority order — first hit (containing at
 * least one YAML doc with a `kind:` we handle) wins as the sole source. */
const PLAIN_MANIFEST_DIRS = [
  'kubernetes-manifests',
  'k8s',
  'kubernetes',
  'manifests',
  'deploy/kubernetes',
  'deploy/k8s',
];

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);
const HANDLED_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'ConfigMap', 'Ingress']);

const HELM_HOLE = '__HELM_HOLE__';

interface RawEnvEntry {
  key: string;
  value?: string;
  configMapRef?: { name: string; key: string };
  line: number;
}

interface RawWorkload {
  name: string;
  image?: string;
  env: RawEnvEntry[];
  file: string;
  nameLine: number;
}

interface Collected {
  workloads: RawWorkload[];
  serviceNames: Set<string>;
  configMaps: Map<string, Record<string, string>>;
  warnings: string[];
  warnedValueFromOnce: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* walkYaml(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkYaml(full);
    } else if (e.isFile() && /\.(ya?ml)$/.test(e.name)) {
      yield full;
    }
  }
}

/** Cheap text sniff: does this directory contain a YAML file with a `kind:`
 * line we handle? Avoids parsing (and templating, for Helm) dirs we won't use. */
function dirHasHandledKind(dir: string): boolean {
  for (const file of walkYaml(dir)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = line.match(/^kind:\s*["']?(\w+)["']?\s*$/);
      if (m && HANDLED_KINDS.has(m[1])) return true;
    }
  }
  return false;
}

// ---------- minimal, tolerant Helm template renderer ----------
// Same philosophy as v1's `env || 'default'` handling: resolve the easy,
// statically-decidable cases and turn everything else into an explicit hole
// rather than trying to be a real template engine.

// A bare `{{- if ... }}` / `{{- else }}` / `{{- end }}` control line whose
// entire content is exactly one action (no other text on the line).
const CONTROL_ACTION_RE = /^\s*\{\{-?\s*([\s\S]*?)\s*-?\}\}\s*$/;
const ACTION_RE = /\{\{-?\s*([\s\S]*?)\s*-?\}\}/g;

function lookupHelmValue(values: unknown, dottedPath: string): string | undefined {
  const parts = dottedPath.split('.').filter(Boolean);
  let cur: unknown = values;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  if (cur === null || cur === undefined || typeof cur === 'object') return undefined;
  return String(cur);
}

/** Apply a chain of trailing pipe filters to a (possibly still-unresolved)
 * `.Values` lookup. `quote`/`squote` are no-ops here — we're substituting
 * into plain text, not re-emitting YAML, so the raw string is already what
 * belongs in the output. `default "x"` only fires while the value is still
 * unresolved (mirrors Helm's real "use default if empty" semantics closely
 * enough for the shapes seen in practice). Any other filter name is treated
 * as unresolvable — same as an unrecognized action — so it degrades to the
 * existing hole behavior rather than silently passing through a wrong value. */
function applyFilters(value: string | undefined, filters: string[]): string | undefined {
  let v = value;
  for (const raw of filters) {
    const f = raw.trim();
    if (!f) continue;
    if (v === undefined) {
      const dm = f.match(/^default\s+"([^"]*)"$/);
      if (dm) {
        v = dm[1];
        continue;
      }
      // still unresolved and this filter can't supply a value — stays a hole
      return undefined;
    }
    if (/^default\s+"([^"]*)"$/.test(f)) continue; // already resolved — default is a no-op
    if (f === 'quote' || f === 'squote') continue;
    if (f === 'trim') {
      v = v.trim();
      continue;
    }
    if (f === 'lower') {
      v = v.toLowerCase();
      continue;
    }
    if (f === 'upper') {
      v = v.toUpperCase();
      continue;
    }
    return undefined; // unknown filter — unresolvable, keep existing hole behavior
  }
  return v;
}

function substituteActions(line: string, values: unknown): string {
  return line.replace(ACTION_RE, (_m, inner: string) => {
    const expr = inner.trim();
    const m = expr.match(/^\.Values((?:\.[\w-]+)+)\s*((?:\|[\s\S]*)?)$/);
    if (m) {
      const [, dottedPath, filterChain] = m;
      let v = lookupHelmValue(values, dottedPath);
      if (filterChain) {
        const filters = filterChain
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
        v = applyFilters(v, filters);
      }
      return v !== undefined ? v : HELM_HOLE;
    }
    return HELM_HOLE;
  });
}

function evalOperand(tok: string, values: unknown): string | undefined {
  const t = tok.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  const m = t.match(/^\.Values((?:\.[\w-]+)+)$/);
  if (m) return lookupHelmValue(values, m[1]);
  return undefined;
}

function truthy(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v !== 'false' && v !== '' && v !== '0';
}

/** Evaluate the handful of condition shapes actually used by real Helm charts:
 * bare `.Values.a.b`, `not .Values.a.b`, `eq .Values.a.b "literal"`. Anything
 * else (function calls, `and`/`or`, comparisons against non-.Values operands)
 * is unresolvable — returns undefined, and callers default to "take the if
 * branch" (the primary, most-likely-enabled path), consistent with v1's
 * bias toward resolving the common case over being exhaustive. */
function evalCondition(expr: string, values: unknown): boolean | undefined {
  const e = expr.trim();
  let m = e.match(/^not\s+([\s\S]+)$/);
  if (m) {
    const inner = evalCondition(m[1], values);
    return inner === undefined ? undefined : !inner;
  }
  m = e.match(/^eq\s+(\S+)\s+([\s\S]+)$/);
  if (m) {
    const a = evalOperand(m[1], values);
    const b = evalOperand(m[2], values);
    if (a === undefined || b === undefined) return undefined;
    return a === b;
  }
  if (/^\.Values(?:\.[\w-]+)+$/.test(e)) return truthy(evalOperand(e, values));
  return undefined;
}

type ControlKind = 'if' | 'elseif' | 'else' | 'end' | 'open' | null;

function classifyControl(inner: string): { kind: ControlKind; rest: string } {
  const e = inner.trim();
  let m = e.match(/^if\s+([\s\S]+)$/);
  if (m) return { kind: 'if', rest: m[1] };
  m = e.match(/^else\s+if\s+([\s\S]+)$/);
  if (m) return { kind: 'elseif', rest: m[1] };
  if (/^else\s*$/.test(e)) return { kind: 'else', rest: '' };
  if (/^end\s*$/.test(e)) return { kind: 'end', rest: '' };
  if (/^(range|with|define|block)\b/.test(e)) return { kind: 'open', rest: '' };
  return { kind: null, rest: '' };
}

interface CondFrame {
  /** is this frame's currently-selected branch active, given its ancestors */
  active: boolean;
  /** has any branch in this if/else-if/else chain already been taken */
  matched: boolean;
  /** was the frame active when it was opened (i.e. are we even inside a live branch) */
  parentActive: boolean;
}

/** Render a Helm template file against `values.yaml`. Tracks `if`/`else
 * if`/`else`/`end` nesting and evaluates the handful of condition shapes
 * above so that mutually-exclusive branches (e.g. `serviceAccountName:
 * {{ .Values.x }}` vs `serviceAccountName: default`) don't both survive into
 * the same YAML mapping as duplicate keys. `range`/`with`/`define`/`block`
 * bodies are not evaluated — they're kept as-is (best effort) rather than
 * dropped, since dropping them would lose real content (e.g. env var blocks)
 * far more often than keeping them produces a structural clash.
 * Preserves line numbers (dropped/blanked lines become '') so evidence line
 * numbers still point at the real source line. */
export function renderHelmTemplate(src: string, values: unknown): string {
  const stack: CondFrame[] = [];
  const isActive = () => stack.every((f) => f.active);

  return src
    .split('\n')
    .map((line) => {
      const ctrl = line.match(CONTROL_ACTION_RE);
      const classified = ctrl ? classifyControl(ctrl[1]) : { kind: null, rest: '' };
      if (classified.kind !== null) {
        const parentActive = isActive();
        if (classified.kind === 'if') {
          const cond = parentActive ? evalCondition(classified.rest, values) : false;
          const active = parentActive && (cond ?? true);
          stack.push({ active, matched: active, parentActive });
        } else if (classified.kind === 'elseif') {
          const frame = stack[stack.length - 1];
          if (frame) {
            if (frame.matched || !frame.parentActive) {
              frame.active = false;
            } else {
              const cond = evalCondition(classified.rest, values);
              frame.active = cond ?? true;
              if (frame.active) frame.matched = true;
            }
          }
        } else if (classified.kind === 'else') {
          const frame = stack[stack.length - 1];
          if (frame) {
            frame.active = frame.parentActive && !frame.matched;
            if (frame.active) frame.matched = true;
          }
        } else if (classified.kind === 'end') {
          stack.pop();
        } else if (classified.kind === 'open') {
          stack.push({ active: parentActive, matched: true, parentActive });
        }
        return '';
      }
      if (!isActive()) return '';
      return substituteActions(line, values);
    })
    .join('\n');
}

function processFile(fileAbs: string, repoRootAbs: string, text: string, collect: Collected): void {
  const relFile = path.relative(repoRootAbs, fileAbs);
  const lines = text.split('\n');
  const lineOf = (re: RegExp): number | undefined => {
    const i = lines.findIndex((l) => re.test(l));
    return i >= 0 ? i + 1 : undefined;
  };

  let docs;
  try {
    docs = parseAllDocuments(text);
  } catch (e) {
    collect.warnings.push(`${relFile}: failed to parse YAML (${(e as Error).message}) — skipped`);
    return;
  }

  for (const doc of docs) {
    if (doc.errors && doc.errors.length > 0) {
      collect.warnings.push(`${relFile}: YAML parse error in one document (${doc.errors[0].message}) — skipped`);
      continue;
    }
    let obj: unknown;
    try {
      obj = doc.toJS();
    } catch (e) {
      collect.warnings.push(`${relFile}: failed to read a YAML document (${(e as Error).message}) — skipped`);
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== 'string' || !HANDLED_KINDS.has(kind)) continue;
    const metadata = (o.metadata ?? {}) as Record<string, unknown>;
    const rawName = typeof metadata.name === 'string' ? metadata.name : undefined;

    if (WORKLOAD_KINDS.has(kind)) {
      if (!rawName) {
        collect.warnings.push(`${relFile}: ${kind} with no metadata.name — skipped`);
        continue;
      }
      let name = rawName;
      const nameLine = lineOf(new RegExp(`^\\s*name:\\s*["']?${escapeRe(rawName)}["']?\\s*$`)) ?? 1;
      if (name.includes(HELM_HOLE)) {
        const chartName = path.basename(findChartRoot(fileAbs) ?? path.dirname(fileAbs));
        collect.warnings.push(
          `${relFile}: ${kind} metadata.name resolved to an unresolved Helm value — falling back to chart directory name "${chartName}"`
        );
        name = chartName;
      }
      const spec = (o.spec ?? {}) as Record<string, unknown>;
      const template = (spec.template ?? {}) as Record<string, unknown>;
      const podSpec = (template.spec ?? {}) as Record<string, unknown>;
      const containers = (podSpec.containers ?? []) as Record<string, unknown>[];
      const first = containers[0] ?? {};
      const image = typeof first.image === 'string' ? first.image : undefined;
      const envList = (first.env ?? []) as Record<string, unknown>[];
      const env: RawEnvEntry[] = [];
      for (const e of envList) {
        const key = typeof e.name === 'string' ? e.name : undefined;
        if (!key) continue;
        const line = lineOf(new RegExp(`^\\s*-\\s*name:\\s*["']?${escapeRe(key)}["']?\\s*$`)) ?? nameLine;
        if (typeof e.value === 'string') {
          env.push({ key, value: e.value, line });
        } else if (e.valueFrom && typeof e.valueFrom === 'object') {
          const vf = e.valueFrom as Record<string, unknown>;
          const cmRef = vf.configMapKeyRef as Record<string, unknown> | undefined;
          if (cmRef && typeof cmRef.name === 'string' && typeof cmRef.key === 'string') {
            env.push({ key, configMapRef: { name: cmRef.name, key: cmRef.key }, line });
          } else if (!collect.warnedValueFromOnce) {
            collect.warnings.push(
              `${relFile}: env var ${key} uses a valueFrom this round doesn't resolve (secretKeyRef/fieldRef/resourceFieldRef) — skipped (warned once)`
            );
            collect.warnedValueFromOnce = true;
          }
        }
      }
      collect.workloads.push({ name, image, env, file: relFile, nameLine });
    } else if (kind === 'Service') {
      if (rawName && !rawName.includes(HELM_HOLE)) collect.serviceNames.add(rawName);
    } else if (kind === 'ConfigMap') {
      if (rawName && !collect.configMaps.has(rawName)) {
        const data = (o.data ?? {}) as Record<string, unknown>;
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') map[k] = v;
        }
        collect.configMaps.set(rawName, map);
      }
    } else if (kind === 'Ingress') {
      collect.warnings.push(
        `${relFile}: Ingress "${rawName ?? '?'}" parsed but not wired to edges this round`
      );
    }
  }
}

function findChartRoot(templateFileAbs: string): string | undefined {
  let dir = path.dirname(templateFileAbs);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'Chart.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function findHelmChartTemplatesDirs(repoRootAbs: string): string[] {
  const out: string[] = [];
  const direct = path.join(repoRootAbs, 'helm-chart', 'templates');
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) out.push(direct);
  const chartsDir = path.join(repoRootAbs, 'charts');
  if (fs.existsSync(chartsDir) && fs.statSync(chartsDir).isDirectory()) {
    for (const entry of fs.readdirSync(chartsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const tpl = path.join(chartsDir, entry.name, 'templates');
      if (fs.existsSync(tpl) && fs.statSync(tpl).isDirectory()) out.push(tpl);
    }
  }
  return out;
}

function loadValuesYaml(chartRoot: string): unknown {
  const p = path.join(chartRoot, 'values.yaml');
  if (!fs.existsSync(p)) return {};
  try {
    return parseYaml(fs.readFileSync(p, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

export function discoverKubernetes(repoRoot: string): Discovery | undefined {
  const abs = path.resolve(repoRoot);
  const warnings: string[] = [];

  let chosenDir: string | undefined;
  let manifestKind: 'kubernetes' | 'helm' = 'kubernetes';
  let chartRoot: string | undefined;

  for (const rel of PLAIN_MANIFEST_DIRS) {
    const dir = path.join(abs, rel);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && dirHasHandledKind(dir)) {
      chosenDir = dir;
      manifestKind = 'kubernetes';
      break;
    }
  }

  if (!chosenDir) {
    for (const tplDir of findHelmChartTemplatesDirs(abs)) {
      if (dirHasHandledKind(tplDir)) {
        chosenDir = tplDir;
        manifestKind = 'helm';
        chartRoot = findChartRoot(tplDir) ?? path.dirname(tplDir);
        break;
      }
    }
  }

  if (!chosenDir) {
    const releaseDir = path.join(abs, 'release');
    if (fs.existsSync(releaseDir) && fs.statSync(releaseDir).isDirectory() && dirHasHandledKind(releaseDir)) {
      chosenDir = releaseDir;
      manifestKind = 'kubernetes';
    }
  }

  if (!chosenDir) return undefined;

  const collect: Collected = {
    workloads: [],
    serviceNames: new Set(),
    configMaps: new Map(),
    warnings,
    warnedValueFromOnce: false,
  };

  const values = manifestKind === 'helm' && chartRoot ? loadValuesYaml(chartRoot) : undefined;

  // A Helm chart nested UNDER the chosen plain-manifest directory (sock-shop
  // ships `deploy/kubernetes/manifests/` next to `deploy/kubernetes/helm-chart/`)
  // is not plain YAML and must not be read as if it were: every one of its
  // templates fails to parse, and 21 "YAML parse error" lines then bury the
  // warnings that matter. The plain manifests we chose already describe the same
  // workloads, so the chart is skipped — once, out loud, naming itself.
  const skippedCharts = new Set<string>();
  const isForeignHelmTemplate = (fileAbs: string): boolean => {
    if (manifestKind === 'helm') return false;
    const chart = findChartRoot(fileAbs);
    if (!chart || !path.relative(chosenDir, chart).length) return false;
    if (path.relative(chosenDir, chart).startsWith('..')) return false;
    skippedCharts.add(path.relative(abs, chart));
    return true;
  };

  for (const fileAbs of walkYaml(chosenDir)) {
    if (isForeignHelmTemplate(fileAbs)) continue;
    // ONE unreadable file must cost one file. Before this, `readFileSync` and
    // `renderHelmTemplate` sat outside any guard, so a single unreadable or
    // pathological template aborted the walk and took the whole manifest tree
    // with it — the scan then reported success over whatever it had reached
    // first. Per-document YAML errors were already isolated inside
    // `processFile`; this closes the same hole one level up.
    try {
      const raw = fs.readFileSync(fileAbs, 'utf8');
      const text = manifestKind === 'helm' ? renderHelmTemplate(raw, values) : raw;
      processFile(fileAbs, abs, text, collect);
    } catch (e) {
      warnings.push(
        `${path.relative(abs, fileAbs)}: could not be read (${(e as Error).message}) — skipped, the rest of the manifests were still read`
      );
    }
  }

  for (const chart of [...skippedCharts].sort()) {
    warnings.push(
      `${chart} is a Helm chart nested inside the manifest directory — its templates are not plain YAML, so they were not parsed; the plain manifests in ${path.relative(abs, chosenDir)} were used instead`
    );
  }

  // dedupe workloads by name — first occurrence wins (files walked in sorted order)
  const seen = new Set<string>();
  const workloads: RawWorkload[] = [];
  for (const w of collect.workloads) {
    if (seen.has(w.name)) continue;
    seen.add(w.name);
    workloads.push(w);
  }

  const services: ServiceInfo[] = [];
  for (const w of workloads) {
    const { role, tech }: { role: ServiceRole; tech?: string } = classify(w.image);
    const dir = role === 'app' ? inferSourceDir(abs, w.name, [`src/${w.name}`]) : undefined;

    const env: Record<string, string> = {};
    for (const e of w.env) {
      let value: string | undefined;
      if (e.value !== undefined) {
        value = e.value;
      } else if (e.configMapRef) {
        const cmData = collect.configMaps.get(e.configMapRef.name);
        value = cmData?.[e.configMapRef.key];
        if (value === undefined) {
          warnings.push(
            `${w.file}: env ${e.key} on ${w.name} references configMapKeyRef ${e.configMapRef.name}.${e.configMapRef.key} which was not found — skipped`
          );
          continue;
        }
      } else {
        continue;
      }
      if (value.includes(HELM_HOLE)) {
        warnings.push(`${w.file}: env ${e.key} on ${w.name} is an unresolved Helm value — skipped`);
        continue;
      }
      env[e.key] = value;
    }

    services.push({ name: w.name, dir, image: w.image, env, dependsOn: [], role, tech });
  }

  const wires: Wire[] = [];
  for (const s of services) {
    const w = workloads.find((x) => x.name === s.name);
    for (const [envKey, value] of Object.entries(s.env)) {
      const hit = parseWireValue(value, collect.serviceNames);
      if (hit && hit.targetService !== s.name) {
        const envEntry = w?.env.find((e) => e.key === envKey);
        wires.push({
          service: s.name,
          envKey,
          value,
          ...hit,
          sourceFile: w?.file,
          composeLine: envEntry?.line,
        });
      }
    }
  }

  const appCount = services.filter((s) => s.role === 'app').length;
  if (appCount === 0) {
    warnings.push('no app workloads found in Kubernetes/Helm manifests — nothing to analyze');
  }

  return {
    composeFile: path.relative(abs, chosenDir) || '.',
    services,
    wires,
    warnings,
    manifestKind,
  };
}
