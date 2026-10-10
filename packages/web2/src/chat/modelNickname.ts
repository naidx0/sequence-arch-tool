/* ══════════════════════════════════════════════════════════════════════════
   AUTO NICKNAMES FOR MODELS
   packages/web2/src/chat/modelNickname.ts

   Raw ids are wire strings (`anthropic/claude-sonnet-5-5[1m]`, `Qwen/Qwen2.5-Coder-32B-Instruct`);
   a person wants "Sonnet 5.5" or "Qwen 2.5 Coder". This maps an id or a provider-given name onto
   a short name. The shortening is done BEFORE anything is truncated on screen: vendor prefixes,
   sizes, quantisation and format tags, "Instruct", "-GGUF", "-latest" and date stamps are dropped
   for display; the full id stays in the tooltip (the caller's job).
   A name the person set themselves is never passed through here: callers use
   `displayModelName`, which lets a user nickname win.

   PURE. String in, string out.
   ══════════════════════════════════════════════════════════════════════════ */

const BRANDS: Record<string, string> = {
  minicpm: 'MiniCPM',
  qwen: 'Qwen',
  llama: 'Llama',
  deepseek: 'DeepSeek',
  gemma: 'Gemma',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  phi: 'Phi',
  codestral: 'Codestral',
  starcoder: 'StarCoder',
  glm: 'GLM',
  kimi: 'Kimi',
  granite: 'Granite',
  yi: 'Yi',
  gemini: 'Gemini',
  grok: 'Grok',
  olmo: 'OLMo',
  hermes: 'Hermes',
  nemotron: 'Nemotron',
  smollm: 'SmolLM',
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Quantisation and format tags: they say how a file was squeezed, not which model it is. */
const QUANT = /^(?:i?q\d(?:_[a-z0-9]+)*|fp\d+|f16|f32|bf16|int[48]|awq|gptq)$/i;
/** Parameter counts: "32B", "7b", "a3b" (active parameters of a mixture), "8x7B". */
const SIZE = /^(?:a?\d+(?:\.\d+)?[bkm]|\d+x\d+[bkm])$/i;
/** Packaging that is never part of a model's name, for any family. */
const isNoise = (tok: string): boolean => QUANT.test(tok) || SIZE.test(tok) || /^(?:instruct|gguf|latest)$/i.test(tok);
/** For a family this table knows, more is packaging too: instruction-tuned and QAT builds, "free", "chat". */
const isKnownNoise = (tok: string): boolean => isNoise(tok) || /^(?:it|qat|free|chat)$/i.test(tok);
/** A trailing four-digit stamp (`2503`, `0613`): a build date, not a version. */
const STAMP = /^\d{4}$/;

/** Keeps the words that name the model; drops the packaging around them. A stamp only ever sits at the end. */
function words(toks: readonly string[], known: boolean): string[] {
  const kept = toks.filter((t) => !(known ? isKnownNoise(t) : isNoise(t)));
  const last = kept[kept.length - 1];
  return kept.length > 1 && last !== undefined && STAMP.test(last) ? kept.slice(0, -1) : kept;
}

function dropNoise(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\[[^\]]*\]\s*$/, '').trim(); // [1m]
  s = s.split('/').filter(Boolean).pop() ?? s; // anthropic/claude-..., Qwen/Qwen2.5-...
  /* Bedrock and Vertex wrap the id: us.anthropic.claude-sonnet-5-5-v1:0, claude-sonnet-5-5@20260101. */
  const wrapped = /(?:^|\.)(claude-[a-z0-9.-]+)$/i.exec(s.replace(/:\d+$/, ''));
  if (wrapped && /\./.test(s.split('claude-')[0] ?? '')) s = wrapped[1]!;
  else if (/^claude-/i.test(s)) s = s.replace(/:\d+$/, '');
  s = s.replace(/-v\d+$/i, (m, off: number) => (/^claude-/i.test(s) && off > 0 ? '' : m)); // Bedrock revision
  s = s.replace(/[-_@]?(\d{8}|\d{4}-\d{2}-\d{2})$/, ''); // date suffix
  return s;
}

