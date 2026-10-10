/* The harness work's UI reuses the app's own controls (owner rule): no bespoke button, pill or card classes. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('new UI elements reuse the app components', () => {
  it('the answers are .s2-btn.s2-btn-sm, the triggers .s2-ibtn', () => {
    expect(src('chat/RefineNoteCard.tsx')).not.toMatch(/<button type="button" (disabled|onClick)/);
    expect(src('chat/AgentRunThread.tsx')).toContain('className="s2-btn s2-btn-sm" data-testid="asks-again"');
    expect(src('chat/EditFromHere.tsx')).toContain('s2-ibtn s2-ibtn-sm s2-edit-from');
    expect(src('chat/AgentChatLayer.tsx')).toContain('s2-btn s2-btn-sm" data-testid="chat-show-older"');
    expect(src('chat/VisualActions.tsx')).toContain('s2-ibtn s2-ibtn-sm dgm-act');
    expect(src('fanout/FanoutMenu.tsx')).not.toMatch(/fo-btn|fo-x/);
    expect(src('fanout/FanoutCompare.tsx')).not.toMatch(/fo-btn|fo-link|fo-confirm|fo-actions/);
  });
  it('the bespoke button rules are gone', () => {
    expect(src('chat/refineNote.css')).not.toMatch(/\.s2-note button/);
    expect(src('chat/editFromHere.css')).not.toMatch(/\.s2-edit-undo button/);
    expect(src('shell2/chat2.css')).not.toContain('.s2-asks-again');
    expect(src('fanout/fanout.css')).not.toMatch(/\.fo-btn|\.fo-x\b|\.fo-link/);
    expect(src('chat/diagramBlock.css')).not.toMatch(/\.dgm-open \{/);
  });
});
