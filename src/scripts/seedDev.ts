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

  // Dashboard stats (updated to reflect more realistic numbers)
  await UserDashboardStats.findOneAndUpdate(
    { userId },
    {
      $set: {
        activeCount: 15,
        countsByStatus: {
          APPLIED: 25,
          OA: 8,
          INTERVIEW: 12,
          OFFER: 2,
          REJECTED: 5,
        },
        lastUpdatedAt: new Date(),
        version: 1,
      },
    },
    { upsert: true, new: true }
  );

  // Daily stats (last 90 days for more historical data)
  const today = new Date();
  const points = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    points.push({
      userId,
      day,
      appliedCount: Math.floor(Math.random() * 5),
      oaCount: Math.floor(Math.random() * 3),
      interviewCount: Math.floor(Math.random() * 2),
      offerCount: i < 7 ? Math.floor(Math.random() * 2) : 0, // Some offers in recent days
      rejectionCount: Math.floor(Math.random() * 3),
    });
  }
  await UserDailyStats.deleteMany({ userId });
  await UserDailyStats.insertMany(points);

  // Scheduled items (some today, some later this month)
  await ScheduledItem.deleteMany({ userId });

  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  const companies = ["Shopify", "Stripe", "Google", "Meta", "Amazon", "Microsoft", "Apple", "Netflix"];
  const roles = ["Software Engineer Intern", "Backend Engineer", "Full Stack Developer", "ML Engineer"];

  const mk = (offsetDays: number, hour: number, type: "OA" | "INTERVIEW", title: string, company?: string) => {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() + offsetDays);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + (type === "INTERVIEW" ? 1 : 2), 0, 0, 0);
    
    const companyIndex = company ? companies.indexOf(company) : Math.floor(Math.random() * companies.length);
    const selectedCompany = company || companies[companyIndex];
    
    return {
      userId,
      applicationId: new mongoose.Types.ObjectId(),
      type,
      title,
      startAt: start,
      endAt: type === "INTERVIEW" ? end : undefined,
      timezone: "America/Toronto",
      links: type === "OA" ? [{ 
        label: "Assessment Link", 
        url: `https://hackerrank.com/assessment-${Math.random().toString(36).substring(7)}` 
      }] : [],
      companyName: selectedCompany,
      roleTitle: roles[Math.floor(Math.random() * roles.length)],
      source: "manual",
      sourceMeta: { threadId: "dev-thread" },
    };
  };

  // More scheduled items: some today, some this week, some next week, some in the past
  await ScheduledItem.insertMany([
    // Today
    mk(0, 10, "OA", "OA: HackerRank Assessment", "Shopify"),
    mk(0, 15, "INTERVIEW", "Interview: Recruiter Screen", "Stripe"),
    mk(0, 16, "INTERVIEW", "Interview: Technical Round", "Google"),
    
    // This week
    mk(1, 11, "OA", "OA: LeetCode Assessment", "Meta"),
    mk(1, 14, "INTERVIEW", "Interview: Behavioral Round", "Amazon"),
    mk(2, 10, "OA", "OA: Take-home Project", "Microsoft"),
    mk(2, 13, "INTERVIEW", "Interview: System Design", "Apple"),
    mk(3, 9, "OA", "OA: CodeSignal Assessment", "Netflix"),
    mk(3, 15, "INTERVIEW", "Interview: Final Round", "Shopify"),
    mk(4, 11, "INTERVIEW", "Interview: Team Fit", "Stripe"),
    
    // Next week
    mk(7, 10, "OA", "OA: HackerRank Assessment", "Google"),
    mk(7, 14, "INTERVIEW", "Interview: Technical Round", "Meta"),
    mk(8, 9, "INTERVIEW", "Interview: Recruiter Screen", "Amazon"),
    mk(9, 11, "OA", "OA: Take-home", "Microsoft"),
    mk(9, 15, "INTERVIEW", "Interview: Final Round", "Apple"),
    mk(10, 10, "INTERVIEW", "Interview: System Design", "Netflix"),
    mk(12, 14, "INTERVIEW", "Interview: Technical Round", "Shopify"),
    mk(14, 9, "OA", "OA: CodeSignal Assessment", "Stripe"),
    
    // Past items (for calendar view)
    mk(-3, 10, "OA", "OA: Completed Assessment", "Google"),
    mk(-5, 14, "INTERVIEW", "Interview: Past Interview", "Meta"),
    mk(-7, 11, "INTERVIEW", "Interview: Past Technical", "Amazon"),
  ]);

  console.log("Seeded dev data for:", email);
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});