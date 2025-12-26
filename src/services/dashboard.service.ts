import type { DashboardResponse } from "../types/dashboard.types";
import { UserDashboardStats } from "../models/UserDashboardStats";
import { ScheduledItem } from "../models/ScheduledItem"
import { UserDailyStats } from "../models/UserDailyStats";

import type { ApplicationStatus } from "../models/UserDashboardStats";

function toISO(d: Date) {
    return d.toISOString();
}

function ymd(d: Date) {
    return d.toISOString().slice(0, 10);
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
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [statsDoc, upcomingItems, todayItems, dailyStats] = await Promise.all([
        UserDashboardStats.findOne({ userId }).lean(),
        ScheduledItem.find({ userId, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(10).lean(),
        ScheduledItem.find({ userId, startAt: { $gte: start, $lt: end } }).sort({ startAt: 1}).lean(),
        UserDailyStats.find({ userId }).sort({ date: 1 }).limit(90).lean(),
    ])

    const calendarDays = await ScheduledItem.aggregate([
        {
          $match: {
            userId,
            startAt: { $gte: monthStart, $lt: monthEnd },
          },
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

    const applied = getStatusCount(statsDoc?.countsByStatus, "APPLIED");
    const oas = getStatusCount(statsDoc?.countsByStatus, "OA");
    const interviews = getStatusCount(statsDoc?.countsByStatus, "INTERVIEW");
    const offers = getStatusCount(statsDoc?.countsByStatus, "OFFER");
    const rejected = getStatusCount(statsDoc?.countsByStatus, "REJECTED");

    const total = applied + oas + interviews + offers + rejected;

    const active = statsDoc?.activeCount ?? 0;

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
        applicationId: x.applicationId ? String(x.applicationId) : undefined,
        company: x.company ?? undefined,
    }));

    const graph: DashboardResponse["graph"] = (dailyStats ?? []).map((d: any) => ({
        date: typeof d.date === "string" ? d.date : ymd(new Date(d.date)),
        appliedCount: d.appliedCount ?? 0,
    }));

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
            applicationId: x.applicationId ? String(x.applicationId) : undefined,
            company: x.companyName ?? undefined,
        })),
    };

    return { counts, upcoming, graph, calendarMonth, today };
}

