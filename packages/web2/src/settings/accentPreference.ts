/* ══════════════════════════════════════════════════════════════════════════
   WHICH ACCENT IS PAINTED — AND WHITE IS NOW THE ONE
   packages/web2/src/settings/accentPreference.ts

   The owner, 2026-09-18, after seeing gold and white side by side on the same
   screens: "I like the white a lot more, it looks a lot more professional…
   easier on the eyes… let's set white as our main thing."
   (GRAPHITE-DECISIONS.md Decision 30; docs/research/walk-4-white-glass-plan.md
   §1 is the plan of record.) The day before, the ask that produced the variant
   at all: "I think it'd be cleaner if it was white instead of yellow, and a bit
   more transparency on the liquid glass."

   GOLD IS NOT DELETED, it is the PREVIOUS look — Settings still reaches it, so
   the comparison can be repeated rather than remembered.

   THE DEFAULT MOVED; THE MECHANISM DID NOT. It is still ONE ATTRIBUTE on the
   root element — `data-accent` — and the whole of the variant is still one
   block in tokens/graphite.css (§5b). `gold` REMOVES the attribute rather than
   setting it to "gold", because `[data-accent="gold"]` would be a second
   spelling of a state no CSS matches. What changed is which way an UNANSWERED
   question falls: with nothing stored, `readAccent` says white and the boot
   path paints the attribute before the first frame.

   PURE, with storage injected, so the decision is answerable without a
   browser — the same shape as `notifyPreference.ts` next door and for the same
   reason: a preference that can only be checked by rendering a panel is a
   preference nobody checks.

   THE PRE-PAINT COPY IS IN index.html AND THAT IS DELIBERATE. A module cannot
   run before the first frame; an inline script can. index.html reads this same
   key and sets this same attribute before the body exists, exactly as it
   already does for `seq.theme`, and `applyAccent` here is what keeps the two
   agreeing on every later change. If the key below moves, that script moves
   with it — it is named in a comment at both ends.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where the choice lives. Namespaced like every other key this app sets. */
export const ACCENT_KEY = 'sequence.accent';

export const ACCENTS = ['gold', 'white', 'blue'] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * BLUE IS WHAT SHIPS, as of 2026-09-18 evening (Decision 32): the Lovable
 * look — its greys, its blue, Inter — on the Decision 31 glass. White (the
 * afternoon's look) and gold (the first) stay reachable from Settings.
 *
 * Earlier the same day, Decision 30 had moved the default to white:
 *
 * This constant and the DOM's own default now DISAGREE on purpose: no attribute
 * is gold, and the product's default is white, so somebody has to say so before
 * the first frame. `index.html`'s inline script does it for frame one and
 * `main.tsx` does it for everything after; both read the key below.
 */
export const DEFAULT_ACCENT: Accent = 'blue';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isAccent(value: unknown): value is Accent {
  return (ACCENTS as readonly unknown[]).includes(value);
}

/**
 * The stored choice, or white.
 *
 * ANYTHING UNREADABLE IS THE SHIPPING DEFAULT. A corrupt value, a key written
 * by an older build, a denied storage — none of them may drop a person into the
 * previous look they never asked for. The failure direction is unchanged; the
 * thing it fails toward is now white.
 *
 * A STORED `'gold'` STILL APPLIES. Everyone who switched before today keeps
 * what they switched to.
 */
export function readAccent(store: Store | undefined = storage()): Accent {
  try {
    const raw = store?.getItem(ACCENT_KEY);
    return isAccent(raw) ? raw : DEFAULT_ACCENT;
  } catch {
    /* Storage can be denied outright. That costs the preference, never the app. */
    return DEFAULT_ACCENT;
  }
}

export function writeAccent(accent: Accent, store: Store | undefined = storage()): void {
  try {
    store?.setItem(ACCENT_KEY, accent);
  } catch {
    /* Quota, or denied. The switch still moves on screen for this session. */
  }
}

/**
 * Put the choice on the element the token sheet selects.
 *
 * GOLD DELETES THE ATTRIBUTE. `[data-accent="gold"]` would be a second spelling
 * of a state no CSS matches. The token sheet's §5b is keyed on
 * `[data-accent="white"]`, so the attribute is the whole of the white look and
 * removing it is the whole of the rollback to gold — that is why this function
 * is CALLED AT BOOT even when nothing was ever stored.
 */
export function applyAccent(accent: Accent, root: HTMLElement | undefined = documentRoot()): void {
  if (!root) return;
  if (accent === 'gold') delete root.dataset.accent;
  else root.dataset.accent = accent;
}

function documentRoot(): HTMLElement | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}

/** Store it and paint it, which is every caller's real intent. */
export function chooseAccent(
  accent: Accent,
  store: Store | undefined = storage(),
  root: HTMLElement | undefined = documentRoot(),
): void {
  writeAccent(accent, store);
  applyAccent(accent, root);
}
