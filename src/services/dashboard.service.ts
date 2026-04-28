import mongoose from "mongoose";
import type { DashboardResponse } from "../types/dashboard.types";
import { User } from "../models/User";
import { Application } from "../models/Application";
import { ScheduledItem } from "../models/ScheduledItem"
import { UserDailyStats } from "../models/UserDailyStats";

function toISO(d: Date) {
    if (!d || isNaN(d.getTime())) {
        throw new Error(`Invalid date provided to toISO: ${d}`);
    }
    return d.toISOString();
}

function ymd(d: Date | string | null | undefined): string {
    if (!d) {
        return new Date().toISOString().slice(0, 10);
    }
    const dateObj = d instanceof Date ? d : new Date(d);
    if (isNaN(dateObj.getTime())) {
        console.warn(`Invalid date provided to ymd: ${d}`);
        return new Date().toISOString().slice(0, 10);
    }
    return dateObj.toISOString().slice(0, 10);
}

/** Scheduled items tied only to archived applications are hidden from dashboard calendar/upcoming. */
async function archivedApplicationIds(userIdObj: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> {
  const rows = await Application.find({ userId: userIdObj, archived: true }).select("_id").lean();
  return rows.map((r) => (r as { _id: mongoose.Types.ObjectId })._id);
}

function scheduledItemMatchExcludingArchived(
  base: Record<string, unknown>,
  archivedIds: mongoose.Types.ObjectId[]
): Record<string, unknown> {
  const activeBase = {
    ...base,
    $and: [
      ...(((base as any).$and as unknown[] | undefined) ?? []),
      { $or: [{ completedAt: null }, { completedAt: { $exists: false } }] },
    ],
  };
  if (archivedIds.length === 0) return activeBase;
  return {
    ...activeBase,
    $and: [
      ...(((activeBase as any).$and as unknown[] | undefined) ?? []),
      { $or: [{ applicationId: null }, { applicationId: { $nin: archivedIds } }] },
    ],
  };
}

export async function buildDashboard(userId: string): Promise<DashboardResponse> {
    const now = new Date();
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const archivedIds = await archivedApplicationIds(userIdObj);

    const upcomingMatch = scheduledItemMatchExcludingArchived(
        {
            userId: userIdObj,
            $or: [
                { startAt: { $gte: now } },
                { type: { $in: ["OA", "DEADLINE", "OTHER"] } },
            ],
        },
        archivedIds
    );
    const todayMatch = scheduledItemMatchExcludingArchived(
        { userId: userIdObj, startAt: { $gte: start, $lt: end } },
        archivedIds
    );

    const [upcomingItems, todayItems, dailyStats, userDoc, statusCounts] = await Promise.all([
        ScheduledItem.find(upcomingMatch).sort({ startAt: 1 }).limit(10).lean(),
        ScheduledItem.find(todayMatch).sort({ startAt: 1}).lean(),
        UserDailyStats.find({ userId }).sort({ day: 1 }).limit(450).lean(),
        User.findById(userId).select("connectedInboxes").lean(),
        Application.aggregate([
            { $match: { userId: userIdObj, archived: { $ne: true } } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
    ])

    console.log(upcomingItems);

    const connectedInboxCount = (userDoc as any)?.connectedInboxes?.filter((i: any) => i.status === "connected").length ?? 0;

    const calendarMatch: Record<string, unknown> = {
        userId: userIdObj,
        startAt: { $gte: monthStart, $lt: monthEnd },
        $and: [{ $or: [{ completedAt: null }, { completedAt: { $exists: false } }] }],
    };
    if (archivedIds.length > 0) {
        (calendarMatch as any).$and.push({ $or: [{ applicationId: null }, { applicationId: { $nin: archivedIds } }] });
    }

    const calendarDays = await ScheduledItem.aggregate([
        {
          $match: calendarMatch,
        },
        {
          $project: {
            day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$startAt",
                timezone: "America/Toronto", // important
              },
            },
            type: "$type",
          },
        },
        {
          $group: {
            _id: { day: "$day", type: "$type" },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.day",
            count: { $sum: "$count" },
            types: {
              $push: { k: "$_id.type", v: "$count" },
            },
          },
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            count: 1,
            types: { $arrayToObject: "$types" },
          },
        },
        { $sort: { date: 1 } },
      ]);

    const countByStatus = new Map<string, number>(
        (statusCounts as Array<{ _id: string; count: number }>).map((row) => [row._id, row.count])
    );
    const applied = countByStatus.get("APPLIED") ?? 0;
    const oas = countByStatus.get("OA") ?? 0;
    const interviews = countByStatus.get("INTERVIEW") ?? 0;
    const offers = countByStatus.get("OFFER") ?? 0;
    const rejected = countByStatus.get("REJECTED") ?? 0;

    // Stable distinct-application total.
    const total = applied + oas + interviews + offers + rejected;

    const active = applied + oas + interviews;

    const counts = {
        total,
        active,
        offers,
        rejected,
        interviews,
        oas
    };

    const upcoming: DashboardResponse["upcoming"] = (upcomingItems ?? []).map((x: any) => ({
        id: String(x._id),
        type: x.type,
        title: x.title,
        startAt: toISO(new Date(x.startAt)),
        endAt: x.endAt ? toISO(new Date(x.endAt)) : undefined,
        duration: x.duration,
        applicationId: x.applicationId ? String(x.applicationId) : undefined,
        company: x.companyName ?? undefined,
        role: x.roleTitle ?? undefined,
    }));

    const graph: DashboardResponse["graph"] = (dailyStats ?? []).map((d: any) => {
        const dayStr = typeof d.day === "string" ? d.day : ymd(d.day);
        return {
            date: dayStr,
            appliedCount: d.appliedCount ?? 0,
            oaCount: d.oaCount ?? 0,
            interviewCount: d.interviewCount ?? 0,
            offerCount: d.offerCount ?? 0,
            rejectionCount: d.rejectionCount ?? 0,
        };
    });

    const calendarMonth : DashboardResponse["calendarMonth"] = {
        month: month,
        days: calendarDays,// todo
    }

    const today: DashboardResponse["today"] = {
        date: ymd(now),
        items: (todayItems ?? []).map((x: any) => ({
            id: String(x._id),
            type: x.type,
            title: x.title,
            startAt: toISO(new Date(x.startAt)),
            endAt: x.endAt ? toISO(new Date(x.endAt)) : undefined,
            duration: x.duration,
            applicationId: x.applicationId ? String(x.applicationId) : undefined,
            company: x.companyName ?? undefined,
            role: x.roleTitle ?? undefined,
        })),
    };

    return { counts, upcoming, graph, calendarMonth, today, connectedInboxCount };
}

/** Scheduled items for a single day (date = YYYY-MM-DD, UTC day bounds). Sorted by startAt. */
export async function getTimelineForDate(
    userId: string,
    dateStr: string
): Promise<{ date: string; items: DashboardResponse["upcoming"] }> {
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    if (isNaN(dayStart.getTime()) || isNaN(dayEnd.getTime())) {
        return { date: dateStr, items: [] };
    }
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const archivedIds = await archivedApplicationIds(userIdObj);
    const dayMatch = scheduledItemMatchExcludingArchived(
        {
            userId: userIdObj,
            startAt: { $gte: dayStart, $lt: dayEnd },
        },
        archivedIds
    );
    const items = await ScheduledItem.find(dayMatch)
        .sort({ startAt: 1 })
        .lean();
    return {
        date: dateStr,
        items: (items as any[]).map((x) => ({
            id: String(x._id),
            type: x.type,
            title: x.title,
            startAt: toISO(new Date(x.startAt)),
            endAt: x.endAt ? toISO(new Date(x.endAt)) : undefined,
            duration: x.duration,
            applicationId: x.applicationId ? String(x.applicationId) : undefined,
            company: x.companyName ?? undefined,
            role: x.roleTitle ?? undefined,
        })),
    };
}

