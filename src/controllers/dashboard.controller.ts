import { Request, Response } from "express";
import { buildDashboard, getTimelineForDate } from "../services/dashboard.service";
import type { DashboardResponse } from "../types/dashboard.types";

export async function getDashboard(req: Request, res: Response) {
    const userId = req.userId!;
    const data: DashboardResponse = await buildDashboard(userId);
    return res.json(data);
}

/** GET /api/dashboard/timeline?date=YYYY-MM-DD — scheduled items for that day, sorted by time. */
export async function getTimeline(req: Request, res: Response) {
    const date = req.query.date;
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Query 'date' required as YYYY-MM-DD" });
    }
    const userId = req.userId!;
    const data = await getTimelineForDate(userId, date);
    return res.json(data);
}
