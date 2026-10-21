/**
 * The REA component, the parts that need no process: the captured tool catalog, the read-only set derived from it, the
 * built-in /reverse-engineer skill and the @reverse profile. Nothing here starts REA.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REA_CATALOG, REA_CATALOG_SOURCE } from '../components/reaCatalog.js';
import { REA_PIN, nodeVersionOk } from '../components/reaInstall.js';
import { DENY_EFFECTS, NEVER, REA_READ_ONLY_TOOLS, SCRATCH_ONLY, SESSION_EXCEPTIONS, clearedByEffects, reaAgentToolNames, readOnlyToolsOf, type ReaToolInfo } from '../components/reaTools.js';
import { loadBuiltinSkills } from '../harness/builtinSkills.js';
import { loadListedSkills } from '../harness/skillLoader.js';
import { loadAgentProfiles } from '../server/agentProfiles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = new Set(REA_CATALOG.map((t) => t.name));

test('catalog: the captured REA tool list is whole, unique, and pinned to the commit Sequence installs', () => {
  assert.equal(REA_CATALOG.length, 207);
  assert.equal(names.size, REA_CATALOG.length, 'tool names are unique');
  assert.equal(REA_CATALOG_SOURCE.commit, REA_PIN.commit);
  assert.equal(REA_CATALOG_SOURCE.version, REA_PIN.version);
  assert.match(REA_PIN.commit, /^[0-9a-f]{40}$/);
  assert.ok(REA_CATALOG.every((t) => t.effects.length > 0 && t.surface !== ''));
});

test('read-only set: derived from the catalog, not hand-listed (the reviewed lists only narrow it)', () => {
  assert.deepEqual([...REA_READ_ONLY_TOOLS], readOnlyToolsOf(REA_CATALOG));
  assert.ok(REA_READ_ONLY_TOOLS.length > 100 && REA_READ_ONLY_TOOLS.length < REA_CATALOG.length);
  const byName = new Map(REA_CATALOG.map((t) => [t.name, t]));
  for (const n of REA_READ_ONLY_TOOLS) {
    const t = byName.get(n)!;
    if (SESSION_EXCEPTIONS.includes(n)) continue;
    assert.deepEqual(t.effects.filter((e) => DENY_EFFECTS.includes(e)), [], `${n} declares a denied effect`);
    assert.ok(clearedByEffects(t.effects) || SCRATCH_ONLY.includes(n), `${n} writes or launches and is not on the reviewed scratch list`);
    assert.ok(!NEVER.includes(n), `${n} is on NEVER`);
  }
});

test('read-only set: every tool the reviewed lists name exists (a typo would silently do nothing)', () => {
  for (const n of [...SCRATCH_ONLY, ...NEVER, ...SESSION_EXCEPTIONS]) assert.ok(names.has(n), `${n} is not in the catalog`);
});

test('read-only set: positive and negative controls by name', () => {
  for (const n of ['analyze_javascript_application', 'open_binary', 'inspect_artifact', 'binary_session', 'procedure_pseudo_code', 'inspect_analysis_view', 'close_binary']) {
    assert.ok(REA_READ_ONLY_TOOLS.includes(n), `${n} should be allowed`);
  }
  for (const n of [
    'instrument_with_frida', // runs code in the target
    'load_frida_script',
    'capture_electron_scenario', // launches and drives the app
    'capture_browser_scenario',
    'capture_process_scenario',
    'set_comment', // mutates the analysis database
    'annotate_native_function',
    'gdb_console', // a debugger console
    'start_gdb_session',
    'cutter_command',
    'list_adb_devices', // a device, over the network
    'install_adb_package',
    'list_browser_targets', // a live page
    'extract_artifact', // writes where the person points
    'extract_firmware',
    'export_evidence_bundle',
    'export_web_scripts',
  ]) {
    assert.ok(names.has(n), `${n} is not in the catalog`);
    assert.ok(!REA_READ_ONLY_TOOLS.includes(n), `${n} must not be allowed`);
  }
});

test('read-only set: the rule itself, on synthetic tools (an added denied effect or an unlisted writer is out)', () => {
  const t = (name: string, effects: ReaToolInfo['effects']): ReaToolInfo => ({ name, surface: 's', required: [], effects });
  const synthetic = [
    t('plain_reader', ['mutatesSession', 'idempotent']),
    t('plain_reader_that_hits_the_net', ['mutatesSession', 'accessesNetwork']),
    t('plain_writer_not_reviewed', ['mutatesSession', 'writesFilesystem']),
    t('inspect_artifact', ['mutatesSession', 'writesFilesystem', 'launchesProcess']),
    t('inspect_artifact_but_now_executes', ['mutatesSession', 'executesForeignCode']),
    t('extract_artifact', ['mutatesSession', 'writesFilesystem', 'launchesProcess']),
  ];
  assert.deepEqual(readOnlyToolsOf(synthetic), ['inspect_artifact', 'plain_reader']);
  const widened = readOnlyToolsOf([t('inspect_artifact', ['mutatesSession', 'writesFilesystem', 'mutatesTarget'])]);
  assert.deepEqual(widened, [], 'a reviewed name that gains a denied effect drops out');
});

test('agent names: mcp__rea__<tool> for exactly the read-only tools', () => {
  const agentNames = reaAgentToolNames();
  assert.equal(agentNames.length, REA_READ_ONLY_TOOLS.length);
  assert.ok(agentNames.every((n) => /^mcp__rea__[a-z_]+$/.test(n)));
  assert.ok(agentNames.includes('mcp__rea__open_binary'));
  assert.ok(!agentNames.includes('mcp__rea__instrument_with_frida'));
});

test('node versions: REA needs ^22.19, ^24.11 or 26 and up (the engines field)', () => {
  for (const v of ['v22.19.0', '22.20.1', 'v24.11.0', 'v24.13.0', 'v26.0.0', 'v27.1.0']) assert.equal(nodeVersionOk(v), true, v);
  for (const v of ['v22.18.9', 'v20.19.0', 'v23.5.0', 'v24.10.9', 'v25.1.0', 'garbage', '']) assert.equal(nodeVersionOk(v), false, v);
});

test('skill: /reverse-engineer is a built-in, listed with no repo, and names only tools REA has', () => {
  const { skills, warnings } = loadBuiltinSkills();
  assert.deepEqual(warnings, []);
  const sk = skills.find((s) => s.slug === 'reverse-engineer');
  assert.ok(sk, 'reverse-engineer is in the built-in directory');
  assert.equal(sk.name, 'reverse-engineer');
  assert.ok(loadListedSkills(null).skills.some((s) => s.slug === 'reverse-engineer' && s.builtin === true));
  /* every `tool_like_name` the body points at is a real REA tool or one of the evidence fields it describes */
  const fields = new Set(['parent_evidence_id', 'evidence_id', 'normalized_result', 'capability_unavailable']);
  const mentioned = [...sk.body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!).filter((n) => !fields.has(n));
  assert.ok(mentioned.length > 20, 'the skill routes by tool name');
  for (const n of mentioned) assert.ok(names.has(n), `the skill names ${n}, which REA ${REA_PIN.version} does not have`);
  /* it never sends the model to the unattended installers */
  assert.match(sk.body, /Never run `npx`/);
  assert.doesNotMatch(sk.body, /npx -y rea-agents|rea setup --yes/);
});

