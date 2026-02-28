import mongoose, { Schema, Document, Types } from 'mongoose';

export type ApplicationStatus = 
    | "APPLIED"
    | "OA"
    | "INTERVIEW"
    | "OFFER"
    | "REJECTED";

export interface IApplication extends Document {
    userId: Types.ObjectId;

    companyName: string;
    companyNorm: string;
    roleTitle: string;
    titleNorm: string; // ?

    location?: string; // ?

    status: ApplicationStatus;
    statusRank: number;
    statusUpdatedAt: Date;

    appliedAt: Date; // ?
    lastEventAt: Date;

    isActive: boolean;

    userNotes?: string;

    aiSummary?: string;
    aiImportantLinks?: { label: string; url: string }[];

    source?: {
        provider?: "gmail" | "outlook";
        inboxEmail?: string;
        threadId?: string;
        lastMessageId?: string;
    }

    createdAt: Date;
    updatedAt: Date;
}

const linkSchema = new Schema(
    {
        label: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const sourceSchema = new Schema(
    {
        provider: { type: String, enum: ["gmail", "outlook"] },
        inboxEmail: { type: String, lowercase: true, trim: true },
        threadId: { type: String, trim: true },
        lastMessageId: { type: String, trim: true },
    },
    { _id: false }
);

const applicationSchema = new Schema<IApplication>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        companyName: {
            type: String,
            required: true,
            trim: true,
        },
        companyNorm: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },

        roleTitle: {
            type: String,
            required: true,
            trim: true,
        },
        titleNorm: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },

        location: { type: String, trim: true, },

        status: {
            type: String,
            enum: ["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"],
            required: true,
            index: true,
        },

        statusRank: { type: Number, required: true, },
        statusUpdatedAt: { type: Date, required: true, },

        appliedAt: { type: Date, required: true, default: Date.now, },
        lastEventAt: { type: Date, required: true, index: true, },

        isActive: { type: Boolean, required: true, default: true, index: true },

        userNotes: { type: String, trim: true },

        aiSummary: { type: String, trim: true },
        aiImportantLinks: { type: [linkSchema], default: [] },

        source: { type: sourceSchema },
    },
    { timestamps: true }
);

applicationSchema.index({ userId: 1, lastEventAt: -1, _id: -1 });
applicationSchema.index({ userId: 1, isActive: 1, lastEventAt: -1 });
applicationSchema.index({ userId: 1, status: 1, lastEventAt: -1 });
applicationSchema.index({ userId: 1, companyNorm: 1, titleNorm: 1 });
applicationSchema.index({ userId: 1, "source.threadId": 1 }); // same thread = same application
applicationSchema.index({ userId: 1, appliedAt: -1 });

export const Application = mongoose.model<IApplication>("Application", applicationSchema);

