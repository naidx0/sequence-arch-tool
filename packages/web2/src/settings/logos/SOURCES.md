# Logo sources

Fetched once with curl on 2026-10-16 and sanitised by `build-marks.mjs` into `agentMarks.ts` and `providerMarks.ts` (the only files the app reads;
nothing is fetched at run time). The sanitiser keeps only path and shape elements and the plain geometry attributes, draws
every colour in `currentColor`, and gives no mark to a file that needs more (gradients, raster, text, white cut-outs, over
3.5 KB for a provider). Those, and models.dev's own generic stand-in sparkle, get a monogram in the same box.
The marks are their owners' trademarks, shown to name the product they belong to.

To rebuild: curl each URL below into `<dir>/agent/<id>.svg` or `<dir>/prov/<id>.svg`, then
`node build-marks.mjs <dir> <providers.txt>`.

## Vendor marks from @lobehub/icons-static-svg (MIT, 1.95.1, the package shell2/brand already uses)

Fetched once with curl into an empty folder and sanitised by `build-lobe-marks.mjs` (same `sanitise.mjs` rules) into `lobeMarks.ts`.
For an agent the ACP registry set lacks. Licence text: shell2/brand/SOURCE.txt. Cursor, Gemini and OpenRouter were compared against the lobehub
files (cursor.svg, gemini.svg, openrouter.svg): same shapes, so the registry and models.dev marks above stay.

- hermes (Nous Research): https://unpkg.com/@lobehub/icons-static-svg@1.95.1/icons/nousresearch.svg

## Agents (ACP registry, https://github.com/agentclientprotocol/registry, served from its CDN)

- gemini: https://cdn.agentclientprotocol.com/registry/v1/latest/gemini.svg
- opencode: https://cdn.agentclientprotocol.com/registry/v1/latest/opencode.svg
- github-copilot-cli: https://cdn.agentclientprotocol.com/registry/v1/latest/github-copilot-cli.svg
- cursor: https://cdn.agentclientprotocol.com/registry/v1/latest/cursor.svg
- goose: https://cdn.agentclientprotocol.com/registry/v1/latest/goose.svg
- qwen-code: https://cdn.agentclientprotocol.com/registry/v1/latest/qwen-code.svg
- cline: https://cdn.agentclientprotocol.com/registry/v1/latest/cline.svg
- kimi: https://cdn.agentclientprotocol.com/registry/v1/latest/kimi.svg
- auggie: https://cdn.agentclientprotocol.com/registry/v1/latest/auggie.svg
- factory-droid: https://cdn.agentclientprotocol.com/registry/v1/latest/factory-droid.svg
- kilo: https://cdn.agentclientprotocol.com/registry/v1/latest/kilo.svg
- mistral-vibe: https://cdn.agentclientprotocol.com/registry/v1/latest/mistral-vibe.svg
- claude-acp: https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg
- codex-acp: https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg
- amp-acp: https://cdn.agentclientprotocol.com/registry/v1/latest/amp-acp.svg

## Providers (models.dev, https://github.com/sst/models.dev)

