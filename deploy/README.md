# Open-weights engine ("Run privately")

Damage Desk's "Run privately" switch runs the same agent, tools and output schema on an
open-weights Muse model, and never calls the Meta Model API (SAM included). Two hosts are
supported, and the case, the trace, the badge and the claim PDF footer say which one actually ran
("Muse Spark Open (open weights, served by Baseten)", "Muse Glimmer (open weights, served by Modal)").

1. **Muse Spark Open on Baseten Model APIs** (primary: the "Best Build on Open Weights" bonus prize
   asks for Muse Glimmer or Muse Spark Open, served on a partner or on your own hardware).
2. **Muse Glimmer on Modal** (fallback, `modal_glimmer.py`, further down).

## Muse Spark Open on Baseten

**Status: written offline, never run against Baseten.** No Baseten credentials existed when this
was written, so no call to Baseten has been made. Everything below comes from Baseten's and Meta's
public pages read on 27 October 2026 (sources at the end); `npm run probe` checks it for real.

### Use it

Claim the hackathon credits, create a Baseten API key (https://app.baseten.co/settings/api_keys), then in
`.env.local` (never committed):

```bash
OPEN_WEIGHTS_PROVIDER=baseten
BASETEN_API_KEY=<your Baseten API key>
# optional, see "The slug" below:
# BASETEN_MODEL=meta-models/muse-spark-open
# optional reasoning depth, low | medium | high | xhigh (default medium here):
# OPEN_WEIGHTS_REASONING_STRENGTH=high
```

Nothing else is needed: the base URL is `https://inference.baseten.co/v1`, the model defaults to
`meta-models/muse-spark-open-1026`. Then check it, in this order (each step costs less than a cent
to a few cents):

```bash
npm run probe -- open-weights --models   # lists the Muse models Baseten offers; says if yours is listed
npm run probe -- open-weights --chat     # one photo call + one tool call: images and tools accepted?
npm run real -- demo-1-vase-broken open-weights      # one whole demo case on the private engine
```

(`npm run real -- <case-id> open-weights`: the case ids are printed when you give an unknown one.)
Without a key the app falls back to the labelled DEMO MODE, never to another host, and
`npm run dev:demo` empties `BASETEN_API_KEY` too, so it cannot spend Baseten credits.

### The slug: the hackathon guide and Baseten's docs disagree

The hackathon guide says the Baseten slug is `meta-models/muse-spark-open-1026`. Baseten's public
Model APIs page and its changelog of 15 Oct 2026 list `meta-models/muse-spark-open` (no date
suffix), and no public page mentions the `-1026` one. The code defaults to the guide's slug because
the hackathon may expose a pinned snapshot. If `npm run probe -- open-weights --models` says the
slug is not listed, set `BASETEN_MODEL` to one of the ids it prints. A wrong slug answers
HTTP 404 ("model not found"), which ends the run in a labelled "needs a human" case.

### What Baseten documents for Muse Spark Open

- **Endpoint**: OpenAI Chat Completions at `https://inference.baseten.co/v1/chat/completions`,
  `Authorization: Bearer <key>`. Also an Anthropic-style Messages endpoint (beta), not used.
- **Images**: yes. `image_url` parts, by HTTPS URL or base64 data URL. Muse Spark Open: at most 8
  images per request, 10 MB per image (URL), 100 MiB request body (base64), JPEG, PNG, WebP, GIF,
  BMP, TIFF. Damage Desk sends at most 3 photos as data URLs of at most 10 MB each.
- **Tool calling**: supported by every Model API model. The agent uses the standard `tools` field.
- **Structured output (`response_format`, JSON mode): NOT supported for Muse Spark Open.** Fine:
  the agent never uses `response_format`; the decision comes back through the `finish_case` tool
  call and is validated in code (same as for Glimmer, see below).
- **Reasoning**: always on, no switch. `reasoning_effort` accepts `low | medium | high | xhigh`
  (default `xhigh`; `none` and `minimal` run at `low`). The reasoning comes back in
  `message.reasoning_content`, counted in `completion_tokens` and billed. Damage Desk sends
  `medium` by default because `xhigh` over up to eight tool turns with photos may not fit the
  90 s budget of a run: **untested**, raise it with `OPEN_WEIGHTS_REASONING_STRENGTH` if the answers
  are weak and the time allows.
- **Sampling**: `temperature`, `top_p`, `top_k`, `stop`, penalties. The model card recommends
  `temperature=1.0, top_p=1.0`, top_k off: that is what is sent. `n > 1` answers 400; `seed` and
  `temperature=0` do not make it deterministic.
- **Context and output**: 1,048k tokens each.
- **Session affinity**: Baseten reuses the cached prompt prefix for requests that share an
  `x-session-affinity` header (the photos are re-sent every turn). The provider sends a random id
  per run, about 60 requests a minute at most per session as Baseten recommends. Nothing about the
  case goes in it.
- **Data**: Baseten states it does not store inputs or outputs of synchronous Model API requests
  (zero data retention). It is a shared hosted endpoint, not your own hardware: the UI says "the
  photos and the message go to Baseten".

### If the model cannot take the photos

`OPEN_WEIGHTS_VISION=0` declares a model without image input: the agent then does not send the
photos, says so in the trace ("The photos were NOT read by the model"), tells the model not to guess,
refuses any damage reading it writes anyway, drops the carrier claim and sends the case to a human.
The same happens automatically if the server answers HTTP 400, 413, 415 or 422 to the very first
request while photos are attached: one retry without photos, out loud, then a human. A case never
pretends to have read photos the model did not see.

### Muse Model License (what the code does about it)

Muse Spark Open is under the Muse Model License ("limited commercial terms"). As read on its
Hugging Face card: the licence text and usage policy travel with copies, the product shows
"Built with Muse Spark Open" in its UI or documentation, and a model-as-a-service business above 20
million USD of yearly revenue needs a separate agreement with Meta. Damage Desk shows "Built with
Muse Spark Open." in the footer whenever the configured open-weights model is Muse Spark Open. Read
the licence yourself before the submission.

### Verified by the partner

The prize says the build must be "verified by the partner". How Baseten verifies it is not described
on any page I could read, so ask through the hackathon channel. What this repository can offer:
Baseten's own dashboard shows Model API usage by API key and model (its pricing page describes usage
tracking), so use the hackathon API key only for this project, run the real demo cases on the private
engine, and keep case files that say "Muse Spark Open (open weights, served by Baseten)".

