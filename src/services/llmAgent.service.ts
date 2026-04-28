import OpenAI from "openai";
import { config } from "../config/env";
import { EventPayloadSchema, type EventPayload, type EventScheduledItem, type EventType } from "../types/event.types";
import type { LlmRoutingCandidate, LlmRoutingContextBundle } from "../types/llmIngestContext.types";

export interface AgentEmailData {
  subject: string;
  body: string;
  from: string;
  userEmail: string;
  userId?: string;
  provider: "gmail" | "outlook";
  inboxEmail?: string;
  messageId: string;
  threadId?: string;
  receivedAt: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ROUTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["existing", "new"] },
    applicationId: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
    isJobRelated: { type: "boolean" },
  },
  required: ["isJobRelated", "decision", "confidence", "reason"],
} as const;

const EVENT_TYPE_ENUM = [
  "OA",
  "INTERVIEW",
  "OFFER",
  "REJECTION",
  "ACKNOWLEDGEMENT",
  "RESCHEDULE",
  "UPDATE",
  "ACTION_REQUIRED",
  "OTHER_UPDATE",
  "CANCELLATION",
  "STAGE_ROLLBACK",
] as const;

const STATUS_ENUM = ["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"] as const;

/** One scheduled/actionable item — nested under step-2 root. */
const EXTRACT_SCHEDULED_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "One OA, interview, deadline, or other action block with its own startAt.",
  properties: {
    type: { type: "string", enum: ["OA", "INTERVIEW", "DEADLINE", "OTHER"] },
    title: {
      type: "string",
      description: 'e.g. "Team interview — session 1", "Coding round 2"',
    },
    startAt: { type: "string", format: "date-time" },
    endAt: { type: "string", format: "date-time" },
    duration: {
      type: "number",
      description: "Minutes for this block (e.g. 45 for a 45-minute session).",
    },
    companyName: { type: "string" },
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, url: { type: "string" } },
        required: ["label", "url"],
      },
    },
    notes: { type: "string", description: "Optional; disambiguate back-to-back sessions if needed." },
  },
  required: ["type", "title", "startAt"],
} as const;

/** Event row fields (pipeline) — nested under step-2 root. */
const EXTRACT_EVENT_BLOB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "Single application event classification and summary for this email.",
  properties: {
    companyName: { type: "string" },
    roleTitle: { type: "string" },
    status: { type: "string", enum: STATUS_ENUM },
    eventType: { type: "string", enum: EVENT_TYPE_ENUM },
    aiSummary: {
      type: "string",
      description: "Summary of what happened. Mention each interview/OA time if multiple.",
    },
  },
  required: ["companyName", "roleTitle", "status", "eventType", "aiSummary"],
} as const;

/**
 * Step 2 structured output: count slots first (calendarSlotCount), then fill scheduledItems to match.
 * scheduledItems null = no concrete scheduled/actionable items.
 */
const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isJobRelated: { type: "boolean" },
    calendarSlotCount: {
      type: "integer",
      minimum: 0,
      description:
        "Number of distinct scheduled/actionable start times in this email. MUST equal scheduledItems.length when scheduledItems is an array; MUST be 0 when scheduledItems is null.",
    },
    event: {
      anyOf: [
        EXTRACT_EVENT_BLOB_SCHEMA,
        { type: "null", description: "Use null only when isJobRelated is false." },
      ],
    },
    scheduledItems: {
      anyOf: [
        {
          type: "array",
          description:
            "Exactly calendarSlotCount items. One object per distinct start time/action; never merge multiple times or actions into one.",
          items: EXTRACT_SCHEDULED_ITEM_SCHEMA,
        },
        {
          type: "null",
          description: "No scheduled/actionable items (pure acknowledgement, update without a date/time, etc.).",
        },
      ],
    },
  },
  required: ["isJobRelated", "calendarSlotCount", "event", "scheduledItems"],
} as const;

