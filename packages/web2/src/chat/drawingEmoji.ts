/* NO EMOJI IN A DRAWING. packages/web2/src/chat/drawingEmoji.ts

   The agent is told not to put emoji in a drawing (packages/acp accessMode.ts rule 6) and sometimes does anyway.
   This is the guard at display: the drawn copy loses them, the saved source is never touched.

   WHAT GOES (narrow on purpose): a character with emoji presentation (\p{Emoji_Presentation}: rocket, check mark
   button, ...), any character followed by U+FE0F (the explicit emoji form), regional-indicator flags, skin tones, tag
   sequences, and ZWJ sequences of those, with their joiners and keycap marks.
   WHAT STAYS: arrows U+2190-21FF, U+2900-297F, U+2B00-2B1A and U+27A1, and (c) (r) (tm), even with a U+FE0F after
   them, and every text-presentation symbol (check, cross, star, heart, gear, sun, info, ballot box), CJK, math and
   every other script. A space before an emoji goes with it only when whitespace or the end of the text follows it, so
   "Ship X it" loses a space and "Ship Xit" does not run together.

   WHERE: html is never text-replaced as source (that corrupts script and regex literals, alt and value): the frame's
   own bootstrap (EMOJI_BOOTSTRAP) walks its text nodes and a few attributes, and watches for later changes, so
   script-added text and &#x1F680; entities are caught too. A static page (the Open dialog with scripts off, which cannot
   run a bootstrap) goes through stripEmojiHtml, a parse and walk of the same nodes. svg is walked on the parsed
   drawing (text nodes only); mermaid is replaced in its source text and falls back to the original if that stops
   parsing. */

/* The grammar is unambiguous on purpose (a first version backtracked exponentially on a run of family emoji):
     ATOM   = one of: an emoji-presentation character that is not a skin tone, or a non-alphanumeric character that is
              followed by U+FE0F (its own, disjoint alternative); never a KEEP character
     SUFFIX = any of FE0E FE0F 20E3, a skin tone, a tag character      (the skin tone is counted here only)
     RUN    = ATOM SUFFIX ( ATOM SUFFIX | ZWJ ATOM' SUFFIX )* ZWJ?   (after a ZWJ exactly one atom, then the suffix)
   Every loop alternative starts with a different character class, and nothing after RUN can fail, so a match never
   backtracks into another way of reading the same text. The pattern is `([ nbsp])?(RUN)`; whether the space goes is
   decided in the replace callback (spaceGoes), not by a lookahead. */
const KEEP = String.raw`\u00A9\u00AE\u2122\u2190-\u21FF\u2900-\u297F\u2B00-\u2B1A\u27A1`;
const ATOM = String.raw`(?![${KEEP}])(?!\p{Emoji_Modifier})(?:\p{Emoji_Presentation}|(?!\p{Emoji_Presentation})[^\p{L}\p{N}\s\uFE0E\uFE0F\u20E3\u200D](?=\uFE0F))`;
const ATOM_AFTER_ZWJ = String.raw`(?!\p{Emoji_Modifier})(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})`;
const SUFFIX = String.raw`(?:[\uFE0E\uFE0F\u20E3]|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*`;
const RUN = String.raw`${ATOM}${SUFFIX}(?:${ATOM}${SUFFIX}|\u200D${ATOM_AFTER_ZWJ}${SUFFIX})*\u200D?`;