/** One token as a display word: a known family is branded and its version spaced ("Qwen 2.5"), a number stays a number. */
function tokenTitle(tok: string): string {
  const low = tok.toLowerCase();
  if (/^\d+(\.\d+)*$/.test(low)) return low;
  for (const [prefix, brand] of Object.entries(BRANDS)) {
    if (low.startsWith(prefix) && (low.length === prefix.length || /^[\d.]/.test(low.slice(prefix.length)))) {
      const ver = low.slice(prefix.length);
      return ver ? `${brand} ${ver}` : brand;
    }
  }
  return cap(low);
}

const knownBrand = (tok: string): boolean => {
  const low = tok.toLowerCase();
  return Object.keys(BRANDS).some((prefix) => low.startsWith(prefix) && (low.length === prefix.length || /^[\d.]/.test(low.slice(prefix.length))));
};

const version = (maj: string, min?: string): string => (min ? `${maj}.${min}` : maj);

/** The short, readable name for a model id. Empty in, empty out. */
export function modelNickname(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  const [namePart, tagPart] = dropNoise(raw).split(':') as [string, string | undefined];
  const name = namePart.trim();
  const low = name.toLowerCase();

  /* Claude: claude-sonnet-5-5, claude-sonnet-5.5, claude-3-5-sonnet. */
  let m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d{1,2}))?(?:-|$)/.exec(low);
  if (m) return `${cap(m[1]!)} ${version(m[2]!, m[3])}`;
  m = /^claude-(\d+)(?:[-.](\d{1,2}))?-(opus|sonnet|haiku|fable)(?:-|$)/.exec(low);
  if (m) return `${cap(m[3]!)} ${version(m[1]!, m[2])}`;
  m = /^claude-(opus|sonnet|haiku|fable)$/.exec(low);
  if (m) return cap(m[1]!);

  /* OpenAI: gpt-5.1-codex, gpt-4o-mini, o3, o4-mini. */
  m = /^gpt-?(\d+(?:\.\d+)?)([a-z]*)((?:[-_][a-z0-9.]+)*)$/.exec(low);
  if (m) {
    const rest = words(m[3]!.split(/[-_]/).filter(Boolean), false).map(cap).join(' ');
    return `GPT-${m[1]}${m[2]}${rest ? ` ${rest}` : ''}`;
  }
  m = /^(o\d+)((?:[-_][a-z0-9.]+)*)$/.exec(low);
  if (m) {
    const rest = words(m[2]!.split(/[-_]/).filter(Boolean), false).map(cap).join(' ');
    return `${m[1]}${rest ? ` ${rest}` : ''}`;
  }

  const nameToks = name.split(/[-\s]+/).filter(Boolean);
  const tagToks = (tagPart ?? '').trim().toLowerCase() === 'latest' ? [] : (tagPart ?? '').split(/[-\s]+/).filter(Boolean);

  /* gpt-oss:20b is a brand of its own, not "Gpt Oss". */
  if (nameToks[0]?.toLowerCase() === 'gpt' && nameToks[1]?.toLowerCase() === 'oss') {
    return ['GPT-OSS', ...words(nameToks.slice(2), true).map(tokenTitle), ...words(tagToks, true).map(tokenTitle)].join(' ');
  }
  /* A model this table knows is tidied; an id it does not know is left as given
     (its packaging aside), never title-cased by guess. */
  if (nameToks[0] && knownBrand(nameToks[0])) {
    return [...words(nameToks, true).map(tokenTitle), ...words(tagToks, true).map(tokenTitle)].join(' ');
  }
  const base = words(nameToks, false).join('-') || name;
  const tag = words(tagToks, false).join('-');
  return tag ? `${base}:${tag}` : base;
}

/** What to show: a name the person gave wins; otherwise the auto nickname, falling back to the id. */
export function displayModelName(raw: string | null | undefined, userNickname?: string | null): string {
  const set = userNickname?.trim();
  if (set && set !== raw) return set;
  return modelNickname(raw) || (raw ?? '');
}

/** A name an agent or provider gave: kept when it already reads as words, nicknamed when it is an id. */
export function tidyModelName(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  if (t === '' || /\s/.test(t)) return t;
  return modelNickname(t) || t;
}
