import mongoose from "mongoose";
import type { DashboardResponse } from "../types/dashboard.types";
import { User } from "../models/User";
import { Application } from "../models/Application";
import { ScheduledItem } from "../models/ScheduledItem"
import { UserDailyStats } from "../models/UserDailyStats";
import { UserDashboardStats, type ApplicationStatus } from "../models/UserDashboardStats";

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

const dueDateScheduledItemTypes = ["OA", "DEADLINE", "OTHER"] as const;

function upcomingScheduledItemMatch(now: Date): Record<string, unknown> {
    return {
        $or: [
            { type: "INTERVIEW", startAt: { $gte: now } },
            {
                type: { $in: dueDateScheduledItemTypes },
                $or: [
                    { endAt: { $gte: now } },
                    { endAt: null },
                    { endAt: { $exists: false } },
                ],
            },
        ],
    };
}

function calendarScheduledItemMatch(start: Date, end: Date): Record<string, unknown> {
    return {
        $or: [
            { type: "INTERVIEW", startAt: { $gte: start, $lt: end } },
            { type: { $in: dueDateScheduledItemTypes }, endAt: { $gte: start, $lt: end } },
        ],
    };
}

function dashboardEffectiveDateExpression() {
    return {
        $cond: [
            { $eq: ["$type", "INTERVIEW"] },
            "$startAt",
            "$endAt",
        ],
    };
}

function mapScheduledItemToDashboardRow(x: any): DashboardResponse["upcoming"][number] {
    return {
        id: String(x._id),
        type: x.type,
        title: x.title,
        startAt: toISO(new Date(x.startAt)),
        endAt: x.endAt ? toISO(new Date(x.endAt)) : undefined,
        completedAt: x.completedAt ? toISO(new Date(x.completedAt)) : undefined,
        duration: x.duration,
        applicationId: x.applicationId ? String(x.applicationId) : undefined,
        company: x.companyName ?? undefined,
        role: x.roleTitle ?? undefined,
        links: Array.isArray(x.links)
            ? (x.links as { label: string; url: string }[]).map((l) => ({ label: l.label, url: l.url }))
            : [],
    };
}

function getStatusCount(counts: unknown, status: ApplicationStatus): number {
    if (!counts) return 0;

    // If map
    if (counts instanceof Map) {
        return Number(counts.get(status) ?? 0);
    }

    // If plain object
    if (typeof counts === "object") {
        const v = (counts as any)[status];
        return Number(v ?? 0);
    }

    return 0;
}

export async function buildDashboard(userId: string): Promise<DashboardResponse> {
    const now = new Date();
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 12);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const archivedIds = await archivedApplicationIds(userIdObj);

    const upcomingMatch = scheduledItemMatchExcludingArchived(
        { userId: userIdObj, ...upcomingScheduledItemMatch(now) },
        archivedIds
    );
    const todayMatch = scheduledItemMatchExcludingArchived(
        { userId: userIdObj, ...calendarScheduledItemMatch(start, end) },
        archivedIds
    );

    const upcomingOaMatch = { ...upcomingMatch, type: "OA" as const };
    const upcomingInterviewMatch = { ...upcomingMatch, type: "INTERVIEW" as const };

    const [
        statsDoc,
        upcomingItems,
        todayItems,
        dailyStats,
        userDoc,
        totalApps,
        activeApps,
        upcomingOaScheduledCount,
        upcomingInterviewScheduledCount,
    ] = await Promise.all([
        UserDashboardStats.findOne({ userId }).lean(),
        ScheduledItem.aggregate([
            { $match: upcomingMatch },
            { $addFields: { dashboardDate: dashboardEffectiveDateExpression() } },
            { $addFields: { undatedSort: { $cond: [{ $eq: ["$dashboardDate", null] }, 1, 0] } } },
            { $sort: { undatedSort: 1, dashboardDate: 1, startAt: 1 } },
            { $limit: 50 },
        ]),
        ScheduledItem.aggregate([
            { $match: todayMatch },
            { $addFields: { dashboardDate: dashboardEffectiveDateExpression() } },
            { $sort: { dashboardDate: 1, startAt: 1 } },
        ]),
        UserDailyStats.find({ userId }).sort({ day: 1 }).limit(450).lean(),
        User.findById(userId).select("connectedInboxes").lean(),
        Application.countDocuments({ userId: userIdObj, archived: { $ne: true } }),
        Application.countDocuments({
            userId: userIdObj,
            archived: { $ne: true },
            status: { $nin: ["OFFER", "REJECTED"] },
        }),
        ScheduledItem.countDocuments(upcomingOaMatch),
        ScheduledItem.countDocuments(upcomingInterviewMatch),
    ])

    console.log(upcomingItems);

    const connectedInboxCount = (userDoc as any)?.connectedInboxes?.filter((i: any) => i.status === "connected").length ?? 0;

    const calendarMatch = scheduledItemMatchExcludingArchived(
        { userId: userIdObj, ...calendarScheduledItemMatch(monthStart, monthEnd) },
        archivedIds
    );

    const calendarDays = await ScheduledItem.aggregate([
        {
          $match: calendarMatch,
        },
        {
          $addFields: {
            dashboardDate: dashboardEffectiveDateExpression(),
          },
        },
        {
          $project: {
            day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$dashboardDate",
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

    /** Upcoming scheduled slots (same filter as dashboard `upcoming` list), not application-stage totals. */
    const oas = upcomingOaScheduledCount;
    const interviews = upcomingInterviewScheduledCount;
    const offers = getStatusCount(statsDoc?.countsByStatus, "OFFER");
    const rejected = getStatusCount(statsDoc?.countsByStatus, "REJECTED");

    // All non-archived applications (includes offer/rejected).
    const total = totalApps;
    /** In pipeline: not archived and not terminal offer/rejection. */
    const active = activeApps;

    const counts = {
        total,
        active,
        offers,
        rejected,
        interviews,
        oas,
    };

    const upcoming: DashboardResponse["upcoming"] = (upcomingItems ?? []).map(mapScheduledItemToDashboardRow);

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
        items: (todayItems ?? []).map(mapScheduledItemToDashboardRow),
    };

    return { counts, upcoming, graph, calendarMonth, today, connectedInboxCount };
}

/** Scheduled items for a single day (date = YYYY-MM-DD, UTC day bounds). Sorted by dashboard date. */
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
            ...calendarScheduledItemMatch(dayStart, dayEnd),
        },
        archivedIds
    );
    const items = await ScheduledItem.aggregate([
        { $match: dayMatch },
        { $addFields: { dashboardDate: dashboardEffectiveDateExpression() } },
        { $sort: { dashboardDate: 1, startAt: 1 } },
    ]);
    return {
        date: dateStr,
        items: (items as any[]).map(mapScheduledItemToDashboardRow),
    };
}

