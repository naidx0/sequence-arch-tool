import { REVIEW } from './anchors';
import { ReviewIcon } from './ReviewIcon';
import { highlight, languageOf, type SyntaxLanguage } from './syntax';
import type { DiffFileChange, DiffLine } from './diffModel';
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

export function DiffView({
  file,
  comments,
  composing,
  onComment,
  onCancel,
  onSend,
  draft,
  onDraft,
}: DiffViewProps) {
  const language = languageOf(file.path);

  const byLine = new Map<number, LineComment[]>();
  for (const comment of comments) {
    const list = byLine.get(comment.line);
    if (list) list.push(comment);
    else byLine.set(comment.line, [comment]);
  }

  return (
    <div className="rv-diff" data-testid={REVIEW.diff}>
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
          </div>

          {hunk.lines.map((line, lineIndex) => {
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
