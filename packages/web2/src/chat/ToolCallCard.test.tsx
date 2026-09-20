import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  ToolCallCard,
  deriveToolCallState,
  isRefusalEvidence,
  refusalReason,
} from './ToolCallCard';

/*
 * A REFUSED CALL USED TO RENDER AS A SUCCESSFUL ONE.
 *
 * The card printed a glyph, a verb and a tool name, and every call — ran,
 * running, turned away — produced exactly those three things. These tests lock
 * the two facts that were missing: which of the three states this call is in,
 * and what it was actually called with.
 *
 * THE REFUSAL STRINGS BELOW ARE COPIED FROM THE SERVER, not invented. They are
 * literal evidence lines out of `packages/analyzer/src/server/askTools.ts` —
 * a test built from a shape that was convenient to write proves nothing about
 * the shape that actually arrives.
 */

const TOOL = { id: 't1', name: 'read_file' };

describe('reading the state off the server, not guessing it', () => {
  it('recognises the prefix every refusal site in askTools writes', () => {
    expect(isRefusalEvidence('refused: read_file missing "path"')).toBe(true);
    expect(isRefusalEvidence('refused: "src/app.ts" not found')).toBe(true);
    // Spacing is not guaranteed — the evidence lines are concatenated by hand.
    expect(isRefusalEvidence('\n  Refused:no space')).toBe(true);
    expect(isRefusalEvidence('read 42 lines of src/app.ts')).toBe(false);
    expect(isRefusalEvidence(undefined)).toBe(false);
  });

  it('lets the server flag OUTRANK the result text', () => {
    // A tool whose legitimate output quotes the word must not be recoloured by
    // its own body; ok === true is the server speaking.
    expect(deriveToolCallState({ ok: true, result: 'refused: is what the log said' })).toBe('done');
    expect(deriveToolCallState({ ok: false, result: 'anything at all' })).toBe('refused');
  });

  it('keeps a call in flight out of every verdict', () => {
    // Half a streamed result must not flip the card red and back again.
    expect(deriveToolCallState({ running: true, result: 'refused: ' })).toBe('running');
    expect(deriveToolCallState({ running: true, ok: false })).toBe('running');
  });

  it('falls back to the string when there is no flag, and to done when there is nothing', () => {
    expect(deriveToolCallState({ result: 'refused: run_command is not a Work-mode default' })).toBe(
      'refused',
    );
    expect(deriveToolCallState({})).toBe('done');
  });
});

describe('the reason put on the card face', () => {
  it('drops the tool name only when the documented dash follows it', () => {
    expect(
      refusalReason('refused: canvas.write_note — AI Canvas tools are not active for this turn', 'canvas.write_note'),
    ).toBe('AI Canvas tools are not active for this turn');
  });

  it('keeps a sentence that runs on from the name INTACT', () => {
    // Cutting the first word off "read_file missing \"path\"" leaves a fragment
    // with no subject. Duplicating the name is the cheaper mistake.
    expect(refusalReason('refused: read_file missing "path"', 'read_file')).toBe(
      'read_file missing "path"',
    );
  });

  it('survives a refusal that never names the tool', () => {
    expect(refusalReason('refused: "src/x.ts" not readable (jail or reserved)', 'read_file')).toBe(
      '"src/x.ts" not readable (jail or reserved)',
    );
  });
});

describe('the three states a reader can actually tell apart', () => {
  it('marks a landed call done', () => {
    render(<ToolCallCard tool={TOOL} result="read 42 lines" />);
    expect(screen.getByTestId('chat-tool-call-card').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('chat-tool-call-state').textContent).toContain('done');
  });

  it('marks a call in flight running', () => {
    render(<ToolCallCard tool={TOOL} running />);
    expect(screen.getByTestId('chat-tool-call-card').getAttribute('data-state')).toBe('running');
  });

  it('marks a refusal refused, and says why ON THE FACE without opening anything', () => {
    render(<ToolCallCard tool={TOOL} result='refused: read_file missing "path"' />);
    const card = screen.getByTestId('chat-tool-call-card');
    expect(card.getAttribute('data-state')).toBe('refused');
    // The distinguishing fact is an attribute, not a colour — a test that read
    // the hue would pass on a card nobody can tell apart in a screenshot.
    expect(screen.getByTestId('chat-tool-call-reason').textContent).toContain('missing "path"');
  });

  it('gives a done and a refused card DIFFERENT readable state, same tool', () => {
    const { unmount } = render(<ToolCallCard tool={TOOL} result="read 42 lines" />);
    const done = screen.getByTestId('chat-tool-call-card').getAttribute('data-state');
    unmount();
    render(<ToolCallCard tool={TOOL} result="refused: whatever" />);
    expect(screen.getByTestId('chat-tool-call-card').getAttribute('data-state')).not.toBe(done);
  });

  it('shows no reason line on a call that was not refused', () => {
    render(<ToolCallCard tool={TOOL} result="read 42 lines" />);
    expect(screen.queryByTestId('chat-tool-call-reason')).toBeNull();
  });
});

