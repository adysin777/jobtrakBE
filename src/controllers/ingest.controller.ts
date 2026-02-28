import { Request, Response } from "express";
import { EventPayloadSchema } from "../types/event.types";
import { createEventFromPayload, assignEventToApplication } from "../services/event.service";

/** Accepts EventPayload (from LLM worker). Backend owns DB: create Event + assign to Application. */
export async function ingestJobEvent(req: Request, res: Response) {
    try {
        const payload = EventPayloadSchema.parse(req.body);
        const { event } = await createEventFromPayload(payload);
        await assignEventToApplication(event._id as any);
        return res.json({ ok: true, eventId: (event as any)._id?.toString() });
    } catch (error) {
        console.error("Ingest error:", error);
        return res.status(400).json({ error: String(error) });
    }
}