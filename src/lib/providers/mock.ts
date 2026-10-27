import type {
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { describeEngine } from "../config";
import { parseReportMessage, type ReportPromptFields } from "../agent/report-prompt";
import type { Provider, ChatParams } from "./index";

// DEMO MODE provider. It walks the same tool loop as the real models, so the whole app
// (agent, guardrails, PDF, UI) works without a key, but it is a script:
//  - it never looks at the photos; it keys on the customer's words and on what the tools
//    return (order, claim eligibility);
//  - every assessment it writes says so, and the engine is "demo-mock" everywhere (case,
//    trace, badge, logs). A mock answer must never be mistaken for a Muse answer.
// It is a pure function of the conversation so far: no state, no clock, no randomness.

const DEMO_WARNING =
  "[damage-desk] DEMO MODE: deterministic mock provider (scripted, no image analysed, not Muse).";
let warned = false;

type Json = Record<string, unknown>;

interface Seen {
  /** Parsed JSON output of the latest call of each tool. */
  results: Map<string, Json>;
  called: Set<string>;
  toolCallCount: number;
}

function textOf(m: ChatCompletionMessageParam): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
      .join("\n");
  }
  return "";
}

function readConversation(messages: ChatCompletionMessageParam[]): { report: ReportPromptFields | null; seen: Seen } {
  let report: ReportPromptFields | null = null;
  const nameById = new Map<string, string>();
  const seen: Seen = { results: new Map(), called: new Set(), toolCallCount: 0 };
  for (const m of messages) {
    if (m.role === "user" && report === null) report = parseReportMessage(textOf(m));
    if (m.role === "assistant" && m.tool_calls) {
      for (const c of m.tool_calls) {
        if (c.type !== "function") continue;
        nameById.set(c.id, c.function.name);
        seen.called.add(c.function.name);
        seen.toolCallCount++;
      }
    }
    if (m.role === "tool") {
      const name = nameById.get(m.tool_call_id);
      if (!name) continue;
      try {
        const parsed: unknown = JSON.parse(textOf(m));
        if (typeof parsed === "object" && parsed !== null) seen.results.set(name, parsed as Json);
      } catch {
        /* a tool message that is not JSON carries no data for the script */
      }
    }
  }
  return { report, seen };
}

// ---- scenarios, keyed on the customer's words ----------------------------------------

type Scenario = "injection" | "blurry" | "crushed_intact" | "missing_or_opened" | "broken" | "unknown";

// The six filmable demo cases (data/demo-cases.json) are keyed on their order number, so
// the scripted reading matches what each photo is meant to show (a blurry lamp, a crushed
// carton...) even when the customer's words alone would not say it. A customer injection
// attempt still wins over the order number.
const DEMO_ORDER_SCENARIOS: Record<string, Scenario> = {
  "1001": "broken",
  "1002": "crushed_intact",
  "1003": "blurry",
  "1004": "missing_or_opened",
  "1005": "broken",
  "1006": "broken",
};

