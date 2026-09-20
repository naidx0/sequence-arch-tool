/**
 * Does a piece of text tell the reader anything the label did not?
 *
 * One rule, two call sites, because the same mechanical restatement was being
 * shown twice on the same card. `whatItIs` is the analyzer's own one-line
 * summary, and on real repositories it is almost always the node's name with its
 * kind bolted on. Measured on ml-harness through the running app (2026-08-21),
 * over all 300 nodeDetail entries:
 *
 *     exact echo of the label ("db.py" -> "db.py")        293
 *     restates it ("ml-harness" -> "Ml Harness service")    7
 *     genuinely informative                                 0
 *
 * `seqdFromGraph` promotes `whatItIs` to the card's TITLE and `project.ts` puts
 * it in the card's SUBTITLE, so a service card read
 *
 *     SERVICE                 <- the kind chip
 *     Ml Harness service      <- title
 *     Ml Harness service      <- subtitle
 *
 * three lines saying one thing, and the one thing the reader actually needs —
 * `ml-harness`, the name they can grep for — was nowhere on the card.
 *
 * The rule is not "drop whatItIs". A summary that says something new is worth
 * more than a bare identifier, and this keeps it. It only refuses the
 * restatements.
 */

/** Words a summary may add to a label without telling the reader anything. */
const KIND_WORDS = new Set([
  'service',
  'services',
  'module',
  'modules',
  'datastore',
  'datastores',
  'data',
  'store',
  'stores',
  'topic',
  'topics',
  'queue',
  'agent',
  'entry',
  'entrypoint',
  'point',
  'file',
  'files',
  'repo',
  'repository',
  'package',
  'directory',
  'folder',
  'component',
  'components',
]);

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** `longer` is `shorter` with nothing but kind words bolted on. */
function onlyKindWordsBeyond(longer: string, shorter: string): boolean {
  if (!longer.startsWith(`${shorter} `)) return false;
  return longer
    .slice(shorter.length + 1)
    .split(' ')
    .every((w) => KIND_WORDS.has(w));
}

/**
 * True when `text` is worth showing beside `label` — i.e. it is not the label
 * re-cased, re-punctuated, or with its own kind appended.
 *
 * A longer summary that merely OPENS with the label is still informative: the
 * reader learns something after the first few words, so it is kept. Only a line
 * that adds nothing at all is refused, which is what stops this quietly eating
 * real prose.
 */
export function saysMoreThan(label: string, text: string | undefined | null): boolean {
  const t = text?.trim();
  if (!t) return false;

  const l = normalise(label);
  const n = normalise(t);
  if (!n) return false;
  if (!l) return true;
  if (n === l) return false;
  if (onlyKindWordsBeyond(n, l)) return false;
  if (onlyKindWordsBeyond(l, n)) return false;
  return true;
}
