/* The UI the harness work added, drawn on fixtures for before/after shots (e2e/ui-conform-shots.mjs). Not part of the app build. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import '../chat/chat.css';
import '../worktree/worktree.css';
import '../v3/v3.css';
import '../shell2/shell2.css';
import '../shell2/chat2.css';
import '../shell2/edits.css';
import '../shell2/pages.css';
import '../files/files.css';

import { AgentRunsList } from './AgentRunThread';
import { EditUndoBar } from './EditFromHere';
import { RefineNoteCard } from './RefineNoteCard';
import { DiagramBlock } from './DiagramBlock';
import VisualOpenDialog from './VisualOpenDialog';
import { FanoutMenu } from '../fanout/FanoutMenu';
import MergePanel from '../worktree/MergePanel';
import { PrSection } from '../worktree/PrSection';
import { editUndo } from '../agents/editUndo';
import { fromSavedRun } from '../agents/savedRuns';
import { StoreProvider, createStore } from '../state';

const q = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', q.get('theme') === 'light' ? 'light' : 'dark');
/* 'old' draws the markup this branch started from for the one element the page builds by hand. */
const old = q.get('v') === 'before';

const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const dry = { clean: true, target: 'main', files: [{ path: 'src/a.ts', status: 'modified' }], conflicts: [], mainUncommitted: [] };
const fakeFetch = (input: string): Promise<Response> => {
  if (input.includes('/api/acp/agents')) return json({ agents: [{ id: 'claude' }, { id: 'codex' }, { id: 'gemini' }] });
  if (input.includes('/api/fanout/')) return json({ prompt: 'p', siblings: [{ chatId: 'c1', agentRef: 'claude', files: [{ path: 'src/a.ts' }], dryRun: dry }, { chatId: 'c2', agentRef: 'codex', files: [{ path: 'src/a.ts' }], dryRun: dry }] });
  if (input.includes('/dry-run')) return json({ ok: true, target: 'main', targetHead: 'def5678', files: [{ path: 'src/a.ts', status: 'modified' }], conflicts: [], worktreeDirty: false, mainUncommitted: [], method: 'merge-tree' });
  if (input.endsWith('/pr/preview')) return json({ commitMessage: 'Add limiter', title: 'Add a rate limiter', body: 'Adds a sliding window.', files: [{ path: 'src/limiter.ts', status: 'added' }], pending: [{ path: 'src/limiter.ts', status: 'added', flagged: null }, { path: '.env', status: 'added', flagged: 'a secrets file' }], dirty: true, remote: 'origin', base: 'main', branch: 'sequence/limiter', pr: null });
  if (input.endsWith('/pr')) return json({ pr: null });
  if (input.includes('/cards')) return json({ auto: false, cards: [{ id: 'n1', state: 'pending', tip: '"add a test for the missing file case" was reported not done before: no test runner is set up in this package. Check that first.', why: { kinds: ['ask_not_done'], turns: ['t1'], asks: ['add a test for the missing file case'] } }] });
  return json({});
};
window.fetch = ((i: unknown, init?: RequestInit) => fakeFetch(String(i)).then((r) => (init ? r : r))) as typeof fetch;

const app = createStore();
const run = fromSavedRun(
  {
    id: 'r1', agentRef: 'claude', prompt: 'remove the meter row, keep the 7d/5h line, show total tokens this week', text: 'The meter row is gone; the 7d/5h line stays.', status: 'done', startedAt: 1, endedAt: 2, tools: [],
    askLedger: { closures: [{ n: 1, text: 'hide the meter row', done: true, reason: null }, { n: 3, text: 'weekly token total', done: false, reason: 'the usage API has no counts' }], open: [3] },
  } as never,
  's',
)!;
editUndo.set({ sessionId: 's', removed: [], prompt: 'x', prevDraft: '', filesReverted: 0, at: Date.now() });
const worktree = { id: 'w1', path: '/work/wt', branch: 'sequence/limiter', baseCommit: 'abc1234', baseBranch: 'main', createdAt: '2026-10-07T10:00:00Z' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90"><rect x="10" y="20" width="70" height="40" rx="6" fill="none" stroke="currentColor"/><rect x="160" y="20" width="70" height="40" rx="6" fill="none" stroke="currentColor"/><path d="M80 40h80" stroke="currentColor"/><text x="45" y="45" text-anchor="middle">app</text><text x="195" y="45" text-anchor="middle">db</text></svg>';

function Section({ id, title, children, wide }: { id: string; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section style={{ width: wide ? 640 : 460 }} data-gallery={id}>
      <h4 style={{ margin: '0 0 8px', font: 'inherit', color: 'var(--ink-3)' }}>{title}</h4>
      {children}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={app}>
      <div className="s2 v3-scaffold" style={{ minHeight: '100vh', padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', background: 'var(--bg-base)' }}>
        <Section id="run" title="Reply with an open ask, and Edit from here">
          <div className="s2-chat" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} onAskAgain={() => {}} />
          </div>
        </Section>
        <Section id="undo" title="Edit undo bar">
          <EditUndoBar sessionId="s" />
        </Section>
        <Section id="note" title="Repo note card">
          <RefineNoteCard sessionId={null} lookAfterMs={0} />
        </Section>
        <Section id="older" title="Show older turns">
          <p className="s2-empty" role="status">
            12 older turns are saved on disk but not shown here.{' '}
            <button type="button" className={old ? 's2-btn' : 's2-btn s2-btn-sm'}>
              Show older turns
            </button>
          </p>
        </Section>
        <Section id="fanout" title="Send to several agents">
          <FanoutMenu store={app} draft="Add a rate limiter" onClose={() => {}} />
        </Section>
        <Section id="compare" title="Best of N: compare and merge" wide>
          <div style={{ position: 'relative', height: 420 }}>
            <MergePanel sessionId="c1" worktree={worktree as never} fanoutId="f1" onClose={() => {}} onChanged={() => {}} fetchImpl={fakeFetch} />
          </div>
        </Section>
        <Section id="pr" title="Pull request form">
          <PrSection sessionId="c1" fetchImpl={fakeFetch} />
        </Section>
        <Section id="drawing" title="A drawing in the chat">
          <DiagramBlock kind="svg" source={SVG} fixedSaved={{ id: 'd1', name: 'app-db.svg', version: 1, title: 'App and database' }} />
        </Section>
        {q.get('viewer') ? (
          <Section id="viewer" title="Open viewer">
            <VisualOpenDialog kind="svg" source={SVG} onClose={() => {}} />
          </Section>
        ) : null}
      </div>
    </StoreProvider>
  </StrictMode>,
);
