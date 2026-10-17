/**
 * 0.1.8 D2: a step row that names a file keeps the file name whole: the folders in front give way (in the middle of the label),
 * the full text is on the title.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentsPanel, splitPathLabel } from './AgentsPanel';
import { createAgentStore } from './agentStream';

const DEEP = 'packages/web2/src/shell2/very/deeply/nested/folder/structure/StatusBarFileNameThatIsLong.tsx';

describe('a step that names a file', () => {
  it('splits at the last slash; a label with no path is left alone', () => {
    expect(splitPathLabel('Edited a/b/c.ts')).toEqual({ head: 'Edited a/b/', tail: 'c.ts' });
    expect(splitPathLabel('Edited c.ts')).toBeNull();
    expect(splitPathLabel('Listed src/')).toBeNull();
    expect(splitPathLabel('Ran git log origin/main --oneline')).toBeNull();
  });

  it('draws the folders and the file name as two spans, with the whole label on the title', () => {
    const store = createAgentStore(() => null);
    let n = 0;
    const ev = (e: object) => ({ id: `e${++n}`, at: 1000 + n * 100, source: 'claude-hook', sessionId: 's1', paths: [], status: 'done', ...e }) as never;
    store.apply(ev({ kind: 'session_start', status: 'running' }));
    store.apply(ev({ kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', status: 'running', title: `Edit ${DEEP}`, paths: [DEEP] }));
    store.apply(ev({ kind: 'tool_end', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', title: `Edit ${DEEP}`, paths: [DEEP] }));
    render(<AgentsPanel store={store} />);
    const name = Array.from(document.querySelectorAll('.ag-name.is-path'))[0] as HTMLElement;
    expect(name).toBeTruthy();
    expect(name.querySelector('.ag-name-tail')!.textContent).toBe('StatusBarFileNameThatIsLong.tsx');
    expect(name.querySelector('.ag-name-head')!.textContent!.endsWith('/')).toBe(true);
    expect(name.getAttribute('title')).toContain('StatusBarFileNameThatIsLong.tsx');
    expect(screen.getAllByTestId('agents-tree-node').length).toBeGreaterThan(0);
  });

  it('the stylesheet cuts the folders first and keeps the file name', () => {
    const css = readFileSync(resolve(__dirname, 'agents.css'), 'utf8').replace(/\r\n/g, '\n');
    const head = /\.ag-scope \.ag-name-head \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const tail = /\.ag-scope \.ag-name-tail \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(head).toMatch(/flex:\s*0\s+100\s+auto/);
    expect(head).toMatch(/text-overflow:\s*ellipsis/);
    expect(tail).toMatch(/flex:\s*0\s+1\s+auto/);
  });
});
