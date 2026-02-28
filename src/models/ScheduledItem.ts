import mongoose, { Schema, Document, Types } from 'mongoose';

export type ScheduledItemType = "OA" | "INTERVIEW";

export type ScheduledItemSource = "auto" | "manual";

export interface IScheduledItemLink {
    label: string;
    url: string;
}

export interface IScheduledItem extends Document {
    userId: Types.ObjectId;
    /** Set when event is assigned to an application; null until then for auto-created items */
    applicationId?: Types.ObjectId;

    /** Set when created from an event (source auto); used to set applicationId when event is assigned */
    eventId?: Types.ObjectId;

    type: ScheduledItemType;
    title: string;

    startAt: Date;
    endAt?: Date;
    duration?: number;
    timezone: string;

    notes?: string;
    links: IScheduledItemLink[];

    companyName?: string;
    roleTitle?: string;

    source: ScheduledItemSource;
    sourceMeta?: {
        provider?: "gmail" | "outlook";
        inboxEmail?: string;
        messageId?: string;
        threadId: string;
    };

    createdAt: Date;
    updatedAt: Date;
}

const linkSchema = new Schema<IScheduledItemLink>(
    {
        label: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const sourceMetaSchema = new Schema(
    {
        provider: { type: String, enum: ["gmail", "outlook"] },
        inboxEmail: { type: String, lowercase: true, trim: true },
        messageId: { type: String, trim: true },
        threadId: { type: String, trim: true },
    },
    { _id: false }
);

const scheduledItemSchema = new Schema<IScheduledItem>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: "Application",
            default: null,
            index: true,
        },
        eventId: {
            type: Schema.Types.ObjectId,
            ref: "Event",
            default: null,
            index: true,
        },
        type: {
            type: String,
            enum: ["OA", "INTERVIEW"],
            required: true,
            index: true,
        },

        title: { type: String, required: true, trim: true },
        startAt: { type: Date, required: true, index: true, },
        endAt: { type: Date},
        duration: { type: Number },
        timezone: { type: String, required: true, default: "EST" },

        notes: { type: String, trim: true },
        links: { type: [linkSchema], default: [] },

        companyName: { type: String, trim: true },
        roleTitle: { type: String, trim: true },

        source: {
            type: String,
            enum: ["auto", "manual"],
            required: true,
            default: "manual",
            index: true,
        },

        sourceMeta: { type: sourceMetaSchema },
    },
    { timestamps: true }
);

scheduledItemSchema.index({ userId: 1, startAt: 1 });
scheduledItemSchema.index({ userId: 1, startAt: 1, type: 1 });
scheduledItemSchema.index({ applicationId: 1, startAt: 1 }); // sparse: only when assigned
scheduledItemSchema.index({ eventId: 1 }); // find items by event (e.g. set applicationId on assign)

scheduledItemSchema.index(
    { userId: 1, "sourceMeta.messageId": 1, type: 1, startAt: 1 },
    { unique: true, sparse: true }
);

export const ScheduledItem = mongoose.model<IScheduledItem>(
    "ScheduledItem",
    scheduledItemSchema
);