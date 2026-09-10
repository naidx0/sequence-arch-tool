/**
 * Optional LLM labeling pass (spec §2.3): the LLM only NAMES and DESCRIBES
 * deterministically-computed nodes — it never decides membership and never
 * invents nodes or edges.
 *
 * WHICH KEY THIS USES (r90). It used to read `ANTHROPIC_API_KEY` from the
 * environment and nothing else, while the rest of the app read the user's
 * configured provider from `.sequence/ai.json`. So an owner who connected an
 * OpenRouter key in Settings, rescanned, and saw the same "Backend" / "Core" /
 * "A group of N related files" had no way to know why: the assistant was using
 * their key and the labeller was silently using a key they had never set.
 *
 * It now takes the SAME `AiConfig` the assistant uses, and falls back to the
 * environment variable only when no config was passed (every pre-r90 caller,
 * byte-identical). The fabrication guard is unchanged and applies to both paths:
 * a returned id that was not requested is DROPPED, so a model can rename a
 * component but can never add one.
 *
 * PROMPT ASSEMBLY (token budget + untrusted content). Everything below the
 * instruction header is REPO-DERIVED: the repo directory name, the README's own
 * prose, component ids, heuristic labels, framework hints, and file paths. It is
 * therefore (a) budgeted — see the `LABEL_*_BUDGET_TOKENS` constants — and (b)
 * wrapped in `<untrusted_repo_content>` with its sentinels defanged, so a file
 * named "ignore previous instructions.md" is data, not a line of the prompt.
 * Neither changes WHAT information reaches the model on a normal repo; both are
 * guardrails for the pathological one. See `llm/tokenBudget.ts` + `llm/untrusted.ts`.
 */

import { cutToBudget, cutTextToBudget } from './tokenBudget.js';
import {
  UNTRUSTED_CONTENT_INSTRUCTION,
  neutralizeUntrusted,
  wrapUntrustedLines,
} from './untrusted.js';

export interface LabelRequest {
  id: string;
  kind: 'service' | 'module';
  /** deterministic heuristic label, used as fallback and prompt context */
  heuristicLabel: string;
  memberFiles: string[];
  extras?: string; // routes, topics, framework hints
}

export interface LabelResult {
  id: string;
  label: string;
  description: string;
}

const MODEL = 'claude-sonnet-4-5';

/**
 * README excerpt budget: 375 tokens ≈ 1500 characters — the SAME allowance the
 * pre-budget code applied as a silent `readmeExcerpt.slice(0, 1500)`. What
 * changed is only that a README past it now carries the omission marker instead
 * of stopping mid-sentence with no trace. A README under the cap is unchanged.
 */
const LABEL_README_BUDGET_TOKENS = 375;

/**
 * Component-list budget: 16 000 tokens ≈ 64 000 characters.
 *
 * Measured (this repo, `pnpm -r build` then scan of the Sequence monorepo
 * itself): 55 labelable components ⇒ 20 404 characters ≈ 5 100 tokens. The
 * `shopfront` fixture: 8 components ⇒ 1 162 characters ≈ 290 tokens. The budget
 * is therefore ~3× the real Sequence repo and ~55× the fixtures — nothing we
 * scan today is cut. It exists so a repo with hundreds of services (the
 * 1140-file fastapi scan) cannot hand a provider an unbounded component list.
 */
const LABEL_COMPONENTS_BUDGET_TOKENS = 16_000;

/** The subset of the app's AiConfig this pass needs. Structural, so `llm/` does
 *  not depend on `server/` and the module stays testable without a server. */
export interface LabelModel {
  provider: 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  model: string;
  apiKey?: string;
}

