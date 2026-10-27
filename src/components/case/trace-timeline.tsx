"use client";

import { useMemo, type ReactNode } from "react";
import {
  BookOpenCheck,
  Calculator,
  CircleCheck,
  CircleDot,
  Cpu,
  EyeOff,
  FileText,
  Gavel,
  Inbox,
  MessageSquareText,
  PackageSearch,
  ScanEye,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Timeline, { type TimelineEvent } from "@/components/arc/timeline/timeline";
import type { AgentToolName, Engine, TraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { prettyJson } from "../display-data";
import styles from "./trace-timeline.module.css";

// The agent's reasoning trace as an Arc timeline. Each step says WHO did it, because that is
// what a reviewer needs to trust the page: the model reads and writes, the code looks things up,
// does the maths and applies the guardrails. Colour is never the only signal: every step has an
// icon and a word ("Model", "Code", "SAM 3.1", "Guardrail").

type Kind = "model" | "sam" | "code" | "guardrail" | "warning";

interface Described {
  kind: Kind;
  icon: LucideIcon;
  title: string;
  tone?: TimelineEvent["tone"];
}

const MODEL_NAME: Record<Engine, string> = {
  "muse-spark-1.3": "Muse Spark 1.3",
  "open-weights": "Open-weights model",
  openrouter: "Model via OpenRouter",
  "demo-mock": "Scripted mock (not Muse)",
};

/** The friendly name and who does the work, for each tool of the agent loop. */
const TOOL: Record<AgentToolName, { kind: Kind; icon: LucideIcon; title: string }> = {
  get_order: { kind: "code", icon: PackageSearch, title: "Looked up the order" },
  check_photo_integrity: { kind: "code", icon: ShieldCheck, title: "Checked the photos for reuse and capture date" },
  assess_photos: { kind: "model", icon: ScanEye, title: "Read the photos and described the damage" },
  mark_damage: { kind: "sam", icon: ScanSearch, title: "Outlined what SAM matched on the photo" },
  carrier_rules: { kind: "code", icon: BookOpenCheck, title: "Loaded the carrier's rules" },
  compute_claim: { kind: "code", icon: Calculator, title: "Computed the claim from the rules" },
  draft_claim: { kind: "code", icon: FileText, title: "Drafted the claim document" },
  draft_reply: { kind: "model", icon: Gavel, title: "Decided and wrote the customer reply" },
};

/** The tool name as the loop logs it ("Tool: get_carrier_rules") mapped to the trace's tool name. */
const LOGGED_TOOL: Record<string, AgentToolName> = {
  get_order: "get_order",
  check_photo_integrity: "check_photo_integrity",
  assess_photos: "assess_photos",
  mark_damage: "mark_damage",
  get_carrier_rules: "carrier_rules",
  compute_claim: "compute_claim",
  draft_claim_document: "draft_claim",
  finish_case: "draft_reply",
};

const MARKER: Record<Kind, string> = {
  model: "bg-accent text-white",
  sam: "bg-accent-soft text-accent",
  code: "bg-surface-muted text-ink-soft",
  guardrail: "bg-warning-soft text-warning",
  warning: "bg-danger-soft text-danger",
};

function describe(step: TraceStep): Described {
  const text = step.step;
  const logged = /^Tool( error)?: (\w+)/.exec(text);
  const tool: AgentToolName | undefined = step.tool ?? (logged ? LOGGED_TOOL[logged[2]] : undefined);

  if (/^Guardrail:/i.test(text)) return { kind: "guardrail", icon: ShieldAlert, title: text };
  if (/NOT read by the model/i.test(text)) return { kind: "warning", icon: EyeOff, title: text, tone: "danger" };
  if (logged?.[1]) return { kind: "warning", icon: TriangleAlert, title: text, tone: "danger" };
  if (/^Agent (did not reach a decision|error)/i.test(text)) return { kind: "warning", icon: TriangleAlert, title: text, tone: "danger" };
  if (/^Model note/i.test(text)) return { kind: "model", icon: MessageSquareText, title: text };
  if (/^Evidence fallback/i.test(text)) return { kind: "code", icon: ScanSearch, title: text };
  if (tool) {
    const t = TOOL[tool];
    // The loop logs "Tool: get_order"; say what it did. A trace that already has its own
    // sentence ("Looked up order #1042") keeps it.
    return { kind: t.kind, icon: t.icon, title: logged ? t.title : text };
  }
  if (/^Engine:/i.test(text)) return { kind: "code", icon: Cpu, title: text };
  if (/^Report received/i.test(text)) return { kind: "code", icon: Inbox, title: text };
  if (/^Case ready for review/i.test(text)) return { kind: "code", icon: CircleCheck, title: text, tone: "success" };
  return { kind: "code", icon: CircleDot, title: text };
}

function actorLabel(kind: Kind, engine: Engine, step: TraceStep): string {
  const mock = engine === "demo-mock";
  switch (kind) {
    case "model":
      return MODEL_NAME[engine];
    case "sam":
      return mock ? "Scripted mock (no SAM call)" : "SAM 3.1";
    case "guardrail":
      return "Guardrail (code)";
    case "warning":
      return "Warning";
    default:
      return /^Evidence fallback/i.test(step.step) ? "Code (calls SAM 3.1)" : "Code";
  }
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed text-ink">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

function detailFor(step: TraceStep, isNote: boolean): ReactNode | undefined {
  if (step.input === undefined && step.output === undefined) return undefined;
  // A model note is prose: show it as a quotation, not as JSON.
  if (isNote && typeof step.output === "string" && step.input === undefined) {
    return <p className="whitespace-pre-wrap border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-ink-soft">{step.output}</p>;
  }
  return (
    <div className="grid gap-3">
      {step.input !== undefined && <Payload label="Input" value={step.input} />}
      {step.output !== undefined && <Payload label="Output" value={step.output} />}
    </div>
  );
}

function seconds(ms: number): string {
  if (ms < 950) return `+${Math.max(0, Math.round(ms))} ms`;
  return `+${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

const LEGEND: { kind: Kind; icon: LucideIcon; label: (engine: Engine) => string; what: string }[] = [
  { kind: "model", icon: MessageSquareText, label: (e) => MODEL_NAME[e], what: "reads, reasons, writes" },
  { kind: "sam", icon: ScanSearch, label: (e) => (e === "demo-mock" ? "Scripted mock" : "SAM 3.1"), what: "outlines what it matches" },
  { kind: "code", icon: Calculator, label: () => "Code", what: "rules, maths, documents" },
  { kind: "guardrail", icon: ShieldAlert, label: () => "Guardrail", what: "code that corrects the model" },
];

/** Legend and timeline. Newest step first (the Arc timeline's order): the outcome, then how it got there. */
export function TraceTimeline({ trace, engine, fallbackAt }: { trace: TraceStep[]; engine: Engine; fallbackAt: string }) {
  const { events, now } = useMemo(() => {
    // Invalid dates would throw inside the timeline's date formatting: fall back to the case's own.
    const fallback = Date.parse(fallbackAt);
    const times: number[] = [];
    trace.forEach((s) => {
      const t = Date.parse(s.at);
      times.push(Number.isNaN(t) ? (times[times.length - 1] ?? (Number.isNaN(fallback) ? 0 : fallback)) : t);
    });
    const last = times[times.length - 1] ?? (Number.isNaN(fallback) ? 0 : fallback);
    const first = times[0] ?? last;
    const built: TimelineEvent[] = trace.map((step, i) => {
      const d = describe(step);
      const Icon = d.icon;
      const meta = [actorLabel(d.kind, engine, step), step.tool ?? null, seconds(times[i] - first)]
        .filter(Boolean)
        .join(" · ");
      return {
        id: `step-${i}`,
        // +i ms keeps steps logged in the same instant in their real order (the timeline sorts by time).
        at: times[i] + i,
        title: d.title,
        meta,
        tone: d.tone,
        icon: (
          <span data-kind={d.kind} className={cn("grid h-full w-full place-items-center rounded-full", MARKER[d.kind])}>
            <Icon aria-hidden="true" />
          </span>
        ),
        detail: detailFor(step, d.kind === "model" && /^Model note/i.test(step.step)),
      };
    });
    // The timeline labels a day "Today" and times "3m" against `now`; a case is read days after the
    // run, so pin `now` two days after the last step: absolute dates and clock times, same on the
    // server and in the browser.
    return { events: built, now: last + 2 * 86_400_000 };
  }, [trace, engine, fallbackAt]);

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted" aria-label="Who did what">
        {LEGEND.map(({ kind, icon: Icon, label, what }) => (
          <li key={kind} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("grid h-5 w-5 place-items-center rounded-full [&_svg]:h-3 [&_svg]:w-3", MARKER[kind])}>
              <Icon strokeWidth={2} />
            </span>
            <span>
              <span className="font-semibold text-ink-soft">{label(engine)}</span> {what}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.host}>
        <Timeline
          events={events}
          now={now}
          label="Reasoning steps, newest first"
          timeZone="Europe/Paris"
          locale="en-GB"
          maxHeight="34rem"
          scrollToNew={false}
          headingLevel={3}
        />
      </div>
    </div>
  );
}