- abacus: https://models.dev/logos/abacus.svg
- above: https://models.dev/logos/above.svg
- agentrouter: https://models.dev/logos/agentrouter.svg
- agnes: https://models.dev/logos/agnes.svg
- ai-router: https://models.dev/logos/ai-router.svg
- aimlapi: https://models.dev/logos/aimlapi.svg
- aiand: https://models.dev/logos/aiand.svg
- ai21: https://models.dev/logos/ai21.svg
- ainetcafe: https://models.dev/logos/ainetcafe.svg
- aixy: https://models.dev/logos/aixy.svg
- aki-io: https://models.dev/logos/aki-io.svg
- alibaba: https://models.dev/logos/alibaba.svg
- alibaba-cn: https://models.dev/logos/alibaba-cn.svg
- alibaba-coding-plan: https://models.dev/logos/alibaba-coding-plan.svg
- alibaba-coding-plan-cn: https://models.dev/logos/alibaba-coding-plan-cn.svg
- alibaba-token-plan: https://models.dev/logos/alibaba-token-plan.svg
- amd: https://models.dev/logos/amd.svg
- anthropic: https://models.dev/logos/anthropic.svg
- anyapi: https://models.dev/logos/anyapi.svg
- arcee: https://models.dev/logos/arcee.svg
- auriko: https://models.dev/logos/auriko.svg
- bailing: https://models.dev/logos/bailing.svg
- baseten: https://models.dev/logos/baseten.svg
- berget: https://models.dev/logos/berget.svg
- blueclaw: https://models.dev/logos/blueclaw.svg
- bothub: https://models.dev/logos/bothub.svg
- boundless: https://models.dev/logos/boundless.svg
- cerebras: https://models.dev/logos/cerebras.svg
- cloudferro-sherlock: https://models.dev/logos/cloudferro-sherlock.svg
- wandb: https://models.dev/logos/wandb.svg
- crossmodel: https://models.dev/logos/crossmodel.svg
- drun: https://models.dev/logos/drun.svg
- daoxe: https://models.dev/logos/daoxe.svg
- deepseek: https://models.dev/logos/deepseek.svg
- llmgateway: https://models.dev/logos/llmgateway.svg
- digitalocean: https://models.dev/logos/digitalocean.svg
- ebcloud: https://models.dev/logos/ebcloud.svg
- echo: https://models.dev/logos/echo.svg
- empiriolabs: https://models.dev/logos/empiriolabs.svg
- engy: https://models.dev/logos/engy.svg
- evroc: https://models.dev/logos/evroc.svg
- fastrouter: https://models.dev/logos/fastrouter.svg
- fireworks-ai: https://models.dev/logos/fireworks-ai.svg
- friendli: https://models.dev/logos/friendli.svg
- github-copilot: https://models.dev/logos/github-copilot.svg
- google: https://models.dev/logos/google.svg
- greenpt: https://models.dev/logos/greenpt.svg
- groq: https://models.dev/logos/groq.svg
- helicone: https://models.dev/logos/helicone.svg
- iflowcn: https://models.dev/logos/iflowcn.svg
- impossibl: https://models.dev/logos/impossibl.svg
- inception: https://models.dev/logos/inception.svg
- inceptron: https://models.dev/logos/inceptron.svg
- inco: https://models.dev/logos/inco.svg
- inference: https://models.dev/logos/inference.svg
- inferx: https://models.dev/logos/inferx.svg
- io-net: https://models.dev/logos/io-net.svg
- jalapeno: https://models.dev/logos/jalapeno.svg
- jiekou: https://models.dev/logos/jiekou.svg
- kilo: https://models.dev/logos/kilo.svg
- kuae-cloud-coding-plan: https://models.dev/logos/kuae-cloud-coding-plan.svg
- lilac: https://models.dev/logos/lilac.svg
- llama: https://models.dev/logos/llama.svg
- llmgateway-providers: https://models.dev/logos/llmgateway-providers.svg
- llmtech: https://models.dev/logos/llmtech.svg
- llmtr: https://models.dev/logos/llmtr.svg
- longcat: https://models.dev/logos/longcat.svg
- lowrouter: https://models.dev/logos/lowrouter.svg
- melious: https://models.dev/logos/melious.svg
- mistral: https://models.dev/logos/mistral.svg
- mixlayer: https://models.dev/logos/mixlayer.svg
- moark: https://models.dev/logos/moark.svg
- modal: https://models.dev/logos/modal.svg
- model-oracle-ai: https://models.dev/logos/model-oracle-ai.svg
- modelis: https://models.dev/logos/modelis.svg
- modelscope: https://models.dev/logos/modelscope.svg
- nan: https://models.dev/logos/nan.svg
- nano-gpt: https://models.dev/logos/nano-gpt.svg
- nearai: https://models.dev/logos/nearai.svg
- nebius: https://models.dev/logos/nebius.svg
- nova: https://models.dev/logos/nova.svg
- novita-ai: https://models.dev/logos/novita-ai.svg
- nvidia: https://models.dev/logos/nvidia.svg
- oci: https://models.dev/logos/oci.svg
- ofox: https://models.dev/logos/ofox.svg
- openai: https://models.dev/logos/openai.svg
- opencode: https://models.dev/logos/opencode.svg
- opencode-go: https://models.dev/logos/opencode-go.svg
- openreason: https://models.dev/logos/openreason.svg
- openrouter: https://models.dev/logos/openrouter.svg
- opper: https://models.dev/logos/opper.svg
- ovhcloud: https://models.dev/logos/ovhcloud.svg
- pareto: https://models.dev/logos/pareto.svg
- pendra: https://models.dev/logos/pendra.svg
- pioneer: https://models.dev/logos/pioneer.svg
- poe: https://models.dev/logos/poe.svg
- poolside: https://models.dev/logos/poolside.svg
- qihang-ai: https://models.dev/logos/qihang-ai.svg
- qiniu-ai: https://models.dev/logos/qiniu-ai.svg
- regolo-ai: https://models.dev/logos/regolo-ai.svg
- routing-run: https://models.dev/logos/routing-run.svg
- runinfra: https://models.dev/logos/runinfra.svg
- scaleway: https://models.dev/logos/scaleway.svg
- scnet-token-plan: https://models.dev/logos/scnet-token-plan.svg
- scx-ai: https://models.dev/logos/scx-ai.svg
- sensenova: https://models.dev/logos/sensenova.svg
- siliconflow: https://models.dev/logos/siliconflow.svg
- siliconflow-cn: https://models.dev/logos/siliconflow-cn.svg
- stackit: https://models.dev/logos/stackit.svg
- standardcompute: https://models.dev/logos/standardcompute.svg
- submodel: https://models.dev/logos/submodel.svg
- tempr: https://models.dev/logos/tempr.svg
- tencent-coding-plan: https://models.dev/logos/tencent-coding-plan.svg
- tencent-token-plan: https://models.dev/logos/tencent-token-plan.svg
- tencent-tokenhub: https://models.dev/logos/tencent-tokenhub.svg
- tensorx: https://models.dev/logos/tensorx.svg
- the-grid-ai: https://models.dev/logos/the-grid-ai.svg
- tinfoil: https://models.dev/logos/tinfoil.svg
- togetherai: https://models.dev/logos/togetherai.svg
- tokengo: https://models.dev/logos/tokengo.svg
- tokenrouter: https://models.dev/logos/tokenrouter.svg
- trustedrouter: https://models.dev/logos/trustedrouter.svg
- unorouter: https://models.dev/logos/unorouter.svg
- vancine: https://models.dev/logos/vancine.svg
- vispark: https://models.dev/logos/vispark.svg
- volcengine: https://models.dev/logos/volcengine.svg
- volcengine-coding-plan: https://models.dev/logos/volcengine-coding-plan.svg
- vultr: https://models.dev/logos/vultr.svg
- xai: https://models.dev/logos/xai.svg
- xiaomi: https://models.dev/logos/xiaomi.svg
- xiaomi-token-plan-cn: https://models.dev/logos/xiaomi-token-plan-cn.svg
- xiaomi-token-plan-ams: https://models.dev/logos/xiaomi-token-plan-ams.svg
- xiaomi-token-plan-sgp: https://models.dev/logos/xiaomi-token-plan-sgp.svg
- xpersona: https://models.dev/logos/xpersona.svg
- zai: https://models.dev/logos/zai.svg
- zai-coding-plan: https://models.dev/logos/zai-coding-plan.svg
- zeldoc: https://models.dev/logos/zeldoc.svg
- zenifra: https://models.dev/logos/zenifra.svg
- zhipuai: https://models.dev/logos/zhipuai.svg
- zhipuai-coding-plan: https://models.dev/logos/zhipuai-coding-plan.svg
