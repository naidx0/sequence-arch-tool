/* ══════════════════════════════════════════════════════════════════════════
   PROVIDER MARKS (Decision 49)
   packages/web2/src/shell2/brandIcons.tsx

   SOURCES AND LICENCES.
   - Codex and Claude: @lobehub/icons-static-svg 1.95.1, MIT, unmodified files
     in ./brand/ with ./brand/SOURCE.txt (source, version, full licence text),
     fetched by the coordinator on Jaden's approval. The mono files (fill
     currentColor) are the ones drawn; the marks are their owners' trademarks.
   - Ollama: simple-icons 16.31.0 (icons/ollama.svg), CC0-1.0, path copied
     from the repository's installed site package (site/node_modules).
   - Sequence: the app's own mark (the title-bar mark).
   The OpenAI mark (./brand/openai.svg, same package) stands for OpenAI's models
   and the picker's "OpenAI" group; the Codex mark stays the Codex agent's own
   in the rail and the connect list.
   ══════════════════════════════════════════════════════════════════════════ */

import codexSvg from './brand/codex.svg?raw';
import claudeSvg from './brand/claude.svg?raw';
import openaiSvg from './brand/openai.svg?raw';
import { BRAND_ALIASES } from '../settings/logos/brandAliases';
import { agentMark } from '../settings/logos/agentMark';
import { providerMark } from '../settings/logos/providerMark';
import { PROVIDER_MARKS } from '../settings/logos/providerMarks';
import { S2Icon } from './icons';

const OLLAMA = 'M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z';

/** A mark's key: a vetted one ('claude', 'codex', 'openai', 'ollama', 'sequence'), a packaged one ('agent:cursor', 'prov:openrouter'), or 'other' for none. */
export type ProviderKey = 'claude' | 'ollama' | 'sequence' | 'codex' | 'openai' | 'other' | (string & {});

/** The provider a model or an agent belongs to, from its own names. */
export function providerOf(...names: (string | null | undefined)[]): ProviderKey {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  if (/claude|anthropic|opus|sonnet|haiku/.test(s)) return 'claude';
  if (/ollama/.test(s)) return 'ollama';
  if (/codex/.test(s)) return 'codex';
  if (/openai|gpt|\bo[1-9]\b/.test(s)) return 'openai';
  if (/sequence/.test(s)) return 'sequence';
  return 'other';
}

/* ── ONE LOGO LOOKUP ──────────────────────────────────────────────────────
   Every place that shows an agent or a provider asks `brandOf` for the mark's
   key and draws it with `ProviderIcon`: (1) the vetted marks in ./brand, then
   (2) the packaged agent marks (Cursor, Gemini, Hermes, ...), then (3) the
   packaged provider marks (OpenRouter, Groq, ...). Only Sequence's own agent
   is `sequence`; a name with no mark anywhere is 'other'. */
const norm = (s: string): string => s.toLowerCase().trim().replace(/^acp[:/]/, '').replace(/[\s_.]+/g, '-');

/** The mark key for the first of these names (an agent ref, id or label, a provider or model id) that has a real mark. */
export function brandOf(...names: (string | null | undefined)[]): ProviderKey {
  const vetted = providerOf(...names);
  if (vetted !== 'other') return vetted;
  for (const raw of names) {
    if (!raw) continue;
    const whole = norm(raw);
    const hit = BRAND_ALIASES[whole] ?? (agentMark(whole) ? `agent:${whole}` : PROVIDER_MARKS[whole] ? `prov:${whole}` : undefined);
    if (hit) return hit;
    for (const word of whole.split(/[^a-z0-9]+/)) {
      const w = BRAND_ALIASES[word];
      if (w) return w;
    }
  }
  return 'other';
}

/** The word a provider's group and chip carry. Local models, whatever runs them, are "Local". */
export function providerLabel(p: ProviderKey): string {
  if (p === 'claude') return 'Claude';
  if (p === 'openai' || p === 'codex') return 'OpenAI';
  return 'Local';
}

/* ── ONE CLASSIFIER FOR CHIP, STATUS BAR AND PICKER ───────────────────────
   Who answers, as a group: Claude, OpenAI, Local (keyless loopback), or a
   hosted gateway/vendor of its own. Everything that names a provider for a
   saved model goes through `modelGroupOf`, so the three surfaces cannot
   disagree. */

/** What is known about a model: its provider kind, wire id, endpoint and whether it carries a key. */
export interface ModelIdentity {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  /** True when a key is configured; false for a keyless model; undefined when unknown. */
  keyed?: boolean | null;
  /** True for the Sequence-provided hosted default (`mode: 'default'`): never a model on this machine. */
  managed?: boolean | null;
}

