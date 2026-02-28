import mongoose, { Schema, Document, Types } from "mongoose";

export type EventStatus =
    | "APPLIED"
    | "OA"
    | "INTERVIEW"
    | "OFFER"
    | "REJECTED";

/** Broad category of what happened: acknowledgement → OA → rounds → offer/rejection, reschedule, other. */
export type EventType =
    | "OA"
    | "INTERVIEW"
    | "OFFER"
    | "REJECTION"
    | "ACKNOWLEDGEMENT"
    | "RESCHEDULE"
    | "OTHER_UPDATE";

export type EventAssignmentStatus = "unprocessed" | "assigned" | "conflict";

export interface IEvent extends Document {
    userId: Types.ObjectId;

    companyName: string;
    roleTitle: string;
    /** Broad category: what kind of thing happened (ACKNOWLEDGEMENT, OA, INTERVIEW, OFFER, REJECTION, RESCHEDULE, OTHER_UPDATE) */
    eventType: EventType;
    /** Application pipeline status after this event (for updating Application) */
    status: EventStatus;
    aiSummary?: string;

    receivedAt: Date;

    messageId: string;
    threadId?: string;
    provider: "gmail" | "outlook";
    inboxEmail: string;

    assignmentStatus: EventAssignmentStatus;
    applicationId?: Types.ObjectId;

    createdAt: Date;
    updatedAt: Date;
}

const eventSchema = new Schema<IEvent>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        companyName: { type: String, required: true, trim: true },
        roleTitle: { type: String, required: true, trim: true },
        eventType: {
            type: String,
            enum: ["OA", "INTERVIEW", "OFFER", "REJECTION", "ACKNOWLEDGEMENT", "RESCHEDULE", "OTHER_UPDATE"],
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"],
            required: true,
            index: true,
        },
        aiSummary: { type: String, trim: true },
        receivedAt: { type: Date, required: true, index: true },
        messageId: { type: String, required: true, trim: true },
        threadId: { type: String, trim: true },
        provider: { type: String, enum: ["gmail", "outlook"], required: true },
        inboxEmail: { type: String, required: true, lowercase: true, trim: true },
        assignmentStatus: {
            type: String,
            enum: ["unprocessed", "assigned", "conflict"],
            required: true,
            default: "unprocessed",
            index: true,
        },
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: "Application",
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

eventSchema.index({ userId: 1, assignmentStatus: 1 });
eventSchema.index({ userId: 1, receivedAt: -1 });
eventSchema.index({ userId: 1, companyName: 1 }); // for assignment: find applications by company
eventSchema.index({ messageId: 1, userId: 1 }, { unique: true }); // idempotency: one event per email per user

export const Event = mongoose.model<IEvent>("Event", eventSchema);
