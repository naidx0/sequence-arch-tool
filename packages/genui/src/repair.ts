/**
 * THE REPAIR LOOP. Output is made correct in three tiers, cheapest first, and every step
 * is reported so the person can watch it happen:
 *
 *   1. lossless fixes (fixer)   meaning-preserving: an alias type, a synonym enum, a prop
 *                               beside its name, a number written as a string.
 *   2. the agent (agent)        what is left is handed back as diagnostics with paths and
 *                               hints; the agent answers with a few op lines (Cursor's
 *                               canvas does this with compile diagnostics; json-render's
 *                               autoFixSpec says the same: prefer re-prompting to lossy).
 *   3. lossy fallback (fixer)   last resort, so the surface still renders: a node that
 *                               cannot be fixed becomes a text fallback or is dropped,
 *                               dangling references are pruned (ChatGPT's DIL renderer has
 *                               the same recoveries: targeted-text-fallback, drop-node).
 */
import { ALIAS_PROPS, CATALOG, ENUM_SYNONYMS, TYPE_ALIASES, findComponent, type ChildRule } from './catalog.js';
import { resolveProps, isBinding } from './bindings.js';
import { SpecStream } from './stream.js';
import { validateSpec, diagnosticsPrompt, type Phase } from './validate.js';
import type { Fix, Issue, UIDiagnostics, UIElement, UIOp, UISpec } from './types.js';

/** Prop names models use for ours, per component. */
export const PROP_SYNONYMS: Record<string, Record<string, string>> = {
  Text: { content: 'text', value: 'text', label: 'text', body: 'text', color: 'tone', variant: 'tone' },
  Heading: { title: 'text', label: 'text', content: 'text', size: 'level' },
  Card: { heading: 'title', name: 'title', label: 'title', description: 'subtitle', status: 'tone', color: 'tone' },
  Badge: { text: 'label', value: 'label', color: 'tone', variant: 'tone', status: 'tone' },
  StatusLine: { label: 'text', message: 'text', loading: 'busy', spinning: 'busy' },
  TimelineItem: { label: 'title', name: 'title', text: 'title', state: 'status', description: 'detail', subtitle: 'detail', time: 'meta' },
  Progress: { current: 'value', done: 'value', completed: 'value', progress: 'value', total: 'max', of: 'max', title: 'label' },
  Metric: { title: 'label', name: 'label', amount: 'value', change: 'delta' },
  Check: { name: 'label', title: 'label', state: 'status', result: 'status', tooltip: 'detail', output: 'detail' },
  Callout: { variant: 'tone', type: 'tone', status: 'tone', message: 'text', body: 'text', content: 'text', heading: 'title' },
  Button: { text: 'label', title: 'label', onClick: 'action', onPress: 'action', type: 'variant', kind: 'variant', confirmText: 'confirm' },
  Diff: { file: 'path', filename: 'path', lang: 'language', hunks: 'lines' },
  KeyValue: { pairs: 'items', rows: 'items', entries: 'items' },
  FileList: { items: 'files', changes: 'files' },
};

const TEXTY = ['text', 'title', 'label', 'content', 'message', 'value', 'name', 'body'];

export interface FixOptions {
  phase: Phase;
  /** Allow fixes that change what renders. Default false. */
  lossy?: boolean;
}

export interface FixResult {
  spec: UISpec;
  fixes: Fix[];
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64) || 'action';

function fixEnum(v: unknown, options: readonly string[]): string | undefined {
  if (typeof v !== 'string') return undefined;
  const k = v.trim().toLowerCase();
  if (options.includes(k)) return k;
  const syn = ENUM_SYNONYMS[k] ?? ENUM_SYNONYMS[k.replace(/\s+/g, '_')];
  return syn && options.includes(syn) ? syn : undefined;
}

function enumOptionsAt(type: string, key: string): readonly string[] | undefined {
  const d = findComponent(type);
  const shape = (d?.props as unknown as { shape?: Record<string, unknown> }).shape;
  let f = shape?.[key] as { options?: readonly string[]; def?: { innerType?: unknown; type?: string }; unwrap?: () => unknown } | undefined;
  for (let i = 0; i < 4 && f && !f.options; i++) f = (f.unwrap?.() ?? (f.def as { innerType?: unknown } | undefined)?.innerType) as typeof f;
  return f?.options;
}

