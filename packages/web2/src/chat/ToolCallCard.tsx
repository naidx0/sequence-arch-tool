import { useState } from 'react';

import { Icon } from './Icon';
import type { IconName } from './Icon';
import { toolCardTitle, type StrippedTool } from './stripToolProse';

/* ══════════════════════════════════════════════════════════════════════════
   THE TOOL CALL, WITH ITS ARGUMENTS AND ITS ANSWER
   packages/web2/src/chat/ToolCallCard.tsx

   WHAT THIS CARD USED TO HIDE. It painted a glyph, a verb and the tool's name
   and stopped there: the arguments went into a `title` tooltip nobody hovers,
   and the tool's own answer went nowhere at all. So a call that RAN and a call
   the server REFUSED rendered identically — same border, same ink, same words.
   A reader could not tell that `edit_file` never touched the file, and could
   not see which path it had been pointed at. That is the whole gap this fixes:
   a tool row is evidence, and evidence you cannot inspect is decoration.

   THREE STATES, DERIVED FROM THE SERVER, NEVER INVENTED. `askTools.ts` answers
   a refusal with `{ ok: false, evidence: 'refused: …' }`, and every one of its
   ~50 refusal sites writes that same prefix. The prefix is the fact;
   `data-state` is a READING of it. When the caller has the server's own `ok`
   flag we prefer it, because a tool whose legitimate output happens to begin
   with the word "refused" must not be recoloured by its own text — the flag
   is the server speaking, the string is the tool speaking.

   A FOLD, NOT AN ALWAYS-OPEN DUMP. Raw JSON in the transcript is exactly what
   the tool card was built to remove; reprinting it by default would undo the
   card. The trigger is the house `reasonfold` shape — a `<button>` carrying
   `aria-expanded` with the body rendered conditionally — and deliberately not
   `<details>`: two disclosure mechanisms in one transcript means two sets of
   open state, two keyboard behaviours and two things to restyle every time the
   fold moves, and the day they diverge nobody notices because both look fine
   in isolation.

   AND NO TRIGGER WHEN THERE IS NOTHING BEHIND IT. Most turns carry a tool name
   and no body. A chevron that opens onto an empty box teaches the reader that
   the chevron means nothing here, and that lesson then applies to every OTHER
   card on the page — it costs more than the control was ever worth.

   HUE BUDGET: 1, spent only on a refusal. `--wont` is a verdict hue and a
   refusal is a verdict about this call, which is the use law 1 permits.
   Running and done spend nothing: they are positions in a lifecycle, not
   claims about the world. The card's material is neutral glass per Decision 16
   — an accent tint would be the thing you see instead of the material, which
   is what "too much purple" looked like the last three times.
   ══════════════════════════════════════════════════════════════════════════ */

function glyphForTool(name: string): IconName {
  if (name === 'propose_topology' || name.startsWith('diagram.')) return 'board';
  if (name === 'propose_chart') return 'pen';
  if (name.startsWith('board.')) return 'pen';
  if (name.startsWith('canvas.')) return 'pen';
  if (name === 'propose_files') return 'code';
  if (name === 'read_file' || name === 'search_files') return 'file';
  if (name === 'run_command') return 'terminal';
  return 'run';
}

/** What the reader is looking at: in flight, landed, or turned away. */
export type ToolCallState = 'running' | 'done' | 'refused';

/*
 * The server's marker, matched loosely on purpose. Evidence strings are built
 * by string concatenation at ~50 call sites in askTools.ts, so the spacing
 * after the colon is not guaranteed by anything, and a leading newline arrives
 * whenever the line has been through a transcript round-trip.
 */
const REFUSAL_PREFIX = /^\s*refused\s*:\s*/i;

export function isRefusalEvidence(text: string | null | undefined): boolean {
  return REFUSAL_PREFIX.test(text ?? '');
}

export interface ToolCallStateInput {
  running?: boolean;
  /** The server's own verdict, when the caller has it. Beats the string. */
  ok?: boolean;
  /** The evidence line or result body the tool answered with. */
  result?: string | null;
}

/**
 * Pure so the reading can be locked without React.
 *
 * ORDER MATTERS AND IT IS NOT ALPHABETICAL. `running` wins outright: a call in
 * flight has no verdict yet, and a partially streamed result that happens to
 * start with "refused" would otherwise flip the card red and then back again
 * mid-turn — a flicker the reader reads as a failure that un-happened.
 */
export function deriveToolCallState({ running, ok, result }: ToolCallStateInput): ToolCallState {
  if (running === true) return 'running';
  if (ok === false) return 'refused';
  if (ok === true) return 'done';
  return isRefusalEvidence(result) ? 'refused' : 'done';
}

/**
 * The half of a refusal worth putting on the card FACE.
 *
 * The documented shape is `refused: <tool> — <reason>`, and repeating the tool
 * name three inches from where the card already prints it wastes the one line
 * the reader gets for free. So the name is dropped ONLY when the em/en dash
 * that shape guarantees follows it. The other ~40 sites write prose that runs
 * straight on from the name (`refused: read_file missing "path"`), and cutting
 * a word off the front of a sentence is how a reason becomes unreadable — so
 * those are returned whole, and the duplication is the cheaper mistake.
 */
