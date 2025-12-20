import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    primaryEmail: string;
    name: string;
    
    plan: "free" | "premium";
    onboardingCompleted: boolean;

    connectedInboxes: {
        email: string;
        provider: "gmail" | "outlook";
        status: "connected" | "error" | "disconnected";
        createdAt: Date;
    }[];

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
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
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
            enum: ["free", "premium"],
            default: "free",
        },
        onboardingCompleted: {
            type: Boolean,
            default: false,
        },
        connectedInboxes: {
            type: [connectedInboxSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

export const User = mongoose.model<IUser>("User", userSchema);