import assert from 'node:assert';
import { test } from 'node:test';
import {
  parseAiRoles,
  resolveRoleConfig,
  shouldConsultAdvisor,
  parseAdvisorReply,
  buildAdvisorPrompt,
  ADVISOR_ROLE_PROMPT_MARKER,
} from '../server/modelRoles.js';
import {
  validateAiConfig,
  redactAiConfig,
  type AiConfig,
} from '../server/provider.js';
import { inferAskTarget } from '../server/inferAskTarget.js';

/**
 * MADR `docs/decisions/model-roles.md` locking tests. Roles are ADDITIVE: a
 * missing role keeps chat working; an advisor with its own key is redacted to
 * `••••`+last4 and never echoed raw; same-model+host advisor is skipped.
 */

const ADVISOR_KEY = 'sk-advisor-secret-1234';

function advisorCfg(): AiConfig {
  return {
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
    roles: {
      advisor: {
        model: 'gpt-advisor',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: ADVISOR_KEY,
      },
    },
  };
}

/* ============================================================ validateAiConfig ===== */

test('validateAiConfig: roles.advisor.model + own apiKey accepted; redact is ••••last4; raw key absent', () => {
  const { config, error } = validateAiConfig({
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
    roles: {
      advisor: { model: 'gpt-advisor', provider: 'openai-compatible', baseUrl: 'https://api.openai.com', apiKey: ADVISOR_KEY },
    },
  });
  assert.ok(config, error);
  assert.ok(config!.roles?.advisor);
  assert.strictEqual(config!.roles!.advisor!.model, 'gpt-advisor');
  assert.strictEqual(config!.roles!.advisor!.apiKey, ADVISOR_KEY, 'stored verbatim (only redacted on read)');

  const red = redactAiConfig(config!) as {
    apiKey: string;
    roles?: { advisor?: { apiKey?: string } };
  };
  assert.strictEqual(red.apiKey, '••••' + 'sk-test'.slice(-4));
  assert.ok(red.roles?.advisor?.apiKey, 'advisor key redacted');
  assert.strictEqual(red.roles!.advisor!.apiKey, '••••' + ADVISOR_KEY.slice(-4));
  assert.ok(!JSON.stringify(red).includes(ADVISOR_KEY), 'raw advisor key never present in redacted view');
});

test('validateAiConfig: missing roles still valid (local-first path intact)', () => {
  const { config, error } = validateAiConfig({
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
  });
  assert.ok(config, error);
  assert.strictEqual(config!.roles, undefined);
  const red = redactAiConfig(config!) as { roles?: unknown };
  assert.strictEqual(red.roles, undefined);
});

test('validateAiConfig: default mode is byte-identical (no roles on that path)', () => {
  const { config, error } = validateAiConfig({ mode: 'default' });
  assert.ok(config, error);
  assert.strictEqual(config!.mode, 'default');
  assert.strictEqual(config!.roles, undefined, 'default mode never carries roles');
  // Even if a caller tries to attach roles to a default-mode body, they are dropped.
  const withRoles = validateAiConfig({ mode: 'default', roles: { advisor: { model: 'x' } } });
  assert.ok(withRoles.config);
  assert.strictEqual(withRoles.config!.roles, undefined);
});

test('validateAiConfig: empty-model role skipped; unknown role ignored', () => {
  const { config, error } = validateAiConfig({
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
    roles: {
      advisor: { model: '' },
      vision: { model: 'gpt-vision' },
      // unknown role keys must be ignored, not error
      smol: { model: 'cheap' } as never,
    },
  });
  assert.ok(config, error);
  assert.strictEqual(config!.roles?.advisor, undefined, 'empty-model advisor skipped');
  assert.ok(config!.roles?.vision);
  assert.strictEqual(config!.roles!.vision!.model, 'gpt-vision');
});

/* ============================================================ shouldConsultAdvisor ===== */

test('shouldConsultAdvisor: false when same model+provider+baseUrl as default', () => {
  const cfg: AiConfig = {
    provider: 'openai-compatible',
    model: 'deepseek-chat',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com',
    roles: {
      // advisor inherits default model+host (only apiKey differs) → same endpoint → skip
      advisor: { model: 'deepseek-chat', apiKey: 'sk-advisor' },
    },
  };
  assert.strictEqual(shouldConsultAdvisor(cfg), false);
});