/** The source of the pattern, shared with the frame's bootstrap so both strip the same set. Group 1 is the optional space before the run. */
export const EMOJI_PATTERN = String.raw`([ \u00A0])?(?:${RUN})`;
const EMOJI_RUN = new RegExp(EMOJI_PATTERN, 'gu');
const STRAY = /[\uFE0F\u20E3]/g;
/** A keycap (1 + FE0F + 20E3) is its digit, not an emoji: it is mapped to the character first. */
const KEYCAP = /([0-9#*])\uFE0F?\u20E3/g;
/** The characters after which a space before an emoji is not a word gap: whitespace, the end, and closing or sentence punctuation. */
export const SPACE_GOES_BEFORE = String.raw`^[\s<>)\]}"'.,;:!?]`;

/** Does the space before an emoji go, given the character that follows the run (undefined at the end)? */
function spaceGoes(next: string | undefined): boolean {
  return next === undefined || new RegExp(SPACE_GOES_BEFORE).test(next);
}

/** True when `text` holds an emoji or pictograph (the same set stripEmoji removes). */
export function hasEmoji(text: string): boolean {
  EMOJI_RUN.lastIndex = 0;
  return EMOJI_RUN.test(text);
}

/** `text` without emoji and pictographs; the same string when there are none. */
export function stripEmoji(text: string): string {
  if (!text) return text;
  return text
    .replace(KEYCAP, '$1')
    .replace(EMOJI_RUN, (m: string, sp: string | undefined, offset: number, whole: string) => (sp && !spaceGoes(whole[offset + m.length]) ? sp : ''))
    .replace(STRAY, '');
}

/** Run `run` on the source without emoji; if that stops it working (a label that was only an emoji), run it on the original. */
export async function withEmojiFallback<T>(source: string, run: (s: string) => Promise<T>): Promise<T> {
  const stripped = stripEmoji(source);
  if (stripped === source) return run(source);
  try {
    return await run(stripped);
  } catch {
    return run(source);
  }
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
export const EMOJI_ATTRS = ['alt', 'value', 'title', 'placeholder', 'aria-label'] as const;

/** Strip the text nodes under `root` (never script or style) and, when `attrs`, the few text attributes. Returns whether anything changed. */
export function stripEmojiIn(root: Node, attrs = true): boolean {
  const doc = root.ownerDocument ?? (root as Document);
  let changed = false;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const t of nodes) {
    const p = t.parentElement;
    if (p && SKIP_TAGS.has(p.tagName.toUpperCase())) continue;
    const next = stripEmoji(t.data);
    if (next !== t.data) {
      t.data = next;
      changed = true;
    }
  }
  if (attrs && root.nodeType === 1) {
    const els = [root as Element, ...Array.from((root as Element).querySelectorAll('*'))];
    for (const el of els) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      for (const a of EMOJI_ATTRS) {
        const v = el.getAttribute(a);
        if (v === null) continue;
        const next = stripEmoji(v);
        if (next !== v) {
          el.setAttribute(a, next.trim());
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** A static html page without emoji (entities included, since they are parsed first). Used where no script can run. */
export function stripEmojiHtml(html: string): string {
  if (typeof DOMParser === 'undefined' || !/[^\x00-\x7f]|&/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!stripEmojiIn(doc.documentElement)) return html;
  /* A lone svg stays a lone svg (the full-screen preview centres it by that), not a whole <html> document. */
  if (LONE_SVG.test(html)) {
    const svg = doc.querySelector('svg');
    if (svg) return svg.outerHTML;
  }
  return doc.documentElement.outerHTML;
}

/** Same test as files/FilePreview isLoneSvg (kept here so the two files do not import each other; a test holds them equal). */
export const LONE_SVG = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>][\s\S]*<\/svg>\s*$/i;

/** The frame's guard: text nodes and text attributes now, and again whenever the page changes them. Never touches script or style. */
export const EMOJI_BOOTSTRAP =
  '<script>(function(){var R=new RegExp(' +
  JSON.stringify(EMOJI_PATTERN) +
  ',"gu"),G=new RegExp(' +
  JSON.stringify(SPACE_GOES_BEFORE) +
  '),S=/[\\uFE0F\\u20E3]/g,KC=/([0-9#*])\\uFE0F?\\u20E3/g,K={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEXTAREA:1},A=' +
  JSON.stringify(EMOJI_ATTRS) +
  ',M=new WeakMap(),T=0,O=null;' +
  'function f(s){return s.replace(KC,"$1").replace(R,function(m,sp,o,w){var n=w.charAt(o+m.length);return sp&&n&&!G.test(n)?sp:""}).replace(S,"")}' +
  /* A page that puts the emoji back (its own observer) must not trap the frame in a loop: three strips per node, five thousand in all. */
  'function ok(n){var c=M.get(n)||0;if(c>=3||T>5000){if(T>5000&&O)O.disconnect();return false}M.set(n,c+1);T++;return true}' +
  'function w(r){if(!r)return;if(r.nodeType===3){var p=r.parentNode;if(p&&p.tagName&&K[p.tagName.toUpperCase()])return;var n=f(r.data);if(n!==r.data&&ok(r))r.data=n;return}' +
  'if(r.nodeType!==1&&r.nodeType!==9)return;if(r.nodeType===1){if(K[r.tagName.toUpperCase()])return;for(var i=0;i<A.length;i++){var v=r.getAttribute(A[i]);if(v!==null){var m=f(v);if(m!==v&&ok(r))r.setAttribute(A[i],m.trim())}}}' +
  'for(var c=r.firstChild;c;c=c.nextSibling)w(c)}' +
  'w(document.documentElement);' +
  'if(window.MutationObserver){O=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i];if(m.type==="characterData")w(m.target);else if(m.type==="attributes")w(m.target);else for(var j=0;j<m.addedNodes.length;j++)w(m.addedNodes[j])}});O.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:A})}' +
  '})()</script>';
