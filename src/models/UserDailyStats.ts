import mongoose, { Schema, Document, Types } from 'mongoose';
import { IUser } from './User';

export interface IUserDailyStats extends Document {
    userId: Types.ObjectId;

    day: String;

    appliedCount: number;

    oaCount: number;
    interviewCount: number;
    offerCount: number;
    rejectionCount: number;

    createdAt: Date;
    updatedAt: Date;
}

const userDailyStatsSchema = new Schema<IUserDailyStats>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        day: {
            type: String,
            required: true,
            trim: true,
        },

        appliedCount: {
            type: Number,
            required: true,
            default: 0,
        },
        interviewCount: {
            type: Number,
            required: true,
            default: 0,
        },
        offerCount: {
            type: Number,
            required: true,
            default: 0,
        },
        rejectionCount: {
            type: Number,
            required: true,
            default: 0,
        },
    }, 
    { timestamps: true }
);

userDailyStatsSchema.index(
    { userId: 1, day: 1 },
    { unique: true });

userDailyStatsSchema.index({ userId: 1, day: -1 });

export const UserDailyStats = mongoose.model<IUserDailyStats>(
    "UserDailyStats",
    userDailyStatsSchema
);