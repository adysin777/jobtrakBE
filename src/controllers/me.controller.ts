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

export async function getMe(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const user = await User.findById(new mongoose.Types.ObjectId(userId));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // For now we only expose basic profile and a placeholder for pendingEmail
    return res.json({
      name: user.name,
      email: user.primaryEmail,
      pendingEmail: null,
    });
  } catch (error) {
    console.error("Get me error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function updateMe(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const { name, email } = req.body as { name?: string; email?: string };

    const user = await User.findById(new mongoose.Types.ObjectId(userId));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (typeof name === "string" && name.trim()) {
      user.name = name.trim();
    }

    if (typeof email === "string" && email.trim()) {
      const normalizedEmail = email.toLowerCase().trim();

      // If email is actually changing, validate uniqueness.
      if (normalizedEmail !== user.primaryEmail) {
        const existing = await User.findOne({
          _id: { $ne: user._id },
          primaryEmail: normalizedEmail,
        });
        if (existing) {
          return res.status(400).json({ message: "That email is already in use." });
        }

        // TODO: Implement proper pending-email + verification flow.
        // For now, update primaryEmail directly so the UI behaves sensibly.
        user.primaryEmail = normalizedEmail;
      }
    }

    await user.save();

    return res.json({
      name: user.name,
      email: user.primaryEmail,
      pendingEmail: null,
    });
  } catch (error) {
    console.error("Update me error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
