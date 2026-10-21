/* ══════════════════════════════════════════════════════════════════════════
   A SCRIPTED AGENT: the whole pipeline, no API key
   packages/web2/src/genui/mockAgent.ts

   It streams JSONL the way a model does (uneven chunks, a token at a time),
   and it makes the mistakes models make, on purpose, so the repair path is
   exercised and visible:

     "step", "ProgressBar"       aliases           -> fixed live (lossless)
     "completed", "in-progress"  enum synonyms     -> fixed live (lossless)
     label on a TimelineItem     prop synonym      -> fixed live (lossless)
     action "Fix Failures"       a string action   -> fixed live (lossless)
     a trailing comma            malformed line    -> repaired line
     "Sparkline"                 not in catalog    -> agent repair round
     fix_failures undeclared     missing action    -> agent repair round

   Then it reacts to clicks: Fix failures -> edits, re-runs the tests live;
   Open pull request -> opens it; Merge -> merged.
   ══════════════════════════════════════════════════════════════════════════ */
import type { UIAction, UIDiagnostics, UIOp } from '@sequence/genui';

import { Emitter, type GenUIAgent } from './agent';

const S = 'task';
type Step =
  | { say: string }
  | { ops: unknown[] }
  | { wait: number }
  | { busy: boolean; label?: string }
  | { count: { path: string; from: number; to: number; every: number; status?: (n: number) => string } }
  | { raw: string }
  | 'end';

const el = (id: string, type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): unknown => ({ op: 'el', id, type, props, ...extra });

const TURN_1: Step[] = [
  { busy: true, label: 'Thinking' },
  { say: "I'll upgrade the auth middleware to the new session API, then run the suite. " },
  { ops: [{ op: 'status', status: 'working', label: 'Planning' }, el('card', 'Card', { title: 'Upgrade auth middleware', subtitle: 'feat/session-refresh into main', badge: 'Working', tone: 'accent' }, { children: ['status', 'tl'] })] },
  { ops: [el('status', 'StatusLine', { text: 'Reading src/auth.ts', busy: true }), { op: 'add', path: '/actions/open_pr', value: { description: 'Open a pull request for feat/session-refresh' } }] },
  { ops: [el('tl', 'Timeline', {}, { children: ['plan', 'edit', 'test'] })] },
  { ops: [el('plan', 'TimelineItem', { title: 'Plan the change', status: 'completed', meta: '2s', detail: 'Session tokens move to rotate-on-refresh; 3 files touch the old API.' })] },
  { wait: 400 },
  { ops: [el('edit', 'step', { label: 'Edit 3 files', status: 'in-progress' }, { children: ['files'] })] },
  { ops: [el('status', 'StatusLine', { text: 'Editing src/middleware.ts' })] },
  { ops: [el('files', 'FileList', { files: [{ path: 'src/auth.ts', status: 'modified', additions: 24, deletions: 9 }, { path: 'src/middleware.ts', status: 'modified', additions: 11, deletions: 6 }, { path: 'src/session.ts', status: 'added', additions: 58 }] })] },
  { wait: 500 },
  { ops: [el('edit', 'TimelineItem', { status: 'done', meta: '9s' })] },
  { ops: [el('test', 'TimelineItem', { title: 'Run tests', status: 'running' }, { children: ['prog'] }), { op: 'set', path: '/tests', value: { passed: 0, total: 42 } }] },
  { ops: [el('prog', 'ProgressBar', { label: 'Tests', value: { $state: '/tests/passed' }, max: { $state: '/tests/total' } })] },
  { count: { path: '/tests/passed', from: 1, to: 40, every: 55, status: (n) => `Running ${n} of 42 tests` } },
  { raw: '{"op":"set","path":"/tests/failed","value":2,}' },
  { ops: [el('test', 'TimelineItem', { status: 'warning', detail: '40 passed, 2 failed', meta: '21s' }), el('fail', 'Callout', { tone: 'red', title: '2 tests failed', text: 'session.refresh does not rotate an expired token; middleware reads the old cookie name.' }, { parent: 'test', children: ['faildiff'] })] },
  { ops: [el('faildiff', 'Diff', { path: 'test/session.test.ts', lines: [{ kind: 'hunk', text: '@@ refresh rotates expired tokens @@' }, { kind: 'ctx', text: "expect(next.token).not.toBe(prev.token)", n: 41 }, { kind: 'del', text: '  Received: "tok_8f2a" (unchanged)', n: 42 }] })] },
  { ops: [el('trend', 'Sparkline', { title: 'Suite time', points: [24, 23, 25, 21] }, { parent: 'card' })] },
  { ops: [el('actions', 'Actions', {}, { parent: 'card', children: ['fixbtn', 'prbtn'] }), el('fixbtn', 'Button', { label: 'Fix failures', action: 'Fix Failures', variant: 'primary' }), el('prbtn', 'Button', { label: 'Open PR anyway', action: { name: 'open_pr' }, variant: 'outline', confirm: 'Open with 2 failing' })] },
  { ops: [el('card', 'Card', { badge: 'Needs attention', tone: 'warning' }), el('status', 'StatusLine', { text: 'Waiting for you', busy: false }), { op: 'status', status: 'idle' }] },
  { say: '\n\nTwo tests fail on token rotation. I can fix them, or you can open the PR as is.' },
  'end',
  { busy: false },
];

