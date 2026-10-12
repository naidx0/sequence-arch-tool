import { useEffect, useState } from 'react';
import { MAC_AGENT_PROMPT } from '@/data/macPrompt';

/**
 * THE EASIEST MAC INSTALL (owner, 2026-10-11): a prompt a Mac owner pastes into
 * their own coding agent, which downloads the latest Apple silicon build,
 * checks its SHA-256, installs it and opens it. The text lives in
 * data/macPrompt.ts (mirrored from docs/install/mac-agent-prompt.md) and holds
 * no version number: the agent resolves the latest tag itself.
 *
 * Open on a Mac; a closed disclosure everywhere else, so the Windows page keeps
 * its shape and a Mac owner reading on another machine can still find it.
 */

export type CopyOutcome = 'copied' | 'selected';
type CopyStatus = 'idle' | CopyOutcome;

/**
 * Write the prompt to the clipboard. When the write is blocked (insecure origin or
 * permission), select the prompt text instead so Cmd+C works, and report 'selected'.
 */
export async function copyPrompt(
  write: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
  select: () => void = selectPromptText,
): Promise<CopyOutcome> {
  try {
    await write(MAC_AGENT_PROMPT);
    return 'copied';
  } catch {
    select();
    return 'selected';
  }
}

/** The button label for each copy outcome. */
export function copyButtonLabel(status: CopyStatus): string {
  if (status === 'copied') return 'Copied';
  if (status === 'selected') return 'Selected. Press Cmd+C';
  return 'Copy prompt';
}

function selectPromptText() {
  const el = document.getElementById('mac-agent-prompt');
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function MacAgent({ open }: { open: boolean }) {
  const [status, setStatus] = useState<CopyStatus>('idle');

  // The button shows the outcome for about two seconds, then returns to "Copy prompt".
  useEffect(() => {
    if (status === 'idle') return;
    const t = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [status]);

  const copy = async () => {
    setStatus(await copyPrompt());
  };

  return (
    <details className="lt-mac" open={open} data-testid="mac-agent">
      <summary className="lt-mac-summary">Easiest on a Mac: give this to your agent</summary>
      <div className="lt-mac-body">
        <p className="lt-mac-lede">
          Paste this into Claude Code or Codex on your Mac. It downloads the latest Apple silicon
          build, checks it against the published checksum, installs it and opens it.
        </p>
        <pre id="mac-agent-prompt" className="lt-mac-prompt" tabIndex={0}>
          {MAC_AGENT_PROMPT}
        </pre>
        <div className="lt-mac-actions">
          <button type="button" className="lt-btn lt-btn-ink" onClick={copy} aria-live="polite">
            {copyButtonLabel(status)}
          </button>
        </div>
      </div>
    </details>
  );
}
