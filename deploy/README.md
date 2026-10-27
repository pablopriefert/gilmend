# Deploying Muse Glimmer (open weights) on Modal

`modal_glimmer.py` serves Meta's open-weights **Muse Glimmer 30B** behind an
OpenAI-compatible endpoint (vLLM inside a Modal GPU container). Damage Desk's
"Run privately" switch then points at it through three environment variables.

**Status: written offline, never run, only syntax-checked.** Nothing here has touched
Modal, Hugging Face's download servers or a GPU. The facts below come from public pages
read on 27 October 2026; the checklist says what still has to be confirmed by a first
real run.

## Use it

```bash
pip install modal && modal setup                      # once
modal secret create damage-desk-glimmer VLLM_API_KEY=<long random value>
modal deploy deploy/modal_glimmer.py                  # prints the public URL
```

Then in `.env.local` (never committed):

```bash
OPEN_WEIGHTS_BASE_URL=<URL printed by modal deploy>/v1
OPEN_WEIGHTS_API_KEY=<the same VLLM_API_KEY value>
OPEN_WEIGHTS_MODEL=muse-glimmer          # the --served-model-name in the script
OPEN_WEIGHTS_PROXY_KEY=<Modal proxy auth token id (wk-...)>
OPEN_WEIGHTS_PROXY_SECRET=<Modal proxy auth token secret (ws-...)>
# optional: OPEN_WEIGHTS_REASONING_STRENGTH=high   (low | medium | high | xhigh)
```

Optional overrides when deploying: `GLIMMER_GPU` (default `H200`; `H100:2` for two H100),
`GLIMMER_MAX_MODEL_LEN` (default 32768), `GLIMMER_MIN_CONTAINERS=1` (keep one replica warm
for the demo recording; it bills while it runs, set it back to 0 afterwards),
`GLIMMER_MODEL_REVISION` (a commit of the Hugging Face repo; empty follows `main`).

## What to verify before the first deploy

I could not check these offline. Do them in this order; each one can break the run.

1. **Exact Hugging Face model id.** The script uses `meta-models/Muse-Glimmer-30B`
   (BF16, ~59.6 GB). The Hugging Face API showed it as public, not gated, licence
   `apache-2.0`, architecture `MuseGlimmerForConditionalGeneration`, last modified
   2026-10-22, commit `cec94fcfd6512f2cfe708138c32533b346ea4f69` (pinned in the script).
   Re-open the page and confirm the id and commit still exist. Other ids exist (GGUF,
   FP8 by RedHatAI, NVFP4 by Inferact, DFlash drafter `meta-models/Muse-Glimmer-30B-assistant`)
   but they are third-party or need different flags; the script does not use them.
2. **Licence acceptance.** Apache 2.0, and the model card links a usage policy
   (`USAGE_POLICY.md` in the repo). The repo is not gated, so no click-through and no
   Hugging Face token should be needed. If Hugging Face now asks for acceptance, accept it
   on the model page with the account whose token you then put in a Modal secret
   (`HF_TOKEN`) and add that secret to `secrets=[...]`. Read the usage policy once
   yourself: I only know it exists.
3. **GPU size.** BF16 weights are ~59.6 GB on disk (the vLLM recipe says ~72 GB with the
   runtime). One 80 GB H100 is therefore very tight; the script defaults to one H200
   (141 GB). Confirm the GPU names and prices on Modal's pricing page (`H200`, `H100` appear
   in Modal's own vLLM examples, but I did not check availability in your region/plan).
   Meta's card lists "Full precision: 64 GB VRAM" as the target hardware.
4. **vLLM version and parsers.** The recipe asks for **vLLM 0.28.0 or newer** and the
   flags `--enable-auto-tool-choice --tool-call-parser muse_glimmer --reasoning-parser
   muse_glimmer --generation-config auto`. The script uses the image
   `vllm/vllm-openai:v0.28.0`. Confirm that tag exists on Docker Hub. A community post
   (Reddit, DFlash on vLLM) mentions needing patches for *speculative decoding*, which this
   script does not enable.
5. **Tool calls and photos on this server.** Muse Glimmer writes tool calls in its own
   XML-like channel format, not JSON, so it only works with the two `muse_glimmer`
   parsers above. Run `modal run deploy/modal_glimmer.py` once, then run one real case
   (a report with a photo) and check in the case trace that the model called the tools
   and that the photo was understood.