const TURN_FIX: Step[] = [
  { busy: true, label: 'Fixing' },
  { ops: [el('card', 'Card', { badge: 'Working', tone: 'accent' }), el('status', 'StatusLine', { text: 'Fixing session.refresh rotation', busy: true })] },
  { ops: [{ op: 'remove', path: '/elements/fail' }] },
  { ops: [el('fix', 'TimelineItem', { title: 'Fix 2 failing tests', status: 'running' }, { children: ['fixdiff'] }), { op: 'replace', path: '/elements/tl/children', value: ['plan', 'edit', 'fix', 'test'] }] },
  {
    ops: [
      el('fixdiff', 'Diff', {
        path: 'src/session.ts',
        lines: [
          { kind: 'hunk', text: '@@ -31,7 +31,9 @@ export function refresh(session: Session)' },
          { kind: 'ctx', text: '  if (isExpired(session.token)) {', n: 31 },
          { kind: 'del', text: '    return session', n: 32 },
          { kind: 'add', text: '    const token = rotate(session.token, keys.current())', n: 32 },
          { kind: 'add', text: '    return { ...session, token, rotatedAt: now() }', n: 33 },
          { kind: 'ctx', text: '  }', n: 34 },
        ],
      }),
    ],
  },
  { wait: 500 },
  { ops: [el('fix', 'TimelineItem', { status: 'done', meta: '6s' }), el('test', 'TimelineItem', { title: 'Re-run tests', status: 'running', detail: '' }), { op: 'set', path: '/tests/passed', value: 0 }] },
  { count: { path: '/tests/passed', from: 2, to: 42, every: 32, status: (n) => `Running ${n} of 42 tests` } },
  { ops: [el('test', 'TimelineItem', { status: 'done', detail: '42 passed', meta: '19s' }), el('checks', 'Checks', {}, { children: ['c1', 'c2', 'c3', 'c4'] }), { op: 'replace', path: '/elements/card/children', value: ['status', 'tl', 'checks', 'trend', 'actions'] }] },
  { ops: [el('c1', 'Check', { label: 'Tests', status: 'pass', detail: 'vitest run: 42 passed, 0 failed (19.2s)' }), el('c2', 'Check', { label: 'Lint', status: 'running' }), el('c3', 'Check', { label: 'Types', status: 'running' }), el('c4', 'Check', { label: 'Preview', status: 'pending' })] },
  { wait: 450 },
  { ops: [el('c2', 'Check', { status: 'pass', detail: 'eslint . : 0 problems (3.1s)' })] },
  { wait: 350 },
  { ops: [el('c3', 'Check', { status: 'pass', detail: 'tsc --noEmit: no errors (21s)' }), el('c4', 'Check', { status: 'running' })] },
  { wait: 500 },
  { ops: [el('c4', 'Check', { status: 'pass', detail: 'https://session-refresh.preview.acme.dev' })] },
  { ops: [el('card', 'Card', { badge: 'Ready', tone: 'success' }), el('status', 'StatusLine', { text: 'All checks passed', busy: false }), { op: 'remove', path: '/elements/fixbtn' }, el('prbtn', 'Button', { label: 'Open pull request', variant: 'primary', confirm: '' })] },
  { say: '\n\nFixed: expired tokens now rotate on refresh, and all 42 tests pass.' },
  'end',
  { busy: false },
];

const TURN_PR: Step[] = [
  { busy: true, label: 'Opening PR' },
  { ops: [el('status', 'StatusLine', { text: 'Pushing 3 commits to origin', busy: true }), el('pr', 'TimelineItem', { title: 'Open pull request', status: 'running' }, { parent: 'tl' })] },
  { wait: 700 },
  { ops: [el('status', 'StatusLine', { text: 'Opening the pull request' })] },
  { wait: 600 },
  { ops: [el('pr', 'TimelineItem', { title: 'Opened PR 128', status: 'done', meta: 'now' }), el('card', 'Card', { badge: 'Open', tone: 'success' }), { op: 'add', path: '/actions/merge', value: { description: 'Squash and merge PR 128 into main' } }, { op: 'remove', path: '/elements/prbtn' }] },
  { ops: [el('mergebtn', 'Button', { label: 'Merge', action: { name: 'merge' }, variant: 'primary' }, { parent: 'actions' }), el('status', 'StatusLine', { text: 'PR 128 is open and green', busy: false })] },
  'end',
  { busy: false },
];

