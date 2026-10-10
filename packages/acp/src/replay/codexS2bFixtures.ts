/* ══════════════════════════════════════════════════════════════════════════
   S2b FIXTURES: WHAT CODEX OFFERS, A TURN ON A CHOSEN MODEL, A COMPACTION
   NOT RUN LIVE
   packages/acp/src/replay/codexS2bFixtures.ts

   Recording new live sessions needs the owner's yes, so these are built from
   codex-cli 0.153.4's generated protocol types (`codex app-server
   generate-ts`: ModelListResponse / Model / ReasoningEffortOption,
   SkillsListResponse / SkillMetadata, TurnStartParams model + effort,
   ThreadCompactStartParams, ContextCompactedNotification, ThreadItem
   contextCompaction) around the opening the live sessions recorded. Every
   header carries `live: false`.

   capabilities       model/list and skills/list, nothing else
   model-effort-turn  a turn started with a chosen model and effort
   compact            thread/compact/start, which codex runs as a turn
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, Frame, Json } from './fixture.js';

const INIT: Frame[] = [
  { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: null } } },
  { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.153.4', codexHome: '<HOME>/.codex', platformFamily: 'windows', platformOs: 'windows' } } },
  { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
];

const header = (scenario: string, covers: string, source: string, accessMode = 'propose'): Fixture['header'] => ({
  kind: 'header',
  provider: 'codex-app-server',
  scenario,
  covers,
  live: false,
  notRunLive: "Recording a new live session needs the owner's yes. Built from the binary's own generated protocol types around the opening the live sessions recorded.",
  source,
  accessMode,
  answers: [],
  placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
});

const model = (id: string, displayName: string, description: string, efforts: string[], def: string, isDefault = false): Json => ({
  id,
  model: id,
  upgrade: null,
  upgradeInfo: null,
  availabilityNux: null,
  displayName,
  description,
  modelSpecialty: null,
  hidden: false,
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} reasoning` })),
  defaultReasoningEffort: def,
  inputModalities: ['text', 'image'],
  supportsPersonality: false,
  isDefault,
});

export function codexCapabilitiesFixture(): Fixture {
  return {
    header: header(
      'capabilities',
      'what this codex offers the picker and the / menu: model/list (models and their reasoning efforts) and skills/list (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4): ModelListResponse, Model, ReasoningEffortOption, SkillsListResponse, SkillMetadata',
    ),
    frames: [
      ...INIT,
      { t: 42, dir: 'c2s', msg: { id: 2, method: 'model/list', params: {} } },
      {
        t: 120,
        dir: 's2c',
        msg: {
          id: 2,
          result: {
            data: [
              model('gpt-5-codex', 'GPT-5 Codex', 'Tuned for coding agents', ['low', 'medium', 'high'], 'medium', true),
              model('gpt-5', 'GPT-5', 'General reasoning', ['minimal', 'low', 'medium', 'high'], 'medium'),
              { ...model('gpt-old', 'Old', 'Hidden from the picker', ['low'], 'low'), hidden: true },
            ],
            nextCursor: null,
          },
        },
      },
      { t: 121, dir: 'c2s', msg: { id: 3, method: 'skills/list', params: { cwds: ['<CWD>'] } } },
      {
        t: 200,
        dir: 's2c',
        msg: {
          id: 3,
          result: {
            data: [
              {
                cwd: '<CWD>',
                skills: [
                  { name: 'release-notes', description: 'Write release notes from the git log since the last tag', shortDescription: 'Release notes from git', path: '<HOME>/.codex/skills/release-notes/SKILL.md', scope: 'user', enabled: true, pluginId: null },
                  { name: 'disabled-one', description: 'Off', path: '<HOME>/.codex/skills/off/SKILL.md', scope: 'user', enabled: false, pluginId: null },
                ],
                errors: [],
              },
            ],
          },
        },
      },
    ],
  };
}

const turnOf = (id: string, status: string): Json => ({ id, items: [], status, error: null });

export function codexModelEffortFixture(): Fixture {
  const threadId = 'thread-model-1';
  const turnId = 'turn-model-1';
  return {
    header: header(
      'model-effort-turn',
      'a turn started with a chosen model and reasoning effort (TurnStartParams model, effort) (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4): TurnStartParams',
    ),
    frames: [
      ...INIT,
      { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only' } } },
      { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } } } },
      { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId, model: 'gpt-5', effort: 'high' } } },
      { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 900, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-model-1', delta: 'Answered on GPT-5, high effort.' } } },
      { t: 950, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

export function codexCompactFixture(): Fixture {
  const threadId = 'thread-compact-1';
  const turnId = 'turn-compact-1';
  return {
    header: header(
      'compact',
      'thread/compact/start answered {}, then a compaction turn: turn/started, a contextCompaction item, thread/compacted, a smaller token usage, turn/completed (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4): ThreadCompactStartParams/Response, ContextCompactedNotification, ThreadItem contextCompaction, ThreadTokenUsageUpdatedNotification',
    ),
    frames: [
      ...INIT,
      { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only' } } },
      { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } } } },
      { t: 301, dir: 'c2s', msg: { id: 3, method: 'thread/compact/start', params: { threadId } } },
      { t: 310, dir: 's2c', msg: { id: 3, result: {} } },
      { t: 311, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 312, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item: { type: 'contextCompaction', id: 'compact-1' } } } },
      { t: 2400, dir: 's2c', msg: { method: 'item/completed', params: { threadId, turnId, item: { type: 'contextCompaction', id: 'compact-1' } } } },
      { t: 2401, dir: 's2c', msg: { method: 'thread/compacted', params: { threadId, turnId } } },
      {
        t: 2402,
        dir: 's2c',
        msg: {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId,
            turnId,
            tokenUsage: {
              total: { totalTokens: 190_000, inputTokens: 186_000, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 4000, reasoningOutputTokens: 0 },
              last: { totalTokens: 12_000, inputTokens: 11_000, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1000, reasoningOutputTokens: 0 },
              modelContextWindow: 258_400,
            },
          },
        },
      },
      { t: 2450, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}
