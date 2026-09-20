import { Icon } from './Icon';

/* ══════════════════════════════════════════════════════════════════════════
   THE TRUST MOMENT
   packages/web2/src/chat/TrustStrip.tsx

   ── WHAT IT IS FOR ───────────────────────────────────────────────────────

   A repository's own `AGENTS.md` used to become the assistant's standing
   orders the moment you attached it, and `pnpm test` used to run whatever that
   repository's package.json said it was. Both are now gated on one explicit
   decision (`analyzer/src/server/repoTrust.ts`).

   A boundary the reader cannot see is worse than no boundary, because the turn
   then behaves differently for reasons nothing on screen explains — the exact
   failure `docs/vision.md` §5 names. So this strip exists, and it says three
   things and stops: what is limited, what the repository asked for, and the
   one action that changes it.

   ── AND IT MUST NOT READ LIKE A SECURITY DIALOG ──────────────────────────

   Owner ruling: it is the first thing a new reader meets, so it is a
   NOTICE, not an interrogation. Three consequences, all of them visible here:

     · The composer stays fully usable underneath. It is a strip, not a modal —
       the same law page 20.4 sets for the failure strip, for the same reason:
       "a failure is a thing that happened, not a mode you are now in."
     · NO WARNING HUE. Graphite law 1 — every hue on screen is a claim about
       the world — and an untrusted repository is the ordinary case, not a
       verdict about the code. A red box here would teach the reader to
       distrust every other red on screen. The glyph is the same neutral ink as
       the words.
     · The words say what is limited, not what might happen. "Its notes are not
       being followed and commands are off" is checkable. "This repository
       could be dangerous" is a mood.

   ── THE DISCLOSURE IS THE HALF THAT MAKES THE DECISION REAL ──────────────

   Review shows the repository's instruction file VERBATIM, as content. It is
   the same text the model would receive if the repo were trusted, which is the
   only way to make trusting an informed act rather than a shrug — and it is
   why the server returns the text on the untrusted path instead of dropping
   it. It is rendered inside a plain <pre>: this is untrusted text, and every
   piece of formatting we grant it is a way to look like our own chrome.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TrustStripProps {
  repoName: string;
  /** What the repository is asking for. Null when it ships no instruction file. */
  instructions: { file: string; text: string; truncated: boolean } | null;
  /** Is the disclosure open? */
  reviewing: boolean;
  onReview: (open: boolean) => void;
  /** The one action. Scoped to this repository root. */
  onTrust: () => void;
}

export function TrustStrip({
  repoName,
  instructions,
  reviewing,
  onReview,
  onTrust,
}: TrustStripProps) {
  return (
    /*
     * A `chat-scope` WRAPPER, not `chat-scope` on the strip itself.
     *
     * Every rule in chat.css is written `.chat-scope .thing`, which is a
     * DESCENDANT combinator: putting both classes on one element matches
     * nothing, because an element is not its own ancestor. That silently cost
     * the trust glyph its neutral ink — it inherited `.strip`'s `--ink-1` and
     * the hue assertion caught it. The wrapper is inert (display:block) and
     * makes the strip paint whether or not a host already provides the scope.
     */
    <div className="chat-scope">
    <div className="truststrip" data-testid="trust-strip">
      <div className="strip" role="status">
        <Icon name="book" className="i-trust" />
        <span className="msg" data-testid="trust-strip-msg">
          {/*
            * NAMED, because "this repository" is ambiguous the moment a second
            * window is open — and because the decision is scoped to exactly
            * this root, not to a habit.
            */}
          {/*
            * "SETTINGS" COVERS TWO FILES AND IS DELIBERATELY NOT A LIST OF THEM.
            * An untrusted repo's `.sequence/permissions.json` cannot widen what
            * the agent may do, and its `.sequence/ai.json` cannot choose which
            * provider the user's questions and code are sent to — the second
            * being the quieter one, because it leaks no credential and simply
            * routes the reader's code somewhere they never chose. Naming both
            * files here would turn one sentence into a manifest; naming neither
            * would hide a real limit. "Its settings are ignored" is the honest
            * summary, and Read <file> below still shows the repo's own words.
            */}
          Sequence is reading <b>{repoName}</b> but not taking direction from it
          {instructions === null
            ? ' — its settings are ignored and commands are off until you trust it.'
            : `: its ${instructions.file} is not being followed, its settings are ignored, and commands are off.`}
        </span>
        <span className="acts">
          {instructions === null ? null : (
            <button
              type="button"
              className="ghost"
              data-testid="trust-strip-review"
              aria-expanded={reviewing}
              onClick={() => onReview(!reviewing)}
            >
              {reviewing ? 'Hide' : `Read ${instructions.file}`}
            </button>
          )}
          <button type="button" className="ghost trustbtn" data-testid="trust-strip-trust" onClick={onTrust}>
            Trust this repo
          </button>
        </span>
      </div>
      {reviewing && instructions !== null ? (
        <div className="trustreview" data-testid="trust-strip-review-body">
          {/*
            * VERBATIM, AND MARKED AS THEIRS. The reader is being shown text
            * written by whoever wrote that repository, so it is labelled and
            * kept in a <pre> — no markdown, no headings, nothing that lets it
            * borrow the product's own voice.
            */}
          <div className="trustreview-head">
            {instructions.file} — written by this repository, shown as-is
            {instructions.truncated ? ' (cut at the size limit)' : ''}
          </div>
          <pre className="trustreview-body">{instructions.text}</pre>
        </div>
      ) : null}
    </div>
    </div>
  );
}
