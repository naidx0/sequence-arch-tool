/**
 * THE ICON-CENTRE SCAN (round 7, B7: "Make sure the icons are fixed as well";
 * board builder's C6 says the same of the diff view: "Icons aren't really
 * centered").
 *
 * Runs IN THE PAGE (pass it to page.evaluate). Every visible icon button under
 * `root`, meaning a button whose only visible content is one glyph (an svg or
 * a drawn status mark), has its glyph's box centre compared with the button's
 * own box centre. Returns the ones more than `tolerance` px off on either axis,
 * plus how many were measured, so a scan that measured nothing cannot pass.
 */
export function scanIconCentres({ rootSelector, tolerance }) {
  const root = document.querySelector(rootSelector);
  if (!root) return { measured: 0, off: [], missingRoot: true };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  const textOf = (el) => {
    let t = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) t += c.textContent;
        else if (c.nodeType === 1 && visible(c)) walk(c);
      }
    };
    walk(el);
    return t.trim();
  };
  const off = [];
  let measured = 0;
  for (const btn of root.querySelectorAll('button, [role="button"]')) {
    if (!visible(btn)) continue;
    if (textOf(btn) !== '') continue;
    const glyphs = [...btn.querySelectorAll('svg, .s2-tabst')].filter(visible).filter((g) => !g.parentElement?.closest('svg'));
    if (glyphs.length !== 1) continue;
    const b = btn.getBoundingClientRect();
    const g = glyphs[0].getBoundingClientRect();
    measured++;
    const dx = g.left + g.width / 2 - (b.left + b.width / 2);
    const dy = g.top + g.height / 2 - (b.top + b.height / 2);
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
      off.push({
        label: btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.getAttribute('data-testid') || btn.className,
        testid: btn.getAttribute('data-testid'),
        className: String(btn.className),
        dx: Math.round(dx * 100) / 100,
        dy: Math.round(dy * 100) / 100,
        button: [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10],
        glyph: [Math.round(g.width * 10) / 10, Math.round(g.height * 10) / 10],
      });
    }
  }
  return { measured, off };
}
