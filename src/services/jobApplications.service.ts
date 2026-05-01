import { Application, type ApplicationStatus, type IApplication } from "../models/Application";
import { Event, type EventStatus, type EventType } from "../models/Event";
import { ScheduledItem } from "../models/ScheduledItem";
import mongoose, { type QueryFilter } from "mongoose";
import { notifyDashboardUpdate } from "./sse.service";

function simpleNorm(str: string): string {
  return str.toLocaleLowerCase().trim();
}

function getStatusRank(status: ApplicationStatus): number {
  const rankMap: Record<ApplicationStatus, number> = {
    APPLIED: 0,
    OA: 1,
    INTERVIEW: 2,
    OFFER: 3,
    REJECTED: -1,
  };
  return rankMap[status];
}

export type ListStatusFilter =
  | "all"
  | "active"
  | "OA"
  | "interview"
  | "offer"
  | "rejection"
  | "archived";

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
  archived: boolean;
}

const statusMap: Record<Exclude<ListStatusFilter, "all" | "archived">, string[]> = {
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

  if (params.status === "archived") {
    query.archived = true;
  } else {
    query.archived = { $ne: true };
    if (params.status && params.status !== "all") {
      const statuses = statusMap[params.status as keyof typeof statusMap];
      if (statuses) query.status = { $in: statuses };
    }
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
    archived: Boolean((doc as any).archived),
  }));
}

export interface ApplicationEventScheduledItem {
  id: string;
  type: "OA" | "INTERVIEW";
  title: string;
  startAt: string;
  endAt?: string;
  timezone: string;
  completedAt?: string;
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
      completedAt: si.completedAt ? si.completedAt.toISOString() : undefined,
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

export interface PatchApplicationInput {
  companyName?: string;
  roleTitle?: string;
  appliedAt?: string;
  status?: ApplicationStatus;
  archived?: boolean;
}

export async function patchApplicationForUser(
  userId: string,
  applicationId: string,
  patch: PatchApplicationInput
): Promise<ApplicationListItem | null> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const app = await Application.findOne({ _id: appId, userId: userObjId });
  if (!app) return null;

  if (patch.companyName !== undefined) {
    app.companyName = patch.companyName.trim();
    app.companyNorm = simpleNorm(patch.companyName);
  }
  if (patch.roleTitle !== undefined) {
    app.roleTitle = patch.roleTitle.trim();
    app.titleNorm = simpleNorm(patch.roleTitle);
  }
  if (patch.appliedAt !== undefined) {
    app.appliedAt = new Date(patch.appliedAt);
  }
  if (patch.status !== undefined) {
    app.status = patch.status;
    app.statusRank = getStatusRank(patch.status);
    app.isActive = patch.status !== "REJECTED";
    app.statusUpdatedAt = new Date();
  }
  if (patch.archived !== undefined) {
    app.archived = patch.archived;
  }

  await app.save();
  notifyDashboardUpdate(userId, { internal: true });

  return {
    id: (app._id as mongoose.Types.ObjectId).toString(),
    companyName: app.companyName,
    roleTitle: app.roleTitle,
    status: app.status,
    appliedAt: app.appliedAt.toISOString(),
    archived: Boolean(app.archived),
  };
}

export interface PatchApplicationEventInput {
  eventType?: EventType;
  status?: EventStatus;
  receivedAt?: string;
  aiSummary?: string | null;
}

export async function patchApplicationEventForUser(
  userId: string,
  applicationId: string,
  eventId: string,
  patch: PatchApplicationEventInput
): Promise<ApplicationEventItem | null> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const eid = new mongoose.Types.ObjectId(eventId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const ownsApp = await Application.exists({ _id: appId, userId: userObjId });
  if (!ownsApp) return null;

  const event = await Event.findOne({
    _id: eid,
    userId: userObjId,
    applicationId: appId,
  });
  if (!event) return null;

  if (patch.eventType !== undefined) event.eventType = patch.eventType;
  if (patch.status !== undefined) event.status = patch.status;
  if (patch.receivedAt !== undefined) {
    event.receivedAt = new Date(patch.receivedAt);
  }
  if (patch.aiSummary !== undefined) {
    event.aiSummary = patch.aiSummary === null || patch.aiSummary === "" ? undefined : patch.aiSummary;
  }

  await event.save();
  notifyDashboardUpdate(userId, { internal: true });

  const events = await getApplicationEventsService(userId, applicationId);
  return events.find((e) => e.id === eventId) ?? null;
}

