import { useMemo, useState } from 'react';

import { planDiff } from '../files/filesModel';
import type { DiffFileChange, DiffLine, DiffPlan } from '../files/filesModel';
import { elidePath } from '../whiteboard/CodeCard';

import './editApprovalCard.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE EDIT APPROVAL CARD — accept or reject an edit WHERE IT WAS PROPOSED
   packages/web2/src/chat/EditApprovalCard.tsx

   `edit:proposal` has been emitted by the turn, `FileEditProposal` has been
   held in the store, and `proposal/file-decide` (store.ts) has been the one
   action that settles a file, SINCE THE DAY THE REVIEW OVERLAY SHIPPED — and
   the only door to it is `ConnectedReview`. So the reader is told an edit was
   proposed in the transcript and has to leave the transcript, open a second
   surface, and find the same proposal there to answer. This card is the
   missing door: the question gets answered in the place it was asked.

   ── PURE PRESENTATION, AND NOT MERELY AS A STYLE PREFERENCE ───────────────

   No store, no fetch, no clock. Everything arrives in props and every decision
   leaves through a callback, for the reason `CodeCard.tsx` gives and one more
   that is specific to a transcript: a transcript re-renders on every streamed
   token, and a card that subscribed would re-render EVERY proposal in the
   scrollback on each one. A card that fetched its own diff would also show a
   diff taken at scroll time rather than the one the agent proposed, which is a
   grounded-looking surface quietly ungrounding itself.

   ── ONE PARSER. THIS FILE CONTAINS NO DIFF PARSING AT ALL ─────────────────

   `planDiff` IS `parseUnifiedDiff`: `files/filesModel.ts:73` imports it from
   `review/diffModel.ts` and adds exactly two things on top — the line cap, and
   the four-state answer to "what did this text turn out to be". Reaching for
   `parseUnifiedDiff` directly here would have meant re-deciding the second of
   those, and a second answer to "is this diff empty or did it fail to parse"
   is the same defect class as a second answer to "what line number is this":
   one surface would print a clean tree where the other prints a failure.

   ── WHY THE ROWS ARE DRAWN HERE AND NOT BY `files/DiffView.tsx` ───────────

   DiffView was the first candidate and it was read before this was written.
   Three things ruled it out, none of them cosmetic:

     · EVERY RULE IN `files.css` IS KEYED OFF `.files-scope`. Mounted in the
       transcript, DiffView renders with no ancestor carrying that class, so
       the gutters, the washes and the mono ramp all fall off — an unstyled
       diff, in the one place a reader is being asked to approve something.
       Importing `files.css` from here to fix that would put the whole files
       panel's sheet into the chat bundle to borrow four rules.
     · It draws its own `N files · +a −b` summary. This card's summary is
       PER FILE, beside the path, because the unit of decision here is the
       file. Two summaries, one of them always reading "1 file", is noise on
       the surface whose whole job is to be scanned quickly.
     · The motion below has to be keyed off classes this file owns. Animating
       another module's class names from this sheet would break silently the
       first time that module renamed one.

   The arithmetic and the line numbers — the parts that are CLAIMS — still come
   from the shared parser. What is duplicated is markup, which cannot be wrong
   in a way a reader would believe.

   ── THE CARD NEVER VANISHES, AND THE REFERENCE'S MOTION IS BENT FOR IT ────

   The 21st.dev reference collapses a rejected line to nothing, which is right
   for an editor widget: the line is not happening, so it goes. It is wrong
   here. This card sits in a TRANSCRIPT, which is a record, and a record that
   erases the thing that was agreed to leaves the reader unable to answer "what
   did I approve?" — the single question the card exists to make answerable.
   So the motion vocabulary is kept and its trigger moves: both animations are
   ENTRY animations (an added line wipes in from the left, a removed line
   unfolds from nothing — the visual inverse), and a DECISION changes ink and
   swaps controls for a verdict. Nothing is ever removed from the card.

   ── HUE BUDGET ───────────────────────────────────────────────────────────

     --diff-add-* / --diff-del-*   the book's third disjoint channel, spent on
       the diff-line wash and the sign column only. Never a foreground on the
       code itself: a line being added is not a claim that the line is good.
     --fits / --wont               the `+N −M` arithmetic, the Accept/Reject
       controls, and the verdict word. All three ARE verdicts, which is the one
       thing law 1 lets a hue pay for.
     Everything else is neutral. Decision 17: a hue belongs on a button you
     press, not on a card. The chassis is `--surface-1` with a hairline, the
     controls are `--glass-ctl` glass with no accent tint.
   ══════════════════════════════════════════════════════════════════════════ */

