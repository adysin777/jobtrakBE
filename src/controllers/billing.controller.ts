import { Request, Response } from "express";
import {
  createCheckoutSession,
  createPortalSession,
  type CheckoutPlan,
} from "../services/billing.service";

export async function createCheckout(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const plan = req.body?.plan as CheckoutPlan | undefined;
    if (!plan || (plan !== "pro_monthly" && plan !== "pro_yearly")) {
      return res.status(400).json({ error: "Invalid plan. Use pro_monthly or pro_yearly." });
    }
    const { url } = await createCheckoutSession(userId, plan);
    return res.json({ url });
  } catch (error) {
    console.error("Create checkout error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function createPortal(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const { url } = await createPortalSession(userId);
    return res.json({ url });
  } catch (error) {
    console.error("Create portal error:", error);
    if (String(error).includes("No billing customer")) {
      return res.status(400).json({ error: "No subscription found. Subscribe first." });
    }
    return res.status(500).json({ error: String(error) });
  }
}
