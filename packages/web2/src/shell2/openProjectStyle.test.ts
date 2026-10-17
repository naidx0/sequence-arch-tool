import { expect, it } from 'vitest';
import bootCssRaw from '../boot/boot.css?raw';
import v3CssRaw from '../v3/v3.css?raw';

/* A Windows checkout has CRLF line ends; the patterns below are written with \n. */
const bootCss = bootCssRaw.replace(/\r\n/g, '\n');
const v3Css = v3CssRaw.replace(/\r\n/g, '\n');

/* Round 9 (ask 23): the Open-project screen is its own floating card. The overlay
   panel around it steps aside and hides its X, so the card's own close is the only one. */
it('opens a single card with one close control and pill buttons', () => {
  const panel = v3Css.match(/\.v3-overlay-scrim\[data-kind="attach"\] \.v3-overlay-panel \{([^}]+)\}/)?.[1];
  expect(panel).toContain('padding: 0;');
  expect(panel).toContain('background: transparent;');
  expect(panel).toContain('box-shadow: none;');
  expect(v3Css.match(/\.v3-overlay-scrim\[data-kind="attach"\] \.v3-overlay-close \{([^}]+)\}/)?.[1]).toContain('display: none;');
  expect(bootCss.match(/\n\.attach \{([^}]+)\}/)?.[1]).toContain('box-shadow:');
  expect(bootCss.match(/\n\.attach-primary,\n\.attach-secondary \{([^}]+)\}/)?.[1]).toContain('border-radius: var(--r-full);');
});
