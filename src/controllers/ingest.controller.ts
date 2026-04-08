import { Request, Response } from "express";
import { z } from "zod";
import { EventPayloadSchema } from "../types/event.types";
import { createEventFromPayload, assignEventToApplication } from "../services/event.service";
import { notifyDashboardUpdate } from "../services/sse.service";
import { buildLlmRoutingContextForEmail } from "../services/ingestContext.service";
import { Event } from "../models/Event";

/** Accepts EventPayload (from LLM worker). Backend owns DB: create Event + assign to Application. */
export async function ingestJobEvent(req: Request, res: Response) {
    try {
        const payload = EventPayloadSchema.parse(req.body);
        const { event, userId } = await createEventFromPayload(payload);
        await assignEventToApplication(event._id as any);
        const assignedEvent = await Event.findById(event._id).select({ applicationId: 1 }).lean();
        notifyDashboardUpdate(userId.toString(), {
            applicationId: assignedEvent?.applicationId ? String(assignedEvent.applicationId) : undefined,
            companyName: event.companyName,
            eventType: event.eventType,
        });
        return res.json({ ok: true, eventId: (event as any)._id?.toString() });
    } catch (error) {
        console.error("Ingest error:", error);
        return res.status(400).json({ error: String(error) });
    }
}

const EmailContextRequestSchema = z.object({
    userEmail: z.string().email(),
    userId: z.string().optional(),
    subject: z.string(),
    from: z.string(),
    body: z.string(),
    threadId: z.string().optional(),
    maxCandidates: z.coerce.number().int().min(1).max(10).optional(),
    maxEventsPerApp: z.coerce.number().int().min(1).max(500).optional(),
    maxScheduledItemsPerApp: z.coerce.number().int().min(1).max(200).optional(),
});

/** Internal: LLM worker fetches routing context here; DB stays on the API server. */
export async function ingestEmailContext(req: Request, res: Response) {
    try {
        const data = EmailContextRequestSchema.parse(req.body);
        const bundle = await buildLlmRoutingContextForEmail({
            userEmail: data.userEmail,
            userId: data.userId,
            subject: data.subject,
            from: data.from,
            body: data.body,
            threadId: data.threadId,
            maxCandidates: data.maxCandidates,
            maxEventsPerApp: data.maxEventsPerApp,
            maxScheduledItemsPerApp: data.maxScheduledItemsPerApp,
        });
        return res.json(bundle);
    } catch (error) {
        console.error("Ingest email-context error:", error);
        return res.status(400).json({ error: String(error) });
    }
}