export interface ModelGroup {
  /** 'local' | 'claude' | 'openai' | `host:<slug>`. */
  key: string;
  /** The word on the group heading, the chip and the status bar. */
  label: string;
  /** The mark: a hosted vendor's own where one is packaged (OpenRouter, Groq, ...), else the neutral model glyph ('other'), never Sequence's. */
  icon: ProviderKey;
}

/** Endpoint hosts whose vendor is known; anything else is "Custom endpoint", never a hostname fragment. */
const HOSTS: readonly [RegExp, string][] = [
  [/openrouter\.ai$/, 'OpenRouter'],
  [/groq\.com$/, 'Groq'],
  [/together\.(ai|xyz)$/, 'Together'],
  [/fireworks\.ai$/, 'Fireworks'],
  [/deepseek\.com$/, 'DeepSeek'],
  [/mistral\.ai$/, 'Mistral'],
  [/x\.ai$/, 'xAI'],
  [/(googleapis|google)\.com$/, 'Google'],
  [/perplexity\.ai$/, 'Perplexity'],
  [/cerebras\.ai$/, 'Cerebras'],
  [/(azure\.com|azure-api\.net)$/, 'Azure'],
  [/amazonaws\.com$/, 'AWS Bedrock'],
  [/huggingface\.(co|cloud)$/, 'Hugging Face'],
  [/deepinfra\.com$/, 'DeepInfra'],
  [/nvidia\.com$/, 'NVIDIA'],
  [/sambanova\.ai$/, 'SambaNova'],
  [/cohere\.(com|ai)$/, 'Cohere'],
  [/moonshot\.(ai|cn)$/, 'Moonshot'],
  [/(bigmodel\.cn|z\.ai)$/, 'Z.ai'],
  [/(dashscope\.aliyuncs\.com|aliyuncs\.com)$/, 'Alibaba'],
  [/siliconflow\.(cn|com)$/, 'SiliconFlow'],
  [/hyperbolic\.xyz$/, 'Hyperbolic'],
  [/novita\.ai$/, 'Novita'],
  [/github\.ai$/, 'GitHub Models'],
  [/anthropic\.com$/, 'Claude'],
  [/openai\.com$/, 'OpenAI'],
];
const ORGS: Record<string, string> = { 'meta-llama': 'Meta', meta: 'Meta', google: 'Google', mistralai: 'Mistral', qwen: 'Qwen', deepseek: 'DeepSeek', 'deepseek-ai': 'DeepSeek', 'x-ai': 'xAI', moonshotai: 'Moonshot', 'z-ai': 'Z.ai', microsoft: 'Microsoft', cohere: 'Cohere', nvidia: 'NVIDIA' };
/** The maker a model id names by its family (the id after any org prefix). */
const FAMILIES: readonly [RegExp, string][] = [
  [/^deepseek/, 'DeepSeek'],
  [/^(qwen|qwq)/, 'Qwen'],
  [/^(llama|meta-llama)/, 'Meta'],
  [/^(mistral|mixtral|codestral|ministral|magistral|devstral)/, 'Mistral'],
  [/^(gemma|gemini)/, 'Google'],
  [/^grok/, 'xAI'],
  [/^(kimi|moonshot)/, 'Moonshot'],
  [/^(glm|chatglm)/, 'Z.ai'],
  [/^phi/, 'Microsoft'],
  [/^command/, 'Cohere'],
  [/^minimax/, 'MiniMax'],
];

function hostOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(h: string): boolean {
  return h === 'localhost' || h === '0.0.0.0' || h === 'host.docker.internal' || h === '::1' || h === '[::1]' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
}

/** The maker a bare model id names (`deepseek-v4-flash` is DeepSeek's), or null when it names none. */
export function vendorOfModel(model: string): string | null {
  const m = model.toLowerCase().trim();
  const slash = m.indexOf('/');
  if (slash > 0) {
    const org = ORGS[m.slice(0, slash)];
    if (org) return org;
  }
  const id = slash >= 0 ? m.slice(slash + 1) : m;
  return FAMILIES.find(([re]) => re.test(id))?.[1] ?? null;
}

/** A name that looks like a local runtime's: `name:tag` (qwen3:30b-a3b), not a Bedrock `...:0` or a URL. */
const isLocalRuntimeId = (m: string): boolean => /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*:[a-z0-9][a-z0-9._-]*$/.test(m) && !/(^|[/.])(anthropic[/.]|claude)/.test(m) && !/:\d+$/.test(m);

