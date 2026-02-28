import OpenAI from "openai";
import { EventPayloadSchema, type EventPayload } from "../types/event.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

interface EmailData {
  subject: string;
  body: string;
  from: string;
  userEmail: string;
  userId?: string;
  provider: "gmail" | "outlook";
  inboxEmail: string;
  messageId: string;
  threadId?: string;
  receivedAt: string;
}

// JSON Schema for OpenAI structured outputs
const ingestEventJsonSchema = {
  type: "object",
  properties: {
    isJobRelated: {
      type: "boolean",
      description: "Whether this email is job-related",
    },
    companyName: {
      type: "string",
      description: "Name of the company",
    },
    roleTitle: {
      type: "string",
      description: "Job title or role being applied for",
    },
    status: {
      type: "string",
      enum: ["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"],
      description: "Application pipeline status after this email",
    },
    eventType: {
      type: "string",
      enum: ["OA", "INTERVIEW", "OFFER", "REJECTION", "ACKNOWLEDGEMENT", "RESCHEDULE", "OTHER_UPDATE"],
      description: "Broad category: ACKNOWLEDGEMENT (application received), OA, INTERVIEW, OFFER, REJECTION, RESCHEDULE (rescheduling existing meeting), OTHER_UPDATE",
    },
    aiSummary: {
      type: "string",
      description: "Brief summary of the email content",
    },
    scheduledItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["OA", "INTERVIEW"],
          },
          title: {
            type: "string",
          },
          startAt: {
            type: "string",
            format: "date-time",
          },
          endAt: {
            type: "string",
            format: "date-time",
          },
          duration: {
            type: "number",
            description: "Duration in minutes (primarily for OAs)",
          },
          companyName: {
            type: "string",
          },
          links: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                url: { type: "string" },
              },
              required: ["label", "url"],
              additionalProperties: false,
            },
          },
          notes: {
            type: "string",
          },
        },
        required: ["type", "title", "startAt"],
        additionalProperties: false,
      },
    },
  },
  required: ["isJobRelated"],
  additionalProperties: false,
} as const;

/** Map status to eventType when LLM omits eventType (backward compat) */
function statusToEventType(status: string): EventPayload["eventType"] {
  const m: Record<string, EventPayload["eventType"]> = {
    APPLIED: "ACKNOWLEDGEMENT",
    OA: "OA",
    INTERVIEW: "INTERVIEW",
    OFFER: "OFFER",
    REJECTED: "REJECTION",
  };
  return m[status] ?? "OTHER_UPDATE";
}

/** Map eventType to pipeline status so Application advances correctly (eventType is source of truth for stage) */
function eventTypeToStatus(eventType: EventPayload["eventType"], fallback: EventPayload["status"]): EventPayload["status"] {
  const m: Record<string, EventPayload["status"]> = {
    OA: "OA",
    INTERVIEW: "INTERVIEW",
    OFFER: "OFFER",
    REJECTION: "REJECTED",
    ACKNOWLEDGEMENT: "APPLIED",
  };
  return (m[eventType] ?? fallback) as EventPayload["status"];
}

