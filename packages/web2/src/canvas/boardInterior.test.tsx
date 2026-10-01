/* ══════════════════════════════════════════════════════════════════════════
   THREE ZOOMS — the system, a service's modules, a module's files.
   packages/web2/src/canvas/boardInterior.test.tsx

   Owner, 2026-09-22, walking ML Harness in the app: "Click on the ML service —
   there's 55 nodes in here. It'd be much cooler if we could turn these micro
   file services into macro services. First the huge macro architecture board
   view, the whole system. Then when you click it, it turns into the macro of
   the mega-macro. And then if you want more, it can tune in and show the
   micro of everything."

   THE FIXTURE IS THE REPORTED SHAPE, measured on ml-harness's own scan:
   `svc:ml-harness-app` holds 6 modules (17, 19, 17, 18, 20 and 3 files) and 49
   files the clustering left outside any module — 55 cards when opened, the six
   that say what the service is made of drowned in the 49 that do not.

   Every gesture here is the reader's: double-click, the menu, the Back button.
   No state is set by hand.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { displayLabel } from './displayLabel.js';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

const MODULES: Array<[string, number, string]> = [
  ['platform', 17, 'Boots the app and applies the theme.'],
  ['Panes', 19, 'Draws the panes a session is read in.'],
  ['Readers', 17, 'Reads approvals and asks back to the person.'],
  ['Engine', 18, 'Runs a turn against the model.'],
  ['Ui', 20, 'Shared controls every pane is built from.'],
  ['shims', 3, 'Stands in for the crash reporter.'],
];

const IMPORTS: Array<[string, string, number]> = [
  ['Readers', 'Ui', 14],
  ['Ui', 'Panes', 14],
  ['Engine', 'Ui', 6],
  ['Panes', 'Engine', 5],
  ['Panes', 'Ui', 3],
];

function mlHarness(): GetArchGraphResponse {
  const nodes: Array<Record<string, unknown>> = [
    { id: 'repo', kind: 'repo', label: 'ml-harness', path: '.' },
    { id: 'svc:ml-harness-app', kind: 'service', label: 'ml-harness-app', parentId: 'repo', path: 'web' },
    /* A second service with no modules, so the repository view has two parts
       and one of them is described only by the scan's `meta.description`. */
    {
      id: 'svc:docs',
      kind: 'service',
      label: 'docs',
      parentId: 'repo',
      path: 'docs',
      meta: { description: 'The published handbook.' },
    },
    { id: 'file:docs/index.ts', kind: 'file', label: 'index.ts', parentId: 'svc:docs', path: 'docs/index.ts', meta: { loc: 40 } },
  ];
  MODULES.forEach(([label, files, description], i) => {
    const id = `mod:ml-harness-app/${i}`;
    nodes.push({
      id,
      kind: 'module',
      label,
      parentId: 'svc:ml-harness-app',
      path: `web/src/${label.toLowerCase()}`,
      meta: { files, description },
    });
    for (let f = 0; f < files; f += 1) {
      const path = `web/src/${label.toLowerCase()}/${label.toLowerCase()}${f}.ts`;
      nodes.push({ id: `file:${path}`, kind: 'file', label: `${label.toLowerCase()}${f}.ts`, parentId: id, path, meta: { loc: 100 } });
    }
  });
  for (let f = 0; f < 49; f += 1) {
    const path = `web/tests/loose${f}.test.ts`;
    nodes.push({ id: `file:${path}`, kind: 'file', label: `loose${f}.test.ts`, parentId: 'svc:ml-harness-app', path, meta: { loc: 30 } });
  }
  /* The scan's imports are all file→file. These are the real module-level
     counts from ml-harness's scan (docs/teaching-flow-plan.md, Explorer 3). */
  const edges: Array<Record<string, unknown>> = [];
  for (const [a, b, n] of IMPORTS) {
    const fa = MODULES.find(([l]) => l === a)![1];
    const fb = MODULES.find(([l]) => l === b)![1];
    for (let k = 0; k < n; k += 1) {
      const src = `web/src/${a.toLowerCase()}/${a.toLowerCase()}${k % fa}.ts`;
      const dst = `web/src/${b.toLowerCase()}/${b.toLowerCase()}${(k + 1) % fb}.ts`;
      edges.push({
        id: `imp:${a}->${b}:${k}`,
        srcId: `file:${src}`,
        dstId: `file:${dst}`,
        kind: 'import',
        confidence: 1,
        origin: 'deterministic',
        evidence: [{ file: src, line: k + 1 }],
      });
    }
  }
  return {
    repoName: 'ml-harness',
    scannedAt: '2026-09-22T00:00:00.000Z',
    repoRoot: '/tmp/ml-harness',
    nodes,
    edges,
    /* What the server sends: the service's sentence is in `nodeDetail`, NOT on
       the graph node, which has no `detail` field at all. */
    nodeDetail: { 'svc:ml-harness-app': { whatItDoes: 'The harness web app a person drives.' } },
  } as unknown as GetArchGraphResponse;
}

