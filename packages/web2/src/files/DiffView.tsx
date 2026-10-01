/* ══════════════════════════════════════════════════════════════════════════
   THE DIFF — item 2.1
   packages/web2/src/files/DiffView.tsx

   Unified-diff TEXT in, a readable diff out. The text is exactly what
   `GET /api/git/diff` answers with — `git diff --no-color` — so this component
   is wired by handing it a response body and nothing else.

   ── THE FOUR STATES, AND WHY A BOOLEAN WOULD BE A LIE ─────────────────────
   `GET /api/git/diff` documents an EMPTY body for a file that is unchanged and
   for a file that is untracked. git emits a `Binary files … differ` line for a
   change that has no lines. And a parser can be handed text it does not
   understand. Rendering any two of those the same way is how one blank panel
   comes to mean four unrelated things, and the worst of the four is the one
   where the reader believes they have reviewed a change they have not seen. So
   {@link planDiff} returns a word, and each word gets its own sentence.

   ── THE GUTTER IS TWO COLUMNS, AND A REMOVED LINE HAS NO NEW NUMBER ───────
   Inherited from `review/DiffView.tsx`, where it is not a nicety: a removed
   line occupies no line in the file anything will edit next, and numbering it
   sends a reader — or an agent the reader steers — at the wrong line, silently.

   ── THE HUE LEDGER FOR THIS FILE, WHICH IS THE WHOLE BUDGET IT SPENDS ─────
     --diff-add-* / --diff-del-*   the book's THIRD disjoint colour channel:
       a background wash and a 2px inset gutter, NEVER a foreground. The token
       sheet says why in its own comment — "so a removed line can never be
       misread as 'won't fit'". An added line's text is the same ink as a
       context line's, because a line being added is not a claim that the line
       is good.
     --fits / --wont               spent on `+340 −118` and on nothing else.
       That arithmetic IS a claim about what happened, which is the one thing
       law 1 lets a hue pay for. This is `review.css`'s settled answer for the
       same two numbers, reused rather than re-argued.
     --diffx-*                     tokens/graphite.css §8, written for exactly
       this surface: the hunk header, the number gutter, the sign column and
       the line rung.

   Syntax highlighting is the ink ramp and the weight ladder, never a hue — the
   highlighter is `review/syntax.ts`, imported rather than re-implemented, for
   the reason its own header gives: a second highlighter is a second answer to
   "what colour is a keyword", and the two would drift.

   ── A VERY LARGE DIFF DOES NOT LOCK THE PAGE ──────────────────────────────
   A unified diff is machine-generated and unbounded. One DOM row per line over
   a regenerated lockfile is the rail's measured stall — "mounted a DOM button
   for every one, stalling the whole shell" — arriving through a different door.
   {@link DIFF_LINE_CAP} bounds what is mounted, the count withheld is SAID, and
   a control raises the cap for a reader who actually wants the rest. Capping
   silently would be strictly worse than stalling: the reader would believe they
   had seen the whole change.
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';

import { highlight, languageOf } from '../review/syntax';
import type { SyntaxLanguage } from '../review/syntax';

import { FILES } from './anchors';
import { DIFF_LINE_CAP, diffSummary, planDiff } from './filesModel';
import type { DiffFileChange, DiffLine } from './filesModel';

export interface DiffViewProps {
  /** Unified diff text, verbatim from `GET /api/git/diff`. May be empty. */
  text: string;
  /**
   * The file the reader asked about. Used ONLY to name the subject in the
   * empty state, which by definition carries no path of its own — an empty
   * diff has no `---`/`+++` header to read one out of.
   */
  path?: string | null;
  /** Mostly for tests; the product uses {@link DIFF_LINE_CAP}. */
  lineCap?: number;
  /** Told when the reader asks for more lines, so a parent can log or fetch. */
  onShowMore?: (cap: number) => void;
}

/** How much the cap grows per press. One more screenful-of-screenfuls. */
const CAP_STEP = DIFF_LINE_CAP;

