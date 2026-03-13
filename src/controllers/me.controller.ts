import { Request, Response } from "express";
import { User } from "../models/User";
import { Application } from "../models/Application";
import { getMaxTrackedApplications } from "../config/planConfig";
import { syncUserPlanFromStripe, expireUserPlanIfNeeded } from "../services/billing.service";
import mongoose from "mongoose";

export interface PlanInfo {
  plan: string;
  planActiveUntil: string | null;
  maxTrackedApplications: number;
  trackedApplications: number;
}

export async function getPlan(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    let user = await User.findById(new mongoose.Types.ObjectId(userId));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.stripeCustomerId) {
      await syncUserPlanFromStripe(user);
    }
    await expireUserPlanIfNeeded(user);

    const maxTracked = getMaxTrackedApplications(user.plan, user.planActiveUntil ?? null);
    const trackedCount = await Application.countDocuments({
      userId: user._id,
    });
    const info: PlanInfo = {
      plan: user.plan,
      planActiveUntil: user.planActiveUntil ? user.planActiveUntil.toISOString() : null,
      maxTrackedApplications: maxTracked,
      trackedApplications: trackedCount,
    };
    return res.json(info);
  } catch (error) {
    console.error("Get plan error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