describe('the disclosure', () => {
  const ARGS = '{"path":"src/app.ts","maxLines":200}';

  it('is collapsed by default — the card is still a one-line row', () => {
    render(<ToolCallCard tool={TOOL} args={ARGS} result="read 42 lines" />);
    const toggle = screen.getByTestId('chat-tool-call-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('chat-tool-call-body')).toBeNull();
  });

  it('opens onto the arguments AND the result', () => {
    render(<ToolCallCard tool={TOOL} args={ARGS} result="read 42 lines of src/app.ts" />);
    fireEvent.click(screen.getByTestId('chat-tool-call-toggle'));
    expect(screen.getByTestId('chat-tool-call-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('chat-tool-call-args').textContent).toBe(ARGS);
    expect(screen.getByTestId('chat-tool-call-result').textContent).toBe('read 42 lines of src/app.ts');
  });

  it('closes again on a second press', () => {
    render(<ToolCallCard tool={TOOL} args={ARGS} />);
    const toggle = screen.getByTestId('chat-tool-call-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByTestId('chat-tool-call-body')).toBeNull();
  });

  it('RENDERS NO TRIGGER AT ALL when there is nothing behind it', () => {
    // A chevron that opens onto an empty box teaches the reader that the
    // chevron means nothing — a lesson that then applies to every other card.
    render(<ToolCallCard tool={TOOL} />);
    expect(screen.queryByTestId('chat-tool-call-toggle')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('chat-tool-call-card')).toBeTruthy();
  });

  it('treats whitespace-only args and result as nothing to show', () => {
    // `result="\n"` in JSX is a literal backslash and an n, not a newline —
    // an attribute string carries no escapes. The braces are what make this
    // test assert the thing it claims to.
    render(<ToolCallCard tool={TOOL} args="   " result={'\n\t '} detail="  " />);
    expect(screen.queryByTestId('chat-tool-call-toggle')).toBeNull();
  });

  it('opens on a result alone, with no arguments section invented', () => {
    render(<ToolCallCard tool={TOOL} result="read 42 lines" />);
    fireEvent.click(screen.getByTestId('chat-tool-call-toggle'));
    expect(screen.queryByTestId('chat-tool-call-args')).toBeNull();
    expect(screen.getByTestId('chat-tool-call-result')).toBeTruthy();
  });

  it('labels a raw fenced dump as the CALL, never as the arguments', () => {
    // `detail` is the whole dump — name, id and arguments together. Calling it
    // "Arguments" is a small lie a reader comparing fold to wire would catch.
    const dump = '{"name":"read_file","arguments":{"path":"src/app.ts"}}';
    render(<ToolCallCard tool={TOOL} detail={dump} />);
    fireEvent.click(screen.getByTestId('chat-tool-call-toggle'));
    const part = screen.getByTestId('chat-tool-call-args').closest('[data-part]');
    expect(part?.getAttribute('data-part')).toBe('call');
    expect(screen.getByText('Raw call')).toBeTruthy();
  });

  it('prefers real arguments over the raw dump when both arrive', () => {
    render(<ToolCallCard tool={TOOL} args={ARGS} detail="{ everything }" />);
    fireEvent.click(screen.getByTestId('chat-tool-call-toggle'));
    const part = screen.getByTestId('chat-tool-call-args').closest('[data-part]');
    expect(part?.getAttribute('data-part')).toBe('args');
    expect(screen.getByTestId('chat-tool-call-args').textContent).toBe(ARGS);
  });

  it('carries a refusal VERBATIM in the fold while the face summarises it', () => {
    const evidence = 'refused: read_file — "src/x.ts" not readable (jail or reserved)';
    render(<ToolCallCard tool={TOOL} result={evidence} />);
    fireEvent.click(screen.getByTestId('chat-tool-call-toggle'));
    expect(screen.getByTestId('chat-tool-call-result').textContent).toBe(evidence);
    expect(screen.getByTestId('chat-tool-call-reason').textContent).toBe(
      '"src/x.ts" not readable (jail or reserved)',
    );
  });
});

describe('reachable without a mouse', () => {
  it('the trigger is a real button, focusable, and names itself', () => {
    render(<ToolCallCard tool={TOOL} args="{}" />);
    const toggle = screen.getByTestId('chat-tool-call-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    // Accessible name comes from the human verb + state — not the raw mono slug.
    expect(toggle.textContent).toContain('Exploring files');
    expect(toggle.textContent).not.toContain('read_file');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
  });

  it('points aria-controls at the body it actually reveals', () => {
    render(<ToolCallCard tool={TOOL} args="{}" />);
    const toggle = screen.getByTestId('chat-tool-call-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('chat-tool-call-body').id).toBe(toggle.getAttribute('aria-controls'));
  });

  it('keeps the tooltip ONLY where there is no fold to open instead', () => {
    const { unmount } = render(<ToolCallCard tool={TOOL} />);
    expect(screen.getByTestId('chat-tool-call-card').getAttribute('title')).toBe('read_file');
    unmount();
    render(<ToolCallCard tool={TOOL} args="{}" />);
    expect(screen.getByTestId('chat-tool-call-card').getAttribute('title')).toBeNull();
  });
});
