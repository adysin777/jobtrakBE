import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { ScheduledItem } from "../models/ScheduledItem";
import { Types } from "mongoose";
import { notifyDashboardUpdate } from "../services/sse.service";
import {
  connectGoogleCalendarService,
  getUserIdFromCalendarState,
  googleCalendarCallbackService,
  listGoogleCalendarConnectionsService,
  listGoogleCalendarsForConnectionService,
  updateGoogleCalendarConnectionService,
  deleteGoogleCalendarConnectionService,
  manualSyncGoogleCalendarsService,
} from "../services/googleCalendar.service";
import {
  calendarErrorPageUrl,
  calendarFailureReasonFromError,
  googleOAuthQueryReason,
} from "../utils/googleOAuthErrors";

const router = Router();

function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function addDays(d: Date, days: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

router.get("/day", requireUser, async (req, res) => {
    const dateStr = String(req.query.date || "");
    if (!dateStr) return res.status(400).json({ error: "Missing ?date=YYYY-MM-DD" });

    const day = new Date(dateStr + "T00:00:00.000Z");
    if (Number.isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

    const start = startOfDay(day);
    const end = addDays(start, 1);

    const items = await ScheduledItem.find({
        userId: req.userId,
        startAt: { $gte: start, $lt: end },
    }).sort({ startAt: 1 });

    res.json({ date: dateStr, items });
});

router.get("/month", requireUser, async (req, res) => {
  const month = String(req.query.month || "");
  if (!month) return res.status(400).json({ error: "Missing ?month=YYYY-MM" });

  const start = new Date(month + "-01T00:00:00.000Z");
  if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Invalid month" });

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const userObjectId = new Types.ObjectId(req.userId);

  const days = await ScheduledItem.aggregate([
    { $match: { userId: userObjectId, startAt: { $gte: start, $lt: end } } },
    {
      $project: {
        day: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$startAt",
            timezone: "America/Toronto", // strongly recommended
          },
        },
        type: "$type",
      },
    },
    { $group: { _id: { day: "$day", type: "$type" }, count: { $sum: 1 } } },
    { $group: { _id: "$_id.day", count: { $sum: "$count" }, types: { $push: { k: "$_id.type", v: "$count" } } } },
    { $project: { _id: 0, date: "$_id", count: 1, types: { $arrayToObject: "$types" } } },
    { $sort: { date: 1 } },
  ]);

  res.json({ month, days });
});

router.get("/connect/google", requireUser, async (req, res) => {
  try {
    const authUrl = await connectGoogleCalendarService(req.userId!);
    return res.json({ authUrl });
  } catch (error) {
    console.error("Google calendar connect error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

router.get("/callback/google", async (req, res) => {
  try {
    const oauthError = req.query.error as string | undefined;
    if (oauthError) {
      return res.redirect(calendarErrorPageUrl(googleOAuthQueryReason(oauthError)));
    }

    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const userId = getUserIdFromCalendarState(state) || state;
    if (!code || !userId) {
      return res.redirect(calendarErrorPageUrl(!code ? "missing_code" : "invalid_state"));
    }

    await googleCalendarCallbackService(userId, code);
    notifyDashboardUpdate(userId);
    return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/calendar-connected`);
  } catch (error) {
    console.error("Google calendar callback error:", error);
    return res.redirect(calendarErrorPageUrl(calendarFailureReasonFromError(error)));
  }
});

router.get("/google/connections", requireUser, async (req, res) => {
  try {
    const connections = await listGoogleCalendarConnectionsService(req.userId!);
    return res.json({ connections });
  } catch (error) {
    console.error("List Google calendar connections error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

router.get("/google/calendars", requireUser, async (req, res) => {
  try {
    const connectionId = String(req.query.connectionId || "");
    if (!connectionId) {
      return res.status(400).json({ error: "Missing connectionId" });
    }
    const calendars = await listGoogleCalendarsForConnectionService(req.userId!, connectionId);
    return res.json({ calendars });
  } catch (error) {
    console.error("List Google calendars error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

router.patch("/google/connections/:id", requireUser, async (req, res) => {
  try {
    const connectionId = req.params.id;
    if (!connectionId) return res.status(400).json({ error: "Missing connection id" });
    const patch: { selectedCalendarId?: string; syncEnabled?: boolean } = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "selectedCalendarId")) {
      patch.selectedCalendarId =
        typeof req.body.selectedCalendarId === "string" ? req.body.selectedCalendarId : "";
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "syncEnabled")) {
      const raw = req.body.syncEnabled;
      patch.syncEnabled =
        typeof raw === "boolean"
          ? raw
          : typeof raw === "string"
            ? raw.toLowerCase() === "true"
            : Boolean(raw);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    const connection = await updateGoogleCalendarConnectionService(req.userId!, connectionId, patch);
    return res.json({ connection });
  } catch (error) {
    console.error("Update Google calendar connection error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

router.delete("/google/connections/:id", requireUser, async (req, res) => {
  try {
    const connectionId = req.params.id;
    if (!connectionId) return res.status(400).json({ error: "Missing connection id" });
    await deleteGoogleCalendarConnectionService(req.userId!, connectionId);
    return res.status(204).send();
  } catch (error) {
    console.error("Delete Google calendar connection error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

router.post("/google/sync", requireUser, async (req, res) => {
  try {
    const result = await manualSyncGoogleCalendarsService(req.userId!);
    return res.json(result);
  } catch (error) {
    console.error("Manual Google calendar sync error:", error);
    return res.status(400).json({ error: String(error) });
  }
});

export default router;