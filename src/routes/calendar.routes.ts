import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { ScheduledItem } from "../models/ScheduledItem";
import { Types } from "mongoose";

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

export default router;