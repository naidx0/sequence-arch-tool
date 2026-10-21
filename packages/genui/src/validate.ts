/**
 * THE VALIDATOR. Every frame of a streaming surface and the final spec go through it.
 *
 * phase 'streaming' is lenient about what has not arrived yet (a child referenced
 * before it is sent is a warning and renders as a placeholder); phase 'final' is not.
 * Every issue carries a JSON pointer and a concrete hint, because the issues are what
 * the agent is handed when it is asked to repair (Cursor's canvas diagnostics carry a
 * range for the same reason).
 */
import type { z } from 'zod';
import { findComponent, COMPONENT_TYPES } from './catalog.js';
import { resolveProps } from './bindings.js';
import type { Issue, UISpec } from './types.js';

export type Phase = 'streaming' | 'final';

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  /** Element ids that render (valid, or valid enough for a placeholder). */
  renderable: Set<string>;
}

const esc = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

export function zodIssueHint(i: z.core.$ZodIssue): string | undefined {
  const anyI = i as unknown as { code: string; values?: unknown[]; expected?: string; keys?: string[]; maximum?: unknown; minimum?: unknown };
  switch (anyI.code) {
    case 'invalid_value':
      return anyI.values ? `use one of: ${anyI.values.map(String).join(', ')}` : undefined;
    case 'invalid_type':
      return anyI.expected ? `expected ${anyI.expected}` : undefined;
    case 'unrecognized_keys':
      return `remove ${anyI.keys?.join(', ')}`;
    case 'too_big':
      return `at most ${String(anyI.maximum)}`;
    case 'too_small':
      return `at least ${String(anyI.minimum)}`;
    default:
      return undefined;
  }
}

export function validateSpec(spec: UISpec, phase: Phase = 'final'): ValidationResult {
  const issues: Issue[] = [];
  const renderable = new Set<string>();
  const soft = phase === 'streaming' ? 'warning' : 'error';
  const ids = Object.keys(spec.elements);

  if (!spec.root) {
    if (ids.length > 0) issues.push({ code: 'NO_ROOT', severity: soft, path: '/root', message: 'no root element', hint: `set "root" to the outermost element id (e.g. "${ids[0]}")` });
  } else if (!spec.elements[spec.root]) {
    issues.push({ code: 'MISSING_CHILD', severity: soft, path: '/root', message: `root "${spec.root}" is not defined`, hint: `send {"op":"el","id":"${spec.root}",...}` });
  }

  for (const id of ids) {
    const el = spec.elements[id]!;
    const base = `/elements/${esc(id)}`;
    const d = findComponent(el.type);
    if (!d) {
      issues.push({ code: 'UNKNOWN_COMPONENT', severity: 'error', path: `${base}/type`, elementId: id, message: `"${el.type}" is not in the catalog`, hint: `use one of: ${COMPONENT_TYPES.join(', ')}` });
      continue;
    }
    const { props, unbound } = resolveProps(el.props ?? {}, spec.state);
    for (const u of unbound) issues.push({ code: 'UNBOUND_STATE', severity: 'warning', path: `${base}/props`, elementId: id, message: `binding ${u} has no value yet`, hint: `send {"op":"set","path":"${u}","value":...}` });
    const parsed = d.props.safeParse(props);
    let propsOk = true;
    if (!parsed.success) {
      for (const zi of parsed.error.issues) {
        /* A required prop bound to state that has no value yet is not the agent's mistake mid-stream. */
        const head = zi.path[0];
        const raw = typeof head === 'string' ? el.props?.[head] : undefined;
        const boundButEmpty = raw != null && typeof raw === 'object' && '$state' in (raw as object) && unbound.length > 0;
        const severity = boundButEmpty ? soft : 'error';
        if (severity === 'error') propsOk = false;
        issues.push({ code: 'INVALID_PROPS', severity, path: `${base}/props${zi.path.length ? `/${zi.path.map((p) => esc(String(p))).join('/')}` : ''}`, elementId: id, message: `${el.type}: ${zi.message}`, hint: zodIssueHint(zi) });
      }
    }
    const kids = el.children ?? [];
    if (!Array.isArray(kids)) {
      issues.push({ code: 'INVALID_PROPS', severity: 'error', path: `${base}/children`, elementId: id, message: 'children must be an array of ids' });
      continue;
    }
    if (d.children === 'none' && kids.length > 0) {
      issues.push({ code: 'UNALLOWED_CHILD', severity: 'error', path: `${base}/children`, elementId: id, message: `${el.type} takes no children`, hint: 'move them to a parent Stack or Card' });
    }
    for (const [i, k] of kids.entries()) {
      const child = spec.elements[k];
      if (!child) {
        issues.push({ code: 'MISSING_CHILD', severity: soft, path: `${base}/children/${i}`, elementId: id, message: `child "${k}" is not defined`, hint: `send {"op":"el","id":"${k}",...} or remove it` });
        continue;
      }
      if (Array.isArray(d.children) && !d.children.includes(child.type)) {
        issues.push({ code: 'UNALLOWED_CHILD', severity: 'error', path: `${base}/children/${i}`, elementId: id, message: `${el.type} only takes ${d.children.join(', ')}, not ${child.type}`, hint: `wrap "${k}" in a ${d.children[0]}, or move it out` });
      }
    }
    if (el.type === 'Button') {
      const name = (props.action as { name?: string } | undefined)?.name;
      if (name && !spec.actions[name]) {
        /* A disabled button is inert, so an undeclared action on it cannot misfire: a warning. */
        const inert = props.disabled === true;
        if (!inert) propsOk = false;
        issues.push({ code: 'UNDECLARED_ACTION', severity: inert ? 'warning' : 'error', path: `${base}/props/action/name`, elementId: id, message: `action "${name}" is not declared`, hint: `send {"op":"add","path":"/actions/${name}","value":{"description":"..."}}` });
      }
    }
    if (propsOk) renderable.add(id);
  }

  /* Cycles and orphans, walked from the root. */
  if (spec.root && spec.elements[spec.root]) {
    const seen = new Set<string>();
    const stack = new Set<string>();
    const walk = (id: string): void => {
      if (stack.has(id)) {
        issues.push({ code: 'CYCLE', severity: 'error', path: `/elements/${esc(id)}/children`, elementId: id, message: `"${id}" contains itself`, hint: 'children must form a tree' });
        return;
      }
      if (seen.has(id)) return;
      seen.add(id);
      stack.add(id);
      for (const k of spec.elements[id]?.children ?? []) if (spec.elements[k]) walk(k);
      stack.delete(id);
    };
    walk(spec.root);
    for (const id of ids) if (!seen.has(id)) issues.push({ code: 'ORPHAN', severity: 'warning', path: `/elements/${esc(id)}`, elementId: id, message: `"${id}" is not reachable from the root`, hint: `add it to a parent's children` });
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues, renderable };
}

/** The repair request in the agent's terms: what is wrong, where, and the line that fixes it. */
export function diagnosticsPrompt(issues: Issue[], surfaceId: string): string {
  const errs = issues.filter((i) => i.severity === 'error');
  const lines = errs.slice(0, 20).map((i, n) => `${n + 1}. [${i.code}] ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`);
  return [
    `The UI surface "${surfaceId}" has ${errs.length} problem${errs.length === 1 ? '' : 's'} the renderer could not fix on its own:`,
    ...lines,
    errs.length > 20 ? `…and ${errs.length - 20} more.` : '',
    'Reply with JSONL ops that fix exactly these (do not resend the whole surface). Use only catalog components and declared actions.',
  ]
    .filter(Boolean)
    .join('\n');
}
