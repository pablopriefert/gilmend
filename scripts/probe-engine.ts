// `npm run probe -- open-weights --models --chat` (or `-- openrouter --image`): checks a real
// engine end to end WITHOUT running the agent, and prints only statuses and shapes, never a key.
//
//   --models  GET <base>/models (Baseten and OpenRouter): is the configured model id listed?
//   --image   one chat call with a demo photo: does the server accept image_url parts, and does
//             the model describe what is on it?
//   --tools   one chat call that must call a tool: does the server return tool_calls?
//   --chat    --image and --tools together.
//
// Each --image / --tools call spends a little real credit (a few cents at most). The keys come
// from .env.local (loaded by `tsx --env-file`). The photo is one of the AI-generated demo
// stand-ins in data/photos/, never customer data.
import path from "node:path";
import { photoToImageUrl } from "../src/lib/agent/photos";
import { describeEngine, resolveEngine, resolveOpenWeights } from "../src/lib/config";
import { getProvider } from "../src/lib/providers";
import type { Engine } from "../src/lib/types";

const args = process.argv.slice(2);
const requested = (args.find((a) => !a.startsWith("--")) ?? "open-weights") as Engine;
const flag = (name: string) => args.includes(`--${name}`) || (args.includes("--chat") && (name === "image" || name === "tools"));

async function main(): Promise<void> {
  if (requested !== "open-weights" && requested !== "openrouter") {
    console.error('Usage: npm run probe -- <open-weights|openrouter> [--models] [--image] [--tools] [--chat]');
    process.exit(1);
  }
  if (resolveEngine(requested, process.env) !== requested) {
    console.error(`${requested} is not configured in .env.local (see .env.example): nothing was sent.`);
    process.exit(1);
  }
  const detail = describeEngine(requested);
  console.log(`engine: ${requested} | model: ${detail.model} | host: ${detail.host}`);

  if (flag("models")) {
    const setup = requested === "open-weights" ? resolveOpenWeights() : null;
    const base = requested === "openrouter" ? "https://openrouter.ai/api/v1" : setup?.baseURL;
    const key = requested === "openrouter" ? process.env.OPENROUTER_API_KEY : setup?.apiKey;
    if (!base || !key || (detail.host !== "baseten" && detail.host !== "openrouter")) {
      console.log("models: skipped (the /models listing is only checked for Baseten and OpenRouter)");
    } else {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
      console.log(`models: HTTP ${res.status}`);
      if (res.ok) {
        const body = (await res.json()) as { data?: { id?: string }[] };
        const ids = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
        const muse = ids.filter((id) => /muse/i.test(id));
        console.log(`models: ${ids.length} listed, Muse ones: ${muse.join(", ") || "none"}`);
        console.log(
          ids.includes(detail.model)
            ? `models: "${detail.model}" IS listed`
            : `models: "${detail.model}" is NOT listed: set BASETEN_MODEL (or OPENROUTER_MODEL) to one of the ids above`,
        );
      }
    }
  }

  if (flag("image") || flag("tools")) {
    const provider = getProvider(requested, process.env);

    if (flag("image")) {
      const photo = path.join("data", "photos", "vase-broken.webp");
      const url = await photoToImageUrl(photo);
      try {
        const res = await provider.chat(
          {
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "Describe in one short sentence what object is in this photo and whether it looks damaged." },
                  { type: "image_url", image_url: { url } },
                ],
              },
            ],
          },
          { timeoutMs: 90_000 },
        );
        const msg = res.choices?.[0]?.message;
        console.log(
          `image: HTTP 200 | model: ${res.model} | finish: ${res.choices?.[0]?.finish_reason} | content ${msg?.content?.length ?? 0} chars | tokens in/out: ${res.usage?.prompt_tokens}/${res.usage?.completion_tokens}`,
        );
        console.log(`image: reply starts: ${JSON.stringify((msg?.content ?? "").slice(0, 120))}`);
      } catch (e) {
        console.log(`image: FAILED HTTP ${(e as { status?: number }).status ?? "?"} ${(e as Error).message.slice(0, 200)}`);
      }
    }

    if (flag("tools")) {
      try {
        const res = await provider.chat(
          {
            messages: [{ role: "user", content: "Call the tool get_order for order number #1001." }],
            tools: [
              {
                type: "function",
                function: {
                  name: "get_order",
                  description: "Fetch an order by number.",
                  parameters: {
                    type: "object",
                    properties: { orderNumber: { type: "string" } },
                    required: ["orderNumber"],
                  },
                },
              },
            ],
          },
          { timeoutMs: 90_000 },
        );
        const calls = (res.choices?.[0]?.message?.tool_calls ?? []).map((c) => (c.type === "function" ? c.function.name : c.type));
        console.log(
          `tools: HTTP 200 | model: ${res.model} | finish: ${res.choices?.[0]?.finish_reason} | tool calls: ${calls.join(", ") || "none"}`,
        );
      } catch (e) {
        console.log(`tools: FAILED HTTP ${(e as { status?: number }).status ?? "?"} ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
