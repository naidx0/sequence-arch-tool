import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ReactCanvasMount, compileReactSource, evaluateBlock } from './ReactCanvasMount';

/*
 * THE REAL COMPILER, NOT A MOCK. The previous test replaced the compiler with
 * a stub that returned ready-made CommonJS, and that is how a mount path that
 * could never mount a block (Babel 8 emitted ESM with the automatic JSX
 * runtime) stayed green. These compile with sucrase, evaluate with the same
 * wrapper the component uses, and compare rendered markup.
 *
 * The expected markup is what Babel produced for the same blocks with a
 * CommonJS + classic-runtime config, measured side by side before the switch
 * (2026-10-05): identical on all four.
 */
const MODULE_BLOCK = `import { useState } from 'react';
type Props = { label?: string };
interface Row { k: string; v: number }
const rows: Row[] = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }];
export default function Chart({ label = 'Totals' }: Props) {
  const [n] = useState<number>(rows.length);
  return (
    <section data-testid="block">
      <h3>{label}</h3>
      <ul>{rows.map((r) => <li key={r.k}>{r.k}={r.v}</li>)}</ul>
      <>{n} rows</>
    </section>
  );
}`;

const CASES: [string, string, string][] = [
  ['an ES module with JSX, TS types and a react import', MODULE_BLOCK, '<section data-testid="block"><h3>Totals</h3><ul><li>a=1</li><li>b=2</li></ul>2 rows</section>'],
  ['a bare JSX expression', `<div className="x">hi {1 + 1}</div>`, '<div class="x">hi 2</div>'],
  ['a function body with a return and a TS cast', `const n: number = 3;\nreturn <b>{n as number}</b>;`, '<b>3</b>'],
  ['a default export using the React global', `export default function App() { const [s] = React.useState<string>('ok'); return <i>{s}</i>; }`, '<i>ok</i>'],
];

describe('ReactCanvasMount', () => {
  for (const [what, source, html] of CASES) {
    it(`compiles and evaluates ${what}`, async () => {
      const Comp = evaluateBlock(await compileReactSource(source)) as React.ComponentType;
      expect(typeof Comp).toBe('function');
      expect(renderToStaticMarkup(React.createElement(Comp))).toBe(html);
    });
  }

  it('mounts a real block live (not the static fallback)', async () => {
    render(<ReactCanvasMount source={MODULE_BLOCK} />);
    await waitFor(() => {
      expect(screen.getByTestId('block').textContent).toBe('Totalsa=1b=22 rows');
    });
    expect(screen.getByTestId('ai-canvas-react-mount')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-react-src')).toBeTruthy();
    expect(screen.queryByTestId('ai-canvas-react-fallback')).toBeNull();
  });

  it('a block importing anything but react fails by name, with its source shown', async () => {
    render(<ReactCanvasMount source={`import _ from 'lodash';\nexport default function X() { return <p>{_.id}</p>; }`} />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-canvas-react-error').textContent).toMatch(/can import only react; it asked for 'lodash'/);
    });
    expect(screen.getByTestId('ai-canvas-react-src').textContent).toMatch(/lodash/);
  });
});