function mount(): void {
  const graph = mlHarness();
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/ml-harness',
      repoName: 'ml-harness',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt,
    },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
}

function titles(): string[] {
  return screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');
}

function card(label: string): HTMLElement {
  const shown = displayLabel(label);
  const found = screen
    .queryAllByTestId('board-node')
    .find((el) => el.querySelector('[data-testid="board-node-title"]')?.textContent === shown);
  if (!found) throw new Error(`no card titled ${shown}; saw ${titles().join(', ')}`);
  return found;
}

function bar(): HTMLElement | null {
  return screen.queryByTestId('board-interior');
}

describe('opening a service that the scan clustered into modules', () => {
  it('shows ONLY its modules — six cards, not fifty-five', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));

    expect(bar()?.textContent).toContain('Inside ml-harness-app');
    expect(screen.queryAllByTestId('board-node')).toHaveLength(6);
    for (const [label] of MODULES) expect(titles()).toContain(displayLabel(label));
    /* Not one loose file is placed. */
    expect(titles().some((t) => /loose/i.test(t))).toBe(false);
  });

  it('counts the files outside every module instead of placing them', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    const count = screen.getByTestId('board-interior-count').textContent ?? '';
    expect(count).toContain('6 modules');
    expect(count).toContain('49 files outside any module');
  });

  it('connects the modules, so the level lays out as a flow and not six loose cards', () => {
    /* Owner, 2026-09-22: "when I click on that service I want a macro diagram
       of how everything comes together". With no edge drawn, `elkGraphFor`
       rectpacks the cards and the direction control is withheld; with the
       roll-up it takes the layered path, which is the one that offers it. */
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    expect(screen.queryAllByTestId('board-edge').length).toBeGreaterThan(0);
    const counts = screen.queryAllByTestId('board-edge-label').map((el) => el.textContent ?? '');
    expect(counts).toContain('14 imports');
    expect(screen.queryByTestId('board-layout-vertical')).not.toBeNull();
  });

  it('each module card says what the module does', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    for (const [label, , description] of MODULES) {
      expect(card(label).textContent).toContain(description);
    }
  });
});

describe('opening a module, and coming back one level at a time', () => {
  it('double-clicking a module shows its files', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    fireEvent.doubleClick(card('Panes'));

    expect(bar()?.textContent).toContain('Inside Panes');
    expect(screen.queryAllByTestId('board-node')).toHaveLength(19);
    expect(titles()).toContain(displayLabel('panes0.ts'));
    expect(titles()).not.toContain(displayLabel('Engine'));
  });

  it('Open on a module card is offered and opens it', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    fireEvent.contextMenu(card('Engine'));
    const open = screen.getByTestId('board-menu-open') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(bar()?.textContent).toContain('Inside Engine');
    expect(screen.queryAllByTestId('board-node')).toHaveLength(18);
  });

  it('Back goes up ONE level: files -> modules -> the system', () => {
    mount();
    fireEvent.doubleClick(card('ml-harness-app'));
    fireEvent.doubleClick(card('Panes'));

    const back = screen.getByTestId('board-interior-close');
    /* The button names where it goes, so the reader knows before pressing it. */
    expect(back.textContent).toContain('ml-harness-app');
    fireEvent.click(back);
    expect(bar()?.textContent).toContain('Inside ml-harness-app');
    expect(screen.queryAllByTestId('board-node')).toHaveLength(6);

    fireEvent.click(screen.getByTestId('board-interior-close'));
    expect(bar()).toBeNull();
    expect(titles()).toContain(displayLabel('ml-harness-app'));
    expect(titles()).toContain(displayLabel('docs'));
  });
});

describe('the repository view says what each part is', () => {
  it('reads the sentence from nodeDetail, and falls back to meta.description', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-repo-anatomy'));
    const parts = screen.getByTestId('board-repo-anatomy-parts');
    const row = (id: string) => parts.querySelector(`[data-part-id="${id}"]`)?.textContent ?? '';
    /* `graph.nodes` carries no `detail`; the sentence the server derived lives
       in `graph.nodeDetail`. Reading it off the node drew nothing, ever. */
    expect(row('svc:ml-harness-app')).toContain('The harness web app a person drives.');
    expect(row('svc:docs')).toContain('The published handbook.');
  });
});
