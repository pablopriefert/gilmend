"""Muse Glimmer (Meta open weights) on Modal, behind an OpenAI-compatible endpoint.

NOT RUN. Written offline against public documentation (sources in deploy/README.md) and
only syntax-checked. Read "What to verify before the first deploy" in deploy/README.md.

What it does: starts `vllm serve` for meta-models/Muse-Glimmer-30B inside a Modal GPU
container and exposes vLLM's OpenAI-compatible server (/v1/chat/completions, /health).
Gilmend then talks to it like to any OpenAI endpoint:

    OPEN_WEIGHTS_BASE_URL=https://<workspace>--damage-desk-glimmer-glimmer-serve.modal.run/v1
    OPEN_WEIGHTS_API_KEY=<the VLLM_API_KEY you stored in the Modal secret>
    OPEN_WEIGHTS_PROXY_KEY=<Modal proxy auth token id, wk-...>
    OPEN_WEIGHTS_PROXY_SECRET=<Modal proxy auth token secret, ws-...>
    OPEN_WEIGHTS_MODEL=muse-glimmer          # = --served-model-name below

Two locks, on purpose. vLLM's --api-key only protects /v1, /v2 and /inference: /invocations,
which offers the same inference, stays open (vLLM docs, "API key authentication does not
protect every endpoint"; vllm#51999). Modal's proxy auth (requires_proxy_auth=True below)
protects the WHOLE public URL, whatever the path. Create the token pair at
https://modal.com/settings/proxy-auth-tokens.

Deploy (by hand, after reading the README):
    modal secret create damage-desk-glimmer VLLM_API_KEY=<a long random value>
    modal deploy deploy/modal_glimmer.py
"""

import json
import os
import subprocess
import urllib.request

import modal

MINUTES = 60  # seconds

# --- configuration (all overridable from the shell that runs `modal deploy`) ------------

# Official BF16 checkpoint, Apache 2.0, not gated (HF API, checked 27 Oct 2026).
MODEL_ID = os.environ.get("GLIMMER_MODEL_ID", "meta-models/Muse-Glimmer-30B")
# Pinned to the commit seen on 27 Oct 2026 so a later push to the repo cannot change what
# the demo runs. Set GLIMMER_MODEL_REVISION="" to follow main instead.
MODEL_REVISION = os.environ.get(
    "GLIMMER_MODEL_REVISION", "cec94fcfd6512f2cfe708138c32533b346ea4f69"
)
# Name clients use as the `model` field.
SERVED_MODEL_NAME = "muse-glimmer"

# BF16 weights are ~60 GB (59.58 GB of safetensors). One 80 GB H100 is very tight once the
# vision encoder and KV cache are added; one H200 (141 GB) is comfortable. Use
# GLIMMER_GPU="H100:2" for two H100s (tensor parallel is derived from the count).
GPU = os.environ.get("GLIMMER_GPU", "H200")
N_GPU = int(GPU.split(":")[1]) if ":" in GPU else 1

# Gilmend prompts are small (system prompt + 1 to 3 photos + tool results), so a short
# context keeps the KV cache cheap. The model supports 131,072.
MAX_MODEL_LEN = int(os.environ.get("GLIMMER_MAX_MODEL_LEN", "32768"))

# 0 = scale to zero (cold start of several minutes to load 60 GB, cheapest).
# 1 = keep one container warm: set it for the demo recording, unset it after (it bills).
MIN_CONTAINERS = int(os.environ.get("GLIMMER_MIN_CONTAINERS", "0"))

VLLM_PORT = 8000

# vLLM recipe for Muse Glimmer says "vLLM 0.28.0+" and uses this exact image tag.
vllm_image = (
    modal.Image.from_registry("vllm/vllm-openai:v0.28.0")
    .entrypoint([])  # the image's default entrypoint would start its own server
    .env(
        {
            "HF_HUB_CACHE": "/root/.cache/huggingface",
            "HF_XET_HIGH_PERFORMANCE": "1",  # faster weight download
        }
    )
)

