/* ══════════════════════════════════════════════════════════════════════════
   DIFF — what this branch changes, on the Map's boxes and lines
   packages/web2/src/canvas/views/DiffView.tsx

   Reads GET /api/git/branch-files?base=<ref> (default main) and places each
   changed file on the box that holds it (historyModel.ts). The Map stays in
   view: each changed or added box carries a badge on the Map, and a module
   the branch deleted whole is drawn there as a ghost marked removed
   (`onMarks`, drawn by ConnectedBoard). This panel lists the same boxes with
   their files, and the lines whose evidence the branch touches. Won its
   registered A/B on 3 of 3 repos (lab/log.md).

   S3: it can also compare against the start of the last agent turn (the
   engine's turn snapshot, GET /api/snapshots/files): "what did the agent just
   change", on the Map.

   S7: A CHAT IN ITS OWN WORKTREE is a different question. Its work is not on
   the user's branch at all: it is in the worktree, against the commit the
   chat was cut from. So when the active chat is bound to a worktree, both
   comparisons read GET /api/sessions/:id/worktree/changes (the worktree,
   uncommitted edits included, against its recorded base commit) and the
   header names the worktree's branch. The board itself stays the user's.
   ══════════════════════════════════════════════════════════════════════════ */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArchGraph } from '@sequence/schema';

import { displayLabel } from '../displayLabel.js';
import { createTurnsClient, latestTurn, type TurnsClient } from '../../review/turnsClient.js';
import type { ChatWorktree } from '../../worktree/worktreeModel.js';
/* Loaded when needed, not imported: a static import here would join this
   lazy chunk's preload list in the boot entry and cost boot bytes (perf
   ratchet). */
