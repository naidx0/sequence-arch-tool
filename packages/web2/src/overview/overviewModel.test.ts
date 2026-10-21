import { describe, expect, it } from 'vitest';

import type { AssistantTurn, ContextChip, FileEditProposal, InFlightTurn, Turn, UserTurn, WorkRow } from '../state/types';
import { buildOverview, fencesIn, normalizePath } from './overviewModel';

const user = (id: string, over: Partial<UserTurn> = {}): UserTurn => ({
  id,
  role: 'user',
  text: 'q',
  intents: [],
  chips: [],
  contextLines: [],
  surface: null,
  at: 1,
  ...over,
});

const asst = (id: string, over: Partial<AssistantTurn> = {}): AssistantTurn =>
  ({
    id,
    role: 'assistant',
    replyTo: 'u',
    text: 'a',
    work: [],
    todos: [],
    effect: { kind: 'answer' },
    coverage: null,
    evidence: { tools: [], filesRead: [], proposals: [] },
    usage: null,
    metrics: null,
    contextBreakdown: null,
    advisor: null,
    diagram: null,
    source: null,
    runId: null,
    failure: null,
    at: 2,
    ...over,
  }) as AssistantTurn;

const chip = (id: string, ref: string, kind: ContextChip['kind'] = 'file'): ContextChip => ({ id, kind, ref, label: ref, nodeKind: null });

const diffRow = (path: string): WorkRow => ({
  id: `w-${path}`,
  group: 'change',
  verb: 'Wrote edits',
  identifier: path,
  outcome: { kind: 'diff', added: 3, removed: 1 },
  provenance: null,
  status: 'done',
  from: 'proposal:files' as WorkRow['from'],
  opens: 'review',
});

const proposal = (id: string, status: FileEditProposal['status'], files: [string, 'pending' | 'accepted' | 'rejected'][]): FileEditProposal => ({
  id,
  turnId: 't',
  title: null,
  rationale: null,
  status,
  verify: null,
  files: files.map(([path, decision]) => ({ path, content: '', decision, diff: null, comments: [] })),
});

describe('buildOverview: empty', () => {
  it('is empty for no turns', () => {
    const m = buildOverview({ turns: [] });
    expect(m.files).toEqual([]);
    expect(m.artifacts).toEqual([]);
    expect(m.progress).toEqual({ todos: [], live: false, run: null });
    expect(m.context.chips).toEqual([]);
  });
});