### Sources (read 27 October 2026)

- Baseten Model APIs (endpoint, slugs, feature table, limits):
  https://docs.baseten.co/inference/model-apis/overview
- Vision (image formats, limits per model): https://docs.baseten.co/inference/model-apis/vision
- Reasoning (`reasoning_effort`, `reasoning_content`): https://docs.baseten.co/inference/model-apis/reasoning
- Pricing and rate limits: https://docs.baseten.co/inference/model-apis/pricing-and-limits
- Baseten changelog, Muse Spark Open (15 Oct 2026):
  https://www.baseten.co/resources/changelog/muse-spark-open-and-nemotron-35-super-vl-available-on-baseten/
- Meta, Muse Spark Open (816B total, 42B active, 1M context, natively multimodal, hosted by Baseten,
  Fireworks, Groq, Modal, Nebius, OpenRouter, Together): https://research.meta.ai/blog/muse-spark-open
- Model card (sampling, reasoning effort, licence): https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
- vLLM day-0 post (tool and reasoning parsers, image/video/audio parts):
  https://vllm.ai/blog/2026-10-15-muse-spark-open

## Cheap test runs: OpenRouter

OpenRouter lists `meta/muse-spark-1.3` and `meta/muse-spark-open`. Setting `OPENROUTER_API_KEY` adds a
fourth engine, "Muse via OpenRouter (test)", to the report screen (only then), labelled "test engine,
not private" everywhere. It is never the default, never counts as the open-weights run, and does not
call SAM. `OPENROUTER_MODEL` changes the model (a `-contributor` id is refused in code). Requests ask
OpenRouter to route only to endpoints that do not store prompts or train on them
(`provider.data_collection: "deny"`).

```bash
npm run probe -- openrouter --models --image    # on 27 Oct 2026: HTTP 200, meta/muse-spark-1.3, photo read
npm run real -- demo-1-vase-broken openrouter               # one whole demo case
```

## Fallback: Muse Glimmer on Modal

`modal_glimmer.py` serves Meta's open-weights **Muse Glimmer 30B** behind an
OpenAI-compatible endpoint (vLLM inside a Modal GPU container). Damage Desk's
"Run privately" switch then points at it through the generic `OPEN_WEIGHTS_*` variables (leave
`OPEN_WEIGHTS_PROVIDER` empty).

**Status: written offline, never run, only syntax-checked.** Nothing here has touched
Modal, Hugging Face's download servers or a GPU. The facts below come from public pages
read on 27 October 2026; the checklist says what still has to be confirmed by a first
real run.

### Use it

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

### What to verify before the first deploy

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

### Sampling and behaviour notes

- Meta's recommended sampling is `temperature=1.0, top_p=0.95, top_k=64`; the vLLM recipe
  says not to run it greedy. `src/lib/providers/index.ts` sends exactly that for the
  `open-weights` engine.
- Reasoning strength is set with a `Reasoning strength: <low|medium|high|xhigh>` line in
  the system prompt; the provider appends it when `OPEN_WEIGHTS_REASONING_STRENGTH` is set.
- A tight `max_tokens` can cut the output before the final channel closes and return empty
  content; the agent sets no `max_tokens`.
- Context: 131,072 tokens supported; the script serves 32,768 to save KV cache.

### Alternatives if Modal does not work in time

- **Hosted Glimmer.** The Hugging Face API listed Together, DeepInfra and Featherless as
  live inference providers for `meta-models/Muse-Glimmer-30B` on 2026-10-27. Point
  `OPEN_WEIGHTS_BASE_URL`, `_API_KEY` and `_MODEL` at their OpenAI-compatible endpoint
  (check their model id and whether they enable tool calling and images; unverified).
- **Muse Spark Open** (`meta-models/Muse-Spark-Open-816B-A42B`, 816B parameters, 42B active)
  needs a multi-GPU node (vLLM's launch post uses `--tensor-parallel-size 8`), so it is
  only realistic through a provider: Baseten has the preset above; another provider takes the
  same three `OPEN_WEIGHTS_*` variables (the label then says "custom endpoint").

### Sources (read 27 October 2026)

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