/** The two answers `proposal/file-decide` accepts. Copied from nothing —
 *  this is `ProposedFile['decision']` minus the state it starts in. */
export type EditDecision = 'accepted' | 'rejected';

/** A file's settled state, which is the decision or the absence of one. */
export type FileDecisionState = 'pending' | EditDecision;

/** The write's own progress. `FileEditProposal['status']`, verbatim. */
export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'denied' | 'partial';

/**
 * One row of {@link EditApprovalCardProps.files}.
 *
 * STRUCTURALLY `ProposedFile` MINUS `content` AND `comments`, and the omission
 * is the point rather than an oversight. `content` is the whole proposed file
 * — handing it to a presentational card would invite the card to render it,
 * and a card that can show either the diff or the full content is a card that
 * can show a reader something the diff does not say. `comments` belong to the
 * review overlay, which is where a line can be clicked.
 *
 * Declared here rather than imported from `state/types.ts` so that this stays
 * a component with a prop contract instead of a component with a store shape.
 * A caller holding a real `ProposedFile` passes it directly: every field this
 * asks for is on it, spelled the same way.
 */
export interface EditApprovalFile {
  /** Repo-relative, exactly as it must be spelled to write it. */
  path: string;
  /** The unified diff against disk, or null when it has not been fetched. */
  diff: string | null;
  decision: FileDecisionState;
}

export interface EditApprovalCardProps {
  /** Echoed into the callbacks so a parent with two cards can tell them apart. */
  proposalId: string;
  /** `FileEditProposal.title`. Null is ordinary; a fallback sentence is used. */
  title: string | null;
  /** `FileEditProposal.rationale`. Null draws nothing — never an empty row. */
  rationale?: string | null;
  files: EditApprovalFile[];
  /**
   * The write's progress, NOT whether the question has been answered.
   *
   * THIS DISTINCTION IS LOAD-BEARING AND IT IS EASY TO GET BACKWARDS.
   * `deriveProposalStatusFromFiles` (store.ts) returns `'pending'` when every
   * file is ACCEPTED but nothing has been written yet — accepted-and-unapplied
   * and untouched are the same word. A card that hid its controls on
   * `status !== 'pending'` would therefore go on offering Accept for a
   * proposal the reader had already fully accepted. So the settled state is
   * derived from the FILES, and `status` only adds the sentence about the
   * write ("applying", "applied", "denied").
   */
  status?: ProposalStatus;
  /** Called for one file. The path is verbatim — it is what a write targets. */
  onDecideFile: (proposalId: string, path: string, decision: EditDecision) => void;
  /**
   * Called for the whole proposal, when the parent has a better answer than
   * "the same decision, once per undecided file".
   *
   * OPTIONAL, AND THE DEFAULT IS THE FAN-OUT, because the fan-out is what the
   * store actually supports: `proposal/file-decide` is per path and there is no
   * whole-proposal decide action. A required callback here would make every
   * caller write the same loop, and the day one of them wrote it slightly
   * differently — skipping already-decided files, or not skipping them — two
   * Accept-all buttons would mean two different things.
   */
  onDecideAll?: (proposalId: string, decision: EditDecision) => void;
  /** Mostly for tests. The product uses {@link APPROVAL_LINE_CAP}. */
  lineCap?: number;
}

/**
 * How many diff lines one file in a transcript card mounts before it stops.
 *
 * DELIBERATELY FAR BELOW `DIFF_LINE_CAP`. 2,000 is right for the files panel,
 * which is a full-height pane the reader went to in order to read a diff. This
 * card is one item in a scrollback, and 2,000 rows of diff inside it is not a
 * proposal any more, it is a wall that buries every message after it. 240 is
 * about six screenfuls inside the card's own scroller — enough to judge a
 * normal edit, and the count withheld is SAID, with a control to raise it.
 * Capping silently would be strictly worse than a wall, because the reader
 * would approve a change believing they had seen all of it.
 */
export const APPROVAL_LINE_CAP = 240;

/** One press of "show more" adds another cap's worth. */
const CAP_STEP = APPROVAL_LINE_CAP;

/**
 * Mono characters of path the header row can hold.
 *
 * Bigger than `CODE_CARD_PATH_CHARS` (34) because the budget is different: that
 * is a 264px card on the board, this is the chat pane at `--pane-w` (392px)
 * less the transcript's and the card's padding, with the `+N −M` group taking
 * the right end. ~40 mono characters at `--t-12`. The estimate is an estimate,
 * and the CSS clip behind it is what keeps being wrong cosmetic — see
 * `elidePath`'s own note on why the tail is never cut.
 */
