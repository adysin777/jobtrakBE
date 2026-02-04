import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";

export function requireIngestSecret(req: Request, res: Response, next: NextFunction) {
    const secret = req.headers["x-ingest-secret"];

    if (!secret || secret !== config.ingestSecret) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
}