const TURN_MERGE: Step[] = [
  { busy: true, label: 'Merging' },
  { ops: [el('status', 'StatusLine', { text: 'Merging PR 128', busy: true }), el('mergebtn', 'Button', { disabled: true })] },
  { wait: 900 },
  { ops: [el('merged', 'TimelineItem', { title: 'Merged into main', status: 'done', tone: 'merged', meta: 'now' }, { parent: 'tl' }), el('card', 'Card', { badge: 'Merged', tone: 'merged' }), { op: 'remove', path: '/elements/mergebtn' }, el('status', 'StatusLine', { text: 'PR 128 merged', busy: false })] },
  { say: '\n\nMerged PR 128 into main.' },
  'end',
  { busy: false },
];

const TURNS: Record<string, Step[]> = { fix_failures: TURN_FIX, open_pr: TURN_PR, merge: TURN_MERGE };

export interface MockOptions {
  /** 1 is real time; 0 runs as fast as timers allow (tests). */
  speed?: number;
  /** Stream characters per chunk, min..max (a model's tokens are uneven). */
  chunk?: [number, number];
}

export class MockAgent extends Emitter implements GenUIAgent {
  private running: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private o: MockOptions = {}) {
    super();
  }

  private sleep(ms: number): Promise<void> {
    const speed = this.o.speed ?? 1;
    return new Promise((r) => setTimeout(r, speed === 0 ? 0 : ms / speed));
  }

  private async streamLine(line: string): Promise<void> {
    const [lo, hi] = this.o.chunk ?? [6, 22];
    let i = 0;
    while (i < line.length && !this.stopped) {
      const n = lo + Math.floor(Math.random() * (hi - lo + 1));
      this.emit({ kind: 'ui.text', surfaceId: S, chunk: line.slice(i, i + n) });
      i += n;
      await this.sleep(14);
    }
    this.emit({ kind: 'ui.text', surfaceId: S, chunk: '\n' });
  }

  private async run(steps: Step[]): Promise<void> {
    for (const s of steps) {
      if (this.stopped) return;
      if (s === 'end') this.emit({ kind: 'ui.end', surfaceId: S });
      else if ('say' in s) {
        for (const w of s.say.match(/\s*\S+/g) ?? []) {
          this.emit({ kind: 'say', text: w });
          await this.sleep(28);
        }
      } else if ('ops' in s) {
        for (const op of s.ops) await this.streamLine(JSON.stringify(op));
        await this.sleep(120);
      } else if ('raw' in s) await this.streamLine(s.raw);
      else if ('wait' in s) await this.sleep(s.wait);
      else if ('busy' in s) this.emit({ kind: 'turn', busy: s.busy, label: s.label });
      else if ('count' in s) {
        const c = s.count;
        for (let n = c.from; n <= c.to && !this.stopped; n += 1 + Math.floor(Math.random() * 3)) {
          const v = Math.min(n, c.to);
          await this.streamLine(JSON.stringify({ op: 'set', path: c.path, value: v }));
          if (c.status && v % 4 < 2) await this.streamLine(JSON.stringify(el('status', 'StatusLine', { text: c.status(v) })));
          await this.sleep(c.every);
        }
        await this.streamLine(JSON.stringify({ op: 'set', path: c.path, value: c.to }));
        if (c.status) await this.streamLine(JSON.stringify(el('status', 'StatusLine', { text: c.status(c.to) })));
      }
    }
  }

  private enqueue(steps: Step[]): void {
    this.running = this.running.then(() => this.run(steps));
  }

  start(): void {
    this.stopped = false;
    this.enqueue(TURN_1);
  }

  sendAction(a: UIAction): void {
    const t = TURNS[a.name];
    if (t) this.enqueue(t);
  }

  /** Answers diagnostics the way a model would: only the ops for the paths it was given. */
  async repair(d: UIDiagnostics): Promise<UIOp[] | string | null> {
    await this.sleep(1300);
    const lines: string[] = [];
    for (const i of d.issues) {
      if (i.code === 'UNDECLARED_ACTION') {
        const name = /action "([^"]+)"/.exec(i.message)?.[1];
        if (name) lines.push(JSON.stringify({ op: 'add', path: `/actions/${name}`, value: { description: 'Fix the 2 failing tests, then re-run the suite' } }));
      }
      if (i.code === 'UNKNOWN_COMPONENT' && i.elementId === 'trend') lines.push(JSON.stringify(el('trend', 'Metric', { label: 'Suite time', value: '21s', delta: '-3s', tone: 'success' })));
    }
    return lines.length ? lines.join('\n') : null;
  }

  stop(): void {
    this.stopped = true;
  }
}