export function refusalReason(evidence: string, toolName: string): string {
  const rest = evidence.replace(REFUSAL_PREFIX, '').trim();
  if (!rest) return evidence.trim();
  if (!toolName || !rest.startsWith(toolName)) return rest;
  const after = rest.slice(toolName.length);
  const trimmed = after.replace(/^\s*[—–]\s*/, '');
  return trimmed && trimmed !== after ? trimmed : rest;
}

const STATE_GLYPH: Record<ToolCallState, IconName> = {
  running: 'clock',
  done: 'check',
  /* A refusal is a STOP, not an alert. `alert` is the glyph for "something
     broke"; nothing broke here — the tool was asked and declined. */
  refused: 'stop',
};

const STATE_WORD: Record<ToolCallState, string> = {
  running: 'running',
  done: 'done',
  refused: 'refused',
};

export interface ToolCallCardProps {
  tool: StrippedTool;
  /** Full raw JSON of the call — the tooltip, and the fallback fold body. */
  detail?: string;
  /** The arguments the tool was called with, already serialised. */
  args?: string;
  /** The tool's answer: the server's evidence line, or the result body. */
  result?: string;
  /** True while the call is in flight. */
  running?: boolean;
  /** The server's `ok`, when the caller has it. Outranks the result string. */
  ok?: boolean;
}

/**
 * Compact tool-call card — replaces raw JSON/code dumps in the transcript
 * while Architecture / AI Canvas work rows carry the live trail. Collapsed it
 * is the same one-line row it always was; opened it is the call itself.
 */
export function ToolCallCard({ tool, detail, args, result, running, ok }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);

  const title = toolCardTitle(tool.name);
  const state = deriveToolCallState({ running, ok, result });

  const argsText = args?.trim() ?? '';
  const rawText = detail?.trim() ?? '';
  const resultText = result?.trim() ?? '';

  /*
   * `detail` IS NOT LABELLED "Arguments", because it is not. It is the whole
   * fenced dump — name, id and arguments together — and calling it arguments
   * would be a small lie that a reader comparing the fold to the wire would
   * catch. One section, two honest labels, picked by which one we actually
   * have.
   */
  const callText = argsText || rawText;
  const callPart = argsText ? 'args' : 'call';
  const callLabel = argsText ? 'Arguments' : 'Raw call';

  /* Rule: a control that opens onto nothing is worse than no control. */
  const openable = callText !== '' || resultText !== '';
  const bodyId = `toolcall-${tool.id}-body`;

  const reason = state === 'refused' && resultText ? refusalReason(resultText, tool.name) : '';

  const head = (
    <>
      <Icon name={glyphForTool(tool.name)} size={14} />
      <span className="tool-call-card-title">{title}</span>
      <span className="tool-call-card-state" data-testid="chat-tool-call-state">
        <Icon name={STATE_GLYPH[state]} size={12} />
        {STATE_WORD[state]}
      </span>
      {openable ? <Icon name={open ? 'chevdown' : 'chevright'} size={12} /> : null}
    </>
  );

  return (
    <div
      className="tool-call-card"
      data-testid="chat-tool-call-card"
      data-tool={tool.name}
      data-state={state}
      data-open={openable && open ? 'true' : undefined}
      /* The tooltip is the LAST RESORT, not a companion to the fold. With a
         fold present, a hover that dumps the same JSON over the body the
         reader just opened fights the thing it duplicates. */
      title={openable ? undefined : tool.name}
    >
      {openable ? (
        <button
          type="button"
          className="tool-call-card-head"
          data-testid="chat-tool-call-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((was) => !was)}
        >
          {head}
        </button>
      ) : (
        <div className="tool-call-card-head">{head}</div>
      )}

      {/* THE REASON IS NOT FOLDED. Everything else here is detail on demand;
          why a call did not run is the one thing the reader needs without
          asking, and it is one short line. The fold below still carries the
          server's sentence verbatim — face summarises, fold quotes. */}
      {reason ? (
        <p className="tool-call-card-reason" data-testid="chat-tool-call-reason">
          {reason}
        </p>
      ) : null}

      {openable && open ? (
        <div className="tool-call-card-body" id={bodyId} data-testid="chat-tool-call-body">
          {callText ? (
            <div className="tool-call-card-part" data-part={callPart}>
              <span className="tool-call-card-part-label">{callLabel}</span>
              <pre className="tool-call-card-pre mono" data-testid="chat-tool-call-args">
                {callText}
              </pre>
            </div>
          ) : null}
          {resultText ? (
            <div className="tool-call-card-part" data-part="result">
              <span className="tool-call-card-part-label">Result</span>
              <pre className="tool-call-card-pre mono" data-testid="chat-tool-call-result">
                {resultText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
