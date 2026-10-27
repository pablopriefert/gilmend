// Fixtures and fakes shared by the agent and provider tests. Imported only by tests.
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatParams, Provider } from "../providers";
import type {
  CarrierRules,
  ClaimComputation,
  DamageReport,
  Evidence,
  Order,
} from "../types";
import type { AgentDeps } from "./run-agent";

export const REPORT_AT = "2026-10-27T10:00:00.000Z";
export const NOW = new Date("2026-10-27T10:05:00.000Z");

export function makeReport(over: Partial<DamageReport> = {}): DamageReport {
  return {
    id: "r1",
    receivedAt: REPORT_AT,
    customerEmail: "ada@example.com",
    orderNumber: "#1001",
    message: "My vase arrived broken, see photos.",
    photos: ["data:image/png;base64,AAAA"],
    language: "en",
    ...over,
  };
}

export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "#1001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    createdAt: "2026-10-20T09:00:00.000Z",
    deliveredAt: "2026-10-25T14:00:00.000Z",
    carrier: "colissimo",
    service: "Colissimo Domicile sans signature",
    trackingNumber: "6A00000000001",
    weightKg: 1.4,
    currency: "EUR",
    lineItems: [{ sku: "VASE-1", title: "Ceramic vase", quantity: 1, unitPrice: 59 }],
    total: 59,
    shippingAddress: { city: "Lyon", country: "FR" },
    ...over,
  };
}

export const RULES: CarrierRules = {
  carrier: "colissimo",
  label: "Colissimo",
  sources: [{ title: "Colissimo terms", url: "https://example.invalid/colissimo", checkedOn: "2026-10-27" }],
  reserveDeadlineHours: 0,
  claimDeadlineDays: 21,
  compensation: { perKgEur: 23, capEur: 690 },
  notes: ["Fictitious test rules."],
};

export const CLAIM_OK: ClaimComputation = {
  eligible: true,
  reasons: ["Reported within the carrier deadline."],
  maxCompensationEur: 32.2,
  claimDeadline: "2026-11-15T23:59:59.000Z",
  reserveDeadline: null,
  daysLeft: 19,
};

export function fakeDeps(over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    getOrder: async () => makeOrder(),
    markDamage: async (photo: string): Promise<Evidence> => ({
      photo,
      annotatedPhoto: "data:image/png;base64,BBBB",
      method: "sam-3.1",
      note: "outlined",
    }),
    getCarrierRules: () => RULES,
    computeClaim: () => CLAIM_OK,
    buildClaimDocument: async () => ({
      pdfPath: "data/runtime/claim.pdf",
      emailSubject: "Claim for parcel 6A00000000001",
      emailBody: "Please find the claim attached.",
    }),
    ...over,
  };
}

export const ASSESSMENT_BROKEN = {
  item: "Ceramic vase",
  damageType: "broken_product",
  severity: "major",
  carrierLikelyAtFault: true,
  packagingAdequate: false,
  evidenceNotes: ["Shards visible."],
  photoQuality: "ok",
};

export function decisionArgs(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: "reship",
    carrierClaim: true,
    confidence: 0.9,
    reasons: ["Vase is broken."],
    needsHuman: false,
    fraudSuspected: false,
    customerReply: "Sorry about this, we send a replacement.",
    ...over,
  };
}

export interface Turn {
  content?: string | null;
  calls?: Array<[name: string, args: unknown]>;
  /** Raw argument string, to simulate invalid JSON. */
  rawCalls?: Array<[name: string, rawArgs: string]>;
  throws?: Error;
}

/**
 * A provider that plays a fixed script, one entry per model turn, and records every
 * request it received so tests can check what the agent sent.
 */
export function scriptedProvider(turns: Turn[]): Provider & { requests: ChatParams[] } {
  const requests: ChatParams[] = [];
  let i = 0;
  return {
    engine: "muse-spark-1.3",
    model: "fake",
    isMock: false,
    requests,
    async chat(params: ChatParams): Promise<ChatCompletion> {
      // Deep copy: the agent keeps appending to the same messages array.
      requests.push({ ...params, messages: structuredClone(params.messages) as ChatCompletionMessageParam[] });
      const turn = turns[i++] ?? { content: "(script exhausted)" };
      if (turn.throws) throw turn.throws;
      const all = [
        ...(turn.calls ?? []).map(([n, a]) => [n, JSON.stringify(a)] as const),
        ...(turn.rawCalls ?? []),
      ];
      const tool_calls = all.map(([name, args], k) => ({
        id: `call_${i}_${k}`,
        type: "function" as const,
        function: { name, arguments: args },
      }));
      return {
        id: `fake-${i}`,
        object: "chat.completion",
        created: 0,
        model: "fake",
        choices: [
          {
            index: 0,
            finish_reason: tool_calls.length ? "tool_calls" : "stop",
            logprobs: null,
            message: {
              role: "assistant",
              refusal: null,
              content: turn.content ?? null,
              ...(tool_calls.length ? { tool_calls } : {}),
            },
          },
        ],
      };
    },
  };
}