export const APPROVAL_PATH_CHARS = 40;

export function EditApprovalCard({
  proposalId,
  title,
  rationale = null,
  files,
  status = 'pending',
  onDecideFile,
  onDecideAll,
  lineCap = APPROVAL_LINE_CAP,
}: EditApprovalCardProps) {
  const pending = files.filter((f) => f.decision === 'pending');
  const settled = files.length > 0 && pending.length === 0;
  const accepted = files.filter((f) => f.decision === 'accepted').length;
  const rejected = files.filter((f) => f.decision === 'rejected').length;

  const decideAll = (decision: EditDecision) => {
    if (onDecideAll) {
      onDecideAll(proposalId, decision);
      return;
    }
    /* Only the undecided ones. Re-deciding a file the reader already answered
       would silently overwrite their answer with the bulk one, and the store
       would accept it — `proposal/file-decide` has no notion of "already
       settled", it just writes the new decision. */
    for (const file of pending) onDecideFile(proposalId, file.path, decision);
  };

  return (
    <section
      className="editapproval"
      data-testid="chat-edit-approval"
      data-settled={settled ? 'yes' : 'no'}
      data-status={status}
      aria-label={title ?? 'Proposed file edits'}
    >
      <header className="editapproval-hd">
        <h3 className="editapproval-title" data-testid="chat-edit-approval-title">
          {/* A model may propose an edit without naming it. "Untitled" would be
              a label about the metadata; this says what the card IS, which is
              what a reader scanning a scrollback needs from the top line. */}
          {title ?? 'Proposed file edits'}
        </h3>
        <span className="editapproval-count" data-testid="chat-edit-approval-count">
          {files.length === 1 ? '1 file' : `${files.length} files`}
        </span>
      </header>

      {rationale === null || rationale === '' ? null : (
        <p className="editapproval-why" data-testid="chat-edit-approval-why">
          {rationale}
        </p>
      )}

      {files.length === 0 ? (
        /* A PROPOSAL WITH NO FILES IS A REAL ARRIVAL, not an impossible one:
           the turn emits the proposal and the file list is filled in as the
           agent names each path. Rendering nothing here would leave a card with
           a header and a void under it, which reads as a broken card rather
           than as an early one. */
        <p className="editapproval-note" data-testid="chat-edit-approval-note">
          This proposal names no files yet. Nothing can be accepted until it
          does.
        </p>
      ) : (
        files.map((file) => (
          <FileBlock
            key={file.path}
            file={file}
            lineCap={lineCap}
            onDecide={(decision) => onDecideFile(proposalId, file.path, decision)}
          />
        ))
      )}

      {files.length === 0 ? null : settled ? (
        <p className="editapproval-settled" data-testid="chat-edit-approval-settled">
          {/* THE RECORD, AND THE REASON THE BUTTONS ARE NOT SIMPLY HIDDEN. The
              reader who comes back to this card a hundred messages later is
              asking what they agreed to, and the answer has to be a sentence,
              not the absence of two controls. */}
          {settledSentence(accepted, rejected)}
          {applySentence(status) === null ? null : (
            <span className="editapproval-settled-status"> {applySentence(status)}</span>
          )}
        </p>
      ) : (
        <div className="editapproval-acts" data-testid="chat-edit-approval-acts">
          <button
            type="button"
            className="editapproval-act editapproval-act-accept"
            data-testid="chat-edit-approval-accept-all"
            aria-label={`Accept all ${pending.length === 1 ? '1 file' : `${pending.length} files`}`}
            onClick={() => decideAll('accepted')}
          >
            Accept all
          </button>
          <button
            type="button"
            className="editapproval-act editapproval-act-reject"
            data-testid="chat-edit-approval-reject-all"
            aria-label={`Reject all ${pending.length === 1 ? '1 file' : `${pending.length} files`}`}
            onClick={() => decideAll('rejected')}
          >
            Reject all
          </button>
        </div>
      )}
    </section>
  );
}

/* ── one file ───────────────────────────────────────────────────────────── */

