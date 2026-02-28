import { EventPayloadSchema, type EventPayload } from "../types/event.types";
import { User } from "../models/User";
import { Event } from "../models/Event";
import { Application } from "../models/Application";
import { ScheduledItem } from "../models/ScheduledItem";
import { UserDashboardStats } from "../models/UserDashboardStats";
import { UserDailyStats } from "../models/UserDailyStats";
import type { ApplicationStatus } from "../models/Application";
import mongoose from "mongoose";

function normalize(str: string): string {
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
    const companyNorm = normalize(event.companyName);
    const titleNorm = normalize(event.roleTitle);
    const receivedAt = event.receivedAt;

    let applications = await Application.find({ userId, companyNorm, titleNorm }).sort({ lastEventAt: -1 });

    if (event.threadId && applications.length > 0) {
        const byThread = applications.find((a) => a.source?.threadId === event.threadId);
        if (byThread) applications = [byThread];
    }

    let application;
    if (applications.length === 0) {
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
            isActive: event.status !== "REJECTED",
            aiSummary: event.aiSummary,
            source: {
                provider: event.provider,
                inboxEmail: event.inboxEmail,
                threadId: event.threadId,
                lastMessageId: event.messageId,
            },
        });
    } else if (applications.length === 1) {
        application = applications[0];
    } else {
        application = applications[0];
        console.log(`Multiple applications for ${event.companyName} / ${event.roleTitle}; using most recent: ${application._id}`);
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
                roleTitle: event.roleTitle,
                status: event.status,
                statusRank: getStatusRank(event.status),
                statusUpdatedAt: receivedAt,
                lastEventAt: receivedAt,
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

    await ScheduledItem.updateMany(
        { eventId },
        { $set: { applicationId: application._id } }
    );

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
