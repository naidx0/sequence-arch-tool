import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { WB_COLOR_TOKEN } from './palette';
import { cssColorResolver, remotionSource } from './sceneRemotion';
import type { WbScene } from './whiteboardModel';

const scene = (): WbScene => ({ kind: 'scene', id: 'sc', at: { x: 0, y: 0 }, w: 200, h: 100, duration: 2000, keyframes: [{ t: 500, target: 'a', stroke: 'chart2' }] }) as WbScene;
const items = [{ kind: 'shape', id: 'a', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 50, y: 30 }, stroke: 'chart2', fill: 'surface' }] as never;
const table = (code: string, name: 'COLORS' | 'FILLS'): Record<string, string> => {
  const m = new RegExp(`const ${name}: Record<string, string> = (\\{[\\s\\S]*?\\n\\});`).exec(code);
  return JSON.parse(m![1]!) as Record<string, string>;
};

afterEach(() => document.documentElement.removeAttribute('style'));

describe('the export takes its colours from the theme in use, not from source', () => {
  it('resolves each palette name from the live CSS variable the board draws it with', () => {
    const root = document.documentElement;
    root.style.setProperty('--viz-2', 'rgb(1, 2, 3)');
    root.style.setProperty('--ink-1', 'rgb(250, 250, 250)');
    root.style.setProperty('--surface-2', 'rgb(9, 9, 9)');
    const code = remotionSource({ scene: scene(), items });
    expect(table(code, 'COLORS').chart2).toBe('rgb(1, 2, 3)');
    expect(table(code, 'COLORS').ink).toBe('rgb(250, 250, 250)');
    expect(table(code, 'FILLS').surface).toBe('rgb(9, 9, 9)');
    /* every name has a variable behind it, from the same map the board uses */
    for (const name of Object.keys(WB_COLOR_TOKEN)) expect(Object.keys(table(code, 'COLORS'))).toContain(name);
  });

  it('a variable that is not set falls back to currentColor for a line or a word and transparent for a fill; none is always transparent', () => {
    const code = remotionSource({ scene: scene(), items });
    expect(table(code, 'COLORS').danger).toBe('currentColor');
    expect(table(code, 'FILLS').danger).toBe('transparent');
    expect(table(code, 'FILLS').surface).toBe('transparent');
    expect(table(code, 'COLORS').none).toBe('transparent');
    expect(table(code, 'FILLS').none).toBe('transparent');
    expect(code).toContain('backgroundColor: "transparent"');
  });

  it('a resolver can be handed in, and the file compiles either way with no hex colour in it', () => {
    const code = remotionSource({ scene: scene(), items, resolveColor: (n) => (n === 'info' ? 'oklch(70% 0.1 250)' : undefined) });
    expect(table(code, 'COLORS').info).toBe('oklch(70% 0.1 250)');
    expect(table(code, 'COLORS').ink).toBe('currentColor');
    const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'scene.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
    expect(out.diagnostics ?? []).toEqual([]);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('cssColorResolver reads getComputedStyle of the document, name by name', () => {
    document.documentElement.style.setProperty('--viz-4', 'rgb(4, 4, 4)');
    const resolve = cssColorResolver();
    expect(resolve('chart4')).toBe('rgb(4, 4, 4)');
    expect(resolve('chart5')).toBeUndefined();
    expect(resolve('none')).toBe('transparent');
    expect(resolve('not-a-name')).toBeUndefined();
  });

  it('no hex colour, px font size or raw font weight lives in the scene sources', () => {
    for (const f of ['scene.ts', 'SceneStage.tsx', 'videoItem.tsx']) {
      const src = readFileSync(path.resolve(__dirname, f), 'utf8');
      expect(src, f).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
      expect(src, f).not.toMatch(new RegExp(['font', 'Size:\\s*\\d'].join('')));
      expect(src, f).not.toMatch(new RegExp(['font', 'Weight:'].join('')));
    }
  });
});

describe('a token that is itself var() or color-mix() is computed, never exported raw', () => {
  it('never puts var( or color-mix( into the exported colour tables', () => {
    document.documentElement.style.setProperty('--viz-2', 'var(--accent)');
    const resolve = cssColorResolver();
    const v = resolve('chart2');
    expect(v === undefined || !/\b(var|color-mix)\(/.test(v)).toBe(true);
    document.documentElement.style.removeProperty('--viz-2');
  });
});