export async function extractJobEventFromEmail(email: EmailData): Promise<EventPayload | null> {
  const receivedAtDate = new Date(email.receivedAt);
  const receivedAtISO = receivedAtDate.toISOString();
  const receivedAtReadable = receivedAtDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short'
  });

  const systemPrompt = `You are an email parser for job applications. Your task is to:
1. Determine if this email is job-related (interview, OA, offer, rejection, application update)
2. If it's NOT job-related, set isJobRelated to false
3. If it IS job-related, set isJobRelated to true and extract ALL required fields

Job-related emails include:
- Interview invitations/scheduling (status: INTERVIEW)
- Online assessment (OA) invitations (status: OA)
- Offer letters (status: OFFER)
- Rejection notices (status: REJECTED)
- Application status updates (status: APPLIED or other)
- Follow-up emails from recruiters

IMPORTANT: If the email mentions scheduling an interview, it IS job-related. Extract:
- Company name: Extract from email (sender domain, email content, or company mentioned)
- Role title: Extract if mentioned, otherwise use "Software Engineer" or similar based on context
- Status: Must be one of: APPLIED, OA, INTERVIEW, OFFER, REJECTED
- eventType: One of OA, INTERVIEW, OFFER, REJECTION, ACKNOWLEDGEMENT, RESCHEDULE, OTHER_UPDATE (use RESCHEDULE when email is rescheduling an existing interview/OA)
- Scheduled items: Extract interviews/OAs with dates/times
- AI summary: Brief summary of the email content

DATE PARSING RULES:
- The email was received at: ${receivedAtReadable} (${receivedAtISO})
- Use this as your reference point for relative dates
- "Tomorrow" = next day from received date
- "Next [day]" = next occurrence of that weekday from received date
- "This [day]" = this week's occurrence of that weekday from received date
- If only a date is mentioned without year, use the year from received date (or next year if date has passed)
- If time is ambiguous (e.g., "12" without AM/PM), assume PM for interviews/OAs (people don't schedule at midnight)
- Always output full ISO 8601 format: YYYY-MM-DDTHH:mm:ssZ (with Z timezone)`;

  const userPrompt = `Email Subject: ${email.subject}

Email From: ${email.from}

Email Body:
${email.body}

Extract job application information from this email. If it's not job-related, set isJobRelated to false.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ingest_event",
          strict: false,
          schema: ingestEventJsonSchema,
        },
      },
      temperature: 0.3,
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      return null;
    }

    const parsed = JSON.parse(content) as any;
    console.log("GPT-4o Mini extracted:", JSON.stringify(parsed, null, 2));

    // Check if email is not job-related
    if (!parsed.isJobRelated) {
      console.log("❌ Email marked as not job-related by LLM");
      return null;
    }

    // Check if required fields are missing
    if (!parsed.companyName || !parsed.roleTitle || !parsed.status) {
      console.log("⚠️ Missing required fields:", {
        companyName: !!parsed.companyName,
        roleTitle: !!parsed.roleTitle,
        status: !!parsed.status,
      });
      return null;
    }

    // Helper to normalize datetime strings (add Z if missing timezone)
    const normalizeDateTime = (dt: string | undefined): string | undefined => {
      if (!dt) return undefined;
      // If it doesn't end with Z or timezone offset, add Z
      if (!dt.match(/[Z+-]\d{2}:\d{2}$/)) {
        return dt.endsWith('Z') ? dt : `${dt}Z`;
      }
      return dt;
    };

    // Basic validation: dates should be after receivedAt and not too far in future
    const validateDate = (dateStr: string, fieldName: string): string => {
      const date = new Date(dateStr);
      const receivedAt = new Date(email.receivedAt);
      const oneYearFromNow = new Date(receivedAt);
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      if (date < receivedAt) {
        console.warn(`⚠️ ${fieldName} is in the past (${dateStr}), using receivedAt + 1 day`);
        const futureDate = new Date(receivedAt);
        futureDate.setDate(futureDate.getDate() + 1);
        return futureDate.toISOString();
      }

      if (date > oneYearFromNow) {
        console.warn(`⚠️ ${fieldName} is more than 1 year in future (${dateStr}), may be incorrect`);
      }

      return dateStr;
    };

    // Build EventPayload (userId set by caller). Derive status from eventType so OA/INTERVIEW/OFFER/REJECTION advance the application.
    const eventType = parsed.eventType ?? statusToEventType(parsed.status);
    const status = eventTypeToStatus(eventType, parsed.status as EventPayload["status"]);
    const payload: EventPayload = {
      userId: "", // caller must set
      userEmail: email.userEmail,
      provider: email.provider,
      inboxEmail: email.inboxEmail,
      messageId: email.messageId,
      threadId: email.threadId,
      receivedAt: email.receivedAt,
      companyName: parsed.companyName,
      roleTitle: parsed.roleTitle,
      status,
      eventType,
      aiSummary: parsed.aiSummary,
      scheduledItems: parsed.scheduledItems?.map((item: any) => {
        const normalizedStart = normalizeDateTime(item.startAt)!;
        const normalizedEnd = item.endAt ? normalizeDateTime(item.endAt) : undefined;
        return {
          type: item.type,
          title: item.title,
          startAt: validateDate(normalizedStart, "startAt"),
          endAt: normalizedEnd ? validateDate(normalizedEnd, "endAt") : undefined,
          duration: item.duration,
          companyName: item.companyName,
          links: item.links,
          notes: item.notes,
        };
      }),
    };

    return EventPayloadSchema.parse(payload);
  } catch (error) {
    console.error("OpenAI extraction error:", error);
    throw error;
  }
}
