/** JSON pointers (RFC 6901), immutable. A write copies only the containers on the path, so
 *  an element nobody touched keeps its identity and a memoised component skips it. */

export function parsePointer(p: string): string[] {
  if (p === '' || p === '/') return [];
  if (!p.startsWith('/')) p = `/${p}`;
  return p
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getAt(root: unknown, p: string | string[]): unknown {
  const parts = Array.isArray(p) ? p : parsePointer(p);
  let cur: unknown = root;
  for (const k of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[k === '-' ? cur.length - 1 : Number(k)] : (cur as Record<string, unknown>)[k];
  }
  return cur;
}

type Mode = 'set' | 'insert' | 'remove';

function writeAt(node: unknown, parts: string[], i: number, mode: Mode, value: unknown): unknown {
  if (i === parts.length) return mode === 'remove' ? undefined : value;
  const k = parts[i]!;
  const last = i === parts.length - 1;
  if (Array.isArray(node)) {
    const arr = node.slice();
    const idx = k === '-' ? arr.length : Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx > arr.length) throw new Error(`bad array index "${k}"`);
    if (last && mode === 'remove') arr.splice(idx, 1);
    else if (last && mode === 'insert') arr.splice(idx, 0, value);
    else arr[idx] = writeAt(arr[idx], parts, i + 1, mode, value);
    return arr;
  }
  const obj: Record<string, unknown> = node != null && typeof node === 'object' ? { ...(node as Record<string, unknown>) } : {};
  if (last && mode === 'remove') {
    delete obj[k];
    return obj;
  }
  /* A missing container on the path is created: an agent setting /state/tests/passed before /state/tests is the normal case. */
  const nextIsIndex = !last && (parts[i + 1] === '-' || /^\d+$/.test(parts[i + 1]!));
  obj[k] = writeAt(obj[k] ?? (last ? undefined : nextIsIndex ? [] : {}), parts, i + 1, last && mode === 'insert' ? 'set' : mode, value);
  return obj;
}

export const setAt = <T>(root: T, p: string, value: unknown): T => writeAt(root, parsePointer(p), 0, 'set', value) as T;
export const insertAt = <T>(root: T, p: string, value: unknown): T => writeAt(root, parsePointer(p), 0, 'insert', value) as T;
export const removeAt = <T>(root: T, p: string): T => writeAt(root, parsePointer(p), 0, 'remove', undefined) as T;
