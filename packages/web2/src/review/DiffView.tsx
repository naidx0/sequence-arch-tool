import { REVIEW } from './anchors';
import { ReviewIcon } from './ReviewIcon';
import { highlight, languageOf, type SyntaxLanguage } from './syntax';
import type { DiffFileChange, DiffLine } from './diffModel';
import { diffPrefs, effectiveMode, pairHunkLines, useDiffPrefs, type DiffViewMode, type SplitRow } from './diffSplit';
import type { LineComment } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE DIFF — item 5.1
   packages/web2/src/review/DiffView.tsx

   Sheet 12 draws the transcript; §5.6 lists "the diff inspector adapted from a
   training-metrics context" among the ELEVEN SURFACES THE BOOK DOES NOT COVER,
   and warns in as many words that "the dangerous state is thinking the book
   covers them". So this is design work traced to the sheet where the sheet
   speaks and declared unsheeted where it does not:

     FROM THE BOOK  the `--diff-add-*` / `--diff-del-*` channel, which is a
       THIRD disjoint colour namespace on purpose — "so a removed line can
       never be misread as 'won't fit'". A wash, never a foreground.
     FROM THE BOOK  `.stat-add` / `.stat-del` at --fits / --wont (sheet 12.7's
       hue ledger), which is the diff's own ARITHMETIC and is allowed a hue
       because it is a claim about what happened.
     FROM THE TOKEN FILE  the whole `--diffx-*` namespace, which §8 of
       tokens/graphite.css was written for this wave and states cannot be
       inherited: hunk headers, intraline runs, per-line comments and a
       per-file header are four things a training-metrics delta list never had.
     UNSHEETED, AND SAID SO  the line-comment affordance and its composer.

   THE GUTTER IS TWO COLUMNS, OLD AND NEW, AND A REMOVED LINE HAS NO NEW
   NUMBER. This is not a nicety: item 5.3 anchors a steering comment to a line
   number, and a removed line occupies no line in the file the agent will edit.
   Numbering it would send the agent at the wrong line, silently.
   ══════════════════════════════════════════════════════════════════════════ */

export interface DiffViewProps {
  file: DiffFileChange;
  comments: LineComment[];
  /** The open comment composer for THIS file, or null. */
  composing: number | null;
  onComment: (line: number) => void;
  onCancel: () => void;
  onSend: (line: number, text: string) => void;
  /** The draft text of the open composer. Held by the pane, not by the DOM. */
  draft: string;
  onDraft: (text: string) => void;
  /** S3: present when each hunk can be put back (the Last turn from a
   *  snapshot). Called with the hunk's index and its header line. */
  onRevertHunk?: (hunkIndex: number, header: string) => void;
  /** Overrides the remembered choice (tests, and surfaces that fix a mode). */
  mode?: DiffViewMode;
  wrap?: boolean;
}

function CodeLine({ line, language }: { line: DiffLine; language: SyntaxLanguage }) {
  return (
    <code className="rv-code">
      {highlight(line.text, language).map((span, index) =>
        span.cls === null ? (
          <span key={index}>{span.text}</span>
        ) : (
          <span key={index} className={`rv-t-${span.cls}`}>
            {span.text}
          </span>
        ),
      )}
    </code>
  );
}


interface SplitRowProps extends Omit<NotesProps, 'anchored' | 'path'> {
  row: SplitRow;
  anchored: LineComment[];
  path: string;
  language: SyntaxLanguage;
  onComment: (line: number) => void;
}

/** One row of the side-by-side view: the old line on the left, the new on the
 *  right. The comment affordance stays on the new side, where a line exists in
 *  the file the agent will edit. */