export async function llmLabels(
  repoName: string,
  readmeExcerpt: string,
  requests: LabelRequest[],
  warnings: string[],
  configured?: LabelModel,
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, LabelResult>> {
  const out = new Map<string, LabelResult>();
  // The user's configured model wins. The env var stays as the fallback so every
  // pre-r90 caller and every CI script keeps working unchanged.
  const model: LabelModel | undefined =
    configured ??
    (process.env.ANTHROPIC_API_KEY
      ? { provider: 'anthropic', model: MODEL, apiKey: process.env.ANTHROPIC_API_KEY }
      : undefined);
  if (!model) {
    warnings.push(
      '--llm requested but no model is configured — using heuristic labels. ' +
        'Connect one in Settings (it is the same model the assistant uses), or set ANTHROPIC_API_KEY.'
    );
    return out;
  }
  const apiKey = model.apiKey ?? '';
  if (requests.length === 0) return out;

  const schema = {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: requests.map((r) => r.id) },
            label: { type: 'string', maxLength: 40 },
            description: { type: 'string', maxLength: 200 },
          },
          required: ['id', 'label', 'description'],
          additionalProperties: false,
        },
      },
    },
    required: ['labels'],
    additionalProperties: false,
  };

  const prompt = buildLabelPrompt(repoName, readmeExcerpt, requests);

  const collect = (labels: LabelResult[]): void => {
    // THE FABRICATION GUARD, on every path: only ids we ASKED about are kept, so
    // a model can rename a component but can never introduce one.
    const validIds = new Set(requests.map((r) => r.id));
    for (const l of labels) {
      if (l && validIds.has(l.id) && l.label) out.set(l.id, l);
    }
    const missing = requests.filter((r) => !out.has(r.id));
    if (missing.length > 0) {
      warnings.push(
        `LLM labeling: ${missing.length} component(s) unlabeled — heuristic fallback used for those`
      );
    }
  };

  try {
    if (model.provider === 'openai-compatible') {
      // OpenAI-compatible hosts (OpenRouter, together, a local server) vary in
      // how well they support tool-calling, but JSON-object mode is universal.
      // The schema is restated in the prompt because that is what the models
      // actually condition on, and the result is validated either way.
      const base = (model.baseUrl ?? '').replace(/\/+$/, '');
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model.model,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content:
                `${prompt}\n\nReply with JSON only, exactly: ` +
                `{"labels":[{"id":"<one of the ids above>","label":"2-4 words",` +
                `"description":"one sentence"}]}`,
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 160);
        warnings.push(
          `LLM labeling failed: HTTP ${res.status} from the configured model — using heuristic labels${body ? ` (${body})` : ''}`
        );
        return out;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content ?? '';
      let parsed: { labels?: LabelResult[] } = {};
      try {
        parsed = JSON.parse(raw) as { labels?: LabelResult[] };
      } catch {
        warnings.push('LLM labeling: the model did not return JSON — using heuristic labels');
        return out;
      }
      collect(parsed.labels ?? []);
      return out;
    }

    // Anthropic: tool-calling with a strict input schema, which is the strongest
    // shape guarantee available and what this pass has always used.
    const res = await fetchImpl(
      `${(model.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model.model,
          max_tokens: 2048,
          temperature: 0,
          tools: [
            {
              name: 'submit_labels',
              description: 'Submit labels for every component id',
              input_schema: schema,
            },
          ],
          tool_choice: { type: 'tool', name: 'submit_labels' },
          messages: [{ role: 'user', content: prompt }],
        }),
      },
    );
    if (!res.ok) {
      warnings.push(`LLM labeling failed: HTTP ${res.status} — using heuristic labels`);
      return out;
    }
    const data = (await res.json()) as {
      content: { type: string; input?: { labels?: LabelResult[] } }[];
    };
    const toolUse = data.content.find((c) => c.type === 'tool_use');
    collect(toolUse?.input?.labels ?? []);
  } catch (e) {
    warnings.push(`LLM labeling failed: ${(e as Error).message} — using heuristic labels`);
  }
  return out;
}

/**
 * Assemble the labeling prompt: our instructions, then the repo's own text
 * inside one clearly-delimited untrusted block.
 *
 * Exported so the budget + neutralization behaviour is testable without a
 * provider, a key, or a network — `llmLabels` itself is the only caller.
 *
 * ORDERING: the component list is cut from the TAIL. `requests` arrives in the
 * scanner's own order and no relevance ranking is invented here; a component
 * that falls off is REPORTED (the marker line) and still gets its heuristic
 * label, which is the same fallback an unlabeled component always had.
 */
export function buildLabelPrompt(
  repoName: string,
  readmeExcerpt: string,
  requests: readonly LabelRequest[],
): string {
  const readme = cutTextToBudget(readmeExcerpt, LABEL_README_BUDGET_TOKENS).text;
  const entries = requests.map(
    (r) =>
      `- id=${r.id} kind=${r.kind} heuristic="${r.heuristicLabel}"${r.extras ? ` hints: ${r.extras}` : ''}\n  files: ${r.memberFiles.slice(0, 12).join(', ')}${r.memberFiles.length > 12 ? ` (+${r.memberFiles.length - 12} more)` : ''}`,
  );
  const components = cutToBudget(entries, LABEL_COMPONENTS_BUDGET_TOKENS, { unit: 'components' });
  // The repo name is repo-derived too (it is a directory name), so it is defanged
  // even though it sits in our own header line.
  const L: string[] = [
    `You are labeling components of the software repo "${neutralizeUntrusted(repoName)}" for an architecture diagram.`,
    'For each component id below, produce a short human label (2-4 words) and a one-sentence description of its responsibility.',
    'Base labels ONLY on the file lists and hints given. Do not invent components.',
    '',
    UNTRUSTED_CONTENT_INSTRUCTION,
    '',
    'README excerpt:',
    ...wrapUntrustedLines(neutralizeUntrusted(readme).split('\n')),
    '',
    'Components:',
    ...wrapUntrustedLines(components.lines.map((l) => neutralizeUntrusted(l))),
  ];
  return L.join('\n');
}
