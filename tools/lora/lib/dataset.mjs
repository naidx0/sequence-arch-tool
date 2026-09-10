/**
 * Training-file emitter, and the artifact that stops the one failure that
 * silently ruins a run.
 *
 * `docs/lora-operator-guide.md` §7 calls chat-template mismatch "the single
 * highest-risk silent failure": if the training render differs even slightly
 * from what inference sends, loss falls normally and the model still produces
 * subtly wrong output. Nobody catches it by reading code. So
 * `renderVerifyTemplate` is a FIRST-CLASS OUTPUT of every dataset build — one
 * fully-rendered training example printed directly above one fully-rendered
 * inference prompt, special tokens and all, with the machine's own byte-level
 * verdict beneath them, so the owner can diff them by eye in ten seconds.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * One training row, in the chat format Qwen2.5-Coder-Instruct expects.
 *
 * A SINGLE user message and no system role — because that is exactly what
 * production sends. `POST /api/ask` hands `buildAskPrompt`'s output to the
 * provider as one user message (`packages/analyzer/src/server/provider.ts`).
 * Adding a system turn here would train a layout inference never produces.
 */
export function toChatSample({ prompt, completion, meta }) {
  if (typeof prompt !== 'string' || prompt === '') throw new TypeError('toChatSample: prompt must be a non-empty string');
  if (typeof completion !== 'string' || completion === '') throw new TypeError('toChatSample: completion must be a non-empty string');
  const row = {
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: completion },
    ],
  };
  if (meta) row.meta = meta;
  return row;
}

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  return file;
}

