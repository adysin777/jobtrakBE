import { Application, type IApplication } from "../models/Application";
import { Event } from "../models/Event";
import { ScheduledItem } from "../models/ScheduledItem";
import mongoose, { type QueryFilter } from "mongoose";

export type ListStatusFilter =
  | "all"
  | "active"
  | "OA"
  | "interview"
  | "offer"
  | "rejection";

export type ListTimeRange =
  | "all"
  | "7"
  | "30"
  | "90";

export interface ListApplicationsParams {
  status?: ListStatusFilter;
  timeRange?: ListTimeRange;
  search?: string;
}

export interface ApplicationListItem {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
  appliedAt: string;
}

const statusMap: Record<ListStatusFilter, string[] | null> = {
  all: null,
  active: ["APPLIED", "OA", "INTERVIEW"], // anything not offer/rejection
  OA: ["OA"],
  interview: ["INTERVIEW"],
  offer: ["OFFER"],
  rejection: ["REJECTED"],
};

export async function listApplicationsService(
  userId: string,
  params: ListApplicationsParams
): Promise<ApplicationListItem[]> {
  const query: QueryFilter<IApplication> = {
    userId: new mongoose.Types.ObjectId(userId),
  };

  if (params.status && params.status !== "all") {
    const statuses = statusMap[params.status];
    if (statuses) query.status = { $in: statuses };
  }

  if (params.timeRange && params.timeRange !== "all") {
    const days = parseInt(params.timeRange, 10);
    const since = new Date();
    since.setDate(since.getDate() - days);
    query.appliedAt = { $gte: since };
  }

  if (params.search && params.search.trim()) {
    const term = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(term, "i");
    query.$or = [
      { companyName: re },
      { roleTitle: re },
    ];
  }

  const list = await Application.find(query)
    .sort({ appliedAt: -1, _id: -1 })
    .lean();

  return list.map((doc) => ({
    id: (doc as any)._id.toString(),
    companyName: doc.companyName,
    roleTitle: doc.roleTitle,
    status: doc.status,
    appliedAt: doc.appliedAt.toISOString(),
  }));
}

export interface ApplicationEventScheduledItem {
  id: string;
  type: "OA" | "INTERVIEW";
  title: string;
  startAt: string;
  endAt?: string;
  timezone: string;
  notes?: string;
  links: { label: string; url: string }[];
}

export interface ApplicationEventItem {
  id: string;
  eventType: string;
  status: string;
  receivedAt: string;
  aiSummary?: string;
  provider?: "gmail" | "outlook";
  inboxEmail?: string;
  messageId?: string;
  threadId?: string;
  scheduledItems?: ApplicationEventScheduledItem[];
}

export async function getApplicationEventsService(
  userId: string,
  applicationId: string
): Promise<ApplicationEventItem[]> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const app = await Application.findOne({ _id: appId, userId: userObjId }).lean();
  if (!app) return [];

  const events = await Event.find({
    userId: userObjId,
    applicationId: appId,
  })
    .sort({ receivedAt: 1 })
    .lean();

  const eventIds = events.map((doc: any) => doc._id);
  const scheduledDocs =
    eventIds.length === 0
      ? []
      : await ScheduledItem.find({
          userId: userObjId,
          eventId: { $in: eventIds },
        })
          .sort({ startAt: 1 })
          .lean();

  const scheduledByEventId = new Map<string, typeof scheduledDocs>();
  for (const row of scheduledDocs) {
    const eid = (row as any).eventId?.toString();
    if (!eid) continue;
    const list = scheduledByEventId.get(eid);
    if (list) list.push(row as any);
    else scheduledByEventId.set(eid, [row as any]);
  }

  return events.map((doc: any) => {
    const sid = doc._id.toString();
    const items = scheduledByEventId.get(sid) ?? [];
    const scheduledItems: ApplicationEventScheduledItem[] = items.map((si: any) => ({
      id: si._id.toString(),
      type: si.type,
      title: si.title,
      startAt: si.startAt.toISOString(),
      endAt: si.endAt ? si.endAt.toISOString() : undefined,
      timezone: si.timezone,
      notes: si.notes,
      links: Array.isArray(si.links) ? si.links : [],
    }));

    return {
      id: sid,
      eventType: doc.eventType,
      status: doc.status,
      receivedAt: doc.receivedAt.toISOString(),
      aiSummary: doc.aiSummary,
      provider: doc.provider,
      inboxEmail: doc.inboxEmail,
      messageId: doc.messageId,
      threadId: doc.threadId,
      ...(scheduledItems.length > 0 ? { scheduledItems } : {}),
    };
  });
}