describe('files', () => {
  it('lists a read once however often it repeats, and counts the touches', () => {
    const turns: Turn[] = [
      user('u1'),
      asst('a1', { evidence: { tools: [], filesRead: ['src/a.ts', 'src/a.ts', 'src\\b.ts'], proposals: [] } }),
      user('u2'),
      asst('a2', { evidence: { tools: [], filesRead: ['./src/a.ts'], proposals: [] } }),
    ];
    const files = buildOverview({ turns }).files;
    expect(files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const a = files.find((f) => f.path === 'src/a.ts')!;
    expect(a.state).toBe('read');
    expect(a.touches).toBe(2);
    expect(a.turnId).toBe('a2');
  });

  it('an edited file that was also read is one row, edited, remembering the read', () => {
    const turns: Turn[] = [
      user('u1'),
      asst('a1', { evidence: { tools: [], filesRead: ['src/x.ts'], proposals: ['p1'] } }),
    ];
    const proposals = { p1: proposal('p1', 'applied', [['src/x.ts', 'accepted']]) };
    const files = buildOverview({ turns, proposals }).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/x.ts', state: 'edited', alsoRead: true, touches: 2 });
  });

  it('read after edit in a later turn does not demote the edit', () => {
    const turns: Turn[] = [
      user('u1'),
      asst('a1', { evidence: { tools: [], filesRead: [], proposals: ['p1'] } }),
      user('u2'),
      asst('a2', { evidence: { tools: [], filesRead: ['src/x.ts'], proposals: [] } }),
    ];
    const proposals = { p1: proposal('p1', 'applied', [['src/x.ts', 'accepted']]) };
    expect(buildOverview({ turns, proposals }).files[0]).toMatchObject({ state: 'edited', alsoRead: true });
  });

  it('pending proposals are proposed, denied ones are not listed, partial lists only accepted files', () => {
    const turns: Turn[] = [user('u'), asst('a', { evidence: { tools: [], filesRead: [], proposals: ['p1', 'p2', 'p3'] } })];
    const proposals = {
      p1: proposal('p1', 'pending', [['a.ts', 'pending']]),
      p2: proposal('p2', 'denied', [['b.ts', 'rejected']]),
      p3: proposal('p3', 'partial', [['c.ts', 'accepted'], ['d.ts', 'rejected']]),
    };
    const byPath = Object.fromEntries(buildOverview({ turns, proposals }).files.map((f) => [f.path, f.state]));
    expect(byPath).toEqual({ 'a.ts': 'proposed', 'c.ts': 'edited' });
  });

  it('a diff work row marks an edit', () => {
    const turns: Turn[] = [user('u'), asst('a', { work: [diffRow('src/w.ts')] })];
    expect(buildOverview({ turns }).files[0]).toMatchObject({ path: 'src/w.ts', state: 'edited' });
  });

  it('read_file tool evidence with a line is a read at that line; other tools are not', () => {
    const tool = (name: string, evidence: string | null) => ({ id: name + evidence, name, text: '', evidence, at: 1 });
    const turns: Turn[] = [
      user('u'),
      asst('a', { evidence: { tools: [tool('read_file', 'src/t.ts:42'), tool('search_files', 'src/zzz.ts:1'), tool('read_file', null)], filesRead: [], proposals: [] } }),
    ];
    const files = buildOverview({ turns }).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/t.ts', line: 42, state: 'read' });
  });

  it('the read evidence is a SENTENCE about a read, and the file it names is the file the panel shows', () => {
    const tool = (name: string, evidence: string | null) => ({ id: name + evidence, name, text: '', evidence, at: 1 });
    const turns: Turn[] = [
      user('u'),
      asst('a', {
        evidence: {
          /* The shapes the server really writes: the verb, the cache marker, a range note. */
          tools: [tool('read_file', 'read src/a.ts'), tool('read_file', '(cached) read src/b.ts'), tool('read_file', 'read src/c.ts (lines 1-50 of 120 - more remains)')],
          filesRead: ['src/a.ts'],
          proposals: [],
        },
      }),
    ];
    /* Taking the sentence for a path put a row named "read src/a.ts" beside the real one: the
       panel said four files where the chat touched two, and the phantom row was a button
       that opened a path that does not exist. */
    expect(buildOverview({ turns }).files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('a refused read names no file', () => {
    const tool = (name: string, evidence: string | null) => ({ id: name + evidence, name, text: '', evidence, at: 1 });
    const turns: Turn[] = [
      user('u'),
      asst('a', { evidence: { tools: [tool('read_file', 'refused: "src/x.ts" not readable (jail or reserved)')], filesRead: [], proposals: [] } }),
    ];
    expect(buildOverview({ turns }).files).toEqual([]);
  });

  it('a read_file tool dump in a closed fence is a read; an unclosed one is not', () => {
    const dump = '{"name":"read_file","arguments":{"path":"src/f.ts"}}';
    const turns: Turn[] = [
      user('u'),
      asst('a', { text: 'x\n```json\n' + dump + '\n```\n' }),
      user('u2'),
      asst('b', { text: '```json\n{"name":"read_file","arguments":{"path":"src/open.ts"}}' }),
    ];
    expect(buildOverview({ turns }).files.map((f) => f.path)).toEqual(['src/f.ts']);
  });

  it('mentions come from sent file chips and the composer; non-file chips are ignored; reads outrank mentions', () => {
    const turns: Turn[] = [
      user('u', { chips: [chip('c1', 'src/m.ts'), chip('c2', 'node-1', 'node')] }),
      asst('a', { evidence: { tools: [], filesRead: ['src/m.ts'], proposals: [] } }),
    ];
    const m = buildOverview({ turns, chips: [chip('c3', 'src/new.ts:7')] });
    const byPath = Object.fromEntries(m.files.map((f) => [f.path, f]));
    expect(byPath['src/m.ts']!.state).toBe('read');
    expect(byPath['src/new.ts']).toMatchObject({ state: 'mentioned', line: 7, turnId: null });
    expect(byPath['node-1']).toBeUndefined();
  });

  it('attachments are rows that cannot be opened, listed last', () => {
    const turns: Turn[] = [user('u'), asst('a', { evidence: { tools: [], filesRead: ['a.ts'], proposals: [] } })];
    const files = buildOverview({ turns, attachments: [{ id: 'h1', name: 'build.log', bytes: 10 }] }).files;
    expect(files.map((f) => [f.path, f.state, f.openable])).toEqual([
      ['a.ts', 'read', true],
      ['build.log', 'attached', false],
    ]);
  });

  it('orders edited, then proposed, then read (newest first), then mentioned', () => {
    const turns: Turn[] = [
      user('u'),
      asst('a', { evidence: { tools: [], filesRead: ['r1.ts', 'r2.ts'], proposals: ['p'] } }),
    ];
    const proposals = { p: proposal('p', 'applied', [['e.ts', 'accepted']]) };
    const files = buildOverview({ turns, proposals, chips: [chip('m', 'm.ts')] }).files;
    expect(files.map((f) => f.path)).toEqual(['e.ts', 'r2.ts', 'r1.ts', 'm.ts']);
  });

  it('files read by the turn in flight count', () => {
    const inFlight = { turnId: 'f', phase: 'streaming', work: [], todos: [], providerRound: 1, roundCap: 8, evidence: { tools: [], filesRead: ['live.ts'], proposals: [] } } as unknown as InFlightTurn;
    expect(buildOverview({ turns: [], inFlight }).files[0]).toMatchObject({ path: 'live.ts', turnId: 'f' });
  });
});

describe('artifacts', () => {
  it('finds charts, a diagram, board marks, a workflow loop, genui and visual fences, in turn order', () => {
    const wf = JSON.stringify({ name: 'Build loop', steps: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], loop: { from: 'b', to: 'a' } });
    const text = ['intro', '```workflow', wf, '```', '```genui', '{"title":"Pricing card","root":{}}', '```', '```visual', '{"nodes":[]}', '```'].join('\n');
    const turns: Turn[] = [
      user('u'),
      asst('a1', {
        text,
        charts: [{ version: 1, kind: 'flow', title: 'Request path', items: [] } as never],
        diagram: { type: 'sequence', scopeNodeIds: [] },
        boardMarks: [{}, {}] as never,
      }),
    ];
    const arts = buildOverview({ turns }).artifacts;
    expect(arts.map((a) => [a.kind, a.title, a.turnId])).toEqual([
      ['chart', 'Request path', 'a1'],
      ['diagram', 'Sequence diagram', 'a1'],
      ['board', '2 marks on the board', 'a1'],
      ['workflow', 'Build loop', 'a1'],
      ['genui', 'Pricing card', 'a1'],
      ['visual', 'Visual', 'a1'],
    ]);
    expect(new Set(arts.map((a) => a.key)).size).toBe(arts.length);
  });

  it('an invalid workflow, an unclosed genui fence and a plain code fence are not artifacts', () => {
    const turns: Turn[] = [
      user('u'),
      asst('a', { text: '```workflow\nnot json\n```\n```ts\nconst x = 1;\n```\n```genui\n{"title":"half' }),
    ];
    expect(buildOverview({ turns }).artifacts).toEqual([]);
  });

  it('user turns never produce artifacts', () => {
    expect(buildOverview({ turns: [user('u', { text: '```genui\n{}\n```' })] }).artifacts).toEqual([]);
  });

  it('a genui fence with no title is named Generated UI', () => {
    const turns: Turn[] = [user('u'), asst('a', { text: '```genui\n{"root":{}}\n```' })];
    expect(buildOverview({ turns }).artifacts[0]).toMatchObject({ kind: 'genui', title: 'Generated UI' });
  });
});

describe('saved generated cards', () => {
  const spec = { root: 'c', state: {}, actions: {}, meta: {}, elements: { c: { type: 'Card', props: { title: 'Saved card' } } } } as never;
  const saved = (turn: string, surface: string, title = 'Saved card') => ({ turn, surface, title, spec });

  it('lists a saved surface by its title and turn, in turn order, next to fence artifacts', () => {
    const turns: Turn[] = [user('u'), asst('a1', { text: '```genui\n{"title":"Fence card","root":{}}\n```' }), user('u2'), asst('a2')];
    const arts = buildOverview({ turns, saved: [saved('a2', 's1', 'From the tool')] }).artifacts;
    expect(arts.map((a) => [a.kind, a.title, a.turnId])).toEqual([
      ['genui', 'Fence card', 'a1'],
      ['genui', 'From the tool', 'a2'],
    ]);
    expect(arts[1]!.spec).toBe(spec);
  });

  it('a fence surface that was saved is not listed twice (same turn, surface "fence")', () => {
    const turns: Turn[] = [user('u'), asst('a1', { text: '```genui\n{"title":"Fence card","root":{}}\n```' })];
    const arts = buildOverview({ turns, saved: [saved('a1', 'fence', 'Fence card'), saved('a1', 'other', 'Another')] }).artifacts;
    expect(arts.map((a) => a.title)).toEqual(['Fence card', 'Another']);
  });

  it('an untitled saved surface is named Generated UI, and a turn this list does not hold still lists (an agent run)', () => {
    const arts = buildOverview({ turns: [user('u')], saved: [saved('run-1', 's', '')] }).artifacts;
    expect(arts.map((a) => [a.title, a.turnId])).toEqual([['Generated UI', 'run-1']]);
  });
});

describe('progress', () => {
  it('uses the last assistant turn todos when idle', () => {
    const turns: Turn[] = [
      user('u'),
      asst('a1', { todos: [{ id: '1', title: 'old', status: 'done' }] }),
      user('u2'),
      asst('a2', { todos: [{ id: '2', title: 'now', status: 'active' }] }),
    ];
    const p = buildOverview({ turns }).progress;
    expect(p.live).toBe(false);
    expect(p.todos.map((t) => t.title)).toEqual(['now']);
  });

  it('a later turn without a plan shows no plan rather than an older one', () => {
    const turns: Turn[] = [user('u'), asst('a1', { todos: [{ id: '1', title: 'old', status: 'done' }] }), user('u2'), asst('a2')];
    expect(buildOverview({ turns }).progress.todos).toEqual([]);
  });

  it('the turn in flight wins and names its running step', () => {
    const running: WorkRow = { id: 'r', group: 'read', verb: 'Read a file', identifier: 'src/a.ts', outcome: null, provenance: null, status: 'running', from: 'file:read', opens: 'rail' };
    const done: WorkRow = { ...running, id: 'd', status: 'done', identifier: 'old.ts' };
    const inFlight = { turnId: 'f', phase: 'streaming', work: [done, running], todos: [{ id: '1', title: 'x', status: 'active' }], providerRound: 2, roundCap: 8, evidence: { tools: [], filesRead: [], proposals: [] } } as unknown as InFlightTurn;
    const p = buildOverview({ turns: [user('u'), asst('a', { todos: [{ id: '9', title: 'stale', status: 'done' }] })], inFlight }).progress;
    expect(p).toMatchObject({ live: true, run: { phase: 'streaming', step: 'Read a file src/a.ts', round: 2, roundCap: 8 } });
    expect(p.todos.map((t) => t.title)).toEqual(['x']);
  });

  it('a finished in-flight phase is ignored', () => {
    const inFlight = { turnId: 'f', phase: 'done', work: [], todos: [{ id: '1', title: 'x', status: 'active' }], providerRound: 1, roundCap: 8, evidence: { tools: [], filesRead: [], proposals: [] } } as unknown as InFlightTurn;
    expect(buildOverview({ turns: [], inFlight }).progress.live).toBe(false);
  });
});

describe('context', () => {
  it('deduplicates composer chips by id', () => {
    const m = buildOverview({ turns: [], chips: [chip('a', 'x.ts'), chip('a', 'x.ts'), chip('b', 'n', 'node')] });
    expect(m.context.chips.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('a long chat', () => {
  it('40 turns with repeated reads and an edited-and-read file stay one row each', () => {
    const turns: Turn[] = [];
    const proposals: Record<string, FileEditProposal> = {};
    for (let i = 0; i < 20; i++) {
      turns.push(user(`u${i}`));
      const reads = [`src/file${i % 5}.ts`, 'src/hot.ts'];
      const props = i === 7 ? ['p7'] : [];
      if (i === 7) proposals.p7 = proposal('p7', 'applied', [['src/file2.ts', 'accepted']]);
      turns.push(
        asst(`a${i}`, {
          evidence: { tools: [], filesRead: reads, proposals: props },
          text: i % 10 === 3 ? '```genui\n{"title":"Panel ' + i + '"}\n```' : 'plain',
        }),
      );
    }
    expect(turns).toHaveLength(40);
    const m = buildOverview({ turns, proposals });
    expect(m.files.map((f) => f.path).sort()).toEqual(['src/file0.ts', 'src/file1.ts', 'src/file2.ts', 'src/file3.ts', 'src/file4.ts', 'src/hot.ts']);
    const hot = m.files.find((f) => f.path === 'src/hot.ts')!;
    expect(hot.touches).toBe(20);
    expect(hot.turnId).toBe('a19');
    expect(m.files[0]).toMatchObject({ path: 'src/file2.ts', state: 'edited', alsoRead: true });
    expect(m.artifacts.map((a) => a.title)).toEqual(['Panel 3', 'Panel 13']);
  });
});

describe('helpers', () => {
  it('normalizePath', () => {
    expect(normalizePath(' .\\a\\b.ts ')).toBe('a/b.ts');
  });
  it('fencesIn reports closed and unclosed fences and tilde fences', () => {
    const f = fencesIn('~~~genui\n{}\n~~~\n```ts\ncode');
    expect(f.map((x) => [x.language, x.closed])).toEqual([['genui', true], ['ts', false]]);
  });
});