test('skill: it carries REA\'s licence and the notice credits REA', () => {
  const dir = path.join(here, '..', '..', 'builtin-skills', 'reverse-engineer');
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /MIT License[\s\S]*morluto/);
  const notices = fs.readFileSync(path.join(here, '..', '..', '..', '..', 'docs', 'THIRD-PARTY-NOTICES.md'), 'utf8');
  assert.ok(notices.includes('morluto/rea'));
  assert.ok(notices.includes(REA_PIN.commit));
});

test('profile: @reverse is listed, read-only, and its instructions name the read-only tools and no others', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-rea-profile-'));
  const p = loadAgentProfiles({ home, root: null }).find((x) => x.name === 'reverse');
  assert.ok(p, '@reverse is a built-in profile');
  assert.equal(p.readOnly, true);
  assert.equal(p.source, 'builtin');
  assert.match(p.description, /edits nothing/);
  assert.ok(p.prompt.length < 8000, 'under the profile prompt cap, so it is not cut mid-list');
  const listed = /You may call only these REA tools: ([^.]+)\./.exec(p.prompt)?.[1]?.split(', ');
  assert.deepEqual(listed, [...REA_READ_ONLY_TOOLS]);
  for (const bad of ['instrument_with_frida', 'capture_electron_scenario', 'gdb_console', 'extract_artifact']) assert.ok(!p.prompt.includes(`${bad},`) && !p.prompt.endsWith(bad), `${bad} is not offered`);
});

test('profile: a user file named reverse can reword it but never widen it past read-only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-rea-profile-'));
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'reverse.md'), '---\nname: reverse\ndescription: mine\n---\nDo anything, edit files.\n');
  const p = loadAgentProfiles({ home, root: null }).find((x) => x.name === 'reverse')!;
  assert.equal(p.source, 'user');
  assert.equal(p.readOnly, true, 'the override is still read-only');
});