/** Lossless prop fixes for one element. Returns the new props and what was done. */
function fixProps(id: string, el: UIElement, state: Record<string, unknown>): { props: Record<string, unknown>; fixes: Fix[] } {
  const d = findComponent(el.type);
  const fixes: Fix[] = [];
  if (!d) return { props: el.props, fixes };
  let props: Record<string, unknown> = { ...(el.props ?? {}) };
  const note = (message: string): void => {
    fixes.push({ lossy: false, by: 'fixer', message, elementId: id });
  };
  const syn = PROP_SYNONYMS[el.type] ?? {};
  const shape = (d.props as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  for (const k of Object.keys(props)) {
    if (k in shape) continue;
    const to = syn[k];
    if (to && to in shape && props[to] === undefined) {
      props[to] = props[k];
      note(`${el.type} "${id}": ${k} -> ${to}`);
    } else {
      note(`${el.type} "${id}": dropped unknown prop ${k}`);
    }
    delete props[k];
  }
  /* Button.action written as a string. */
  if (el.type === 'Button' && typeof props.action === 'string') {
    props.action = { name: slug(props.action) };
    note(`Button "${id}": action "${String(el.props.action)}" -> {name:"${slug(String(el.props.action))}"}`);
  }
  if (el.type === 'Button' && props.action && typeof props.action === 'object' && typeof (props.action as { name?: unknown }).name === 'string') {
    const a = props.action as { name: string };
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(a.name)) {
      const n = slug(a.name);
      props.action = { ...a, name: n };
      note(`Button "${id}": action name "${a.name}" -> "${n}"`);
    }
  }
  /* Per-issue coercions, a few passes (a fix can reveal the next issue). */
  for (let pass = 0; pass < 3; pass++) {
    const { props: resolved } = resolveProps(props, state);
    const r = d.props.safeParse(resolved);
    if (r.success) break;
    let changed = false;
    for (const zi of r.error.issues) {
      const key = zi.path[0];
      if (typeof key !== 'string' || zi.path.length !== 1) continue;
      const raw = props[key];
      if (isBinding(raw)) continue;
      const code = (zi as { code: string }).code;
      if (code === 'invalid_value') {
        const opts = (zi as unknown as { values: string[] }).values ?? enumOptionsAt(el.type, key) ?? [];
        const v = fixEnum(raw, opts);
        if (v !== undefined) {
          props = { ...props, [key]: v };
          note(`${el.type} "${id}": ${key} "${String(raw)}" -> "${v}"`);
          changed = true;
        }
      } else if (code === 'invalid_type') {
        const expected = (zi as unknown as { expected: string }).expected;
        if (expected === 'number' && typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw.replace(/[,_%]/g, '')))) {
          props = { ...props, [key]: Number(raw.replace(/[,_%]/g, '')) };
          note(`${el.type} "${id}": ${key} "${raw}" -> ${Number(raw.replace(/[,_%]/g, ''))}`);
          changed = true;
        } else if (expected === 'boolean' && (raw === 'true' || raw === 'false')) {
          props = { ...props, [key]: raw === 'true' };
          note(`${el.type} "${id}": ${key} "${raw}" -> ${raw}`);
          changed = true;
        } else if (expected === 'string' && (typeof raw === 'number' || typeof raw === 'boolean')) {
          props = { ...props, [key]: String(raw) };
          note(`${el.type} "${id}": ${key} ${String(raw)} -> "${String(raw)}"`);
          changed = true;
        } else if (expected === 'string' && Array.isArray(raw) && raw.every((x) => typeof x === 'string')) {
          props = { ...props, [key]: raw.join('\n') };
          note(`${el.type} "${id}": ${key} list -> text`);
          changed = true;
        }
      } else if (code === 'invalid_union' && typeof raw === 'string' && el.type === 'Metric') {
        /* nothing: Metric.value accepts both */
      }
    }
    if (!changed) break;
  }
  return { props, fixes };
}

function resolveType(type: string): { type: string; extra: Record<string, unknown> } | undefined {
  if (findComponent(type)) return { type, extra: {} };
  const lower = type.toLowerCase();
  const exact = Object.keys(CATALOG).find((k) => k.toLowerCase() === lower);
  if (exact) return { type: exact, extra: {} };
  const alias = TYPE_ALIASES[lower] ?? TYPE_ALIASES[lower.replace(/[\s-]/g, '_')] ?? TYPE_ALIASES[lower.replace(/[\s_-]/g, '')];
  if (alias) return { type: alias, extra: ALIAS_PROPS[lower] ?? {} };
  return undefined;
}

const childRule = (type: string): ChildRule | undefined => findComponent(type)?.children;