/** Delete one timeline event and its scheduled items; refresh application lastEventAt from remaining events. */
export async function deleteApplicationEventForUser(
  userId: string,
  applicationId: string,
  eventId: string
): Promise<boolean> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const eid = new mongoose.Types.ObjectId(eventId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const ownsApp = await Application.exists({ _id: appId, userId: userObjId });
  if (!ownsApp) return false;

  const existing = await Event.findOne({
    _id: eid,
    userId: userObjId,
    applicationId: appId,
  }).select("_id");
  if (!existing) return false;

  await ScheduledItem.deleteMany({ userId: userObjId, eventId: eid });
  await Event.deleteOne({ _id: eid, userId: userObjId, applicationId: appId });

  const latest = await Event.findOne({ userId: userObjId, applicationId: appId })
    .sort({ receivedAt: -1 })
    .select("receivedAt")
    .lean();

  const app = await Application.findOne({ _id: appId, userId: userObjId });
  if (app) {
    const nextLast = latest && (latest as { receivedAt?: Date }).receivedAt;
    app.lastEventAt = nextLast ?? app.appliedAt;
    await app.save();
  }

  notifyDashboardUpdate(userId, { internal: true });
  return true;
}

/**
 * Permanently remove an archived application and all events + scheduled items tied to it.
 * Only applications with archived === true can be deleted (safety).
 */
export async function deleteArchivedApplicationForUser(
  userId: string,
  applicationId: string
): Promise<boolean> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const ownsArchived = await Application.exists({
    _id: appId,
    userId: userObjId,
    archived: true,
  });
  if (!ownsArchived) return false;

  const eventDocs = await Event.find({ userId: userObjId, applicationId: appId })
    .select("_id")
    .lean();
  const eventIds = eventDocs.map((e: { _id: unknown }) => e._id as mongoose.Types.ObjectId);

  await ScheduledItem.deleteMany({
    userId: userObjId,
    $or: [{ applicationId: appId }, { eventId: { $in: eventIds } }],
  });
  await Event.deleteMany({ userId: userObjId, applicationId: appId });
  await Application.deleteOne({ _id: appId, userId: userObjId });

  notifyDashboardUpdate(userId, { internal: true });
  return true;
}

export async function patchScheduledItemCompletionForUser(
  userId: string,
  applicationId: string,
  scheduledItemId: string,
  completed: boolean
): Promise<ApplicationEventScheduledItem | null> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const sid = new mongoose.Types.ObjectId(scheduledItemId);
  const userObjId = new mongoose.Types.ObjectId(userId);

  const ownsApp = await Application.exists({ _id: appId, userId: userObjId });
  if (!ownsApp) return null;

  const scheduledItem = await ScheduledItem.findOne({
    _id: sid,
    userId: userObjId,
    applicationId: appId,
  });
  if (!scheduledItem) return null;

  scheduledItem.completedAt = completed ? new Date() : null;
  await scheduledItem.save();
  notifyDashboardUpdate(userId, { internal: true });

  return {
    id: (scheduledItem._id as mongoose.Types.ObjectId).toString(),
    type: scheduledItem.type,
    title: scheduledItem.title,
    startAt: scheduledItem.startAt.toISOString(),
    endAt: scheduledItem.endAt ? scheduledItem.endAt.toISOString() : undefined,
    timezone: scheduledItem.timezone,
    completedAt: scheduledItem.completedAt ? scheduledItem.completedAt.toISOString() : undefined,
    notes: scheduledItem.notes,
    links: Array.isArray(scheduledItem.links) ? scheduledItem.links : [],
  };
}