# Weights and compilation artefacts survive container restarts, so only the first cold
# start downloads 60 GB.
hf_cache = modal.Volume.from_name("damage-desk-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("damage-desk-vllm-cache", create_if_missing=True)

app = modal.App("damage-desk-glimmer")


@app.cls(
    image=vllm_image,
    gpu=GPU,
    volumes={
        "/root/.cache/huggingface": hf_cache,
        "/root/.cache/vllm": vllm_cache,
    },
    # Secret holding VLLM_API_KEY. Without it the public URL would be an open GPU.
    secrets=[modal.Secret.from_name("damage-desk-glimmer")],
    scaledown_window=10 * MINUTES,
    timeout=30 * MINUTES,
    min_containers=MIN_CONTAINERS,
)
@modal.concurrent(max_inputs=8)
class Glimmer:
    @modal.enter()
    def start(self):
        api_key = os.environ["VLLM_API_KEY"]  # KeyError here = the Modal secret is missing
        cmd = [
            "vllm",
            "serve",
            MODEL_ID,
            "--served-model-name",
            SERVED_MODEL_NAME,
            "--host",
            "0.0.0.0",
            "--port",
            str(VLLM_PORT),
            "--api-key",
            api_key,
            "--tensor-parallel-size",
            str(N_GPU),
            "--max-model-len",
            str(MAX_MODEL_LEN),
            "--max-num-seqs",
            "16",
            "--gpu-memory-utilization",
            "0.90",
            # Photos only (up to 3 per report, 4 for headroom); no video or audio.
            "--limit-mm-per-prompt",
            json.dumps({"image": 4, "video": 0, "audio": 0}),
            # Glimmer does not emit JSON tool calls nor <think> tags: it uses its own
            # channel format, so BOTH dedicated parsers are required (vLLM recipe).
            "--enable-auto-tool-choice",
            "--tool-call-parser",
            "muse_glimmer",
            "--reasoning-parser",
            "muse_glimmer",
            # Use the sampling defaults shipped in generation_config.json.
            "--generation-config",
            "auto",
        ]
        if MODEL_REVISION:
            cmd += ["--revision", MODEL_REVISION]
        print("starting:", " ".join(c if c != api_key else "***" for c in cmd))
        self.process = subprocess.Popen(cmd)

    # requires_proxy_auth: without a valid Modal-Key / Modal-Secret pair Modal answers 401
    # before the request reaches vLLM, on every path (including /invocations).
    @modal.web_server(port=VLLM_PORT, startup_timeout=20 * MINUTES, requires_proxy_auth=True)
    def serve(self):
        # vLLM is already listening on VLLM_PORT; Modal proxies this port to a public URL.
        pass

    @modal.exit()
    def stop(self):
        self.process.terminate()


@app.local_entrypoint()
def smoke():
    """`modal run deploy/modal_glimmer.py`: one health check and one tiny chat call.

    Starts a fresh replica, so it bills GPU time and takes minutes on a cold cache.
    """
    url = Glimmer().serve.get_web_url()
    # The same token pair Gilmend sends (OPEN_WEIGHTS_PROXY_KEY / _SECRET), read from the shell.
    proxy = {
        "Modal-Key": os.environ.get("OPEN_WEIGHTS_PROXY_KEY", ""),
        "Modal-Secret": os.environ.get("OPEN_WEIGHTS_PROXY_SECRET", ""),
    }
    health = urllib.request.Request(f"{url}/health", headers=proxy)
    print("health:", urllib.request.urlopen(health, timeout=20 * MINUTES).status)
    # The key lives only in the Modal secret; read it from your shell for this check.
    key = os.environ.get("VLLM_API_KEY", "")
    req = urllib.request.Request(
        f"{url}/v1/chat/completions",
        data=json.dumps(
            {
                "model": SERVED_MODEL_NAME,
                "messages": [{"role": "user", "content": "Say hello in five words."}],
                # Glimmer reasons before answering and the channel format can cut a short
                # budget before the final answer: leave room.
                "max_tokens": 1024,
            }
        ).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", **proxy},
    )
    print(json.load(urllib.request.urlopen(req, timeout=5 * MINUTES))["choices"][0]["message"])
