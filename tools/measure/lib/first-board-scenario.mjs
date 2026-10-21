/** Explicit browser profiles: a fresh measurement must never inherit a board. */
export function profileForScenario(scenario) {
  if (scenario === 'fresh') return {};
  if (scenario === 'restored-architecture') return {
    'v3.chromeTabs': JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'architecture', minimized: false }], active: 'architecture' }),
  };
  throw new Error(`first-board: unknown scenario ${scenario}`);
}

export function validateBoardSample(sample, ratchet = false) {
  if (!sample.boardVisible || sample.layout !== 'idle') throw new Error('first-board: Architecture must be visible with an applied successful layout');
  if (ratchet && (sample.scenario !== 'restored-architecture' || sample.clicks !== 0 || !sample.landedOnBoard)) {
    throw new Error('first-board: ratchet requires restored Architecture without corrective navigation');
  }
  return true;
}

/** Serialized into the page by Playwright; intentionally closes over no module state. */
export function installFirstBoardObserver() {
      // Scope the edge to a visible real board, including a later arranged
      // mutation. An unrelated or hidden data-layout element is no endpoint.
      const pending = new WeakSet();
      new MutationObserver((ms) => {
        for (const m of ms) {
          if (!m.target.matches('[data-testid="board"]')) continue;
          const v = m.target.getAttribute('data-layout');
          if (m.oldValue === 'laying-out' || v === 'laying-out') pending.add(m.target);
          const rect = m.target.getBoundingClientRect();
          if (pending.has(m.target) && v === 'idle' && m.target.getAttribute('data-arranged') === 'true' && rect.width > 0 && rect.height > 0 && m.target.querySelector('.react-flow__node') && !window.__seqFirstLayout) window.__seqFirstLayout = v;
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-layout', 'data-arranged'], attributeOldValue: true });
}
