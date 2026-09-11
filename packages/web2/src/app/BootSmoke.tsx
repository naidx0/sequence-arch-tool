/**
 * THE BOOT SMOKE SURFACE — Wave 0, items 0.1 and 0.6.
 *
 * This renders NOTHING but the Graphite token layer proving it resolved. It is
 * not a product surface, it is not a preview of one, and no part of it may be
 * lifted into the shell. Wave 2 deletes this component when <Shell/> lands.
 *
 * What it is for, exactly: an app that boots to a blank page cannot tell you
 * whether the token sheet parsed, whether the typeface bound, or whether the
 * theme switch reaches the ground — three failures that look identical from
 * outside and each of which would silently poison every surface built on top.
 * Rendering one specimen of each ramp makes all three answerable at a glance,
 * before there is anything else on screen to confuse the answer.
 *
 * Every value below is read out of tokens/graphite.css through a class in
 * styles/boot.css. There is not one literal colour, size or radius in this
 * file, and item 0.6 fails the build if one appears.
 */

/** The nine rungs of the type ladder. Compact is the only mode: nothing above
 *  26 and nothing below 10, and the line height is PAIRED to the size rather
 *  than derived from a role ratio — 17/22 is 1.29 and 14/21 is 1.50, so every
 *  pairing is read off the ladder and never computed. */
const TYPE_LADDER = [10, 11, 12, 13, 14, 15, 17, 20, 26] as const;

/** Six radius steps and only six. --r-6, --r-12, --r-16 and --r-20 do not
 *  exist; writing one yields an invalid border-radius and a square corner,
 *  deliberately. */
const RADIUS_LADDER = [
  { cls: 'boot-r4', label: '4' },
  { cls: 'boot-r8', label: '8' },
  { cls: 'boot-r10', label: '10' },
  { cls: 'boot-r14', label: '14' },
  { cls: 'boot-r18', label: '18' },
  { cls: 'boot-rfull', label: 'full' },
] as const;

/** The whole hue budget: five verdicts, then the accent. The accent sits last
 *  on purpose — it is here to be checked against the five beside it, because
 *  the one rule it can break is being mistaken for a verdict. */
const HUES = [
  { cls: 'boot-fits', label: 'FITS' },
  { cls: 'boot-spills', label: 'SPILLS' },
  { cls: 'boot-wont', label: "WON'T" },
  { cls: 'boot-unknown', label: 'UNKNOWN' },
  { cls: 'boot-info', label: 'INFO' },
  { cls: 'boot-accent', label: 'ACCENT' },
] as const;

const SURFACES = ['boot-s1', 'boot-s2', 'boot-s3', 'boot-s4'] as const;
const INKS = ['boot-i1', 'boot-i2', 'boot-i3', 'boot-i4'] as const;

export function BootSmoke() {
  return (
    <main className="boot" data-testid="boot-smoke">
      <div className="boot-sheet">
        <header className="boot-head">
          <h1 className="boot-title">Graphite token surface</h1>
          <p className="boot-sub">
            packages/web2 boots. Every specimen below is a var() read out of
            tokens/graphite.css. Nothing here is a product surface.
          </p>
          <span className="boot-stamp" data-testid="boot-stamp">
            {__SEQUENCE_COMMIT__}
          </span>
        </header>

        <section className="boot-section" data-testid="boot-typeface">
          <h2 className="boot-legend">Typeface</h2>
          <p className="boot-rung-spec boot-t17">
            Instrument Sans — the sans carries UI, chrome and prose.
          </p>
          <code className="boot-stamp">
            JetBrains Mono — 0123456789 · every number, id, path and verdict.
          </code>
        </section>

        <section className="boot-section" data-testid="boot-surfaces">
          <h2 className="boot-legend">Surface ramp</h2>
          <div className="boot-row">
            {SURFACES.map((cls, i) => (
              <div key={cls} className={`boot-chip ${cls}`}>
                <span className="boot-chip-name">surface-{i + 1}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="boot-section" data-testid="boot-ink">
          <h2 className="boot-legend">Ink ramp</h2>
          <div className="boot-row">
            {INKS.map((cls, i) => (
              <span key={cls} className={`boot-ink ${cls}`}>
                ink-{i + 1}
              </span>
            ))}
          </div>
        </section>

        <section className="boot-section" data-testid="boot-type">
          <h2 className="boot-legend">Type ladder</h2>
          <div className="boot-ladder">
            {TYPE_LADDER.map((size) => (
              <div key={size} className="boot-rung">
                <span className="boot-rung-key">t-{size}</span>
                <span className={`boot-rung-spec boot-t${size}`}>
                  Grounded, not guessed
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="boot-section" data-testid="boot-radius">
          <h2 className="boot-legend">Radius ramp</h2>
          <div className="boot-row">
            {RADIUS_LADDER.map(({ cls, label }) => (
              <div key={cls} className={`boot-r ${cls}`}>
                {label}
              </div>
            ))}
          </div>
        </section>

        <section className="boot-section" data-testid="boot-hues">
          <h2 className="boot-legend">The hue budget — five verdicts and the accent</h2>
          <div className="boot-row">
            {HUES.map(({ cls, label }) => (
              <span key={cls} className={`boot-verdict ${cls}`}>
                <i className="boot-dot" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </section>

        <p className="boot-note">
          Every hue on screen is a claim about the world, and there are never
          more hues than there are claims. Dividers, headings and chrome are
          never coloured. A red WON&rsquo;T FIT is alarming because it is the
          only red on screen.
        </p>
      </div>
    </main>
  );
}
