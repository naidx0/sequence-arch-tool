import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAskToolHintSection } from '../server/askTools.js';

test('ask tool hints name Architecture, Whiteboard, Chat, and Settings — not Task Board', () => {
  /* P7 honesty: Task Board was deleted with v1; naming it in the model hint
     teaches the assistant a surface that does not exist in web2. */
  const work = renderAskToolHintSection('work', 'full').join('\n');
  const code = renderAskToolHintSection('code', 'full').join('\n');
  for (const text of [work, code]) {
    assert.match(text, /Architecture is the source of truth/i);
    assert.match(text, /Whiteboard/i);
    assert.match(text, /Settings holds/i);
    assert.doesNotMatch(text, /Task Board/i);
  }
  assert.doesNotMatch(work, /run_command/);
  assert.match(code, /run_command/);
});

test('THE SHELL IS A FULL-MODE TOOL, and Propose is told so', () => {
  /*
   * Propose is the OUT-OF-THE-BOX DEFAULT and it used to fall through to the
   * whole belt, `run_command` included, while the control that sets it says
   * "Changes arrive as proposals you accept". The hint is belt-driven, so the
   * model was also explicitly TOLD it could run commands. Both halves of that
   * are now the same sentence: only Full runs anything.
   */
  for (const mode of ['propose', 'autoEdit', 'plan', undefined]) {
    const hint = renderAskToolHintSection('code', mode).join('\n');
    assert.doesNotMatch(
      hint,
      /run_command/,
      `${mode ?? '(no mode)'} must not be told it can run commands`,
    );
  }
  assert.match(renderAskToolHintSection('code', 'full').join('\n'), /run_command/);
});

test('ask tool hints: MCP belt points at Settings editor (D4 honesty)', () => {
  const hint = renderAskToolHintSection('code', 'propose').join('\n');
  assert.match(hint, /Settings → MCP servers edits that file/i);
  assert.doesNotMatch(hint, /does not edit that file yet/i);
});
