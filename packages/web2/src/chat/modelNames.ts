/* ══════════════════════════════════════════════════════════════════════════
   WHAT A SAVED MODEL IS CALLED BEFORE ANYBODY NAMES IT
   packages/web2/src/chat/modelNames.ts

   Ported from ml-harness `frontend/src/lib/useProviders.ts:nameForALocalModel`,
   which exists because of a measured defect the owner reported with nine models
   set up: his connection list had seven rows and six of them read `Ollama`.

   Every one-click local connection used to be named after the ENDPOINT, and the
   endpoint is `localhost` for all of them. A connection to a local daemon is
   identified by its MODEL, so that is what it is named after:

     - `:latest` is dropped. It is on nearly every id, and a suffix every row
       shares distinguishes nothing. A non-`latest` tag is KEPT, because then it
       is the thing telling two rows apart.
     - A namespaced id keeps only its last segment, so
       `hf.co/prism-ml/Bonsai-27B-gguf` reads `Bonsai-27B-gguf`.
     - A BLANK LABEL IS WORSE THAN A REPEATED ONE — it is a row in the picker
       with nothing written on it and no way to tell what activating it would
       do. So an empty id falls back through the raw string, then the provider
       label, then a plain word.

   IT IS A DEFAULT AND NOT A RULE. `name` on `AiProfileView` is an ordinary
   editable field; this only decides what a row says before anybody renames it.

   PURE. Id in, label out. No React, no wire, no state.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The name a saved model wears until the reader gives it one.
 *
 * `provider` is the last resort before the plain word — a row that can only be
 * described as "the anthropic one" still says more than an empty row.
 */
export function defaultNickname(model: unknown, provider?: unknown): string {
  const id = typeof model === 'string' ? model : '';
  const withoutTag = id.replace(/:latest$/i, '');
  const lastSegment = withoutTag.split('/').filter(Boolean).pop() ?? withoutTag;
  const named = lastSegment.trim() || id.trim();
  if (named !== '') return named;
  const label = typeof provider === 'string' ? provider.trim() : '';
  return label !== '' ? label : 'local model';
}
