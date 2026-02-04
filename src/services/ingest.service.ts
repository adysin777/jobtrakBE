import { IngestEventSchema, type IngestEvent } from "../types/ingestEvent.types";
import { User } from '../models/User';
import { Application } from "../models/Application";
import { ApplicationStatus, UserDashboardStats } from "../models/UserDashboardStats";
import { UserDailyStats } from "../models/UserDailyStats";
import { ScheduledItem } from "../models/ScheduledItem";
import mongoose from 'mongoose';

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

function normalize(str: string): string {
    return str.toLocaleLowerCase().trim();
}

export async function ingestJobEventService(data: any): Promise<void> {
    console.log("📥 Ingesting event:", data);
    const event = IngestEventSchema.parse(data);

    const user = await User.findOneAndUpdate(
        { primaryEmail: event.userEmail },
        { $setOnInsert: {
            primaryEmail: event.userEmail,
            name: event.userEmail.split("@")[0]
        }},
        { upsert: true, new: true }
    );

    if (event.userId) {
        if (user._id.toString() !== event.userId) {
            throw new Error(`User ID mismatch: email ${event.userEmail} does not belong to user ${event.userId}`);
        }
    }

    const inboxConnected = user.connectedInboxes.some(
        inbox => inbox.email.toLowerCase() === event.inboxEmail.toLocaleLowerCase() &&
                 inbox.status === "connected"
    );

    if (!inboxConnected && process.env.NODE_ENV === "production") {
        console.warn(`Inbox ${event.inboxEmail} not connected for user ${user._id}`);
    }

    const userId = user._id;
    const receivedAt = new Date(event.receivedAt);
    const today = receivedAt.toISOString().slice(0, 10);

    const companyNorm = normalize(event.companyName);
    const titleNorm = normalize(event.roleTitle);

    const application = await Application.findOneAndUpdate(
        { userId, companyNorm, titleNorm },
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
            $setOnInsert: {
                appliedAt: receivedAt,
                isActive: event.status !== "REJECTED",
            },
        },
        { upsert: true, new: true }
    );

    const applicationId = application._id;
    console.log("✅ Application upserted:", application._id);

    await UserDashboardStats.findOneAndUpdate(
        { userId },
        {
            $set: { lastUpdatedAt: new Date() },
            $inc: {
                [`countsByStatus.${event.status}`]: 1,
            },
        },
        { upsert: true }
    );

    const dailyStatField = event.status === "OA" ? "oaCount" :
                        event.status === "INTERVIEW" ? "interviewCount" :
                        event.status === "OFFER" ? "offerCount" :
                        event.status === "REJECTED" ? "rejectionCount" :
                        "appliedCount";

    await UserDailyStats.findOneAndUpdate(
        { userId, day: today },
        { $inc: { [dailyStatField]: 1 } },
        { upsert: true }
        );

    if (event.scheduledItems && event.scheduledItems.length > 0) {
        // Use upsert for each item to handle duplicates
        for (const item of event.scheduledItems) {
            await ScheduledItem.findOneAndUpdate(
                {
                    userId,
                    "sourceMeta.messageId": event.messageId,
                    type: item.type,
                    startAt: new Date(item.startAt),
                },
                {
                    $set: {
                        applicationId,
                        title: item.title,
                        endAt: item.endAt ? new Date(item.endAt) : undefined,
                        duration: item.duration,
                        timezone: "America/Toronto",
                        links: item.links || [],
                        notes: item.notes,
                        companyName: item.companyName || event.companyName,
                        roleTitle: event.roleTitle,
                        source: "auto",
                        sourceMeta: {
                            provider: event.provider,
                            inboxEmail: event.inboxEmail,
                            messageId: event.messageId,
                            threadId: event.threadId || event.messageId,
                        },
                    },
                },
                { upsert: true, new: true }
            );
        }
        console.log("✅ ScheduledItems upserted:", event.scheduledItems.length);
    }
    
    console.log("✅ Ingest complete for:", event.messageId);
}