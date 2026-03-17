import { EventPayloadSchema, type EventPayload } from "../types/event.types";
import { User } from "../models/User";
import { Event } from "../models/Event";
import { Application } from "../models/Application";
import { ScheduledItem } from "../models/ScheduledItem";
import { UserDashboardStats } from "../models/UserDashboardStats";
import { UserDailyStats } from "../models/UserDailyStats";
import type { ApplicationStatus } from "../models/Application";
import { getMaxTrackedApplications } from "../config/planConfig";
import { syncUserPlanFromStripe, expireUserPlanIfNeeded } from "../services/billing.service";
import mongoose from "mongoose";

const COMPANY_SUFFIXES = new Set([
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "company",
    "plc",
    "gmbh",
]);

const TITLE_VARIANT_TOKENS = new Set([
    "summer",
    "winter",
    "spring",
    "fall",
    "autumn",
]);

function normalizeWhitespace(str: string): string {
    return str.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function tokenize(str: string): string[] {
    return normalizeWhitespace(str)
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function normalizeCompany(str: string): string {
    const tokens = tokenize(str).filter((token) => !COMPANY_SUFFIXES.has(token));
    return tokens.join(" ");
}

function normalizeTitle(str: string): string {
    return tokenize(str).join(" ");
}

function canonicalizeTitleVariant(str: string): string {
    const tokens = tokenize(str).filter(
        (token) => !TITLE_VARIANT_TOKENS.has(token) && !/^(19|20)\d{2}$/.test(token)
    );
    return tokens.join(" ");
}

function isActiveApplication(status: ApplicationStatus): boolean {
    return status !== "REJECTED";
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

/** Derive pipeline status from eventType so OA/INTERVIEW/OFFER/REJECTION always advance the application. */
function statusFromEventType(eventType: string, fallback: ApplicationStatus): ApplicationStatus {
    const m: Record<string, ApplicationStatus> = {
        OA: "OA",
        INTERVIEW: "INTERVIEW",
        OFFER: "OFFER",
        REJECTION: "REJECTED",
        ACKNOWLEDGEMENT: "APPLIED",
    };
    return m[eventType] ?? fallback;
}

async function markEventConflict(eventId: mongoose.Types.ObjectId, reason: string): Promise<void> {
    await Event.updateOne(
        { _id: eventId },
        { $set: { assignmentStatus: "conflict" } }
    );
    console.log(`Event assignment conflict for ${eventId}: ${reason}`);
}

async function findApplicationByThreadHistory(event: any): Promise<any | null> {
    if (!event.threadId) return null;

    const priorEvent = await Event.findOne({
        userId: event.userId,
        threadId: event.threadId,
        applicationId: { $ne: null },
        _id: { $ne: event._id },
    })
        .sort({ receivedAt: -1 })
        .lean();

    if (priorEvent?.applicationId) {
        const application = await Application.findOne({
            _id: priorEvent.applicationId,
            userId: event.userId,
        });
        if (application) return application;
    }

    return Application.findOne({
        userId: event.userId,
        "source.threadId": event.threadId,
    }).sort({ lastEventAt: -1 });
}

function chooseSafeCompanyCandidate(event: any, applications: any[]): any | null {
    const companyNorm = normalizeCompany(event.companyName);
    const titleNorm = normalizeTitle(event.roleTitle);
    const variantTitleNorm = canonicalizeTitleVariant(event.roleTitle);

    const sameCompany = applications.filter(
        (application) => normalizeCompany(application.companyName ?? application.companyNorm ?? "") === companyNorm
    );
    if (sameCompany.length === 0) return null;

    const activeCandidates = sameCompany.filter((application) => isActiveApplication(application.status));
    const pool = activeCandidates.length > 0 ? activeCandidates : sameCompany;

    if (event.threadId) {
        const byThread = pool.find((application) => application.source?.threadId === event.threadId);
        if (byThread) return byThread;
    }

    const exactTitleMatches = pool.filter(
        (application) => normalizeTitle(application.roleTitle ?? application.titleNorm ?? "") === titleNorm
    );
    if (exactTitleMatches.length === 1) return exactTitleMatches[0];
    if (exactTitleMatches.length > 1) return null;

    if (pool.length === 1 && activeCandidates.length > 0) return pool[0];

    const canonicalTitleMatches = pool.filter(
        (application) => canonicalizeTitleVariant(application.roleTitle ?? application.titleNorm ?? "") === variantTitleNorm
    );
    if (canonicalTitleMatches.length === 1) return canonicalTitleMatches[0];

    return null;
}

async function attachScheduledItemsToApplication(event: any, applicationId: mongoose.Types.ObjectId): Promise<void> {
    const pendingItems = await ScheduledItem.find({ eventId: event._id }).sort({ startAt: 1 });
    if (pendingItems.length === 0) return;

    if (event.eventType !== "RESCHEDULE") {
        await ScheduledItem.updateMany(
            { eventId: event._id },
            { $set: { applicationId } }
        );
        return;
    }

    for (const pendingItem of pendingItems) {
        const candidates = await ScheduledItem.find({
            userId: event.userId,
            applicationId,
            type: pendingItem.type,
            source: "auto",
            _id: { $ne: pendingItem._id },
        }).sort({ startAt: -1 });

        const sameThreadCandidate = pendingItem.sourceMeta?.threadId
            ? candidates.find((candidate) => candidate.sourceMeta?.threadId === pendingItem.sourceMeta?.threadId)
            : null;
        const targetItem = sameThreadCandidate ?? candidates[0] ?? null;

        if (!targetItem) {
            await ScheduledItem.updateOne(
                { _id: pendingItem._id },
                { $set: { applicationId } }
            );
            continue;
        }

        await ScheduledItem.updateOne(
            { _id: targetItem._id },
            {
                $set: {
                    applicationId,
                    title: pendingItem.title,
                    startAt: pendingItem.startAt,
                    endAt: pendingItem.endAt,
                    duration: pendingItem.duration,
                    timezone: pendingItem.timezone,
                    links: pendingItem.links,
                    notes: pendingItem.notes,
                    companyName: pendingItem.companyName ?? event.companyName,
                    roleTitle: event.roleTitle,
                    sourceMeta: {
                        provider: event.provider,
                        inboxEmail: event.inboxEmail,
                        messageId: event.messageId,
                        threadId: event.threadId ?? pendingItem.sourceMeta?.threadId ?? event.messageId,
                    },
                },
            }
        );

        await ScheduledItem.deleteOne({ _id: pendingItem._id });
    }
}

/**
 * Create Event + ScheduledItems from extracted payload. Event has assignmentStatus unprocessed; ScheduledItems have eventId set, applicationId null.
 */
export async function createEventFromPayload(payload: EventPayload): Promise<{ event: mongoose.Document; userId: mongoose.Types.ObjectId }> {
    const data = EventPayloadSchema.parse(payload);
    const user = await User.findOne({ primaryEmail: data.userEmail });
    if (!user) {
        throw new Error(`User not found: ${data.userEmail}. Ingest only applies to connected inboxes owned by existing accounts.`);
    }
    const userId = user._id;
    if (data.userId && user._id.toString() !== data.userId) {
        throw new Error(`User ID mismatch: email ${data.userEmail} does not belong to user ${data.userId}`);
    }

    const receivedAt = new Date(data.receivedAt);

    const existing = await Event.findOne({ messageId: data.messageId, userId });
    if (existing) {
        return { event: existing, userId };
    }

    const status = statusFromEventType(data.eventType, data.status as ApplicationStatus);
    const event = await Event.create({
        userId,
        companyName: data.companyName,
        roleTitle: data.roleTitle,
        eventType: data.eventType,
        status,
        aiSummary: data.aiSummary,
        receivedAt,
        messageId: data.messageId,
        threadId: data.threadId,
        provider: data.provider,
        inboxEmail: data.inboxEmail,
        assignmentStatus: "unprocessed",
    });

    if (data.scheduledItems && data.scheduledItems.length > 0) {
        for (const item of data.scheduledItems) {
            try {
                await ScheduledItem.create({
                    userId,
                    eventId: event._id,
                    applicationId: undefined,
                    type: item.type,
                    title: item.title,
                    startAt: new Date(item.startAt),
                    endAt: item.endAt ? new Date(item.endAt) : undefined,
                    duration: item.duration,
                    timezone: "America/Toronto",
                    links: item.links ?? [],
                    notes: item.notes,
                    companyName: item.companyName ?? data.companyName,
                    roleTitle: data.roleTitle,
                    source: "auto",
                    sourceMeta: {
                        provider: data.provider,
                        inboxEmail: data.inboxEmail,
                        messageId: data.messageId,
                        threadId: data.threadId ?? data.messageId,
                    },
                });
            } catch (err: unknown) {
                const isDuplicate = err && typeof err === "object" && "code" in err && (err as { code?: number }).code === 11000;
                if (isDuplicate) {
                    console.log(
                        `[Ingest] Skipping duplicate ScheduledItem messageId=${data.messageId} type=${item.type} startAt=${item.startAt}`
                    );
                } else {
                    throw err;
                }
            }
        }
    }

    return { event, userId };
}

/**
 * Assign event to an application: match by company + role; if multiple, use threadId then most recent lastEventAt.
 * Updates Event, Application, ScheduledItems, and dashboard/daily stats.
 */
export async function assignEventToApplication(eventId: mongoose.Types.ObjectId): Promise<void> {
    const event = await Event.findById(eventId);
    if (!event) throw new Error("Event not found");
    if (event.assignmentStatus === "assigned") {
        console.log("Event already assigned:", eventId);
        return;
    }

    const userId = event.userId;
    const companyNorm = normalizeCompany(event.companyName);
    const titleNorm = normalizeTitle(event.roleTitle);
    const receivedAt = event.receivedAt;

    let application = await findApplicationByThreadHistory(event);

    if (!application) {
        const exactApplications = await Application.find({ userId, companyNorm, titleNorm }).sort({ lastEventAt: -1 });
        if (event.threadId && exactApplications.length > 0) {
            const byThread = exactApplications.find((candidate) => candidate.source?.threadId === event.threadId);
            if (byThread) {
                application = byThread;
            }
        }

        if (!application && exactApplications.length === 1) {
            application = exactApplications[0];
        }

        if (!application && exactApplications.length > 1) {
            const activeExactApplications = exactApplications.filter((candidate) => candidate.isActive);
            if (activeExactApplications.length === 1) {
                application = activeExactApplications[0];
            } else {
                await markEventConflict(eventId, `multiple exact matches for ${event.companyName} / ${event.roleTitle}`);
                return;
            }
        }
    }

    if (!application) {
        const allApplications = await Application.find({ userId }).sort({ lastEventAt: -1 });
        const sameCompany = allApplications.filter(
            (candidate) => normalizeCompany(candidate.companyName) === companyNorm
        );

        if (sameCompany.length > 0) {
            application = chooseSafeCompanyCandidate(event, sameCompany);
            if (!application) {
                await markEventConflict(eventId, `ambiguous company-level match for ${event.companyName}`);
                return;
            }
        }
    }

    if (!application) {
        // Would create a new application – enforce free-tier limit.
        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");
        if (user.stripeCustomerId) {
          await syncUserPlanFromStripe(user);
        }
        await expireUserPlanIfNeeded(user);
        const maxApps = getMaxTrackedApplications(user.plan, user.planActiveUntil ?? null);
        if (Number.isFinite(maxApps)) {
            const count = await Application.countDocuments({ userId });
            if (count >= maxApps) {
                await markEventConflict(eventId, `application limit reached for user ${userId}: ${count} >= ${maxApps}`);
                return;
            }
        }
        application = await Application.create({
            userId,
            companyName: event.companyName,
            companyNorm,
            roleTitle: event.roleTitle,
            titleNorm,
            status: event.status,
            statusRank: getStatusRank(event.status),
            statusUpdatedAt: receivedAt,
            appliedAt: receivedAt,
            lastEventAt: receivedAt,
            isActive: isActiveApplication(event.status),
            aiSummary: event.aiSummary,
            source: {
                provider: event.provider,
                inboxEmail: event.inboxEmail,
                threadId: event.threadId,
                lastMessageId: event.messageId,
            },
        });
    }

    await Event.updateOne(
        { _id: eventId },
        { $set: { applicationId: application._id, assignmentStatus: "assigned" } }
    );

    await Application.updateOne(
        { _id: application._id },
        {
            $set: {
                companyName: event.companyName,
                companyNorm,
                roleTitle: event.roleTitle,
                titleNorm,
                status: event.status,
                statusRank: getStatusRank(event.status),
                statusUpdatedAt: receivedAt,
                lastEventAt: receivedAt,
                isActive: isActiveApplication(event.status),
                aiSummary: event.aiSummary,
                source: {
                    provider: event.provider,
                    inboxEmail: event.inboxEmail,
                    threadId: event.threadId,
                    lastMessageId: event.messageId,
                },
            },
        }
    );

    await attachScheduledItemsToApplication(event, application._id);

    const today = receivedAt.toISOString().slice(0, 10);
    await UserDashboardStats.findOneAndUpdate(
        { userId },
        { $set: { lastUpdatedAt: new Date() }, $inc: { [`countsByStatus.${event.status}`]: 1 } },
        { upsert: true }
    );
    const dailyField =
        event.status === "OA" ? "oaCount" :
        event.status === "INTERVIEW" ? "interviewCount" :
        event.status === "OFFER" ? "offerCount" :
        event.status === "REJECTED" ? "rejectionCount" : "appliedCount";
    await UserDailyStats.findOneAndUpdate(
        { userId, day: today },
        { $inc: { [dailyField]: 1 } },
        { upsert: true }
    );

    console.log("✅ Event assigned to application:", application._id);
}
