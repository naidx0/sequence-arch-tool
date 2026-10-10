import { describe, expect, it } from 'vitest';

import { HANDED_OFF_NOTE } from '../agents/askAgent';
import { askNote } from './ConnectedBoard';

/* Round 3 review: "The agent is working in chat." floated over the top of the
   board while the agent chip on the box already said so. */

describe('the board note after Ask an agent', () => {
  it('says nothing when the run went to chat', () => {
    expect(askNote({ ok: true, text: HANDED_OFF_NOTE, handedOff: true })).toBeNull();
  });

  it('still says why when the ask failed, and when an answer came back empty', () => {
    expect(askNote({ ok: false, text: 'No agent is set up.' })).toBe('No agent is set up.');
    expect(askNote({ ok: true, text: '' })).toBe('The agent answered with nothing.');
  });
});
