import type { Response } from "express";

/** Map of userId -> set of open SSE responses. */
const connections = new Map<string, Set<Response>>();

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Register an SSE connection for a user. Sends heartbeat periodically; caller must call
 * removeConnection when the response closes or errors.
 */
export function addConnection(userId: string, res: Response): void {
    if (!connections.has(userId)) {
        connections.set(userId, new Set());
    }
    connections.get(userId)!.add(res);

    const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
            res.write(`: heartbeat\n\n`);
        } else {
            clearInterval(heartbeat);
        }
    }, HEARTBEAT_INTERVAL_MS);

    res.on("close", () => {
        clearInterval(heartbeat);
        removeConnection(userId, res);
    });
    res.on("error", () => {
        clearInterval(heartbeat);
        removeConnection(userId, res);
    });
}

export function removeConnection(userId: string, res: Response): void {
    const set = connections.get(userId);
    if (set) {
        set.delete(res);
        if (set.size === 0) connections.delete(userId);
    }
}

/**
 * Notify all open SSE connections for this user that dashboard data changed.
 * Call after: ingest (event assigned), inbox connected, etc.
 */
export function notifyDashboardUpdate(userId: string): void {
    const set = connections.get(userId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify({ type: "dashboard_invalidate" });
    for (const res of set) {
        if (!res.writableEnded) {
            res.write(`data: ${payload}\n\n`);
        }
    }
}
