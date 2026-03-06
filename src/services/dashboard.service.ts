import mongoose from "mongoose";
import type { DashboardResponse } from "../types/dashboard.types";
import { User } from "../models/User";
import { UserDashboardStats } from "../models/UserDashboardStats";
import { ScheduledItem } from "../models/ScheduledItem"
import { UserDailyStats } from "../models/UserDailyStats";

import type { ApplicationStatus } from "../models/UserDashboardStats";

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

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const [statsDoc, upcomingItems, todayItems, dailyStats, userDoc] = await Promise.all([
        UserDashboardStats.findOne({ userId }).lean(),
        ScheduledItem.find({ userId: userIdObj, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(10).lean(),
        ScheduledItem.find({ userId: userIdObj, startAt: { $gte: start, $lt: end } }).sort({ startAt: 1}).lean(),
        UserDailyStats.find({ userId }).sort({ date: 1 }).limit(90).lean(),
        User.findById(userId).select("connectedInboxes").lean(),
    ])

    console.log(upcomingItems);

    const connectedInboxCount = (userDoc as any)?.connectedInboxes?.filter((i: any) => i.status === "connected").length ?? 0;

    const calendarDays = await ScheduledItem.aggregate([
        {
          $match: {
            userId: userIdObj,
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
        duration: x.duration,
        applicationId: x.applicationId ? String(x.applicationId) : undefined,
        company: x.companyName ?? undefined,
        role: x.roleTitle ?? undefined,
    }));

    const graph: DashboardResponse["graph"] = (dailyStats ?? []).map((d: any) => ({
        date: typeof d.date === "string" ? d.date : ymd(d.date),
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
    const items = await ScheduledItem.find({
        userId: userIdObj,
        startAt: { $gte: dayStart, $lt: dayEnd },
    })
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