function FileBlock({
  file,
  lineCap,
  onDecide,
}: {
  file: EditApprovalFile;
  lineCap: number;
  onDecide: (decision: EditDecision) => void;
}) {
  const [cap, setCap] = useState(lineCap);
  const text = file.diff ?? '';
  const plan = useMemo(() => planDiff(text, cap), [text, cap]);
  const elided = useMemo(() => elidePath(file.path, APPROVAL_PATH_CHARS), [file.path]);

  /* The arithmetic is the parser's, summed across the file's own entries.
     `plan.totals` is already exactly that — the totals are computed BEFORE the
     cap bites (filesModel's `planDiff`), so a capped diff still reports the
     real size of the change rather than the size of what fitted. */
  const added = plan.totals.added;
  const removed = plan.totals.removed;

  /*
   * `+0 −0` IS A CLAIM, AND IT WOULD BE A FALSE ONE TWICE OVER.
   *
   * `planDiff` reports zeros both for a diff that has not been fetched and for
   * text it could not parse, and in neither case has anything been measured.
   * Printed beside the path it reads as "this file changes nothing", which is
   * the opposite of what the note under it says. So the arithmetic is drawn
   * only when it was actually computed; an empty diff DOES get `+0 −0`,
   * because there the zeros are the measured answer.
   */
  const counted = file.diff !== null && plan.state !== 'unreadable';

  return (
    <div
      className="editapproval-file"
      data-testid="chat-edit-approval-file"
      data-path={file.path}
      data-decision={file.decision}
    >
      <div className="editapproval-filehd">
        <span
          className="editapproval-path"
          data-testid="chat-edit-approval-path"
          /* The whole path, always, for the reader who needs the part that was
             elided and for anything driving this by accessible name. */
          title={file.path}
        >
          <span className="editapproval-path-head">{elided.head}</span>
          <span className="editapproval-path-tail">{elided.tail}</span>
        </span>

        {counted ? (
          <span
            className="editapproval-stat"
            data-testid="chat-edit-approval-stat"
            aria-label={`${added} added, ${removed} removed`}
          >
            <span className="editapproval-add">+{added}</span>
            <span className="editapproval-del">&minus;{removed}</span>
          </span>
        ) : null}

        {file.decision === 'pending' ? (
          <span className="editapproval-acts editapproval-acts-file">
            <button
              type="button"
              className="editapproval-act editapproval-act-accept"
              data-testid="chat-edit-approval-accept"
              aria-label={`Accept ${file.path}`}
              onClick={() => onDecide('accepted')}
            >
              Accept
            </button>
            <button
              type="button"
              className="editapproval-act editapproval-act-reject"
              data-testid="chat-edit-approval-reject"
              aria-label={`Reject ${file.path}`}
              onClick={() => onDecide('rejected')}
            >
              Reject
            </button>
          </span>
        ) : (
          <span
            className="editapproval-verdict"
            data-testid="chat-edit-approval-verdict"
            data-decision={file.decision}
          >
            {file.decision === 'accepted' ? 'Accepted' : 'Rejected'}
          </span>
        )}
      </div>

      <DiffBody plan={plan} diff={file.diff} onMore={() => setCap(cap + CAP_STEP)} />
    </div>
  );
}

/* ── the diff, and the four ways there isn't one ───────────────────────── */

