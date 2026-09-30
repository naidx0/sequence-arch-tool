import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAskToolHintSection } from '../server/askTools.js';

test('ask tool hints name Architecture, Whiteboard, Chat, and Settings — not Task Board', () => {
  /* P7 honesty: Task Board was deleted with v1; naming it in the model hint
     teaches the assistant a surface that does not exist in web2. */
  const work = renderAskToolHintSection('work', 'full').join('\n');
  const code = renderAskToolHintSection('code', 'build').join('\n');
  for (const text of [work, code]) {
    assert.match(text, /Architecture is the source of truth/i);
    assert.match(text, /Whiteboard/i);
    assert.match(text, /Settings holds/i);
    assert.doesNotMatch(text, /Task Board/i);
  }
  assert.doesNotMatch(work, /run_command/);
  assert.match(code, /run_command/);
});

test('THE SHELL IS A BUILD-MODE TOOL, and every other mode is told so', () => {
  /*
   * `propose` was the OUT-OF-THE-BOX DEFAULT and it used to fall through to the
   * whole belt, `run_command` included, while the control that sets it said
   * "changes arrive as proposals you accept". The hint is belt-driven, so the
   * model was also explicitly TOLD it could run commands. Both halves are now
   * one sentence: only Build runs anything.
   *
   * TWO RUNGS SINCE 2026-09-13, and the stale names stay in this loop on
   * purpose. `propose`, `autoEdit` and `full` are no longer values this build
   * can produce — which is exactly why they belong here: an old client or a
   * hand-written body may still send one, and the gate is a membership test on
   * `build` so every one of them loses the shell rather than inheriting it.
   */
  for (const mode of ['plan', undefined, 'propose', 'autoEdit', 'full', 'BUILD']) {
    const hint = renderAskToolHintSection('code', mode as never).join('\n');
    assert.doesNotMatch(
      hint,
      /run_command/,
      `${mode ?? '(no mode)'} must not be told it can run commands`,
    );
  }
  assert.match(renderAskToolHintSection('code', 'build').join('\n'), /run_command/);
});

test('ask tool hints: MCP belt points at Settings editor (D4 honesty)', () => {
  const hint = renderAskToolHintSection('code', 'plan').join('\n');
  assert.match(hint, /Settings → MCP servers edits that file/i);
  assert.doesNotMatch(hint, /does not edit that file yet/i);
});