/** Parsed shape from step-2 JSON (before mapping to EventPayload). */
export type AgentExtractStructured = {
  isJobRelated: boolean;
  calendarSlotCount: number;
  event: {
    companyName: string;
    roleTitle: string;
    status: string;
    eventType: string;
    aiSummary: string;
  } | null;
  scheduledItems: Array<{
    type: string;
    title: string;
    startAt: string;
    endAt?: string;
    duration?: number;
    companyName?: string;
    links?: Array<{ label: string; url: string }>;
    notes?: string;
  }> | null;
};

async function fetchRoutingContextFromBackend(email: AgentEmailData): Promise<LlmRoutingContextBundle> {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    throw new Error("Missing INGEST_SECRET (required to call /api/ingest/email-context)");
  }

  const url = `${config.backendUrl}/api/ingest/email-context`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-INGEST-SECRET": secret,
    },
    body: JSON.stringify({
      userEmail: email.userEmail,
      userId: email.userId,
      subject: email.subject,
      from: email.from,
      body: email.body,
      threadId: email.threadId,
    }),
  });

  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`email-context failed (${url}): ${res.status} ${txt}`);
  }

  const data = JSON.parse(txt) as LlmRoutingContextBundle;
  if (!data?.userId || !Array.isArray(data.candidates)) {
    throw new Error("email-context: invalid response shape");
  }
  return data;
}

function normalizeDateTime(dt: string | undefined): string | undefined {
  if (!dt) return undefined;
  if (!dt.match(/[Z+-]\d{2}:\d{2}$/)) return dt.endsWith("Z") ? dt : `${dt}Z`;
  return dt;
}

function validateDate(dateStr: string, receivedAt: string, fieldName: string): string {
  const date = new Date(dateStr);
  const received = new Date(receivedAt);
  const oneYearFromNow = new Date(received);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  if (date < received) {
    const futureDate = new Date(received);
    futureDate.setDate(futureDate.getDate() + 1);
    console.warn(`[LLM Agent] ${fieldName} in past (${dateStr}); using receivedAt+1d`);
    return futureDate.toISOString();
  }
  if (date > oneYearFromNow) {
    console.warn(`[LLM Agent] ${fieldName} >1yr in future (${dateStr}); may be incorrect`);
  }
  return dateStr;
}

function eventTypeToStatus(eventType: string, fallback: EventPayload["status"]): EventPayload["status"] {
  const m: Record<string, EventPayload["status"]> = {
    OA: "OA",
    INTERVIEW: "INTERVIEW",
    OFFER: "OFFER",
    REJECTION: "REJECTED",
    ACKNOWLEDGEMENT: "APPLIED",
  };
  return (m[eventType] ?? fallback) as EventPayload["status"];
}

type ScheduledItemPayloadType = EventScheduledItem["type"];

function normalizeScheduledItemType(rawType: unknown, eventType: EventType, item: any): ScheduledItemPayloadType {
  const normalized = typeof rawType === "string" ? rawType.toUpperCase() : "";
  if (normalized === "OA" || normalized === "INTERVIEW" || normalized === "DEADLINE" || normalized === "OTHER") {
    return normalized;
  }

  const text = `${item?.title ?? ""} ${item?.notes ?? ""}`.toLowerCase();
  const looksDueBy = /\b(by|due|deadline|before|within|submit|upload|complete|sign)\b/.test(text);
  if (normalized === "ACTION_REQUIRED" && looksDueBy) return "DEADLINE";
  if (normalized === "OTHER_UPDATE" || normalized === "UPDATE" || normalized === "ACTION_REQUIRED") return "OTHER";
  if (eventType === "ACTION_REQUIRED" && looksDueBy) return "DEADLINE";
  return "OTHER";
}

function scheduledItemsLength(raw: AgentExtractStructured["scheduledItems"]): number {
  return raw == null ? 0 : raw.length;
}

function parseExtractStructured(content: string): AgentExtractStructured {
  return JSON.parse(content) as AgentExtractStructured;
}

async function runStep2ExtractionCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  strict: boolean
): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: "extract_event_nested", strict, schema: EXTRACT_SCHEMA as unknown as Record<string, unknown> },
    },
    temperature: 0.3,
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("Step 2 extraction returned empty content");
  return content;
}

