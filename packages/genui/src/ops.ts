/**
 * Ops: normalise what the agent wrote into a UIOp, then fold it into the spec.
 * Normalising is where most "almost right" output is saved without asking anyone: a bare
 * element with no "op", a dotted state path, a set aimed at /state/... are all read as
 * what they obviously mean, and each reading is reported as a lossless fix.
 */
import { insertAt, parsePointer, removeAt, setAt, getAt } from './pointer.js';
import type { Fix, Issue, UIElement, UIOp, UISpec } from './types.js';

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);

const toPointer = (p: string): string => (p.startsWith('/') ? p : `/${p.replace(/\./g, '/')}`);

export type Normalised = { op: UIOp; fixes: Fix[] } | { issue: Omit<Issue, 'path'> };

export function normaliseOp(raw: unknown): Normalised {
  const fixes: Fix[] = [];
  if (!isObj(raw)) return { issue: { code: 'BAD_OP', severity: 'error', message: 'a line must be one JSON object', hint: 'one op per line, e.g. {"op":"el","id":"card","type":"Card","props":{"title":"..."}}' } };
  let r = raw;
  if (r.op === undefined && typeof r.type === 'string' && typeof r.id === 'string') {
    r = { ...r, op: 'el' };
    fixes.push({ lossy: false, by: 'fixer', message: `read a bare element "${String(r.id)}" as an "el" op`, elementId: String(r.id) });
  }
  const op = typeof r.op === 'string' ? r.op.toLowerCase() : undefined;
  switch (op) {
    case 'el':
    case 'element':
    case 'upsert': {
      if (typeof r.id !== 'string' || !r.id) return { issue: { code: 'BAD_OP', severity: 'error', message: 'el needs an id', hint: '{"op":"el","id":"step-1",...}' } };
      if (typeof r.type !== 'string') return { issue: { code: 'BAD_OP', severity: 'error', message: `el "${r.id}" needs a type`, elementId: r.id } };
      let children = r.children;
      if (typeof children === 'string') {
        children = [children];
        fixes.push({ lossy: false, by: 'fixer', message: `children of "${r.id}" was one id; read it as a list`, elementId: r.id });
      }
      /* Props written beside type instead of inside props: move them in. */
      const known = new Set(['op', 'id', 'type', 'props', 'children', 'parent', 'root']);
      const stray = Object.keys(r).filter((k) => !known.has(k));
      let props = isObj(r.props) ? { ...r.props } : {};
      if (stray.length) {
        for (const k of stray) props[k] = r[k];
        fixes.push({ lossy: false, by: 'fixer', message: `moved ${stray.join(', ')} of "${r.id}" into props`, elementId: r.id });
      }
      if (!isObj(r.props) && r.props !== undefined) props = {};
      return {
        op: { op: 'el', id: r.id, type: r.type, props, ...(Array.isArray(children) ? { children: children.map(String) } : {}), ...(typeof r.parent === 'string' ? { parent: r.parent } : {}), ...(r.root === true ? { root: true } : {}) },
        fixes,
      };
    }
    case 'set': {
      if (typeof r.path !== 'string') return { issue: { code: 'BAD_OP', severity: 'error', message: 'set needs a path', hint: '{"op":"set","path":"/tests/passed","value":36}' } };
      let path = toPointer(r.path);
      if (path.startsWith('/state/')) {
        path = path.slice('/state'.length);
        fixes.push({ lossy: false, by: 'fixer', message: `set paths are relative to state; read ${r.path} as ${path}` });
      }
      return { op: { op: 'set', path, value: r.value }, fixes };
    }
    case 'status': {
      const s = r.status ?? r.value;
      if (!['streaming', 'working', 'idle', 'done', 'error'].includes(String(s))) return { issue: { code: 'BAD_OP', severity: 'error', message: `status "${String(s)}" is not one of streaming, working, idle, done, error` } };
      return { op: { op: 'status', status: s as 'done', ...(typeof r.label === 'string' ? { label: r.label } : {}) }, fixes };
    }
    case 'add':
    case 'replace':
    case 'merge':
    case 'append': {
      if (typeof r.path !== 'string') return { issue: { code: 'BAD_OP', severity: 'error', message: `${op} needs a path` } };
      if (op === 'merge' && !isObj(r.value)) return { issue: { code: 'BAD_OP', severity: 'error', message: 'merge needs an object value' } };
      return { op: { op, path: toPointer(r.path), value: r.value } as UIOp, fixes };
    }
    case 'remove': {
      if (typeof r.path !== 'string') return { issue: { code: 'BAD_OP', severity: 'error', message: 'remove needs a path' } };
      return { op: { op: 'remove', path: toPointer(r.path) }, fixes };
    }
    default:
      return { issue: { code: 'BAD_OP', severity: 'error', message: `unknown op "${String(r.op)}"`, hint: 'ops: el, set, status, add, replace, merge, append, remove' } };
  }
}

/** Fold one op in. Pure: returns a new spec sharing every untouched element. */
export function applyOp(spec: UISpec, op: UIOp): UISpec {
  switch (op.op) {
    case 'el': {
      const prev = spec.elements[op.id];
      const el: UIElement = {
        type: op.type,
        props: prev && prev.type === op.type ? { ...prev.props, ...(op.props ?? {}) } : { ...(op.props ?? {}) },
        ...(op.children ? { children: op.children } : prev?.children ? { children: prev.children } : {}),
      };
      let next: UISpec = { ...spec, elements: { ...spec.elements, [op.id]: el } };
      if (op.parent) {
        const parent = next.elements[op.parent];
        if (parent && !(parent.children ?? []).includes(op.id)) next = { ...next, elements: { ...next.elements, [op.parent]: { ...parent, children: [...(parent.children ?? []), op.id] } } };
        if (!parent) next = { ...next, elements: { ...next.elements, [op.parent]: { type: 'Stack', props: {}, children: [op.id] } } };
      }
      if (op.root || (!next.root && !op.parent)) next = { ...next, root: op.id };
      return next;
    }
    case 'set':
      return { ...spec, state: setAt(spec.state, op.path, op.value) };
    case 'status':
      return { ...spec, meta: { ...spec.meta, status: op.status, ...(op.label !== undefined ? { label: op.label } : {}) } };
    case 'add':
    case 'replace': {
      const parts = parsePointer(op.path);
      const parentVal = getAt(spec, parts.slice(0, -1));
      return Array.isArray(parentVal) && op.op === 'add' ? insertAt(spec, op.path, op.value) : setAt(spec, op.path, op.value);
    }
    case 'merge': {
      const cur = getAt(spec, op.path);
      return setAt(spec, op.path, { ...(isObj(cur) ? cur : {}), ...op.value });
    }
    case 'append': {
      const cur = getAt(spec, op.path);
      return setAt(spec, op.path, [...(Array.isArray(cur) ? cur : []), op.value]);
    }
    case 'remove': {
      const parts = parsePointer(op.path);
      /* Removing an element also unhooks it from its parents, or the tree points at nothing. */
      if (parts.length === 2 && parts[0] === 'elements') {
        const id = parts[1]!;
        const elements: Record<string, UIElement> = {};
        for (const [k, e] of Object.entries(spec.elements)) {
          if (k === id) continue;
          elements[k] = e.children?.includes(id) ? { ...e, children: e.children.filter((c) => c !== id) } : e;
        }
        return { ...spec, elements, root: spec.root === id ? null : spec.root };
      }
      return removeAt(spec, op.path);
    }
  }
}