test('shouldConsultAdvisor: true when advisor model differs', () => {
  assert.strictEqual(shouldConsultAdvisor(advisorCfg()), true);
});

test('shouldConsultAdvisor: false when advisor unbound', () => {
  const cfg: AiConfig = { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' };
  assert.strictEqual(shouldConsultAdvisor(cfg), false);
});

test('resolveRoleConfig: openai-compatible role without baseUrl → null', () => {
  const cfg: AiConfig = {
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
    roles: {
      // advisor switches to openai-compatible but supplies no baseUrl and the
      // default (anthropic) has none → unusable → null
      advisor: { model: 'gpt-advisor', provider: 'openai-compatible' },
    },
  };
  assert.strictEqual(resolveRoleConfig(cfg, 'advisor'), null);
});

test('resolveRoleConfig: strips roles from the resolved config', () => {
  const resolved = resolveRoleConfig(advisorCfg(), 'advisor');
  assert.ok(resolved);
  assert.strictEqual(resolved!.roles, undefined, 'resolved config never re-enters role resolution');
  assert.strictEqual(resolved!.model, 'gpt-advisor');
  assert.strictEqual(resolved!.provider, 'openai-compatible');
  assert.strictEqual(resolved!.apiKey, ADVISOR_KEY, 'apiKey inherits from role binding');
});

/* ============================================================ parseAdvisorReply ===== */

test('parseAdvisorReply: parses JSON object with severity + note', () => {
  const note = parseAdvisorReply('{"severity":"blocker","note":"do not ship"}');
  assert.strictEqual(note.severity, 'blocker');
  assert.strictEqual(note.note, 'do not ship');
});

test('parseAdvisorReply: tolerates markdown fences', () => {
  const note = parseAdvisorReply('```json\n{"severity":"concern","note":"risky"}\n```');
  assert.strictEqual(note.severity, 'concern');
  assert.strictEqual(note.note, 'risky');
});

test('parseAdvisorReply: invalid severity falls back to aside', () => {
  const note = parseAdvisorReply('{"severity":"critical","note":"x"}');
  assert.strictEqual(note.severity, 'aside');
});

test('parseAdvisorReply: malformed JSON → aside + truncated text, never throws', () => {
  const note = parseAdvisorReply('this is not json at all');
  assert.strictEqual(note.severity, 'aside');
  assert.ok(note.note.includes('this is not json'));
});

test('parseAdvisorReply: note capped at 280 chars', () => {
  const long = 'x'.repeat(500);
  const note = parseAdvisorReply(`{"severity":"aside","note":"${long}"}`);
  assert.strictEqual(note.note.length, 280);
});

test('buildAdvisorPrompt: tiny JSON-only prompt with marker; worker truncated to 4000', () => {
  const worker = 'W'.repeat(5000);
  const prompt = buildAdvisorPrompt('How does routing work?', worker);
  assert.ok(prompt.includes(ADVISOR_ROLE_PROMPT_MARKER));
  assert.ok(prompt.includes('How does routing work?'));
  // worker text truncated to 4000 chars
  assert.ok(prompt.includes('W'.repeat(4000)));
  assert.ok(!prompt.includes('W'.repeat(4001)), 'worker text truncated to 4000 chars');
  assert.ok(prompt.includes('severity'));
});

/* ============================================================ inferAskTarget ===== */

test('inferAskTarget: explicit wins', () => {
  assert.strictEqual(inferAskTarget('draw on the canvas', { explicit: 'architecture' }), 'architecture');
  assert.strictEqual(inferAskTarget('explain the services', { explicit: 'canvas' }), 'canvas');
});

test('inferAskTarget: canvas word routes to canvas', () => {
  assert.strictEqual(inferAskTarget('sketch artifact the new flow'), 'canvas');
  assert.strictEqual(inferAskTarget('open the whiteboard'), 'canvas');
  assert.strictEqual(inferAskTarget('freehand a diagram'), 'canvas');
  assert.strictEqual(inferAskTarget('use the tldraw surface'), 'canvas');
});

test('inferAskTarget: default architecture when nothing matches', () => {
  assert.strictEqual(inferAskTarget('how does the gateway route orders'), 'architecture');
  assert.strictEqual(inferAskTarget('how does routing work', { recommended: 'canvas' }), 'canvas');
  assert.strictEqual(inferAskTarget('explain services'), 'architecture');
});
