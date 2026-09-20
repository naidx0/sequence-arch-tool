/* ══════════════════════════════════════════════════════════════════════════
   WHICH MODEL IS ACTUALLY ANSWERING
   packages/web2/src/chat/modelSelection.ts

   The composer draws the model name under the field, and it was ALWAYS EMPTY.
   `ComposerSlice.model` starts as `EMPTY_MODEL` — `{ model: '', origin:
   'unconfigured' }` — and the `composer/model` action that would replace it
   has a reducer arm and is dispatched by nobody. So a reader with a key
   configured and a model chosen saw a blank where the answer's author should
   be.

   ── WHAT THIS DOES AND WHAT IT DELIBERATELY DOES NOT ─────────────────────

   It maps the config the server already serves onto the selection the composer
   already renders. That is the whole gap: the fact existed at one end and the
   surface existed at the other.

   THIS FILE IS STILL NOT THE PICKER — it maps ONE config onto ONE label. It
   used to say a picker was impossible: "A menu needs a LIST of models, and no
   route serves one — `/api/ai-config` returns the ONE configured model as a
   string. Drawing a menu over a single value would be the fabrication
   `EMPTY_MODEL`'s own comment exists to prevent."

   That was true until saved models existed. `/api/ai-config` now answers with
   `profiles` and `defaultProfileId`, and `modelPicker.ts` reads THAT — every
   row a model the reader saved, none invented. The rule the old paragraph was
   defending is unchanged and is enforced there: no list, no menu.

   PURE. Config in, selection out.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ModelSelection } from '../state/types';

/** The unconfigured selection — the honest answer when nothing is set up. */
export const UNCONFIGURED: ModelSelection = { model: '', origin: 'unconfigured' };

/**
 * Read the composer's model out of an `/api/ai-config` response.
 *
 * The three response variants map exactly onto the three `origin` values,
 * which is not a coincidence — `ModelSelection.origin` was written to describe
 * this route and then never connected to it.
 *
 * ANYTHING UNRECOGNISED IS UNCONFIGURED. A malformed response must not produce
 * a model name, because the name is a claim about who will answer the next
 * question and a wrong one is worse than a blank.
 */
export function modelFromConfig(body: unknown): ModelSelection {
  if (typeof body !== 'object' || body === null) return UNCONFIGURED;
  const config = body as {
    configured?: unknown;
    mode?: unknown;
    provider?: unknown;
    model?: unknown;
    apiKey?: unknown;
  };

  if (config.configured !== true) return UNCONFIGURED;
  if (typeof config.model !== 'string' || config.model.trim() === '') return UNCONFIGURED;

  return {
    model: config.model,
    /* The redacted response deliberately preserves three states: the funded
       default, a keyless loopback OpenAI-compatible model, or a masked user
       key. Do not collapse the second into `api-key`; absence is the contract
       that lets later readers tell it was never a credential. */
    origin:
      config.mode === 'default'
        ? 'default'
        : config.provider === 'openai-compatible' && config.apiKey === undefined
          ? 'local'
          : 'api-key',
  };
}

/**
 * What the composer should say beside the field.
 *
 * The unconfigured case names the NEXT ACTION rather than the absence. "No
 * model" tells a reader something is wrong and leaves them looking for the
 * place to fix it; this says where.
 */
export function modelLabel(selection: ModelSelection): string {
  /*
   * "CONNECT A MODEL" — SHORTER BECAUSE THIS LABEL ABSORBS THE SQUEEZE.
   *
   * The idea was already right: name the next action, not the absence. The
   * SENTENCE was too long, and the reason is not the 220px cap — measured in a
   * browser at the real face (11px JetBrains Mono, 6.6px per character),
   * "Choose reasoning in Settings" is 184.8px and fits 220 comfortably. The cap
   * is not the constraint; `min(100%, 220px)` is, and `.modelsel`'s own rule
   * says why on purpose: "THE MODEL LABEL ABSORBS THE SQUEEZE, NEVER THE SEND
   * CLUSTER." In a narrow chat pane 100% is far under 220, so the label is the
   * thing that gives — and on the owner's first-run screen it gave exactly
   * where it named the destination: "Choose reasoning in Sett…".
   *
   * So the fix is the sentence, not the cap. The cap is right for a model id —
   * `qwen2.5-coder:32b-instruct-q4_K_M` measures 217.8px and SHOULD ellipsize
   * rather than shove the send button off the row. This label is not a model
   * id; it is an instruction, and an instruction cut before its object says
   * nothing. At 99px "Connect a model" survives a squeeze that kills 184.8px,
   * and it is the owner's own phrase: "you can connect your own model from one
   * click".
   */
  if (selection.origin === 'unconfigured' || selection.model === '') {
    return 'Connect a model';
  }
  return selection.model;
}