export function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${file}: line ${i + 1} is not valid JSON: ${e.message}`);
      }
    });
}

/** Structural check on a finished JSONL row — used by the build and by the tests. */
export function validateChatSample(row) {
  const problems = [];
  if (!row || !Array.isArray(row.messages)) problems.push('missing `messages` array');
  else {
    if (row.messages.length !== 2) problems.push(`expected exactly 2 messages, got ${row.messages.length}`);
    const [u, a] = row.messages;
    if (u?.role !== 'user') problems.push(`first message role is "${u?.role}", expected "user"`);
    if (a?.role !== 'assistant') problems.push(`second message role is "${a?.role}", expected "assistant"`);
    for (const m of row.messages) {
      if (typeof m?.content !== 'string' || m.content === '') problems.push(`a ${m?.role} message has empty content`);
    }
  }
  return problems;
}

export const IM_START = '<|im_start|>';
export const IM_END = '<|im_end|>';

/**
 * ChatML as Qwen2.5 renders it — TRANSCRIBED HERE, NOT AUTHORITATIVE.
 *
 * We cannot download the tokenizer in this repo (and this round deliberately
 * downloads nothing), so this is our best reproduction of Qwen2.5's
 * `chat_template`, printed into the verification artifact for the owner to
 * compare against the real thing. The guide is explicit: "Never trust a template
 * silently supplied by a wrapper library." That warning applies to this function
 * too — the artifact tells the owner to print `tokenizer.chat_template` and
 * check it against what is written here, and the whole point of the exercise is
 * that a mismatch becomes visible rather than silent.
 *
 * Note the default system turn: Qwen2.5's own template inserts
 * "You are Qwen, created by Alibaba Cloud..." when no system message is given.
 * That is fine PROVIDED it happens on both sides — which is exactly what the
 * artifact's verdict checks.
 */
export const QWEN_DEFAULT_SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';

export function renderQwenChatML(messages, { addGenerationPrompt = false, includeDefaultSystem = true } = {}) {
  const out = [];
  const hasSystem = messages.some((m) => m.role === 'system');
  if (!hasSystem && includeDefaultSystem) out.push(`${IM_START}system\n${QWEN_DEFAULT_SYSTEM}${IM_END}\n`);
  for (const m of messages) out.push(`${IM_START}${m.role}\n${m.content}${IM_END}\n`);
  if (addGenerationPrompt) out.push(`${IM_START}assistant\n`);
  return out.join('');
}

/**
 * Do the training render and the inference render agree, byte for byte, up to
 * the point where the model starts writing?
 *
 * @returns {{identical: boolean, prefixLength: number, firstDivergence: number|null, trainingContext: string, inferenceContext: string}}
 */
export function comparePrefixes(trainingRender, inferenceRender) {
  const n = Math.min(trainingRender.length, inferenceRender.length);
  let i = 0;
  while (i < n && trainingRender[i] === inferenceRender[i]) i++;
  const identical = i === inferenceRender.length;
  return {
    identical,
    prefixLength: i,
    firstDivergence: identical ? null : i,
    trainingContext: trainingRender.slice(Math.max(0, i - 60), i + 60),
    inferenceContext: inferenceRender.slice(Math.max(0, i - 60), i + 60),
  };
}

const RULE = '='.repeat(78);

/**
 * The artifact. Written on every dataset build, next to the JSONL.
 *
 * @param {object} args
 * @param {object} args.trainingSample a row from `toChatSample`
 * @param {string} args.inferencePrompt the prompt the eval/product path will send
 * @param {object} [args.context] free-form provenance printed at the top
 */
export function renderVerifyTemplate({ trainingSample, inferencePrompt, context = {} }) {
  const trainingRender = renderQwenChatML(trainingSample.messages);
  const inferenceRender = renderQwenChatML([{ role: 'user', content: inferencePrompt }], {
    addGenerationPrompt: true,
  });
  // The comparable part: everything the model SEES before it writes. For the
  // training row that is the user turn plus the assistant header; for inference
  // it is the same thing followed by the generation prompt.
  const trainingUpToAssistant = trainingRender.slice(0, trainingRender.indexOf(`${IM_START}assistant\n`) + `${IM_START}assistant\n`.length);
  const verdict = comparePrefixes(trainingUpToAssistant, inferenceRender);

  const L = [];
  L.push(RULE);
  L.push('CHAT-TEMPLATE VERIFICATION — read this before you spend a GPU-hour.');
  L.push(RULE);
  L.push('');
  L.push('docs/lora-operator-guide.md §7: a training/inference formatting gap is the single');
  L.push('highest-risk silent failure in fine-tuning. Loss goes down normally, the model');
  L.push('still produces subtly wrong output, and everyone misdiagnoses it as "bad data".');
  L.push('It is invisible in code and obvious on the page. So: read the two renders below');
  L.push('side by side, by eye, before training anything.');
  L.push('');
  for (const [k, v] of Object.entries(context)) L.push(`  ${k}: ${v}`);
  L.push('');
  L.push(RULE);
  L.push('A · ONE FULLY-RENDERED TRAINING EXAMPLE  (what the trainer sees)');
  L.push(RULE);
  L.push(trainingRender);
  L.push(RULE);
  L.push('B · ONE FULLY-RENDERED INFERENCE PROMPT  (what Sequence sends at run time)');
  L.push(RULE);
  L.push(inferenceRender);
  L.push('');
  L.push(RULE);
  L.push('C · THE MACHINE\'S VERDICT (a starting point, not a substitute for reading A and B)');
  L.push(RULE);
  if (verdict.identical) {
    L.push('IDENTICAL up to the assistant turn: every byte the model sees before it starts');
    L.push(`writing is the same in training and at inference (${verdict.prefixLength} bytes compared).`);
  } else {
    L.push(`DIVERGES at byte ${verdict.firstDivergence}. This is the failure §7 warns about.`);
    L.push('');
    L.push('  training  ...' + JSON.stringify(verdict.trainingContext));
    L.push('  inference ...' + JSON.stringify(verdict.inferenceContext));
  }
  L.push('');
  L.push(RULE);
  L.push('D · WHAT ONLY YOU CAN CHECK (the machine cannot, and did not)');
  L.push(RULE);
  L.push('1. The ChatML above is OUR TRANSCRIPTION of Qwen2.5\'s template, not the real one —');
  L.push('   this repo downloads no weights and no tokenizer. On the training box, run:');
  L.push('');
  L.push('     from transformers import AutoTokenizer');
  L.push('     tok = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-Coder-7B-Instruct")');
  L.push('     print(tok.chat_template)');
  L.push('     print(tok.apply_chat_template(json.loads(first_line)["messages"], tokenize=False))');
  L.push('');
  L.push('   and confirm its output matches section A character for character. If it does');
  L.push('   not, THE TEMPLATE WINS — fix the renderer here, never the data.');
  L.push('2. EOS placement: the assistant turn must END with ' + IM_END + ' and the trainer must');
  L.push('   emit an EOS token there. A run that never sees EOS produces a model that never');
  L.push('   stops — which reads as a format failure and gets blamed on the data.');
  L.push('3. The default system turn: Qwen inserts one when the messages carry none. It is');
  L.push('   printed in BOTH sections above. Confirm your trainer does the same thing your');
  L.push('   Ollama Modelfile TEMPLATE will do at serving time (guide §6.1 step 4).');
  L.push('4. The proposal fence: confirm the assistant turn in section A wraps its');
  L.push('   ```proposal block exactly the way extractArchProposalFromAnswer will see it at');
  L.push('   inference — that parser is the metric Phase 0 is judged on.');
  L.push('');
  return L.join('\n');
}