const worktreeModel = () => import('../../worktree/worktreeModel.js');
const branchLabel = (branch: string): string => branch.replace(/^sequence\//, '');
import { useAppState } from '../../state/index.js';
import { BranchSwitcher } from '../../git/BranchSwitcher';
import { getBranchChanges } from '../../git/gitCalls';
import { diffMarks, diffModel, type BranchFile, type DiffMarks } from './historyModel.js';
import { viewName, type ViewBox, type ViewLine } from './viewModel.js';
import './views.css';
import { AsciiSpinner } from '../../shell2/AsciiSpinner';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const STATUS_WORD: Record<string, string> = { added: 'added', changed: 'changed', modified: 'changed', deleted: 'removed', renamed: 'renamed' };
/** One glyph per status, coloured by its token (views.css): + added, ~ changed, − removed. */
export const STATUS_GLYPH: Record<string, string> = { added: '+', changed: '~', removed: '−', renamed: '~' };

/**
 * THE AGAINST-BASE METRIC, WRITTEN PLAINLY: "12 files changed against main, +340 −120".
 * `counts` is null when the engine cannot say (no branch-changes route), and
 * then the line says only what it knows.
 */
export function diffHeadline(files: number, vs: string, counts: { added: number; removed: number } | null): string {
  if (files === 0) return `No files changed against ${vs}`;
  const head = `${files} ${files === 1 ? 'file' : 'files'} changed against ${vs}`;
  return counts ? `${head}, +${counts.added} −${counts.removed}` : head;
}

/* Round 7 C.6 (Jaden: "the UI doesn't match up. Icons aren't really
   centered"): the status is B's round chip with its glyph centred in it, then
   the word, the same shape as the board's other chips. */
function Status({ word }: { word: string }) {
  return (
    <span className={`dv-status is-${word}`} data-testid="diff-status">
      <span className="dv-ic" aria-hidden="true">
        <span className="dv-glyph">{STATUS_GLYPH[word]}</span>
      </span>
      <span className="dv-word">{word}</span>
    </span>
  );
}

export function DiffView({
  boxes,
  lines,
  graph,
  fetchImpl,
  initialBase = 'main',
  onMarks,
  turns,
  sessionId = null,
}: {
  boxes: readonly ViewBox[];
  lines: readonly ViewLine[];
  graph: ArchGraph | null;
  fetchImpl?: Fetch;
  initialBase?: string;
  /** What the Map draws for this diff; null when there is nothing (yet). */
  onMarks?: (marks: DiffMarks | null) => void;
  /** S3 turn snapshots, for "Before last turn". */
  turns?: TurnsClient;
  /** S7: the active chat; when it is bound to a worktree the diff is the worktree's. */
  sessionId?: string | null;
}) {
  /* S7: the active chat's worktree, if it has one (and it is not merged back:
     merged work is on the user's branch, where the ordinary diff finds it). */
  const [worktree, setWorktree] = useState<ChatWorktree | null>(null);
  useEffect(() => {
    let live = true;
    setWorktree(null);
    if (!sessionId) return undefined;
    const f = fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init));
    void worktreeModel()
      .then((m) => m.worktreeApi.get(sessionId, f))
      .then((r) => {
        if (live && r.ok && r.body.worktree && !r.body.worktree.merged) setWorktree(r.body.worktree);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sessionId, fetchImpl]);
  /* What the diff is against: a branch base, or the start of the last agent turn. */
  const [against, setAgainst] = useState<'base' | 'turn'>('base');
  const [turnSeq, setTurnSeq] = useState<number | null>(null);
  const [base, setBase] = useState(initialBase);
  const [draft, setDraft] = useState(initialBase);
  const [files, setFiles] = useState<BranchFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* +N −N per file, from GET /api/git/branch-changes when the engine serves it. */
  const [counts, setCounts] = useState<ReadonlyMap<string, { added: number; removed: number }> | null>(null);
  /* Bumped when the head moves, so the changes are read again against the new branch. */
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  /* What the route compared against: the base asked for can fall back (main -> master ...), and a repo can have none. */
  const [resolved, setResolved] = useState<{ base: string | null; noBase: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const f = fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init));
    setFiles(null);
    setError(null);
    setResolved(null);
    setCounts(null);
    setCurrent(null);
    void (async () => {
      if (worktree && sessionId) {
        const { worktreeApi } = await worktreeModel();
        const r = await worktreeApi.changes(sessionId, f).catch((e: Error) => ({ ok: false, status: 0, body: { error: e.message } }) as const);
        if (!live) return;
        if (!r.ok) setError(r.body.error ?? `The worktree's changes could not be read (${r.status}).`);
        else setFiles((r.body as { files: { path: string; status: BranchFile['status'] }[] }).files.map((x) => ({ path: x.path, status: x.status })));
        return;
      }
      if (against === 'turn') {
        const last = await latestTurn(turns ?? createTurnsClient(f as typeof fetch)).catch(() => null);
        if (!live) return;
        if (!last) {
          setTurnSeq(null);
          setError('No agent turn has been recorded yet.');
          return;
        }
        setTurnSeq(last.seq);
        setFiles(last.files.map((x) => ({ path: x.path, status: x.status === 'modified' ? 'modified' : x.status })));
        return;
      }
      try {
        void getBranchChanges(base, f as typeof fetch).then((c) => {
          if (!live) return;
          if (c.outcome !== 'ok') return setCounts(null);
          const map = new Map<string, { added: number; removed: number }>();
          for (const x of c.body.files) if (typeof x.added === 'number' && typeof x.removed === 'number') map.set(x.path, { added: x.added, removed: x.removed });
          setCounts(map.size > 0 ? map : null);
        });
        const r = await f(`/api/git/branch-files?base=${encodeURIComponent(base)}`);
        const j = (await r.json().catch(() => ({}))) as { files?: BranchFile[]; error?: string; base?: string | null; noBase?: boolean };
        if (!live) return;
        if (!r.ok) setError(j.error ?? `The changes could not be read (${r.status}).`);
        else {
          setResolved({ base: j.base ?? null, noBase: j.noBase === true });
          setFiles(j.files ?? []);
        }
      } catch (e) {
        if (live) setError(`The changes could not be read: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [base, fetchImpl, against, turns, worktree, sessionId, reloadKey]);
  const vs = worktree
    ? `commit ${worktree.baseCommit.slice(0, 7)}, where this chat began`
    : against === 'turn'
      ? (turnSeq ? `the start of agent turn ${turnSeq}` : 'the last agent turn')
      : (resolved?.base ?? base);

  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const name = (id: string) => {
    const b = byId.get(id);
    return b ? viewName(b, byId, displayLabel) : id;
  };
  const model = useMemo(() => (graph && files ? diffModel(graph, boxes, lines, files) : null), [graph, files, boxes, lines]);
  /* Handed up only when it changes: the ghosts it adds come back in `boxes`,
     which the model ignores, so the key settles after one round. */
  const marks = useMemo(() => (model ? diffMarks(model) : null), [model]);
  /* Every changed file in the order the list shows them: what j/k walk and the jump list names. */
  const order = useMemo(() => {
    if (!model) return [] as string[];
    const seen = new Set<string>();
    /* Only files that are DRAWN (in a box or a removed module): the ones in no box have no row to land on. */
    for (const b of [...model.boxes, ...model.removed]) for (const x of b.files) seen.add(x.path);
    return [...seen];
  }, [model]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const step = useCallback((delta: 1 | -1) => {
    setCurrent((was) => {
      const list = orderRef.current;
      if (list.length === 0) return was;
      const at = was === null ? -1 : list.indexOf(was);
      const next = at === -1 ? (delta === 1 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta));
      return list[next]!;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'j' || e.key === ']') step(1);
      else if (e.key === 'k' || e.key === '[') step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (current === null) return;
    const el = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-testid="diff-file"]') ?? [])].find((n) => n.dataset.path === current);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);
  const totals = useMemo(() => {
    if (!counts || order.length === 0) return null;
    let added = 0;
    let removed = 0;
    for (const p of order) {
      const c = counts.get(p);
      if (c) {
        added += c.added;
        removed += c.removed;
      }
    }
    return { added, removed };
  }, [counts, order]);
  const marksKey = marks ? JSON.stringify(marks) : '';
  const report = useRef(onMarks);
  report.current = onMarks;
  useEffect(() => {
    report.current?.(marks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey]);
  useEffect(() => () => report.current?.(null), []);

  return (
    <div className="board-view diffview" data-testid="diff-view" role="region" aria-label="Changes on this branch">
      {worktree ? (
        <p className="dv-worktree" data-testid="diff-worktree" title={`${worktree.branch} at ${worktree.path}`}>
          <span className="dv-worktree-label">Worktree</span> <code>{branchLabel(worktree.branch)}</code> against{' '}
          <code>{worktree.baseCommit.slice(0, 7)}</code>
        </p>
      ) : null}
      {worktree ? null : (
        <div className="dv-top">
          <BranchSwitcher fetchImpl={fetchImpl as typeof fetch | undefined} onSwitched={() => setReloadKey((n) => n + 1)} />
        </div>
      )}
      <form
        hidden={worktree !== null}
        className="dv-base"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setBase(draft.trim());
        }}
      >
        <div className="dv-against bseg" role="group" aria-label="Compare against">
          <button
            type="button"
            className={`bseg-b${against === 'base' ? ' on' : ''}`}
            data-testid="diff-against-base"
            aria-pressed={against === 'base'}
            onClick={() => setAgainst('base')}
          >
            Branch base
          </button>
          <button
            type="button"
            className={`bseg-b${against === 'turn' ? ' on' : ''}`}
            data-testid="diff-against-turn"
            aria-pressed={against === 'turn'}
            onClick={() => setAgainst('turn')}
          >
            Before last turn
          </button>
        </div>
        {against === 'base' ? (
          <label className="dv-field" title="The branch or commit to compare against (Enter)">
            <span className="dv-field-k">Against</span>
            <input data-testid="diff-base" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Base branch" />
          </label>
        ) : null}
      </form>
      {error ? (
        <p className="bv-empty dv-error" role="alert" data-testid="diff-error">
          {error}
        </p>
      ) : against === 'base' && !worktree && resolved?.noBase ? (
        <p className="bv-empty dv-nobase" data-testid="diff-nobase">
          There is no base branch to compare against yet: this repo has no main, master or upstream branch with commits. Type a branch or commit above to compare against it.
        </p>
      ) : !model ? (
        <p className="bv-empty"><AsciiSpinner /> Reading the changes…</p>
      ) : (
        <>
          <p className="dv-headline" data-testid="diff-headline">
            {diffHeadline(files?.length ?? 0, vs, totals)}
          </p>
          {order.length > 0 ? (
            <label className="dv-jump" title="Jump to a changed file (or press j and k)">
              <span className="dv-field-k">File</span>
              <select data-testid="diff-jump" aria-label="Jump to a changed file" value={current ?? ''} onChange={(e) => setCurrent(e.target.value || null)}>
                <option value="">{`${order.length} changed (j next, k previous)`}</option>
                {order.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="dv-scroll" data-testid="diff-scroll" ref={scroller} tabIndex={-1}>
          <p className="dv-sum" data-testid="diff-summary">
            {model.boxes.length + model.removed.length === 0
              ? `No box on this board changes against ${vs}.`
              : `${model.boxes.length + model.removed.length} ${model.boxes.length + model.removed.length === 1 ? 'box changes' : 'boxes change'} against ${vs}, ${model.lines.length} ${model.lines.length === 1 ? 'connection' : 'connections'} touched.`}
          </p>
          {model.boxes.length + model.removed.length > 0 ? (
            <section aria-label="Changed boxes">
              <h3 className="dv-h">Boxes</h3>
              <ul className="dv-list">
                {model.boxes.map((b) => (
                  <li key={b.id} className="dv-row" data-testid="diff-box" data-id={b.id} data-status={b.status}>
                    <div className="dv-row-hd">
                    <Status word={b.status} />
                    <span className="dv-name" data-testid="diff-box-name" title={name(b.id)}>
                      {name(b.id)}
                    </span>
                    <span className="dv-n">{b.files.length === 1 ? '1 file' : `${b.files.length} files`}</span>
                    </div>
                    <FileList files={b.files} counts={counts} current={b.files.some((x) => x.path === current) ? current : null} />
                  </li>
                ))}
                {model.removed.map((b) => (
                  <li key={b.id} className="dv-row" data-testid="diff-box" data-id={b.id} data-status="removed">
                    <div className="dv-row-hd">
                    <Status word="removed" />
                    <span className="dv-name" data-testid="diff-box-name" title={b.dir}>
                      {b.label}
                    </span>
                    <span className="dv-n">{b.files.length === 1 ? '1 file' : `${b.files.length} files`}</span>
                    </div>
                    <FileList files={b.files} counts={counts} current={b.files.some((x) => x.path === current) ? current : null} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {model.lines.length > 0 ? (
            <section aria-label="Touched connections">
              <h3 className="dv-h">Connections</h3>
              <ul className="dv-list">
                {model.lines.map((l) => (
                  <li key={`${l.source}->${l.target}`} className="dv-row" data-testid="diff-line" data-pair={`${l.source}->${l.target}`}>
                    <Status word="changed" />
                    <span className="dv-name" data-testid="diff-line-from">{name(l.source)}</span>
                    <span aria-hidden="true">→</span>
                    <span className="dv-name" data-testid="diff-line-to">{name(l.target)}</span>
                    <span className="dv-n">{l.links === 1 ? '1 code link changed' : `${l.links} code links changed`}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {model.elsewhere.length > 0 ? (
            <p className="bv-empty" data-testid="diff-elsewhere">
              {model.elsewhere.length} changed {model.elsewhere.length === 1 ? 'file is' : 'files are'} in no box on this board.
            </p>
          ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** The first FILES_SHOWN files of a box, the rest behind one row. */
const FILES_SHOWN = 8;
const FileList = memo(function FileList({
  files,
  counts,
  current,
}: {
  files: readonly BranchFile[];
  counts: ReadonlyMap<string, { added: number; removed: number }> | null;
  current: string | null;
}) {
  const [all, setAll] = useState(false);
  /* The file j/k landed on is never hidden behind "more files": it is shown
     alone, in its place, and the box does not open whole. */
  const shown = all
    ? files
    : files.filter((x, i) => i < FILES_SHOWN || x.path === current);
  return (
    <ul className="dv-files">
      {shown.map((f) => (
        <li
          key={f.path}
          className="dv-file"
          data-testid="diff-file"
          data-path={f.path}
          data-current={current === f.path ? 'true' : undefined}
          title={f.from ? `${f.from} -> ${f.path}` : f.path}
        >
          <span className={`dv-fstatus is-${STATUS_WORD[f.status]}`}>
            <span className="dv-glyph" aria-hidden="true">
              {STATUS_GLYPH[STATUS_WORD[f.status]!]}
            </span>{' '}
            {STATUS_WORD[f.status]}
          </span>
          {/* One line, cut from the LEFT so the file name always shows; the
              whole path is on the row's title (round 7). The left-to-right
              marks keep the path's own order inside the rtl box; a <bdi>
              isolate does not, Chromium then anchors the run at the left. */}
          <span className="dv-path" dir="rtl" data-testid="diff-file-path">
            {`‎${f.path}‎`}
          </span>
          {counts?.get(f.path) ? (
            <span className="dv-fcounts" data-testid="diff-file-counts">
              {counts.get(f.path)!.added > 0 ? <span className="dv-cadd">{`+${counts.get(f.path)!.added}`}</span> : null}
              {counts.get(f.path)!.added > 0 && counts.get(f.path)!.removed > 0 ? ' ' : null}
              {counts.get(f.path)!.removed > 0 ? <span className="dv-cdel">{`−${counts.get(f.path)!.removed}`}</span> : null}
            </span>
          ) : null}
        </li>
      ))}
      {files.length > FILES_SHOWN && (all || shown.length < files.length) ? (
        <li>
          <button type="button" className="dv-more" data-testid="diff-more-files" onClick={() => setAll((v) => !v)}>
            {all ? 'Fewer files' : files.length - shown.length === 1 ? '1 more file' : `${files.length - shown.length} more files`}
          </button>
        </li>
      ) : null}
    </ul>
  );
});

/**
 * The Diff view as the board mounts it (lazily): the active chat comes from the
 * store here, inside the lazy chunk, so the board's boot code passes nothing new.
 */
function ConnectedDiffView(props: Omit<Parameters<typeof DiffView>[0], 'sessionId'>) {
  const state = useAppState();
  return <DiffView {...props} sessionId={state.session.activeId} />;
}

export default ConnectedDiffView;
