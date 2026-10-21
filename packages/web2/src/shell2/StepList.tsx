/* ══════════════════════════════════════════════════════════════════════════
   THE STEP LIST (Decision 49) — uiarc.dev's thinking and tool progress
   packages/web2/src/shell2/StepList.tsx

   BArc.dc.html `.steps`: one bordered list, one row per step, a check (or a
   spinner while it runs) at the left, the step in words, a quiet count at the
   right. Jaden: "thinking processes... quite clean". A row with an answer
   behind it opens in place (folded by default); a refused call says so in the
   verdict ink, read off the server's own `refused:` prefix.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState, type ReactNode } from 'react';

import { toolCardTitle, toolDoneTitle } from '../chat/stripToolProse';
import { groupConsecutive, summarizeCalls, toolKindOfName } from '../chat/toolGroupModel';
import { useToolDetail } from '../settings/toolDetailPreference';
import { AsciiSpinner } from './AsciiSpinner';
import { S2Icon } from './icons';

export interface StepTool {
  id: string;
  name: string;
  text?: string;
  evidence?: string | null;
}

function countOf(result: string | undefined): string | null {
  if (!result) return null;
  const m = /^(\d+)\s+(matches|callers|files|lines|results|hits)\b/i.exec(result.trim()) ?? /:\s*(\d+)\s+lines?\b/i.exec(result);
  return m ? m[1]! : null;
}

function isRefused(tool: StepTool): boolean {
  const result = tool.text ?? tool.evidence ?? undefined;
  return typeof result === 'string' && /^refused:/i.test(result.trim());
}

/* Focused mode: a run of calls as one row. While the last one runs the row names that step; done, it counts them. */
function StepFold({ tools, running }: { tools: readonly StepTool[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const last = tools[tools.length - 1]!;
  return (
    <li className="s2-st s2-st-fold" data-state={running ? 'running' : 'done'} data-testid="s2-step-fold">
      <button type="button" className="s2-st-row" aria-expanded={open} data-testid="s2-step-fold-toggle" onClick={() => setOpen((v) => !v)}>
        {running ? <AsciiSpinner /> : <S2Icon name="check" small className="s2-ok" />}
        <span className="s2-t" data-testid="s2-step-fold-summary">
          {running ? toolCardTitle(last.name) : summarizeCalls(tools.map((t) => ({ toolKind: toolKindOfName(t.name) })))}
        </span>
        <S2Icon name={open ? 'chev' : 'chevr'} small className="s2-st-chev" />
      </button>
      {open ? (
        <ol className="s2-steps" data-testid="s2-step-fold-body">
          {tools.map((tool, i) => (
            <StepRow key={tool.id} tool={tool} running={running && i === tools.length - 1} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function StepRow({ tool, running }: { tool: StepTool; running: boolean }) {
  const [open, setOpen] = useState(false);
  const result = tool.text ?? tool.evidence ?? undefined;
  const refused = isRefused(tool);
  const count = countOf(result);
  /* A call that has finished reads in the past tense: "Edited a file", never "Calling edit_file". */
  const title = running ? toolCardTitle(tool.name) : refused ? `Refused ${tool.name}` : toolDoneTitle(tool.name);
  const body = result && result.trim() && result.trim() !== tool.name ? result.trim() : null;
  return (
    <li className="s2-st" data-state={running ? 'running' : refused ? 'refused' : 'done'} data-testid="s2-step">
      <button
        type="button"
        className="s2-st-row"
        aria-expanded={body ? open : undefined}
        disabled={!body}
        onClick={() => setOpen((v) => !v)}
        title={tool.name}
      >
        {running ? <AsciiSpinner /> : refused ? <S2Icon name="x" small className="s2-del" /> : <S2Icon name="check" small className="s2-ok" />}
        <span className="s2-t">{title}</span>
        {count ? <span className="s2-mono s2-meta">{count}</span> : null}
        {body ? <S2Icon name={open ? 'chev' : 'chevr'} small className="s2-st-chev" /> : null}
      </button>
      {open && body ? <pre className="s2-st-body">{body}</pre> : null}
    </li>
  );
}

/** Tools as B's step rows; `running` spins the last one. `lead` rows (a thought) sit first. */
export function StepList({ tools, running = false, lead, testId = 'v3-tool-timeline' }: { tools: readonly StepTool[]; running?: boolean; lead?: ReactNode; testId?: string }) {
  const mode = useToolDetail();
  if (tools.length === 0 && !lead) return null;
  const runs = groupConsecutive(tools, mode, (t) => !isRefused(t));
  return (
    <ol className="s2-steps" data-testid={testId}>
      {lead}
      {runs.map((run) => {
        const isLast = run[run.length - 1] === tools[tools.length - 1];
        return run.length > 1 ? (
          <StepFold key={`fold-${run[0]!.id}`} tools={run} running={running && isLast} />
        ) : (
          <StepRow key={run[0]!.id} tool={run[0]!} running={running && isLast} />
        );
      })}
    </ol>
  );
}