const LOCAL_PROVIDERS = /^(ollama|lmstudio|lm-studio|llama\.?cpp|llamacpp|vllm|local)$/;

/** The group a model belongs to. Local only when the evidence says so; otherwise hosted and named honestly. */
export function modelGroupOf(id: ModelIdentity): ModelGroup {
  const p = (id.provider ?? '').toLowerCase();
  const m = (id.model ?? '').toLowerCase();
  const host = hostOf(id.baseUrl);
  const claude: ModelGroup = { key: 'claude', label: 'Claude', icon: 'claude' };
  const openai: ModelGroup = { key: 'openai', label: 'OpenAI', icon: 'openai' };
  const local: ModelGroup = { key: 'local', label: 'Local', icon: 'sequence' };
  const hosted = (label: string): ModelGroup => ({ key: `host:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, icon: brandOf(label) });
  if (p === 'anthropic') return claude;
  if (p === 'openai') return openai;
  if (LOCAL_PROVIDERS.test(p)) return local;
  /* The Sequence-provided hosted default is never "Local", whatever its id looks like. */
  const managed = id.managed === true;
  /* Loopback (or a LAN address) is this machine's, key or no key: LM Studio and vLLM take a dummy key. */
  if (!managed && host !== null && isLoopbackHost(host)) return local;
  /* A keyless model with no endpoint is the keyless local one, whatever its id says. */
  if (!managed && host === null && id.keyed === false) return local;
  const claudeId = /(^|[/.])(anthropic[/.]|claude)/.test(m);
  if (claudeId) return claude;
  const remote = host !== null;
  const openaiId = /^openai\/(?!gpt-oss)/.test(m) || (!remote && /^(gpt-(?!oss)|chatgpt|o\d(?:-|$)|text-embedding)/.test(m));
  if (openaiId || (host !== null && /(^|\.)openai\.com$/.test(host))) return openai;
  /* One named like a local runtime's (name:tag) and not known to hold a key is Local; nothing else is assumed. */
  if (!managed && host === null && id.keyed !== true && isLocalRuntimeId(m)) return local;
  const byHost = host ? HOSTS.find(([re]) => re.test(host))?.[1] : undefined;
  if (byHost) return hosted(byHost);
  /* An unknown host is an unknown host: the id's family says whose model it is, not who serves it. */
  if (remote) return hosted('Custom endpoint');
  const vendor = vendorOfModel(m);
  if (vendor) return hosted(vendor);
  return hosted(managed ? 'Hosted model' : 'Custom endpoint');
}

export function SequenceMark() {
  return (
    <svg className="s2-brand" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="10" y="10" width="26" height="8" rx="4" />
        <rect x="28" y="10" width="8" height="26" rx="4" />
        <rect x="28" y="28" width="26" height="8" rx="4" />
        <rect x="46" y="28" width="8" height="26" rx="4" />
        <rect x="5" y="5" width="18" height="18" rx="5" />
        <rect x="23" y="23" width="18" height="18" rx="5" />
        <rect x="41" y="41" width="18" height="18" rx="5" />
      </g>
    </svg>
  );
}

/** The provider's mark; the neutral model glyph for a provider with none. */
export function ProviderIcon({ provider }: { provider: ProviderKey }) {
  if (provider === 'codex' || provider === 'claude' || provider === 'openai') {
    /* Static, packaged files (./brand), not user content. */
    const svg = provider === 'codex' ? codexSvg : provider === 'openai' ? openaiSvg : claudeSvg;
    return <span className="s2-brand" data-brand={provider} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  if (provider === 'ollama') {
    return (
      <svg className="s2-brand" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-brand={provider}>
        <path fill="currentColor" d={OLLAMA} />
      </svg>
    );
  }
  if (provider === 'sequence') return <SequenceMark />;
  const packaged = provider.startsWith('agent:') ? agentMark(provider.slice(6)) : provider.startsWith('prov:') ? providerMark(provider.slice(5)) : undefined;
  if (packaged) {
    const [viewBox, shapes, rootFill] = packaged;
    /* Packaged, sanitised path data (settings/logos, build-marks.mjs), never user content. */
    return <svg className="s2-brand" viewBox={viewBox} fill={rootFill === 'none' ? 'none' : 'currentColor'} aria-hidden="true" focusable="false" data-brand={provider.slice(provider.indexOf(':') + 1)} data-mark="logo" dangerouslySetInnerHTML={{ __html: shapes }} />;
  }
  return <S2Icon name="cpu" small />;
}