function SplitRowView({ row, anchor, anchored, path, language, onComment, ...notes }: SplitRowProps) {
  const cell = (line: DiffLine | null, side: 'old' | 'new') => {
    const number = side === 'old' ? line?.oldLine : line?.newLine;
    const kind = line === null ? 'empty' : line.kind;
    return (
      <div
        className={`rv-sc rv-sc-${side} rv-sc-${kind}`}
        data-testid={side === 'old' ? REVIEW.splitOld : REVIEW.splitNew}
        data-kind={kind}
      >
        <span className="rv-num mono">{number ?? ''}</span>
        {side === 'new' && line !== null && line.newLine !== null ? (
          <button
            type="button"
            className="rv-cadd"
            data-testid={REVIEW.commentAdd}
            aria-label={`Comment on ${path} line ${line.newLine}`}
            onClick={() => onComment(line.newLine as number)}
          >
            <ReviewIcon name="plus" size={12} />
          </button>
        ) : (
          <span className="rv-cadd-gap" aria-hidden="true" />
        )}
        <span className="rv-sign mono" aria-hidden="true">
          {line === null ? '' : line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
        </span>
        {line === null ? <code className="rv-code" /> : <CodeLine line={line} language={language} />}
      </div>
    );
  };
  return (
    <>
      {cell(row.left, 'old')}
      {cell(row.right, 'new')}
      {anchored.length > 0 || notes.composing === anchor ? (
        <div className="rv-split-notes">
          <LineNotes anchor={anchor} anchored={anchored} path={path} {...notes} />
        </div>
      ) : null}
    </>
  );
}

/** Unified / side by side, and Wrap: the remembered choice, drawn once in the
 *  review header (DeepSeek's review toolbar, in the shell2 segmented look). */
export function DiffToolbar() {
  const prefs = useDiffPrefs();
  return (
    <span className="rv-difftools" data-testid={REVIEW.diffTools}>
      <span className="rv-viewseg" role="radiogroup" aria-label="Diff view">
        {(['unified', 'split'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={prefs.view === v}
            className="rv-viewbtn"
            data-testid={v === 'split' ? REVIEW.viewSplit : REVIEW.viewUnified}
            onClick={() => diffPrefs.set({ view: v })}
          >
            {v === 'split' ? 'Side by side' : 'Unified'}
          </button>
        ))}
      </span>
      <button
        type="button"
        className="rv-viewbtn rv-wrapbtn"
        aria-pressed={prefs.wrap}
        data-testid={REVIEW.wrapToggle}
        title="Wrap long lines"
        onClick={() => diffPrefs.set({ wrap: !prefs.wrap })}
      >
        Wrap
      </button>
    </span>
  );
}

interface NotesProps {
  anchor: number | null;
  anchored: LineComment[];
  path: string;
  composing: number | null;
  draft: string;
  onDraft: (text: string) => void;
  onCancel: () => void;
  onSend: (line: number, text: string) => void;
}

/** The comments on one line and the open composer for it. One copy, drawn
 *  under a unified row and under a side-by-side row alike. */
function LineNotes({ anchor, anchored, path, composing, draft, onDraft, onCancel, onSend }: NotesProps) {
  const file = { path };
  return (
    <>
    {anchored.map((comment) => (
      <div
        key={comment.id}
        className="rv-comment"
        data-testid={REVIEW.comment}
        data-line={String(comment.line)}
        data-sent={comment.sentWith === null ? 'no' : 'yes'}
      >
        <span className="rv-comment-anchor mono">
          {file.path}:{comment.line}
        </span>
        <span className="rv-comment-text">{comment.text}</span>
        {/* SENT IS A STATE, NOT A DISAPPEARANCE. A comment that
            vanished the moment it reached the composer would leave
            the reviewer unable to see what they have already said
            about this file — and `LineComment.sentWith` exists in
            the frozen contract precisely "so the same comment is
            not replayed twice". */}
        <span className="rv-comment-state">
          {comment.sentWith === null ? 'not sent' : 'sent'}
        </span>
      </div>
    ))}

    {composing === anchor && anchor !== null ? (
      <div className="rv-compose">
        <label className="rv-compose-anchor mono" htmlFor={`rv-c-${file.path}-${anchor}`}>
          {file.path}:{anchor}
        </label>
        <textarea
          id={`rv-c-${file.path}-${anchor}`}
          className="rv-compose-field"
          data-testid={REVIEW.commentField}
          value={draft}
          rows={2}
          placeholder="What should change here?"
          onChange={(event) => onDraft(event.target.value)}
        />
        <div className="rv-compose-row">
          <button
            type="button"
            className="rv-btn"
            data-testid={REVIEW.commentCancel}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rv-btn rv-btn-solid"
            data-testid={REVIEW.commentSend}
            onClick={() => onSend(anchor, draft)}
          >
            Send to chat
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

export function DiffView({
  file,
  comments,
  composing,
  onComment,
  onCancel,
  onSend,
  draft,
  onDraft,
  onRevertHunk,
  mode: forcedMode,
  wrap: forcedWrap,
}: DiffViewProps) {
  const language = languageOf(file.path);
  const prefs = useDiffPrefs();
  /* A diff that only adds, or only removes, has nothing to set against itself:
     one column in either mode (DeepSeek's review tab does the same). */
  const mode = effectiveMode(file, forcedMode ?? prefs.view);
  const wrap = forcedWrap ?? prefs.wrap;

  const byLine = new Map<number, LineComment[]>();
  for (const comment of comments) {
    const list = byLine.get(comment.line);
    if (list) list.push(comment);
    else byLine.set(comment.line, [comment]);
  }

  return (
    <div className="rv-diff" data-testid={REVIEW.diff} data-view={mode} data-wrap={wrap ? 'on' : 'off'}>
      {file.hunks.map((hunk, hunkIndex) => (
        <div className="rv-hunk" key={hunkIndex} data-testid={REVIEW.hunk}>
          {/* The hunk header carries git's own enclosing-context guess. On a
              long file it is the only thing that says WHERE you are, and
              dropping it is how a diff view becomes a wall. */}
          <div className="rv-hunk-hd">
            <span className="rv-hunk-range mono">
              @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </span>
            {hunk.section === '' ? null : <span className="rv-hunk-sect mono">{hunk.section}</span>}
            {onRevertHunk ? (
              <button
                type="button"
                className="rv-hunk-revert"
                data-testid={REVIEW.hunkRevert}
                aria-label={`Revert this change in ${file.path}`}
                onClick={() => onRevertHunk(hunkIndex, hunk.header)}
              >
                Revert hunk
              </button>
            ) : null}
          </div>

          {mode === 'split' ? (
            <div className="rv-split" data-testid={REVIEW.split}>
              {pairHunkLines(hunk.lines).map((row, rowIndex) => {
                const anchor = row.right?.newLine ?? null;
                const anchored = anchor === null ? [] : (byLine.get(anchor) ?? []);
                return (
                  <SplitRowView
                    key={rowIndex}
                    row={row}
                    anchor={anchor}
                    anchored={anchored}
                    path={file.path}
                    language={language}
                    onComment={onComment}
                    composing={composing}
                    draft={draft}
                    onDraft={onDraft}
                    onCancel={onCancel}
                    onSend={onSend}
                  />
                );
              })}
            </div>
          ) : null}

          {mode === 'split' ? null : hunk.lines.map((line, lineIndex) => {
            const anchor = line.newLine;
            const anchored = anchor === null ? [] : (byLine.get(anchor) ?? []);
            return (
              <div key={lineIndex}>
                <div
                  className={`rv-line rv-line-${line.kind}`}
                  data-testid={REVIEW.line}
                  data-kind={line.kind}
                  {...(line.oldLine === null ? {} : { 'data-old': String(line.oldLine) })}
                  {...(line.newLine === null ? {} : { 'data-new': String(line.newLine) })}
                >
                  <span className="rv-num mono">{line.oldLine ?? ''}</span>
                  <span className="rv-num mono">{line.newLine ?? ''}</span>
                  {/* THE AFFORDANCE IS ON LINES THAT EXIST IN THE NEW FILE
                      ONLY. Item 5.3's whole value is that the anchor steers the
                      next edit; a removed line is not somewhere the agent can
                      be sent. */}
                  {anchor === null ? (
                    <span className="rv-cadd-gap" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="rv-cadd"
                      data-testid={REVIEW.commentAdd}
                      aria-label={`Comment on ${file.path} line ${anchor}`}
                      onClick={() => onComment(anchor)}
                    >
                      <ReviewIcon name="plus" size={12} />
                    </button>
                  )}
                  <span className="rv-sign mono" aria-hidden="true">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                  </span>
                  <CodeLine line={line} language={language} />
                </div>

                <LineNotes
                  anchor={anchor}
                  anchored={anchored}
                  path={file.path}
                  composing={composing}
                  draft={draft}
                  onDraft={onDraft}
                  onCancel={onCancel}
                  onSend={onSend}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
