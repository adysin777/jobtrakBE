import { Request, Response } from "express";
import { buildDashboard } from "../services/dashboard.service";
import type { DashboardResponse } from "../types/dashboard.types";

export async function getDashboard(req: Request, res: Response) {
    const userId = req.userId!;
    const data: DashboardResponse = await buildDashboard(userId);
    return res.json(data);
}