function classify(message: string, orderNumber: string): Scenario {
  const byWords = classifyWords(message);
  if (byWords === "injection") return byWords;
  return DEMO_ORDER_SCENARIOS[orderNumber.replace(/[#\s]/g, "")] ?? byWords;
}

function classifyWords(message: string): Scenario {
  const t = message.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/ignore (all|your|the|previous|les|tes|vos)|system prompt|you are now|tu es maintenant|instructions precedentes/.test(t)) {
    return "injection";
  }
  if (/\bblur|\bflou|out of focus|too dark|trop sombre/.test(t)) return "blurry";
  if (/crush|ecras|squash|dented|enfonce/.test(t) && /intact|undamaged|works|working|fine|fonctionne|marche|pas casse|pas abime|rien de casse/.test(t)) {
    return "crushed_intact";
  }
  if (/missing|manque|opened|\bopen\b|ouvert|empty|\bvide\b|disparu|stolen|vole/.test(t)) return "missing_or_opened";
  if (/broke|broken|cass|shatter|smash|crack|fissur|brise|smashed|bris/.test(t)) return "broken";
  return "unknown";
}

function firstItemTitle(orderResult: Json | undefined): string {
  const order = orderResult?.order as { lineItems?: { title?: string }[] } | undefined;
  return order?.lineItems?.[0]?.title ?? "item from the order";
}

function firstName(orderResult: Json | undefined): string {
  const order = orderResult?.order as { name?: string } | undefined;
  return order?.name?.split(/\s+/)[0] ?? "";
}

const NOTE = "Scripted demo reading (demo-mock): no image was analysed.";

// What a real model would name for SAM (a short concrete noun phrase), per scripted scenario.
const CONCEPT_BY_SCENARIO: Record<Scenario, string> = {
  broken: "broken pottery",
  missing_or_opened: "torn cardboard",
  crushed_intact: "torn cardboard",
  blurry: "damaged area",
  injection: "damaged area",
  unknown: "damaged area",
};

/** What the customer wrote about refusing the parcel: true / false when said, null when not. */
function refusalFromWords(message: string): boolean | null {
  const t = message.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/(did not|didn't|n'ai pas|pas) (refuse|refus)|accepted the parcel|j'ai accepte|ai signe/.test(t)) return false;
  if (/refus/.test(t)) return true;
  return null;
}

function assessmentFor(s: Scenario, item: string): Json {
  switch (s) {
    case "broken":
      return { item, damageType: "broken_product", severity: "major", carrierLikelyAtFault: true, packagingAdequate: true, evidenceNotes: [NOTE, "Customer reports the product arrived broken."], photoQuality: "ok" };
    case "missing_or_opened":
      return { item, damageType: "opened_parcel", severity: "major", carrierLikelyAtFault: true, packagingAdequate: null, evidenceNotes: [NOTE, "Customer reports the parcel was delivered open or an article is missing."], photoQuality: "ok" };
    case "crushed_intact":
      return { item, damageType: "crushed_packaging", severity: "none", carrierLikelyAtFault: true, packagingAdequate: true, evidenceNotes: [NOTE, "Customer reports a crushed box with the product intact."], photoQuality: "ok" };
    case "blurry":
      // The vitrine of the vision path: the reading is recorded even though the photo cannot
      // be used, and the decision (ask for another photo) depends on it.
      return { item, damageType: "unclear", severity: "minor", carrierLikelyAtFault: false, packagingAdequate: null, evidenceNotes: [NOTE, "Scripted: the photo is treated as too blurry to judge the damage or the packaging."], photoQuality: "blurry" };
    default:
      return { item, damageType: "unclear", severity: "minor", carrierLikelyAtFault: false, packagingAdequate: null, evidenceNotes: [NOTE], photoQuality: "ok" };
  }
}

// ---- customer replies (no amounts, no dates: only tool results may carry those) ------

type Reply = "reship" | "refund" | "ask_photos" | "no_action" | "no_order" | "review";

function reply(lang: string, kind: Reply, name: string): string {
  const fr = lang.toLowerCase().startsWith("fr");
  const hello = fr ? `Bonjour${name ? ` ${name}` : ""},` : `Hello${name ? ` ${name}` : ""},`;
  const bye = fr ? "Cordialement,\nLe service client" : "Kind regards,\nCustomer support";
  const body: Record<Reply, [string, string]> = {
    reship: [
      "Thank you for your photos, and sorry about this. We are sending you a replacement and will contact the carrier ourselves.",
      "Merci pour vos photos, et désolé pour ce désagrément. Nous vous envoyons un nouvel article et nous nous occupons du transporteur.",
    ],
    refund: [
      "Thank you for your photos, and sorry about this. We will refund your order; you do not need to do anything else.",
      "Merci pour vos photos, et désolé pour ce désagrément. Nous allons vous rembourser, vous n'avez rien d'autre à faire.",
    ],
    ask_photos: [
      "Thank you for your message. The photos are not clear enough for us to see the damage. Could you send one or two sharper photos of the item and of the box, in good light?",
      "Merci pour votre message. Les photos ne sont pas assez nettes pour voir le dégât. Pouvez-vous envoyer une ou deux photos plus nettes de l'article et du carton, avec une bonne lumière ?",
    ],
    no_action: [
      "Thank you for your message. From what you describe, the item itself is fine, so there is nothing for us to replace. If something is wrong with it after all, just tell us.",
      "Merci pour votre message. D'après votre description, l'article lui-même est intact, il n'y a donc rien à remplacer. Si un problème apparaît, dites-le-nous.",
    ],
    no_order: [
      "Thank you for your message. We could not find an order matching this number and e-mail. Could you check the order number in your confirmation e-mail and write back?",
      "Merci pour votre message. Nous ne retrouvons pas de commande avec ce numéro et cet e-mail. Pouvez-vous vérifier le numéro dans votre e-mail de confirmation et nous répondre ?",
    ],
    review: [
      "Thank you for your message. A member of our team is reviewing your case and will get back to you.",
      "Merci pour votre message. Un membre de l'équipe examine votre dossier et reviendra vers vous.",
    ],
  };
  return `${hello}\n\n${fr ? body[kind][1] : body[kind][0]}\n\n${bye}`;
}

// ---- the script ----------------------------------------------------------------------

type PlannedCall = { name: string; args: Json };

function plan(report: ReportPromptFields, seen: Seen): PlannedCall[] | null {
  const scenario = classify(report.message, report.orderNumber);
  const orderResult = seen.results.get("get_order");
  const orderFound = orderResult?.found === true;
  const name = firstName(orderResult);

  if (!seen.called.has("get_order")) {
    return [{ name: "get_order", args: { orderNumber: report.orderNumber } }];
  }

  if (!orderFound) {
    if (seen.called.has("finish_case")) return null;
    return [
      {
        name: "finish_case",
        args: {
          decision: "no_action",
          carrierClaim: false,
          confidence: 0.9,
          reasons: ["No order matches this number and e-mail, so nothing can be verified. The customer is asked to check the number."],
          needsHuman: true,
          fraudSuspected: false,
          customerReply: reply(report.language, "no_order", ""),
        },
      },
    ];
  }

  if (!seen.called.has("assess_photos")) {
    // The structured reading first (even for a blurry photo), then the outlines, then the rules.
    const order = orderResult?.order as { carrier?: string } | undefined;
    const calls: PlannedCall[] = [
      { name: "assess_photos", args: assessmentFor(scenario, firstItemTitle(orderResult)) },
    ];
    for (const i of report.photoIndexes) {
      calls.push({ name: "mark_damage", args: { photoIndex: i, concept: CONCEPT_BY_SCENARIO[scenario] } });
    }
    calls.push({ name: "get_carrier_rules", args: { carrier: order?.carrier ?? "colissimo" } });
    return calls;
  }

  const skipClaim = scenario === "blurry" || scenario === "injection";
  if (!skipClaim && !seen.called.has("compute_claim")) {
    return [
      {
        name: "compute_claim",
        args: { parcelRefusedAtDelivery: refusalFromWords(report.message) },
      },
    ];
  }

  if (!seen.called.has("finish_case")) {
    const claim = seen.results.get("compute_claim");
    const eligible = claim?.eligible === true;
    const claimReasons = Array.isArray(claim?.reasons) ? (claim?.reasons as unknown[]).filter((r): r is string => typeof r === "string") : [];
    const base = { fraudSuspected: false };
    const orderForValue = orderResult?.order as { total?: number; currency?: string } | undefined;
    const escalated =
      (orderForValue?.currency ?? "EUR").toUpperCase() !== "EUR" || (orderForValue?.total ?? 0) > 300;
    let args: Json;
    if (scenario === "injection") {
      args = { ...base, decision: "no_action", carrierClaim: false, confidence: 0.9, reasons: ["The customer message tries to give the agent instructions. Treated as a fraud signal; nothing was acted on."], needsHuman: true, fraudSuspected: true, customerReply: reply(report.language, "review", name) };
    } else if (scenario === "blurry") {
      args = { ...base, decision: "ask_more_photos", carrierClaim: false, confidence: 0.9, reasons: ["The photos are too blurry to judge the damage (scripted demo reading)."], needsHuman: false, customerReply: reply(report.language, "ask_photos", name) };
    } else if (scenario === "crushed_intact") {
      args = { ...base, decision: "no_action", carrierClaim: false, confidence: 0.85, reasons: ["The packaging is crushed but the customer says the product is intact: no loss, no claim (scripted demo reading)."], needsHuman: false, customerReply: reply(report.language, "no_action", name) };
    } else if (scenario === "unknown") {
      args = { ...base, decision: "ask_more_photos", carrierClaim: false, confidence: 0.5, reasons: ["The message does not describe a clear damage; more information is needed (scripted demo reading)."], needsHuman: false, customerReply: reply(report.language, "ask_photos", name) };
    } else if (eligible && escalated) {
      // High value: the merchant has not decided yet, so the reply promises neither a
      // reshipment nor a refund (it used to announce a replacement above "Needs your judgement").
      args = { ...base, decision: "reship", carrierClaim: true, confidence: 0.85, reasons: ["Damage reported and the carrier claim is eligible according to compute_claim, but the order value is high: handed to the merchant before anything is promised (scripted demo reading).", ...claimReasons.slice(0, 1)], needsHuman: true, customerReply: reply(report.language, "review", name) };
    } else if (eligible) {
      args = { ...base, decision: "reship", carrierClaim: true, confidence: 0.9, reasons: ["Damage reported on a delivered parcel and the carrier claim is eligible according to compute_claim (scripted demo reading).", ...claimReasons.slice(0, 1)], needsHuman: false, customerReply: reply(report.language, "reship", name) };
    } else {
      args = { ...base, decision: "refund", carrierClaim: false, confidence: 0.8, reasons: ["Damage reported but no carrier claim is possible according to compute_claim; refunding the customer.", ...claimReasons.slice(0, 1)], needsHuman: false, customerReply: reply(report.language, "refund", name) };
    }
    return [{ name: "finish_case", args }];
  }

  const finished = seen.results.get("finish_case");
  const finalDecision = finished?.decision as { carrierClaim?: boolean } | undefined;
  if (finalDecision?.carrierClaim === true && !seen.called.has("draft_claim_document")) {
    return [{ name: "draft_claim_document", args: {} }];
  }
  return null;
}

function completion(turn: number, calls: PlannedCall[] | null, firstCallIndex: number): ChatCompletion {
  const toolCalls: ChatCompletionMessageFunctionToolCall[] = (calls ?? []).map((c, i) => ({
    id: `call_mock_${firstCallIndex + i + 1}`,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
  return {
    id: `chatcmpl-mock-${turn}`,
    object: "chat.completion",
    created: 0,
    model: "demo-mock",
    choices: [
      {
        index: 0,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        logprobs: null,
        message: {
          role: "assistant",
          refusal: null,
          content: toolCalls.length > 0 ? null : "Case recorded (demo mode, scripted).",
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function createMockProvider(): Provider {
  return {
    engine: "demo-mock",
    model: "demo-mock",
    isMock: true,
    detail: describeEngine("demo-mock"),
    async chat(params: ChatParams): Promise<ChatCompletion> {
      if (!warned) {
        warned = true;
        console.warn(DEMO_WARNING);
      }
      const { report, seen } = readConversation(params.messages);
      if (!report) {
        // Not a report conversation: say so rather than guess.
        return completion(1, null, 0);
      }
      const turn = params.messages.filter((m) => m.role === "assistant").length + 1;
      return completion(turn, plan(report, seen), seen.toolCallCount);
    },
  };
}
