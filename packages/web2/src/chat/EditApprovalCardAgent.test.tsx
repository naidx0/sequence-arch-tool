import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentApproval } from '../agents/runNodeStream';
import { AgentApprovalCard, AgentApprovals, answeredSentence } from './EditApprovalCardAgent';

const fileApproval = (over: Partial<AgentApproval> = {}): AgentApproval => ({
  requestId: 'r-file',
  title: 'Edit /repo/hello.txt',
  toolKind: 'edit',
  proposal: { proposalId: 'r-file', title: 'Edit /repo/hello.txt', rationale: null, files: [{ path: '/repo/hello.txt', diff: '@@ -0,0 +1 @@\n+hello\n' }] },
  decision: null,
  answeredBy: null,
  sending: null,
  ...over,
});

const COMMAND = `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Set-Content -LiteralPath 'hello.txt' -Value 'hello'"`;
const commandApproval = (over: Partial<AgentApproval> = {}): AgentApproval => ({
  requestId: 'r-cmd',
  title: `Run ${COMMAND}`,
  toolKind: 'execute',
  proposal: { proposalId: 'r-cmd', title: `Run ${COMMAND}`, rationale: null, files: [] },
  decision: null,
  answeredBy: null,
  sending: null,
  ...over,
});

describe('agent approval cards', () => {
  it('a file change is the edit card in whole-request mode: Allow and Deny answer the request', () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<AgentApprovalCard approval={fileApproval()} onAnswer={onAnswer} />);
    expect(screen.getByTestId('chat-edit-approval-path').getAttribute('title')).toBe('/repo/hello.txt');
    /* No per-file Accept/Reject: the agent takes one answer for the request. */
    expect(screen.queryByTestId('chat-edit-approval-accept')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-reject')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Allow/ }));
    expect(onAnswer).toHaveBeenLastCalledWith('r-file', 'allow');
    rerender(<AgentApprovalCard approval={fileApproval()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /^Deny/ }));
    expect(onAnswer).toHaveBeenLastCalledWith('r-file', 'deny');
  });

  it('a command with no files shows the command verbatim in mono, with Allow and Deny', () => {
    const onAnswer = vi.fn();
    render(<AgentApprovalCard approval={commandApproval()} onAnswer={onAnswer} />);
    const text = screen.getByTestId('agent-approval-command-text');
    expect(text.tagName).toBe('PRE');
    expect(text.textContent).toBe(COMMAND);
    fireEvent.click(screen.getByTestId('agent-approval-deny'));
    expect(onAnswer).toHaveBeenCalledWith('r-cmd', 'deny');
    fireEvent.click(screen.getByTestId('agent-approval-allow'));
    expect(onAnswer).toHaveBeenCalledWith('r-cmd', 'allow');
  });

  it('answered by the person, the card folds to one row saying so', () => {
    render(<AgentApprovalCard approval={fileApproval({ decision: 'deny', answeredBy: 'person' })} onAnswer={vi.fn()} />);
    const folded = screen.getByTestId('agent-approval-folded');
    expect(folded.dataset.answeredBy).toBe('person');
    expect(screen.getByTestId('agent-approval-answer').textContent).toBe('Denied by you');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a timeout folds it too, and says the person did not answer', () => {
    render(<AgentApprovalCard approval={commandApproval({ decision: 'deny', answeredBy: 'timeout' })} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('agent-approval-folded').dataset.answeredBy).toBe('timeout');
    expect(screen.getByTestId('agent-approval-answer').textContent).toBe('Denied: no answer in time, so the mode decided');
    expect(answeredSentence(fileApproval({ decision: 'allow', answeredBy: 'person' }))).toBe('Allowed by you');
    expect(answeredSentence(fileApproval({ decision: 'deny', answeredBy: 'disconnect' }))).toMatch(/run ended/);
  });

  it('while an answer is in flight the buttons are gone, and the stack draws nothing when empty', () => {
    const { container, rerender } = render(<AgentApprovals approvals={[fileApproval({ sending: 'deny' })]} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('agent-approval-sending').textContent).toBe('Denying…');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<AgentApprovals approvals={[]} onAnswer={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
