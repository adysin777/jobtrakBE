import { Request, Response } from "express";
import { ingestJobEventService } from "../services/ingest.service";

export async function ingestJobEvent(req: Request, res: Response) {
    try {
        await ingestJobEventService(req.body);
        return res.json({ ok: true });
    } catch (error) {
        console.error("Ingest error:", error);
        return res.status(400).json({ error: String(error)});
    }
}