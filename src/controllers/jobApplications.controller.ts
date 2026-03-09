import { Request, Response } from "express";
import { listApplicationsService, getApplicationEventsService, type ListStatusFilter, type ListTimeRange } from "../services/jobApplications.service";

export async function listApplications(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const status = (req.query.status as ListStatusFilter) || "all";
    const timeRange = (req.query.timeRange as ListTimeRange) || "all";
    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    const applications = await listApplicationsService(userId, {
      status,
      timeRange,
      search,
    });
    return res.json({ applications });
  } catch (error) {
    console.error("List applications error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function getApplicationEvents(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({ error: "Missing application id" });
    }
    const events = await getApplicationEventsService(userId, applicationId);
    return res.json({ events });
  } catch (error) {
    console.error("Get application events error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
