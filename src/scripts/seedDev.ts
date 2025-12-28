import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database";
import { User } from "../models/User";
import { UserDashboardStats } from "../models/UserDashboardStats";
import { UserDailyStats } from "../models/UserDailyStats";
import { ScheduledItem } from "../models/ScheduledItem";

async function main() {
  await connectDatabase();

  const email = process.env.SEED_EMAIL || "test@uwaterloo.ca";

  // Ensure user exists
  const user = await User.findOneAndUpdate(
    { primaryEmail: email }, // change field if yours is different
    { $setOnInsert: { primaryEmail: email, name: "Dev User" } },
    { upsert: true, new: true }
  );

  const userId = user._id;

  // Dashboard stats
  await UserDashboardStats.findOneAndUpdate(
    { userId },
    {
      $set: {
        activeCount: 7,
        countsByStatus: {
          APPLIED: 5,
          OA: 1,
          INTERVIEW: 1,
          OFFER: 0,
          REJECTED: 2,
        },
        lastUpdatedAt: new Date(),
        version: 1,
      },
    },
    { upsert: true, new: true }
  );

  // Daily stats (last 14 days)
  const today = new Date();
  const points = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    points.push({
      userId,
      day,
      appliedCount: Math.floor(Math.random() * 4),
    });
  }
  await UserDailyStats.deleteMany({ userId });
  await UserDailyStats.insertMany(points);

  // Scheduled items (some today, some later this month)
  await ScheduledItem.deleteMany({ userId });

  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  const mk = (offsetDays: number, hour: number, type: "OA" | "INTERVIEW", title: string) => {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() + offsetDays);
    start.setHours(hour, 0, 0, 0);
    return {
      userId,
      applicationId: new mongoose.Types.ObjectId(),
      type,
      title,
      startAt: start,
      timezone: "America/Toronto",
      links: [],
      companyName: offsetDays % 2 === 0 ? "Shopify" : "Stripe",
      roleTitle: "Software Engineer Intern",
      source: "manual",
      sourceMeta: { threadId: "dev-thread" },
    };
  };

  await ScheduledItem.insertMany([
    mk(0, 10, "OA", "OA: HackerRank Assessment"),
    mk(0, 15, "INTERVIEW", "Interview: Recruiter Screen"),
    mk(2, 11, "OA", "OA: Take-home"),
    mk(5, 14, "INTERVIEW", "Interview: Technical Round"),
    mk(9, 9, "INTERVIEW", "Interview: Final Round"),
  ]);

  console.log("Seeded dev data for:", email);
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});