import mongoose, { Schema, Document, Types } from 'mongoose';

export type ApplicationStatus = 
    | "APPLIED"
    | "OA"
    | "INTERVIEW"
    | "OFFER"
    | "REJECTED";

export interface IUserDashboardStats extends Document {
    userId: Types.ObjectId;

    activeCount: number;
    countsByStatus: Record<ApplicationStatus, number>;

    lastUpdatedAt: Date;
    version: number; // This model is subject to change

    createdAt: Date;
    updatedAt: Date;
}

const userDashboardStatsSchema = new Schema<IUserDashboardStats>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
            index: true,
        },
        countsByStatus: {
            type: Map,
            of: Number,
            default: {},
        },
        lastUpdatedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        version: {
            type: Number,
            required: true,
            default: 1,
        },
    },
    { timestamps: true }
);

export const UserDashboardStats = mongoose.model<IUserDashboardStats>(
    "UserDashboardStats",
    userDashboardStatsSchema
);
