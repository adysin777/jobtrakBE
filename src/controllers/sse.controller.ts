import type { Request, Response } from "express";
import { addConnection } from "../services/sse.service";

/**
 * GET /api/sse
 * Query: token (Clerk JWT) — EventSource cannot send Authorization header, so token is passed in URL.
 * Middleware must have already set req.userId (e.g. by copying query.token to Authorization before Clerk).
 */
export function sseHandler(req: Request, res: Response) {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx
    res.flushHeaders();

    addConnection(userId, res);
}