function DiffBody({
  plan,
  diff,
  onMore,
}: {
  plan: DiffPlan;
  diff: string | null;
  onMore: () => void;
}) {
  /*
   * NULL IS NOT EMPTY, AND EMPTY IS NOT UNREADABLE.
   *
   * `ProposedFile.diff` is null until it has been fetched — the agent proposes
   * content and the diff against disk is computed after. Empty means the fetch
   * came back with nothing to show. Unreadable means text arrived and the
   * parser understood none of it. Three different facts, three different next
   * moves for the reader, and the worst possible rendering of any of them is
   * the same blank box: a reader who sees a clean panel believes they have
   * reviewed a change they have never seen.
   */
  if (diff === null) {
    return (
      <p className="editapproval-note" data-testid="chat-edit-approval-note">
        The diff for this file has not been fetched yet, so nothing is drawn.
        The proposed change is real; only the comparison is missing.
      </p>
    );
  }

  if (plan.state === 'empty') {
    return (
      <p className="editapproval-note" data-testid="chat-edit-approval-note">
        No diff. This file matches what is already on disk, or git is not
        tracking it yet.
      </p>
    );
  }

  if (plan.state === 'unreadable') {
    return (
      <p
        className="editapproval-note editapproval-note-fail"
        data-testid="chat-edit-approval-note"
        role="alert"
      >
        {/* NOT "no changes". Text arrived and none of it parsed, which is a
            different fact and a different fix — and drawing it as a clean tree
            is how somebody approves a change sight unseen. */}
        This is not a unified diff, so nothing is drawn from it. Guessing at one
        would be worse than showing none.
      </p>
    );
  }

  return (
    <div className="editapproval-diff" data-testid="chat-edit-approval-diff" data-state={plan.state}>
      {plan.files.map((file, index) => (
        <FileHunks key={`${file.path}-${index}`} file={file} />
      ))}

      {plan.omitted > 0 ? (
        <div className="editapproval-tail">
          <p className="editapproval-note" data-testid="chat-edit-approval-note">
            {`${plan.omitted.toLocaleString('en-US')} more line${plan.omitted === 1 ? '' : 's'} not drawn.`}
          </p>
          <button
            type="button"
            className="editapproval-act"
            data-testid="chat-edit-approval-more"
            onClick={onMore}
          >
            {`Show ${Math.min(CAP_STEP, plan.omitted).toLocaleString('en-US')} more`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FileHunks({ file }: { file: DiffFileChange }) {
  if (file.binary) {
    return (
      <p className="editapproval-note" data-testid="chat-edit-approval-note">
        {/* A BINARY CHANGE IS A CHANGE. Rendering this as "no diff" would tell
            the reader nothing happened to a file that git says differs. */}
        Binary file. It changed, and the change has no lines to show.
      </p>
    );
  }

  if (file.hunks.length === 0) {
    return (
      <p className="editapproval-note" data-testid="chat-edit-approval-note">
        Every line of this file is past the limit below.
      </p>
    );
  }

  return (
    <>
      {file.hunks.map((hunk, index) => (
        <div className="editapproval-hunk" key={index}>
          {/* git's own enclosing-context guess. On a long file it is the only
              thing that says WHERE you are, and dropping it turns a diff into
              a wall of lines with no location. */}
          <div className="editapproval-hunk-hd" data-testid="chat-edit-approval-hunk">
            <span className="editapproval-hunk-range">
              @@ &minus;{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </span>
            {hunk.section === '' ? null : (
              <span className="editapproval-hunk-sect">{hunk.section}</span>
            )}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <Row key={lineIndex} line={line} />
          ))}
        </div>
      ))}
      {file.noNewlineAtEof ? (
        <p className="editapproval-note editapproval-note-quiet">No newline at end of file.</p>
      ) : null}
    </>
  );
}

function Row({ line }: { line: DiffLine }) {
  return (
    <div
      className={`editapproval-line editapproval-line-${line.kind}`}
      data-testid="chat-edit-approval-line"
      data-kind={line.kind}
      {...(line.oldLine === null ? {} : { 'data-old': String(line.oldLine) })}
      {...(line.newLine === null ? {} : { 'data-new': String(line.newLine) })}
    >
      {/* TWO NUMBER COLUMNS, AND A REMOVED LINE HAS NO NEW NUMBER. Inherited
          from `review/DiffView.tsx`, where it is not a nicety: a removed line
          occupies no line in the file anything will edit next, and numbering it
          sends the reader — or an agent they steer — at the wrong line. */}
      <span className="editapproval-num">{line.oldLine ?? ''}</span>
      <span className="editapproval-num">{line.newLine ?? ''}</span>
      <span className="editapproval-sign" aria-hidden="true">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
      </span>
      <code className="editapproval-code">{line.text === '' ? ' ' : line.text}</code>
    </div>
  );
}

/* ── the sentences ─────────────────────────────────────────────────────── */

/**
 * What the settled card says it did.
 *
 * ONE FUNCTION so there is ONE sentence, and exported so a test asserts against
 * the words the card actually prints rather than against a copy of them.
 */
export function settledSentence(accepted: number, rejected: number): string {
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
  if (rejected === 0) return `Accepted ${files(accepted)}.`;
  if (accepted === 0) return `Rejected ${files(rejected)}.`;
  return `Accepted ${files(accepted)}, rejected ${files(rejected)}.`;
}

/**
 * The write's own progress, or null when there is nothing extra to say.
 *
 * `'pending'` and `'partial'` return null ON PURPOSE. Both describe the
 * DECISIONS, which the sentence above has already reported; printing "pending"
 * next to "Accepted 2 files" would read as though the acceptance had not taken.
 */
export function applySentence(status: ProposalStatus): string | null {
  if (status === 'applying') return 'Writing the accepted files now.';
  if (status === 'applied') return 'The accepted files were written.';
  if (status === 'denied') return 'Nothing was written.';
  return null;
}
