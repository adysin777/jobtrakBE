import { z } from "zod";

/** Broad category of what happened in this event (acknowledgement → OA → rounds → offer/rejection, plus reschedule/other). */
export const EventTypeSchema = z.enum([
    "OA",
    "INTERVIEW",
    "OFFER",
    "REJECTION",
    "ACKNOWLEDGEMENT",
    "RESCHEDULE",
    "OTHER_UPDATE",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Actionables with a date (OA, interview). Payload shape for creating ScheduledItem docs (eventId set, applicationId null).
 * RESCHEDULE is an event type only: when we get a RESCHEDULE event, we find the existing OA/INTERVIEW ScheduledItem and update its startAt/endAt.
 */
export const EventScheduledItemSchema = z.object({
    type: z.enum(["OA", "INTERVIEW"]),
    title: z.string(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional(),
    duration: z.number().optional(),
    companyName: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
    notes: z.string().optional(),
});

export type EventScheduledItem = z.infer<typeof EventScheduledItemSchema>;

export const EventAssignmentStatus = z.enum(["unprocessed", "assigned", "conflict"]);
export type EventAssignmentStatus = z.infer<typeof EventAssignmentStatus>;

/**
 * Event payload as produced by LLM extraction (and optionally enriched with userId, etc.).
 * Used to create Event documents; assignment to applications happens later.
 */
export const EventPayloadSchema = z.object({
    userId: z.string().optional(), // set by worker after user lookup
    userEmail: z.string().email(),
    provider: z.enum(["gmail", "outlook"]),
    inboxEmail: z.string().email(),
    messageId: z.string(),
    threadId: z.string().optional(),
    receivedAt: z.string().datetime(),
    companyName: z.string(),
    roleTitle: z.string(),
    /** Broad category: what kind of thing happened in this email */
    eventType: EventTypeSchema,
    /** Application pipeline status after this event (for updating Application.current state) */
    status: z.enum(["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"]),
    aiSummary: z.string().optional(),
    scheduledItems: z.array(EventScheduledItemSchema).optional(),
});

export type EventPayload = z.infer<typeof EventPayloadSchema>;
