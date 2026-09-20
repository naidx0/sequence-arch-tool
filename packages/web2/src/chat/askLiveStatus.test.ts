import { describe, expect, it } from 'vitest';

import { inFlight } from './fixtures';
import {
  DEFAULT_MAX_ASK_ROUNDS,
  DESIGN_DRAW_ASK_TOOL_ROUNDS,
  PROVIDER_STALL_MESSAGE,
  PROVIDER_STALL_THRESHOLD_MS,
  deriveAskLiveStatus,
  formatRoundTimer,
  isDesignShortPathAsk,
  isDrawishAskQuestion,
  resolveAskRoundCap,
  shouldShowProviderStall,
} from './askLiveStatus';

describe('resolveAskRoundCap — live Round k/n denominator', () => {
  it('defaults to the everyday ceiling', () => {
    expect(resolveAskRoundCap({ question: 'what calls auth?', designMode: false })).toBe(
      DEFAULT_MAX_ASK_ROUNDS,
    );
  });

  it('clamps any drawish question to the short path (B1.2 — matches analyzer)', () => {
    expect(
      resolveAskRoundCap({
        question: 'show me the breakdown on the board',
        designMode: false,
      }),
    ).toBe(DESIGN_DRAW_ASK_TOOL_ROUNDS);
  });
});

describe('isDesignShortPathAsk', () => {
  it('matches drawish questions regardless of design mode', () => {
    expect(isDrawishAskQuestion('sketch the API')).toBe(true);
    expect(isDrawishAskQuestion('show me the breakdown on the board')).toBe(true);
    expect(isDesignShortPathAsk({ designMode: true, question: 'sketch the API' })).toBe(true);
    expect(
      isDesignShortPathAsk({ designMode: false, question: 'show me the breakdown on the board' }),
    ).toBe(true);
    expect(isDesignShortPathAsk({ designMode: true, question: 'what is auth?' })).toBe(false);
  });
});

describe('formatRoundTimer', () => {
  it('renders Round k/n · elapsed from turn start', () => {
    expect(formatRoundTimer(1, 8, 12_000)).toBe('Round 1/8 · 12s');
    expect(formatRoundTimer(2, 2, 45_000)).toBe('Round 2/2 · 45s');
  });
});

describe('shouldShowProviderStall', () => {
  it('stays hidden while activity is recent', () => {
    const now = 100_000;
    expect(shouldShowProviderStall(now - 10_000, now, true)).toBe(false);
  });

  it('shows after the threshold without blaming the board', () => {
    const now = 200_000;
    expect(shouldShowProviderStall(now - PROVIDER_STALL_THRESHOLD_MS, now, true)).toBe(true);
    expect(shouldShowProviderStall(now - PROVIDER_STALL_THRESHOLD_MS - 1, now, true)).toBe(true);
  });

  it('clears when the turn is no longer live', () => {
    const now = 300_000;
    expect(shouldShowProviderStall(now - 60_000, now, false)).toBe(false);
  });
});

describe('deriveAskLiveStatus', () => {
  it('shows live round count from provider starts and elapsed wall time', () => {
    const status = deriveAskLiveStatus(
      inFlight({
        startedAt: 1_000,
        providerRound: 2,
        roundCap: 8,
        lastActivityAt: 11_000,
      }),
      13_000,
    );
    expect(status.roundTimer).toEqual({ current: 2, max: 8, elapsedMs: 12_000 });
    expect(status.stallNotice).toBeNull();
  });

  it('surfaces the provider stall line after quiet', () => {
    const status = deriveAskLiveStatus(
      inFlight({
        startedAt: 0,
        providerRound: 1,
        roundCap: 2,
        lastActivityAt: 1_000,
      }),
      1_000 + PROVIDER_STALL_THRESHOLD_MS,
    );
    expect(status.stallNotice).toBe(PROVIDER_STALL_MESSAGE);
  });
});