/** Tier 1 (and 3 with lossy): deterministic fixes. Idempotent. */
export function autoFix(input: UISpec, opts: FixOptions): FixResult {
  const fixes: Fix[] = [];
  let spec: UISpec = { ...input, elements: { ...input.elements } };
  const lossy = opts.lossy === true;
  const final = opts.phase === 'final';
  const els = spec.elements;

  for (const [id, el0] of Object.entries(els)) {
    let el = el0;
    const t = resolveType(el.type);
    if (t && t.type !== el.type) {
      fixes.push({ lossy: false, by: 'fixer', message: `"${el.type}" -> ${t.type}${Object.keys(t.extra).length ? ` ${JSON.stringify(t.extra)}` : ''}`, elementId: id });
      el = { ...el, type: t.type, props: { ...t.extra, ...el.props } };
    }
    if (findComponent(el.type)) {
      const fp = fixProps(id, el, spec.state);
      if (fp.fixes.length) {
        fixes.push(...fp.fixes);
        el = { ...el, props: fp.props };
      }
    }
    if (el.children) {
      const uniq = [...new Set(el.children.filter((c) => c !== id))];
      if (uniq.length !== el.children.length) {
        fixes.push({ lossy: false, by: 'fixer', message: `"${id}": removed repeated or self children`, elementId: id });
        el = { ...el, children: uniq };
      }
    }
    if (el !== el0) els[id] = el;
  }

  /* A root nobody named: the one element nobody contains (a Card if there are several). */
  if ((!spec.root || !els[spec.root]) && Object.keys(els).length) {
    const contained = new Set(Object.values(els).flatMap((e) => e.children ?? []));
    const tops = Object.keys(els).filter((k) => !contained.has(k));
    const pick = tops.find((k) => els[k]!.type === 'Card') ?? tops[0];
    if (pick && (final || !spec.root)) {
      fixes.push({ lossy: false, by: 'fixer', message: `root -> "${pick}"`, elementId: pick });
      spec = { ...spec, root: pick };
    }
  }

  /* Button actions named but not declared: declare them when the agent's intent is unambiguous
     (it named the action on a button it built); the description says it was inferred. */
  for (const [id, el] of Object.entries(els)) {
    if (el.type !== 'Button') continue;
    const name = (el.props.action as { name?: string } | undefined)?.name;
    if (final && lossy && name && !spec.actions[name] && !el.props.disabled) {
      els[id] = { ...el, props: { ...el.props, disabled: true } };
      fixes.push({ lossy: true, by: 'fixer', message: `Button "${id}": action "${name}" was never declared; disabled`, elementId: id });
    }
  }

  if (lossy) {
    const v = validateSpec(spec, opts.phase);
    const bad = new Set(v.issues.filter((i) => i.severity === 'error' && (i.code === 'UNKNOWN_COMPONENT' || i.code === 'INVALID_PROPS') && i.elementId).map((i) => i.elementId!));
    for (const id of bad) {
      const el = els[id];
      if (!el) continue;
      const words = TEXTY.map((k) => el.props?.[k]).find((x) => typeof x === 'string' && x.trim()) as string | undefined;
      if (words && childRule(el.type) !== 'any') {
        els[id] = { type: 'Text', props: { text: words } };
        fixes.push({ lossy: true, by: 'fixer', message: `"${id}" (${el.type}) could not be fixed; shown as text`, elementId: id });
      } else if (words) {
        els[id] = { type: 'Stack', props: { direction: 'column' }, children: el.children ?? [] };
        fixes.push({ lossy: true, by: 'fixer', message: `"${id}" (${el.type}) could not be fixed; kept its children in a Stack`, elementId: id });
      } else if (el.children?.length) {
        els[id] = { type: 'Stack', props: { direction: 'column' }, children: el.children };
        fixes.push({ lossy: true, by: 'fixer', message: `"${id}" (${el.type}) could not be fixed; kept its children`, elementId: id });
      } else {
        delete els[id];
        fixes.push({ lossy: true, by: 'fixer', message: `"${id}" (${el.type}) could not be fixed; dropped`, elementId: id });
      }
    }
    /* Children: prune what never arrived (final only), move what a parent may not hold. */
    const parentOf = (cid: string): string | undefined => Object.keys(els).find((k) => els[k]!.children?.includes(cid));
    for (const [id, el] of Object.entries(els)) {
      if (!el.children?.length) continue;
      const rule = childRule(el.type);
      const keep: string[] = [];
      const evicted: string[] = [];
      for (const c of el.children) {
        const child = els[c];
        if (!child) {
          if (final) fixes.push({ lossy: true, by: 'fixer', message: `"${id}": removed child "${c}" that never arrived`, elementId: id });
          else keep.push(c);
          continue;
        }
        if (rule === 'none' || (Array.isArray(rule) && !rule.includes(child.type))) evicted.push(c);
        else keep.push(c);
      }
      if (evicted.length) {
        const p = parentOf(id);
        if (p && childRule(els[p]!.type) === 'any') {
          const pk = els[p]!.children!.slice();
          pk.splice(pk.indexOf(id) + 1, 0, ...evicted);
          els[p] = { ...els[p]!, children: pk };
          fixes.push({ lossy: true, by: 'fixer', message: `moved ${evicted.join(', ')} out of ${el.type} "${id}" to "${p}"`, elementId: id });
        } else {
          fixes.push({ lossy: true, by: 'fixer', message: `removed ${evicted.join(', ')} from ${el.type} "${id}" (not allowed there)`, elementId: id });
        }
      }
      if (keep.length !== el.children.length) els[id] = { ...els[id]!, children: keep };
    }
    /* Cycles: cut the edge that closes the loop. */
    if (spec.root && els[spec.root]) {
      const onPath = new Set<string>();
      const done = new Set<string>();
      const walk = (id: string): void => {
        onPath.add(id);
        const e = els[id];
        for (const c of e?.children ?? []) {
          if (onPath.has(c)) {
            els[id] = { ...els[id]!, children: els[id]!.children!.filter((x) => x !== c) };
            fixes.push({ lossy: true, by: 'fixer', message: `"${id}" -> "${c}" closed a loop; cut`, elementId: id });
          } else if (!done.has(c) && els[c]) walk(c);
        }
        onPath.delete(id);
        done.add(id);
      };
      walk(spec.root);
    }
  }
  spec = { ...spec, elements: els };
  return { spec, fixes };
}