6. **Structured output is not enforced.** vLLM issue #53469 reports that
   `response_format` / JSON mode is not enforced for Glimmer when the reasoning parser is
   on. Damage Desk therefore does not rely on it: the decision comes back through the
   `finish_case` tool call and is validated in code (`src/lib/agent/tools.ts`,
   `guardrails.ts`). Do not "fix" this by switching the agent to `response_format`.
7. **Modal API details.** The script uses `@app.cls` + `@modal.web_server` +
   `@modal.concurrent`, the pattern of Modal's published vLLM examples. Modal's API moves
   quickly (a newer `@app.server` also appears in its docs): if `modal deploy` complains,
   adapt to the current example. The public URL is whatever `modal deploy` prints; the
   shape in the script's docstring is a guess.
8. **Access control (two locks).** `--api-key` of vLLM protects only `/v1`, `/v2` and
   `/inference`; `/invocations` (same inference) stays open (vLLM docs, "API key
   authentication does not protect every endpoint"; vllm#51999). `@modal.web_server` would
   publish the port as is, so the script sets `requires_proxy_auth=True`: Modal answers 401
   on EVERY path unless the request carries `Modal-Key` / `Modal-Secret` (the token pair of
   https://modal.com/settings/proxy-auth-tokens, documented at
   https://modal.com/docs/guide/webhook-proxy-auth). Damage Desk sends the pair from
   `OPEN_WEIGHTS_PROXY_KEY` / `OPEN_WEIGHTS_PROXY_SECRET`. Not deployed, so unverified.
   Before sharing the URL, check with curl (replace the host):
   - `POST /invocations` **without** headers must answer **401**;
   - `POST /v1/chat/completions` without headers must answer **401**;
   - the same call with `Modal-Key`, `Modal-Secret` and `Authorization: Bearer <VLLM_API_KEY>`
     must answer 200.
9. **Cost.** A cold start downloads ~60 GB the first time (cached in a Modal Volume
   afterwards) and takes several minutes. `scaledown_window` is 10 minutes. Check Modal's
   credit balance before leaving a warm replica running.

## Sampling and behaviour notes

- Meta's recommended sampling is `temperature=1.0, top_p=0.95, top_k=64`; the vLLM recipe
  says not to run it greedy. `src/lib/providers/index.ts` sends exactly that for the
  `open-weights` engine.
- Reasoning strength is set with a `Reasoning strength: <low|medium|high|xhigh>` line in
  the system prompt; the provider appends it when `OPEN_WEIGHTS_REASONING_STRENGTH` is set.
- A tight `max_tokens` can cut the output before the final channel closes and return empty
  content; the agent sets no `max_tokens`.
- Context: 131,072 tokens supported; the script serves 32,768 to save KV cache.

## Alternatives if Modal does not work in time

- **Hosted Glimmer.** The Hugging Face API listed Together, DeepInfra and Featherless as
  live inference providers for `meta-models/Muse-Glimmer-30B` on 2026-10-27. Point
  `OPEN_WEIGHTS_BASE_URL`, `_API_KEY` and `_MODEL` at their OpenAI-compatible endpoint
  (check their model id and whether they enable tool calling and images; unverified).
- **Muse Spark Open** (`meta-models/Muse-Spark-Open-816B-A42B`, 816B parameters, 42B active)
  needs a multi-GPU node (vLLM's launch post uses `--tensor-parallel-size 8`), so it is
  only realistic through a provider. Same three variables.

## Sources (read 27 October 2026)

- Muse Glimmer model card (licence, architecture, sampling, best practices):
  https://huggingface.co/meta-models/Muse-Glimmer-30B
- Hugging Face model metadata (gated: false, licence, files, commit, providers), via the
  Hub API record for the same repo.
- vLLM recipe for Muse Glimmer (vLLM 0.28.0+, parsers, checkpoints and sizes, sampling,
  `max_tokens` note): https://recipes.vllm.ai/meta-models/Muse-Glimmer-30B
- vLLM issue on structured outputs with Glimmer:
  https://github.com/vllm-project/vllm/issues/53469
- Meta announcement (Apache 2.0, open weights):
  https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model
- Modal's OpenAI-compatible vLLM examples (patterns used in the script):
  https://modal.com/docs/examples/llm_inference and
  https://modal.com/docs/examples/ministral3_inference
- Meta Model API (Muse Spark, for the other engine): chat completions, tool calling and
  image understanding pages under https://dev.meta.ai/docs/
