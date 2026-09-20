import type { WorkOutcome, WorkRow } from '../state/types';
import { Icon } from './Icon';
import { ReasoningGlyph } from './ThinkingMark';
import { formatElapsed, glyphFor, liveLabelFor, livePhaseFor } from './workRowModel';

/* ══════════════════════════════════════════════════════════════════════════
   ONE TOOL ROW — sheet 12.2
   packages/web2/src/chat/WorkRowLine.tsx

   Four slots, left to right: the glyph for what kind of work it was, what it
   did IN THE PAST TENSE, the identifier it did it to, and a right cluster
   carrying the outcome. Only the first two are compulsory.

   The verb is rendered VERBATIM and nothing is appended to it — ON A LANDED
   ROW. Sheet 12.2's Don't is "Exploring 2 files…": present tense means the
   line has to be rewritten a second later, "and a transcript that rewrites
   itself is not a record of anything".

   DECISION 7 amends that for the ONE row that is not yet part of the record:
   while `status === 'running'`, the row shows the present-progressive name of
   the real in-flight call ("Reading session.ts…") with the shimmer treatment,
   and on landing it is REPLACED by this past-tense row — never appended. The
   landed record still rewrites nothing.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WorkRowLineProps {
  row: WorkRow;
  /** True for the bordered affordance form that opens another surface. */
  bordered?: boolean;
  onOpen?: () => void;
  reasoningProvider?: string | null;
}

export function WorkRowLine({ row, bordered = false, onOpen, reasoningProvider }: WorkRowLineProps) {
  const live = row.status === 'running';
  const phase = live ? livePhaseFor(row) : null;
  const reasonRow =
    live &&
    (row.from === 'provider:start' || row.from === 'intent:start' || row.from === 'step:start');
  const classes = [
    'toolrow',
    bordered ? 'bordered' : '',
    live ? 'running live' : '',
    reasonRow ? 'wash' : '',
    phase ? `live-${phase}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      {reasonRow ? <ReasoningGlyph /> : <Icon name={glyphFor(row)} />}
      <span className="name">{live ? liveLabelFor(row, reasoningProvider) : row.verb}</span>
      {row.identifier === null || live ? null : <span className="file">{row.identifier}</span>}
      <RightCluster row={row} bordered={bordered} />
    </>
  );

  if (bordered) {
    return (
      <button
        type="button"
        className={`${classes} opensrow`}
        data-testid="chat-opens-row"
        onClick={onOpen}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classes} data-testid="chat-tool-row" data-live={live ? 'true' : undefined}>
      {body}
    </div>
  );
}

/**
 * The right cluster, and the only place on this row where a hue is legal.
 *
 * Sheet 12.7 lists the whole budget for these surfaces, and the row's share of
 * it is exactly three things: the Measured/Declared provenance tag, the
 * .stat-add/.stat-del pair, and the tick or cross on a command's exit. Nothing
 * else here may be coloured, which is why the cluster is built from the OUTCOME
 * UNION rather than from a pre-formatted string — types.ts keeps
 * `WorkOutcome` a union for exactly this reason: a formatted string cannot be
 * coloured by claim.
 *
 * Rendered as nothing at all when there is nothing to say. An empty right
 * cluster still consumes `margin-left:auto` and pushes the identifier off the
 * row's centre of gravity for no reason.
 */
function RightCluster({ row, bordered }: { row: WorkRow; bordered: boolean }) {
  const hasContent = row.provenance !== null || row.outcome !== null || bordered;
  if (!hasContent) return null;

  return (
    <span className="right">
      {row.provenance === null ? null : (
        <span className={`prov p-${row.provenance}`}>{row.provenance}</span>
      )}
      {row.outcome === null ? null : <Outcome outcome={row.outcome} />}
      {bordered ? <Icon name="chevright" size={12} /> : null}
    </span>
  );
}

/** Soft cap for the right-cluster stdout snippet — full text stays in `title`. */
function truncateCmdOut(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function Outcome({ outcome }: { outcome: WorkOutcome }) {
  switch (outcome.kind) {
    case 'count':
      return (
        <span className="mono">
          {outcome.n} {outcome.unit}
        </span>
      );

    case 'diff':
      /* The + and − counts are the diff's own arithmetic, which is why they take
         the diff vocabulary rather than the verdict one (sheet 12.3, Change).
         A change row never carries an outcome tick: the tick belongs to the gate
         that verified the change, and putting one here would let a proposal wear
         the result of a step that has not run. */
      return (
        <>
          <span className="stat-add">+{outcome.added}</span>
          <span className="stat-del">−{outcome.removed}</span>
        </>
      );

    case 'exit': {
      /* NEVER INVENT A NUMBER. A command whose exit code did not reach us gets
         the word, not a zero — and no tick either, because a tick would be a
         claim that it passed. stdout from `command:log` is measured; omit when
         absent rather than inventing empty output. */
      const out =
        typeof outcome.output === 'string' && outcome.output.trim().length > 0 ? (
          <span className="mono cmd-out" data-testid="chat-command-output" title={outcome.output}>
            {truncateCmdOut(outcome.output)}
          </span>
        ) : null;
      if (outcome.code === null) {
        return (
          <>
            <span className="mono">exit unrecorded</span>
            {out}
          </>
        );
      }
      if (outcome.code === 0) {
        return (
          <>
            <Icon name="check" className="ok" />
            {out}
          </>
        );
      }
      return (
        <>
          <span className="mono">exit {outcome.code}</span>
          <Icon name="x" className="fail" />
          {out}
        </>
      );
    }

    case 'elapsed':
      return <span className="mono">{formatElapsed(outcome.ms)}</span>;

    case 'note':
      return <span>{outcome.text}</span>;
  }
}