export type RepairEvent =
  | { type: 'fixed'; fixes: Fix[] }
  | { type: 'ask'; diagnostics: UIDiagnostics }
  | { type: 'agent-patched'; ops: UIOp[]; fixes: Fix[]; round: number }
  | { type: 'agent-silent'; round: number }
  | { type: 'fallback'; fixes: Fix[] }
  | { type: 'clean'; issues: Issue[] };

/** The agent's side of a repair round: given diagnostics, answer with ops (or JSONL text), or null to pass. */
export type RepairAgent = (d: UIDiagnostics) => Promise<UIOp[] | string | null>;

export interface RepairOptions {
  surfaceId: string;
  agent?: RepairAgent;
  maxRounds?: number;
  onEvent?: (e: RepairEvent) => void;
}

export interface RepairOutcome {
  spec: UISpec;
  fixes: Fix[];
  issues: Issue[];
  rounds: number;
  usedFallback: boolean;
}

const errorsOf = (spec: UISpec): Issue[] => validateSpec(spec, 'final').issues.filter((i) => i.severity === 'error');

export async function repairSpec(input: UISpec, o: RepairOptions): Promise<RepairOutcome> {
  const all: Fix[] = [];
  const emit = o.onEvent ?? (() => {});
  let { spec, fixes } = autoFix(input, { phase: 'final' });
  if (fixes.length) {
    all.push(...fixes);
    emit({ type: 'fixed', fixes });
  }
  let rounds = 0;
  let errs = errorsOf(spec);
  while (errs.length && o.agent && rounds < (o.maxRounds ?? 2)) {
    rounds++;
    const diagnostics: UIDiagnostics = { kind: 'ui.diagnostics', surfaceId: o.surfaceId, issues: errs, prompt: diagnosticsPrompt(errs, o.surfaceId), round: rounds };
    emit({ type: 'ask', diagnostics });
    let reply: UIOp[] | string | null = null;
    try {
      reply = await o.agent(diagnostics);
    } catch {
      reply = null;
    }
    if (!reply || (Array.isArray(reply) && reply.length === 0)) {
      emit({ type: 'agent-silent', round: rounds });
      break;
    }
    const s = new SpecStream(spec);
    let ops: UIOp[];
    let lineFixes: Fix[] = [];
    if (typeof reply === 'string') {
      const r = s.push(`${reply}\n`);
      ops = r.applied;
      lineFixes = r.fixes;
    } else {
      s.applyOps(reply);
      ops = reply;
    }
    const before = errs;
    spec = s.spec;
    const second = autoFix(spec, { phase: 'final' });
    spec = second.spec;
    errs = errorsOf(spec);
    const resolved = before.filter((b) => !errs.some((e) => e.code === b.code && e.path === b.path));
    const agentFixes: Fix[] = resolved.map((r) => ({ lossy: false, by: 'agent', message: `fixed ${r.code} at ${r.path}`, elementId: r.elementId, path: r.path }));
    all.push(...lineFixes, ...second.fixes, ...agentFixes);
    emit({ type: 'agent-patched', ops, fixes: agentFixes, round: rounds });
  }
  let usedFallback = false;
  if (errs.length) {
    const last = autoFix(spec, { phase: 'final', lossy: true });
    spec = last.spec;
    usedFallback = true;
    all.push(...last.fixes);
    emit({ type: 'fallback', fixes: last.fixes });
  }
  const issues = validateSpec(spec, 'final').issues;
  emit({ type: 'clean', issues });
  return { spec, fixes: all, issues, rounds, usedFallback };
}
