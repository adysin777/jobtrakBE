import mongoose, { Schema, Document } from 'mongoose';

export interface IGoogleCalendarConnection {
    _id: mongoose.Types.ObjectId;
    provider: "google";
    email: string;
    status: "connected" | "error" | "disconnected";
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    selectedCalendarId?: string;
    selectedCalendarSummary?: string;
    syncEnabled: boolean;
    createdAt: Date;
}

export interface IUser extends Document {
    primaryEmail: string;
    name: string;

    plan: "free" | "premium" | "pro_monthly" | "pro_yearly";
    planActiveUntil: Date | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;

    onboardingCompleted: boolean;

    connectedInboxes: {
        email: string;
        provider: "gmail" | "outlook";
        status: "connected" | "error" | "disconnected";
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        lastProcessedMessageId?: string;
        lastProcessedAt?: Date;
        historyId?: string;
        watchExpiration?: Date;
        createdAt: Date;
    }[];
    connectedCalendars: IGoogleCalendarConnection[];

    createdAt: Date;
    updatedAt: Date;
}

const connectedInboxSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        provider: {
            type: String,
            enum: ["gmail", "outlook"],
            required: true,
        },
        status: {
            type: String,
            enum: ["connected", "error", "disconnected"],
            default: "connected",
        },
        accessToken: {
            type: String,
            required: true,
        },
        refreshToken: {
            type: String,
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        lastProcessedMessageId: {
            type: String,
        },
        lastProcessedAt: {
            type: Date,
        },
        historyId: {
            type: String,
        },
        watchExpiration: {
            type: Date,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

const connectedCalendarSchema = new Schema(
    {
        provider: {
            type: String,
            enum: ["google"],
            required: true,
            default: "google",
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ["connected", "error", "disconnected"],
            default: "connected",
        },
        accessToken: {
            type: String,
            required: true,
        },
        refreshToken: {
            type: String,
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        selectedCalendarId: {
            type: String,
            trim: true,
        },
        selectedCalendarSummary: {
            type: String,
            trim: true,
        },
        syncEnabled: {
            type: Boolean,
            default: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: true }
);

const userSchema = new Schema<IUser>(
    {
        primaryEmail: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        plan: {
            type: String,
            enum: ["free", "premium", "pro_monthly", "pro_yearly"],
            default: "free",
        },
        planActiveUntil: { type: Date, default: null },
        stripeCustomerId: { type: String, default: null },
        stripeSubscriptionId: { type: String, default: null },
        onboardingCompleted: {
            type: Boolean,
            default: false,
        },
        connectedInboxes: {
            type: [connectedInboxSchema],
            default: [],
        },
        connectedCalendars: {
            type: [connectedCalendarSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// Fast lookup: "which user has this inbox email?" (webhook, workers)
userSchema.index({ "connectedInboxes.email": 1, "connectedInboxes.provider": 1 });
userSchema.index({ "connectedCalendars.email": 1, "connectedCalendars.provider": 1 });

export const User = mongoose.model<IUser>("User", userSchema);