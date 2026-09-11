import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  renderAskToolHintSection,
  renderDesignTopologyHintSection,
} from '../server/askTools.js';

describe('design topology hints ask detail level before dumping', () => {
  it('renderDesignTopologyHintSection instructs a clarifying question', () => {
    const hint = renderDesignTopologyHintSection().join('\n');
    assert.match(hint, /clarifying question/i);
    assert.match(hint, /compact overview/i);
    assert.match(hint, /detailed diagram/i);
    assert.match(hint, /whatItDoes/);
  });

  it('renderAskToolHintSection teaches the same contract for attached repos', () => {
    const hint = renderAskToolHintSection('code', 'autoEdit').join('\n');
    assert.match(hint, /clarifying question/i);
    assert.match(hint, /propose_topology/);
    assert.match(hint, /whatItDoes/);
  });
});
