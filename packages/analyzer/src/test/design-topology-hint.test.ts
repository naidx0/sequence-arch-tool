import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DETAILED_TOPOLOGY_LINE,
  renderAskToolHintSection,
  renderDesignTopologyHintSection,
} from '../server/askTools.js';

/*
 * DETAILED IS THE DEFAULT — owner, 2026-09-22: "remove it everywhere, it should
 * just be detailed always". Both hints used to order a "compact overview or
 * detailed diagram?" question before any drawing; the live battery caught the
 * model obeying it over his own request (Bastion turn 17, and /plan).
 */
describe('topology hints draw the detailed diagram without asking', () => {
  for (const [name, hint] of [
    ['design (no repository)', renderDesignTopologyHintSection().join('\n')],
    ['design, propose-now', renderDesignTopologyHintSection({ proposeNow: true }).join('\n')],
    ['attached repository', renderAskToolHintSection('code', 'autoEdit').join('\n')],
    ['attached repository, plan', renderAskToolHintSection('code', 'plan').join('\n')],
  ] as const) {
    it(`${name}: detailed, and no scoping question`, () => {
      assert.ok(hint.includes(DETAILED_TOPOLOGY_LINE), hint.slice(0, 300));
      assert.doesNotMatch(hint, /clarifying question/i);
      assert.doesNotMatch(hint, /compact overview/i);
      assert.match(hint, /whatItDoes/);
    });
  }
});