export type AgentExtractOptions = {
  /** When set (e.g. fixture/tests in-process with Mongo), skip HTTP context fetch. */
  routingContext?: LlmRoutingContextBundle;
};

export async function agentExtractJobEventFromEmail(
  email: AgentEmailData,
  options?: AgentExtractOptions
): Promise<EventPayload | null> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const receivedAtDate = new Date(email.receivedAt);
  const receivedAtISO = receivedAtDate.toISOString();
  const receivedAtReadable = receivedAtDate.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "short",
  });

  const bundle = options?.routingContext ?? (await fetchRoutingContextFromBackend(email));
  const { userId, candidates } = bundle;

  const routingSystemPrompt = `You route job-related emails to the correct existing job application, or decide that a new application should be created.\n\nRules:\n- If NOT job-related, set isJobRelated=false and decision=\"new\".\n- If job-related and it belongs to an existing application, set decision=\"existing\" and applicationId to one of the provided candidates.\n- If job-related but none match, set decision=\"new\".\n- Only choose applicationId from the provided candidate list.\n- Same employer, multiple roles: use roleTitle, appliedAt, location, userNotes, threadId, and exact email wording (e.g. \"Summer\" vs \"Winter\", internship term, team name) to pick ONE candidate. If the email clearly refers to one role, choose that application's id.\n- Output JSON matching schema exactly.\n\nEmail received at: ${receivedAtReadable} (${receivedAtISO})`;

  const routingUserPrompt = `Email Subject: ${email.subject}\n\nEmail From: ${email.from}\n\nEmail Body:\n${email.body}\n\nCandidate applications (choose one ID or choose new):\n${JSON.stringify(
    candidates,
    null,
    2
  )}`;

  const routeCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: routingSystemPrompt },
      { role: "user", content: routingUserPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "route_application", strict: true, schema: ROUTE_SCHEMA },
    },
    temperature: 0.1,
  });

  const routeContent = routeCompletion.choices[0]?.message?.content;
  if (!routeContent) return null;
  const routeParsed = JSON.parse(routeContent) as any;

  console.log("[LLM Agent] route:", JSON.stringify(routeParsed));

  if (!routeParsed.isJobRelated) return null;

  const selectedId =
    routeParsed.decision === "existing" && typeof routeParsed.applicationId === "string" ? routeParsed.applicationId : null;
  const selected: LlmRoutingCandidate | undefined = selectedId
    ? candidates.find((c) => c.applicationId === selectedId)
    : undefined;

  const extractionSystemPrompt = `You extract a structured job-application event from an email using a fixed JSON shape.

Workflow (follow this order):
1) Decide isJobRelated.
2) If not job-related: set event=null, scheduledItems=null, calendarSlotCount=0 and stop.
3) If job-related: fill event (one object) with companyName, roleTitle, eventType, status, aiSummary.
4) Count distinct scheduled/actionable START times mentioned in this email only. Set calendarSlotCount to that integer.
5) Build scheduledItems: an array with EXACTLY calendarSlotCount objects (one per distinct startAt). If there are zero concrete times, set scheduledItems=null and calendarSlotCount=0.
6) calendarSlotCount MUST always equal (scheduledItems === null ? 0 : scheduledItems.length).

Rules for event.eventType: use enums precisely. RESCHEDULE when changing an existing OA/INTERVIEW time using context. CANCELLATION/STAGE_ROLLBACK only when explicitly rescinding or moving backward. ACTION_REQUIRED for docs/availability without firm times. UPDATE/OTHER_UPDATE for lightweight confirmations.

Rules for scheduledItems[].type: OA for online assessments; INTERVIEW for recruiting interviews; DEADLINE for due-by tasks such as uploading documents, signing forms, completing onboarding/background checks by a stated cutoff; OTHER for fixed non-stage meetings or open-ended actions with no explicit due date (e.g. "confirm your interview time", RSVP, reply with availability). If a confirmation action has a cutoff ("confirm by EOD Friday"), use DEADLINE. If it has no cutoff, use OTHER with the email received time as startAt unless the email gives a better action time, and let the user mark it complete.

When application context is provided, align companyName and roleTitle with that candidate unless the email names a different role.

Dates: ISO 8601 with timezone. Email received at: ${receivedAtReadable} (${receivedAtISO}).`;

  const extractionUserPrompt = `Email Subject: ${email.subject}

Email From: ${email.from}

Email Body:
${email.body}

${
  selected
    ? `Selected application context:\n${JSON.stringify(selected, null, 2)}`
    : `No existing application selected.`
}

Step 2 output: set calendarSlotCount first, then fill scheduledItems with that many slot objects (or null if zero).`;

  const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: extractionSystemPrompt },
    { role: "user", content: extractionUserPrompt },
  ];

  let extractContent: string;
  try {
    extractContent = await runStep2ExtractionCompletion(baseMessages, true);
  } catch (err) {
    console.warn("[LLM Agent] step 2 strict schema failed, retrying with strict: false:", err);
    extractContent = await runStep2ExtractionCompletion(baseMessages, false);
  }

  let extractParsed = parseExtractStructured(extractContent);
  console.log("[LLM Agent] extract:", JSON.stringify(extractParsed));

  const slotLen = scheduledItemsLength(extractParsed.scheduledItems);
  if (extractParsed.isJobRelated && extractParsed.calendarSlotCount !== slotLen) {
    console.warn(
      `[LLM Agent] calendarSlotCount (${extractParsed.calendarSlotCount}) !== scheduledItems.length (${slotLen}); retrying once`
    );
    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...baseMessages,
      { role: "assistant", content: extractContent },
      {
        role: "user",
        content: `Your JSON had calendarSlotCount=${extractParsed.calendarSlotCount} but scheduledItems had ${slotLen} slot(s). They must match. scheduledItems must be null if and only if calendarSlotCount is 0. Fix and return corrected JSON only.`,
      },
    ];
    try {
      extractContent = await runStep2ExtractionCompletion(retryMessages, true);
    } catch {
      extractContent = await runStep2ExtractionCompletion(retryMessages, false);
    }
    extractParsed = parseExtractStructured(extractContent);
    console.log("[LLM Agent] extract (retry):", JSON.stringify(extractParsed));
  }

  if (!extractParsed.isJobRelated) return null;
  if (!extractParsed.event) {
    console.warn("[LLM Agent] isJobRelated but event is null");
    return null;
  }

  const ev = extractParsed.event;
  if (!ev.companyName || !ev.roleTitle || !ev.eventType) return null;

  const eventType = ev.eventType as EventType;
  const statusFallback = (ev.status ?? "APPLIED") as EventPayload["status"];
  const status = eventTypeToStatus(eventType, statusFallback);

  const items = extractParsed.scheduledItems;
  const scheduledItemsMapped =
    items == null || items.length === 0
      ? undefined
      : items.map((item) => {
          const normalizedStart = normalizeDateTime(item.startAt)!;
          const normalizedEnd = item.endAt ? normalizeDateTime(item.endAt) : undefined;
          return {
            type: normalizeScheduledItemType(item.type, eventType, item),
            title: item.title,
            startAt: validateDate(normalizedStart, email.receivedAt, "startAt"),
            endAt: normalizedEnd ? validateDate(normalizedEnd, email.receivedAt, "endAt") : undefined,
            duration: item.duration,
            companyName: item.companyName,
            links: item.links,
            notes: item.notes,
          };
        });

  const payload: EventPayload = {
    userId,
    ...(selected ? { suggestedApplicationId: selected.applicationId } : {}),
    userEmail: email.userEmail,
    provider: email.provider,
    inboxEmail: email.inboxEmail ?? email.userEmail,
    messageId: email.messageId,
    threadId: email.threadId,
    receivedAt: email.receivedAt,
    companyName: ev.companyName,
    roleTitle: ev.roleTitle,
    eventType,
    status,
    aiSummary: ev.aiSummary,
    scheduledItems: scheduledItemsMapped,
  };

  return EventPayloadSchema.parse(payload);
}
