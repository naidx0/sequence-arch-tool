/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW DOCK (Decision 49) — DeepSeek's review tab, drawn as the Mix panel
   packages/web2/src/shell2/ReviewDock.tsx

   Mix.dc.html `.panel`: a capsule head (Review, the open file), the view
   switch (side by side or unified), full screen and close; the turn's files
   folded, one opening on a click to its diff; Revert hunk on each change,
   Revert file and Revert turn at the foot. Everything is the engine's own S3
   turn snapshot (/api/snapshots): the diff is the turn's start against the
   file now, and a revert writes the snapshot back. Loaded when first opened.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { parseUnifiedDiff, type DiffFileChange, type DiffHunk } from '../review/diffModel';
import { wireMessage } from '../review/reviewClient';
import { createTurnsClient, type TurnFile, type TurnsClient } from '../review/turnsClient';
import { ConfirmDialog } from './ConfirmDialog';
import { S2Icon } from './icons';
import { reviewDock, type ReviewTarget } from './reviewDockStore';

type View = 'split' | 'unified';

function readView(): View {
  try {
    return localStorage.getItem('sequence.review.view') === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

function UnifiedHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {hunk.lines.map((l, i) => (
        <div key={i} className={`s2-cl${l.kind === 'add' ? ' a' : l.kind === 'del' ? ' d' : ''}`}>
          <i>{l.kind === 'del' ? l.oldLine : l.newLine}</i>
          <span>{l.text || ' '}</span>
        </div>
      ))}
    </>
  );
}

/** Side by side: the old file on the left, the new on the right, changes
    paired in order. Each side scrolls on its own axis and the two move
    together; with Wrap on, lines wrap instead. */
