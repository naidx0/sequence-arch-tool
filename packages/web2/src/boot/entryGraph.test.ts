import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* THE ENTRY CHUNK KEEPS ITS WEIGHT OFF THE PATH TO THE COMPOSER.
   Cold start (spawn to the composer accepting input) regressed ~33 ms in 0.1.8.4 because the session rail's lists
   (RailLists with the workflow editor, component detail and the built-in programs) and the agent's live cards
   (GenUISurface with @sequence/genui and zod) were imported statically from the shell and the chat, so they landed in
   the entry chunk (+200 KB). This test walks the STATIC import graph from main.tsx (what vite puts in the entry
   chunk), and `import()` / React.lazy edges are not followed. It reads source files only. */

const SRC = path.resolve(__dirname, '..');
const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

function resolve(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  if (/\.(css|svg|png|json)$/.test(base)) return null;
  for (const e of ['', ...EXTS]) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/** Value imports and re-exports only: `import type` and `export type` vanish at build time. */
function staticImports(file: string): { rel: string[]; bare: string[] } {
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rel: string[] = [];
  const bare: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[2]) continue;
    const clause = m[3] ?? '';
    if (/^\{[^}]*\}\s+from\s+$/.test(clause.trim() + ' ') && /^\{\s*(type\s+\w+\s*,?\s*)+\}/.test(clause.trim())) continue;
    (m[4].startsWith('.') ? rel : bare).push(m[4]);
  }
  return { rel, bare };
}

function entryGraph(): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [path.join(SRC, 'main.tsx')];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const { rel, bare: b } = staticImports(f);
    b.forEach((x) => bare.add(x));
    for (const r of rel) {
      const p = resolve(f, r);
      if (p) queue.push(p);
    }
  }
  return { files, bare };
}

describe('the entry chunk (static import graph from main.tsx)', () => {
  const { files, bare } = entryGraph();
  const has = (rel: string): boolean => files.has(path.join(SRC, rel));

  it('positive control: the walk reaches the shell, the chat and the rail nav', () => {
    expect(has('app/App.tsx')).toBe(true);
    expect(has('v3/V3Chat.tsx')).toBe(true);
    expect(has('shell2/SessionPanel.tsx')).toBe(true);
    expect(has('rail/RailNav.tsx')).toBe(true);
  });

  it('the rail lists load when a section opens, not with the shell', () => {
    expect(has('rail/RailLists.tsx')).toBe(false);
    expect(has('activity/WorkflowEditor.tsx')).toBe(false);
    expect(has('activity/WorkflowPreview.tsx')).toBe(false);
    expect(has('components/ComponentDetail.tsx')).toBe(false);
  });

  it('the generative cards load when the first card is drawn, not with the chat', () => {
    expect(has('genui/chatSurfacesImpl.tsx')).toBe(false);
    expect(has('genui/surfaceStore.ts')).toBe(false);
    expect(has('genui/GenUISurface.tsx')).toBe(false);
    expect(has('genui/GenUISavedSurface.tsx')).toBe(false);
    expect(has('genui/session.ts')).toBe(false);
    expect(bare.has('@sequence/genui')).toBe(false);
  });

  it('the layout engine (elkjs, 1.4 MB) is never in the entry chunk: it lives in the worker and loads with the first layout', () => {
    expect(has('canvas/elk.worker.ts')).toBe(false);
    expect([...bare].filter((b) => b.startsWith('elkjs'))).toEqual([]);
  });

  it('the packaged brand mark tables (about 170 KB) load when a packaged mark is drawn, not with the shell', () => {
    expect(has('settings/logos/providerMarks.ts')).toBe(false);
    expect(has('settings/logos/agentMarks.ts')).toBe(false);
    expect(has('settings/logos/lobeMarks.ts')).toBe(false);
    expect(has('settings/logos/markKeys.ts')).toBe(true);
  });
});
