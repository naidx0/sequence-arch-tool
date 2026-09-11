/**
 * B2.2 — OpenAI ask tool definitions match the allowlist belt.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ASK_TOOL_ALLOWLIST,
  ASK_TOOL_REGISTRY,
  askToolUiVerb,
  askToolsForJobMode,
  openaiAskToolDefinitions,
} from '../server/askTools.js';
import { anthropicToolDefinitions } from '../server/provider.js';

describe('openaiAskToolDefinitions (B2.2)', () => {
  it('emits one function tool per allowlisted name', () => {
    const defs = openaiAskToolDefinitions();
    assert.equal(defs.length, ASK_TOOL_ALLOWLIST.length);
    assert.deepEqual(
      defs.map((d) => d.function.name),
      [...ASK_TOOL_ALLOWLIST],
    );
    for (const d of defs) {
      assert.equal(d.type, 'function');
      assert.equal(typeof d.function.description, 'string');
      assert.ok(d.function.description.length > 0);
      assert.equal(d.function.parameters.type, 'object');
    }
  });

  it('plan mode omits mutating tools from the native belt', () => {
    const names = askToolsForJobMode('code', 'plan');
    const defs = openaiAskToolDefinitions(names);
    assert.ok(!defs.some((d) => d.function.name === 'propose_files'));
    assert.ok(!defs.some((d) => d.function.name === 'run_command'));
    assert.ok(defs.some((d) => d.function.name === 'read_file'));
  });
});

describe('anthropicToolDefinitions — ONE registry, two wires', () => {
  /*
   * THE DEFECT: `provider.ts` attached tool definitions only when the wire was
   * openai-compatible, and this registry said so out loud — "Anthropic Messages
   * wire is out of scope for this slice… Fence salvage remains the belt." So a
   * claude-sonnet user ran the agent loop on regex fence salvage while a local
   * granite4 got native calls, and repoServer built these definitions for an
   * anthropic config only to drop them on the floor.
   *
   * The property that matters is PARITY: every tool the openai wire can call,
   * the anthropic wire can call, from the same array, with no second list to
   * keep in step.
   */
  it('emits one anthropic tool per openai tool, from the same array', () => {
    const openai = openaiAskToolDefinitions();
    const anthropic = anthropicToolDefinitions(openai);
    assert.equal(anthropic.length, openai.length);
    assert.deepEqual(
      anthropic.map((d) => d.name),
      [...ASK_TOOL_ALLOWLIST],
    );
    for (let i = 0; i < openai.length; i++) {
      assert.equal(anthropic[i]!.description, openai[i]!.function.description);
      /* `function.parameters` IS `input_schema` — same object, renamed field. */
      assert.deepEqual(anthropic[i]!.input_schema, openai[i]!.function.parameters);
    }
  });

  it('a job mode that strips a tool strips it on BOTH wires', () => {
    const names = askToolsForJobMode('code', 'plan');
    const anthropic = anthropicToolDefinitions(openaiAskToolDefinitions(names));
    assert.ok(!anthropic.some((d) => d.name === 'propose_files'));
    assert.ok(!anthropic.some((d) => d.name === 'run_command'));
    assert.ok(anthropic.some((d) => d.name === 'read_file'));
  });
});

describe('ASK_TOOL_REGISTRY (B2.4)', () => {
  it('covers every allowlisted tool with matching uiVerb', () => {
    for (const name of ASK_TOOL_ALLOWLIST) {
      const entry = ASK_TOOL_REGISTRY[name];
      assert.ok(entry, `missing registry entry for ${name}`);
      assert.equal(entry.uiVerb, name);
      assert.equal(askToolUiVerb(name), name);
      assert.equal(typeof entry.description, 'string');
      assert.equal(entry.parameters.type, 'object');
    }
  });

  it('openai defs are projections of the same registry', () => {
    for (const def of openaiAskToolDefinitions()) {
      const entry = ASK_TOOL_REGISTRY[def.function.name];
      assert.equal(def.function.description, entry.description);
      assert.deepEqual(def.function.parameters, entry.parameters);
    }
  });
});