function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  const rows: { left: DiffHunk['lines'][number] | null; right: DiffHunk['lines'][number] | null }[] = [];
  let dels: DiffHunk['lines'] = [];
  let adds: DiffHunk['lines'] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const l of hunk.lines) {
    if (l.kind === 'del') dels.push(l);
    else if (l.kind === 'add') adds.push(l);
    else {
      flush();
      rows.push({ left: l, right: l });
    }
  }
  flush();
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => (syncing.current = false));
  };
  return (
    <div className="s2-split">
      <div className="s2-split-col" ref={left} onScroll={() => sync(left.current, right.current)} data-testid="s2-split-old">
        {rows.map((r, i) => (
          <div key={i} className={`s2-cl${r.left?.kind === 'del' ? ' d' : ''}${r.left ? '' : ' e'}`}>
            <i>{r.left?.oldLine ?? ''}</i>
            <span>{r.left?.text || ' '}</span>
          </div>
        ))}
      </div>
      <div className="s2-split-col" ref={right} onScroll={() => sync(right.current, left.current)} data-testid="s2-split-new">
        {rows.map((r, i) => (
          <div key={i} className={`s2-cl${r.right?.kind === 'add' ? ' a' : ''}${r.right ? '' : ' e'}`}>
            <i>{r.right?.newLine ?? ''}</i>
            <span>{r.right?.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewDock({
  target,
  client: given,
  full,
  onFull,
}: {
  target: ReviewTarget;
  client?: TurnsClient;
  full: boolean;
  onFull: () => void;
}) {
  const [client] = useState(() => given ?? createTurnsClient());
  const [files, setFiles] = useState<TurnFile[] | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(target.path ?? null);
  const [diffs, setDiffs] = useState<Record<string, DiffFileChange | null>>({});
  const [view, setView] = useState<View>(() => readView());
  /* Off by default: long lines scroll sideways, both sides together. */
  const [wrap, setWrap] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'turn' } | { kind: 'file'; path: string }>(null);
  const { sessionId, seq } = target;

  const loadFiles = useCallback(async () => {
    const f = await client.files(sessionId, seq);
    setFiles(f.outcome === 'ok' ? f.body.files : []);
  }, [client, sessionId, seq]);

  const loadDiff = useCallback(
    async (path: string) => {
      const d = await client.diff(sessionId, seq, path);
      const parsed = d.outcome === 'ok' ? (parseUnifiedDiff(d.body.diff)[0] ?? null) : null;
      setDiffs((prev) => ({ ...prev, [path]: parsed }));
      return parsed;
    },
    [client, sessionId, seq],
  );

  useEffect(() => {
    setDiffs({});
    setOpenPath(target.path ?? null);
    void loadFiles();
  }, [loadFiles, target.path]);

  useEffect(() => {
    if (openPath && !(openPath in diffs)) void loadDiff(openPath);
  }, [openPath, diffs, loadDiff]);

  useEffect(() => {
    try {
      localStorage.setItem('sequence.review.view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  async function revertHunk(path: string, index: number, header: string) {
    setBusy(true);
    const r = await client.revertHunk(sessionId, seq, path, index, header);
    setBusy(false);
    setNote(r.outcome === 'ok' ? `Reverted one change in ${path}.` : wireMessage(r));
    await loadDiff(path);
  }

  /** Every change in the file, one at a time from the top, re-reading between. */
  async function revertFile(path: string) {
    setBusy(true);
    let failed: string | null = null;
    for (let i = 0; i < 200; i++) {
      const d = await client.diff(sessionId, seq, path);
      const parsed = d.outcome === 'ok' ? parseUnifiedDiff(d.body.diff)[0] : undefined;
      const first = parsed?.hunks[0];
      if (!first) break;
      const r = await client.revertHunk(sessionId, seq, path, 0, first.header);
      if (r.outcome !== 'ok') {
        failed = wireMessage(r);
        break;
      }
    }
    setBusy(false);
    setConfirm(null);
    setNote(failed ?? `Reverted ${path} to the start of the turn.`);
    await loadDiff(path);
  }

  async function revertTurn() {
    setBusy(true);
    const r = await client.revert(sessionId, seq);
    setBusy(false);
    setConfirm(null);
    setNote(r.outcome === 'ok' ? `Reverted the turn: ${r.body.files.length === 1 ? '1 file' : `${r.body.files.length} files`} back.` : wireMessage(r));
    setDiffs({});
    await loadFiles();
  }

  const openDiff = openPath ? diffs[openPath] : undefined;
  const fileName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

  return (
    <section className="s2-review" aria-label="Review" data-testid="s2-review">
      <div className="s2-pane-head">
        <span className="s2-cap is-on">
          <S2Icon name="split" small />
          Review
        </span>
        {openPath ? (
          <span className="s2-cap" title={openPath}>
            <S2Icon name="file" small />
            {fileName(openPath)}
          </span>
        ) : null}
        <span className="s2-grow" />
        <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label={full ? 'Exit full screen' : 'Full screen'} aria-pressed={full} onClick={onFull}>
          <S2Icon name="fit" small />
        </button>
        <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label="Close the review" data-testid="s2-review-close" onClick={() => reviewDock.close()}>
          <S2Icon name="x" small />
        </button>
      </div>
      <div className="s2-review-tools">
        <div className="s2-seg s2-seg-sm" role="radiogroup" aria-label="Diff view">
          {(['split', 'unified'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'is-on is-focused' : ''} data-testid={`s2-review-${v}`} onClick={() => setView(v)}>
              {v === 'split' ? 'Side by side' : 'Unified'}
            </button>
          ))}
        </div>
        <button type="button" className={`s2-chipbtn s2-wrap${wrap ? ' is-on' : ''}`} aria-pressed={wrap} data-testid="s2-review-wrap" title="Wrap long lines" onClick={() => setWrap((w) => !w)}>
          Wrap
        </button>
      </div>
      <div className="s2-review-body">
        {files === null ? <p className="s2-empty">Reading the turn</p> : null}
        {files !== null && files.length === 0 ? <p className="s2-empty">This turn changed no files, or it was reverted.</p> : null}
        {(files ?? []).map((f) => {
          const isOpen = openPath === f.path;
          const d = diffs[f.path];
          return (
            <div key={f.path} className={`s2-rv-file${isOpen ? ' is-open' : ''}`} data-testid="s2-review-file">
              <button type="button" className="s2-fold" aria-expanded={isOpen} onClick={() => setOpenPath(isOpen ? null : f.path)}>
                <S2Icon name={isOpen ? 'chev' : 'chevr'} small className="s2-fold-chev" />
                <S2Icon name="file" small />
                <span className="s2-t s2-mono">{f.path}</span>
                {f.status === 'added' ? <span className="s2-mono s2-ok">new</span> : null}
                {f.status === 'deleted' ? <span className="s2-mono s2-del">deleted</span> : null}
                {d && d.added > 0 ? <span className="s2-mono s2-ok">+{d.added}</span> : null}
                {d && d.removed > 0 ? <span className="s2-mono s2-del">−{d.removed}</span> : null}
              </button>
              {isOpen ? (
                <div className="s2-code s2-mono" data-view={view} data-wrap={wrap ? 'on' : 'off'}>
                  {openDiff === undefined ? <p className="s2-empty">Reading the diff</p> : null}
                  {openDiff === null ? <p className="s2-empty">No change left in this file.</p> : null}
                  {openDiff && openDiff.hunks.length === 0 ? <p className="s2-empty">{openDiff.binary ? 'A binary file changed.' : 'No change left in this file.'}</p> : null}
                  {openDiff?.hunks.map((h, i) => (
                    <div key={`${h.header}:${i}`} className="s2-hunk">
                      {view === 'split' ? <SplitHunk hunk={h} /> : <UnifiedHunk hunk={h} />}
                      <div className="s2-hunk-acts">
                        <span className="s2-meta">{`Lines ${h.newStart} to ${h.newStart + Math.max(0, h.newCount - 1)}`}</span>
                        <span className="s2-grow" />
                        <button type="button" className="s2-chipbtn" data-testid="s2-revert-hunk" disabled={busy} onClick={() => void revertHunk(f.path, i, h.header)}>
                          <S2Icon name="undo" small />
                          Revert hunk
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {note ? (
          <p className="s2-cf-note" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="s2-review-foot">
        <span className="s2-grow" />
        <button type="button" className="s2-pill" data-testid="s2-revert-file" disabled={busy || !openPath} onClick={() => openPath && setConfirm({ kind: 'file', path: openPath })}>
          <S2Icon name="undo" small />
          Revert file
        </button>
        <button type="button" className="s2-pill" data-testid="s2-revert-turn" disabled={busy || !files?.length} onClick={() => setConfirm({ kind: 'turn' })}>
          <S2Icon name="undo" small />
          Revert turn
        </button>
      </div>
      {confirm ? (
        <ConfirmDialog
          icon="undo"
          danger
          title={confirm.kind === 'turn' ? 'Revert the whole turn?' : `Revert ${fileName(confirm.path)}?`}
          body={confirm.kind === 'turn' ? 'Every file this turn wrote goes back to how it was when the turn started.' : 'This file goes back to how it was when the turn started.'}
          items={confirm.kind === 'turn' ? (files ?? []).map((f) => ({ label: f.path })) : [{ label: confirm.path }]}
          confirmLabel={confirm.kind === 'turn' ? 'Revert turn' : 'Revert file'}
          busy={busy}
          testId="s2-confirm-review"
          onConfirm={() => void (confirm.kind === 'turn' ? revertTurn() : revertFile(confirm.path))}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </section>
  );
}

export default ReviewDock;
