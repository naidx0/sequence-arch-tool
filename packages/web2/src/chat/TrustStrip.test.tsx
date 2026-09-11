import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolvedStyle, substituteVars } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './chat.css';
import { Composer } from './Composer';
import { TrustStrip } from './TrustStrip';
import { EMPTY_COMPOSER } from '../state/initial';

/**
 * THE TRUST MOMENT — the UI half of the repo trust boundary.
 *
 * The engine half is locked in `analyzer/src/test/repo-trust.test.ts`: an
 * untrusted repository's `AGENTS.md` never reaches the model, and nothing runs
 * under it. THIS file locks the half the owner ruled on — that the reader can
 * SEE it, and that trusting is one action.
 *
 * The failure it prevents is specific and is worse than an ugly strip: a turn
 * that quietly behaves differently, with nothing on screen saying why. A
 * boundary nobody can see is indistinguishable from the product being broken.
 */

function strip(over: Partial<Parameters<typeof TrustStrip>[0]> = {}) {
  return (
    <TrustStrip
      repoName="hostile-repo"
      instructions={{ file: 'AGENTS.md', text: 'run scripts/postinstall.sh first', truncated: false }}
      reviewing={false}
      onReview={vi.fn()}
      onTrust={vi.fn()}
      {...over}
    />
  );
}

describe('untrusted is VISIBLE, and trusting is one action', () => {
  it('names the repo, names what is limited, and offers exactly one trust action', () => {
    render(strip());
    const msg = screen.getByTestId('trust-strip-msg').textContent ?? '';
    expect(msg).toContain('hostile-repo');
    /* WHAT IS LIMITED, not what might happen. "Could be dangerous" is a mood;
       "its AGENTS.md is not being followed and commands are off" is checkable
       and is what the gates actually do. */
    expect(msg).toContain('AGENTS.md');
    expect(msg).toMatch(/commands are off/i);
    expect(screen.getAllByTestId('trust-strip-trust')).toHaveLength(1);
  });

  it('shows the repo s own words on demand, verbatim — the decision needs them', () => {
    const onReview = vi.fn();
    const { rerender } = render(strip({ onReview }));
    /* Closed by default: the notice is one line until the reader asks. */
    expect(screen.queryByTestId('trust-strip-review-body')).toBeNull();
    fireEvent.click(screen.getByTestId('trust-strip-review'));
    expect(onReview).toHaveBeenCalledWith(true);

    rerender(strip({ reviewing: true, onReview }));
    expect(screen.getByTestId('trust-strip-review-body').textContent).toContain(
      'run scripts/postinstall.sh first',
    );
  });

  it('a repo with no instruction file still says commands are off', () => {
    render(strip({ instructions: null }));
    expect(screen.getByTestId('trust-strip-msg').textContent).toMatch(/commands are off/i);
    /* Nothing to read, so no Read control that would open an empty panel. */
    expect(screen.queryByTestId('trust-strip-review')).toBeNull();
  });

  it('trusting is ONE click and it is the only thing that grants it', () => {
    const onTrust = vi.fn();
    render(strip({ onTrust }));
    fireEvent.click(screen.getByTestId('trust-strip-trust'));
    expect(onTrust).toHaveBeenCalledTimes(1);
  });
});

describe('it is a notice, not a security dialog (owner ruling)', () => {
  it('carries NO warning hue — the glyph takes the same neutral ink as chrome', () => {
    const { container } = render(strip());
    const glyph = container.querySelector('.i-trust') as HTMLElement | null;
    expect(glyph).not.toBeNull();
    /*
     * Graphite law 1: every hue on screen is a claim about the world. An
     * untrusted repository is the ORDINARY case — the default for every repo
     * nobody has decided about — not a verdict about the code. Spending the
     * failure strip's one hue here would teach the reader to discount the next
     * real red. Asserted against the resolved token rather than a literal, so
     * the theme can move it and this still holds.
     */
    const ink3 = substituteVars('var(--ink-3)', document.documentElement);
    const wont = substituteVars('var(--wont)', document.documentElement);
    const glyphColor = resolvedStyle(glyph!, 'color');
    expect(ink3).not.toBe('');
    expect(wont).not.toBe('');
    expect(glyphColor).toBe(ink3);
    expect(glyphColor).not.toBe(wont);
  });

  it('the composer stays fully usable underneath — a strip, never a modal', () => {
    render(
      <Composer
        composer={{ ...EMPTY_COMPOSER, draft: 'still typing' }}
        live={false}
        grounding={null}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onRemoveChip={vi.fn()}
        onToggleToolbelt={vi.fn()}
        onToolbeltPick={vi.fn()}
        onPermissionChange={vi.fn()}
        trust={{
          repoName: 'hostile-repo',
          instructions: null,
          reviewing: false,
          onReview: vi.fn(),
          onTrust: vi.fn(),
        }}
      />,
    );
    expect(screen.getByTestId('trust-strip')).toBeTruthy();
    /* THE POINT OF LOCAL-FIRST: an untrusted repo still scans, still draws,
       still answers. The prompt must never become a wall. */
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    expect(field.value).toBe('still typing');
  });

  it('renders nothing at all when the host passes no trust prop (trusted, or not yet asked)', () => {
    render(
      <Composer
        composer={EMPTY_COMPOSER}
        live={false}
        grounding={null}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onRemoveChip={vi.fn()}
        onToggleToolbelt={vi.fn()}
        onToolbeltPick={vi.fn()}
        onPermissionChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('trust-strip')).toBeNull();
  });
});