export function DiffView({ text, path = null, lineCap = DIFF_LINE_CAP, onShowMore }: DiffViewProps) {
  const [cap, setCap] = useState(lineCap);
  /*
   * THE CAP RESETS WHEN THE DIFF CHANGES, AND IT IS DONE DURING RENDER RATHER
   * THAN IN AN EFFECT. React documents this exact pattern for state derived
   * from a prop, and the effect version is worse in a way that shows: an effect
   * runs AFTER the first paint, so switching from a file whose cap had been
   * raised to a huge one would mount ten thousand rows for one frame before the
   * reset — which is the stall this component exists to prevent, reintroduced
   * by the code meant to manage it.
   */
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setCap(lineCap);
  }

  const plan = useMemo(() => planDiff(text, cap), [text, cap]);

  if (plan.state === 'empty') {
    return (
      <div className="files-diff" data-testid={FILES.diff} data-state="empty">
        <p className="files-note" data-testid={FILES.diffNote}>
          {/* BOTH CAUSES, BECAUSE THE ROUTE CANNOT TELL THEM APART AND NEITHER
              CAN THIS PANEL. Naming only one would be a guess, and the reader's
              next move differs: an unchanged file needs nothing, an untracked
              one needs `git add`. */}
          {path === null
            ? 'No diff. This file is unchanged, or git is not tracking it yet.'
            : `No diff for ${path}. It is unchanged, or git is not tracking it yet.`}
        </p>
      </div>
    );
  }

  if (plan.state === 'unreadable') {
    return (
      <div className="files-diff" data-testid={FILES.diff} data-state="unreadable">
        <p className="files-note files-note-fail" data-testid={FILES.diffNote} role="alert">
          {/* NOT "no changes". Text arrived and nothing in it parsed, which is a
              different fact and a different fix — and showing it as a clean
              tree is how somebody ships believing they reviewed a change. */}
          This is not a unified diff, so nothing is drawn from it. Guessing at a
          diff would be worse than showing none.
        </p>
      </div>
    );
  }

  return (
    <div className="files-diff" data-testid={FILES.diff} data-state={plan.state}>
      <div
        className="files-diff-sum"
        data-testid={FILES.diffSummary}
        aria-label={diffSummary(plan.totals)}
      >
        <span className="files-diff-files">
          {plan.totals.files} file{plan.totals.files === 1 ? '' : 's'}
        </span>
        {/* THE ARITHMETIC IS THE ONE THING HERE ALLOWED A HUE, and it takes the
            verdict pair rather than the diff wash: a wash used as a foreground
            on two short numbers measured below every legibility floor when
            review.css tried it. */}
        <span className="files-stat-add">+{plan.totals.added}</span>
        <span className="files-stat-del">&minus;{plan.totals.removed}</span>
      </div>

      {plan.files.map((file, index) => (
        <FileDiff key={`${file.path}-${index}`} file={file} />
      ))}

      {plan.omitted > 0 ? (
        <div className="files-diff-tail">
          <p className="files-note" data-testid={FILES.diffNote}>
            {`${plan.omitted.toLocaleString('en-US')} more line${plan.omitted === 1 ? '' : 's'} not drawn — a diff this size is not read on a screen.`}
          </p>
          <button
            type="button"
            className="files-btn"
            data-testid={FILES.diffMore}
            onClick={() => {
              const next = cap + CAP_STEP;
              setCap(next);
              onShowMore?.(next);
            }}
          >
            {`Show ${Math.min(CAP_STEP, plan.omitted).toLocaleString('en-US')} more`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FileDiff({ file }: { file: DiffFileChange }) {
  const language = languageOf(file.path);

  return (
    <div className="files-diff-file" data-testid={FILES.diffFile} data-path={file.path} data-change={file.change}>
      <div className="files-diff-hd">
        {/* The path truncates at the FRONT: the identity of …/files/DiffView.tsx
            is its tail. rail.css's recipe, `direction: rtl` with an inner
            <bdi> so the characters still run left to right inside it. */}
        <span className="files-diff-path mono">
          <bdi>{file.path}</bdi>
        </span>
        {file.oldPath !== null && file.oldPath !== file.path ? (
          <span className="files-diff-from mono">{`was ${file.oldPath}`}</span>
        ) : null}
      </div>

      {file.binary ? (
        <p className="files-note" data-testid={FILES.diffNote}>
          {/* A BINARY CHANGE IS A CHANGE. Rendering this as "no diff" would tell
              the reader nothing happened to a file that git says differs. */}
          Binary file. It changed, and the change has no lines to show.
        </p>
      ) : null}

      {!file.binary && file.hunks.length === 0 ? (
        <p className="files-note" data-testid={FILES.diffNote}>
          Every line of this file is past the limit below.
        </p>
      ) : null}

      {file.hunks.map((hunk, index) => (
        <div className="files-hunk" key={index} data-testid={FILES.hunk}>
          {/* THE HEADER CARRIES git's OWN ENCLOSING-CONTEXT GUESS. On a long
              file it is the only thing that says WHERE you are, and dropping it
              is how a diff view becomes a wall. */}
          <div className="files-hunk-hd" data-testid={FILES.hunkHead}>
            <span className="files-hunk-range mono">
              @@ &minus;{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </span>
            {hunk.section === '' ? null : (
              <span className="files-hunk-sect mono">{hunk.section}</span>
            )}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <CodeRow key={lineIndex} line={line} language={language} />
          ))}
        </div>
      ))}

      {file.noNewlineAtEof ? (
        <p className="files-note files-note-quiet">No newline at end of file.</p>
      ) : null}
    </div>
  );
}

function CodeRow({ line, language }: { line: DiffLine; language: SyntaxLanguage }) {
  return (
    <div
      className={`files-line files-line-${line.kind}`}
      data-testid={FILES.line}
      data-kind={line.kind}
      {...(line.oldLine === null ? {} : { 'data-old': String(line.oldLine) })}
      {...(line.newLine === null ? {} : { 'data-new': String(line.newLine) })}
    >
      <span className="files-num mono">{line.oldLine ?? ''}</span>
      <span className="files-num mono">{line.newLine ?? ''}</span>
      <span className="files-sign mono" aria-hidden="true">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
      </span>
      <code className="files-code-text">
        {highlight(line.text, language).map((span, index) =>
          span.cls === null ? (
            <span key={index}>{span.text}</span>
          ) : (
            <span key={index} className={`files-t-${span.cls}`}>
              {span.text}
            </span>
          ),
        )}
      </code>
    </div>
  );
}
