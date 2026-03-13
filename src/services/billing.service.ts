import { User } from "../models/User";
import { stripe } from "../config/stripe";
import { PLAN_CODES } from "../config/planConfig";
import mongoose from "mongoose";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_MONTHLY_PRICE;
const PRICE_PRO_YEARLY = process.env.STRIPE_PRICE_PRO_YEARLY || process.env.STRIPE_YEARLY_PRICE;

export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  if (!stripe) throw new Error("Stripe is not configured");
  const user = await User.findById(new mongoose.Types.ObjectId(userId));
  if (!user) throw new Error("User not found");
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.primaryEmail,
    metadata: { userId },
  });
  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

export type CheckoutPlan = "pro_monthly" | "pro_yearly";

export async function createCheckoutSession(
  userId: string,
  plan: CheckoutPlan
): Promise<{ url: string }> {
  if (!stripe) throw new Error("Stripe is not configured");
  const priceId = plan === PLAN_CODES.PRO_MONTHLY ? PRICE_PRO_MONTHLY : PRICE_PRO_YEARLY;
  if (!priceId) throw new Error(`Price not configured for plan: ${plan}`);
  const customerId = await getOrCreateStripeCustomer(userId);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${FRONTEND_URL}/settings?tab=subscription&checkout=success`,
    cancel_url: `${FRONTEND_URL}/settings?tab=subscription&checkout=cancel`,
    subscription_data: {
      metadata: { userId },
    },
  });
  if (!session.url) throw new Error("Failed to create checkout session URL");
  return { url: session.url };
}

export async function createPortalSession(userId: string): Promise<{ url: string }> {
  if (!stripe) throw new Error("Stripe is not configured");
  const user = await User.findById(new mongoose.Types.ObjectId(userId));
  if (!user?.stripeCustomerId) throw new Error("No billing customer found. Subscribe first.");
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${FRONTEND_URL}/settings?tab=subscription`,
  });
  return { url: session.url };
}

const PRICE_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_MONTHLY_PRICE;
const PRICE_YEARLY = process.env.STRIPE_PRICE_PRO_YEARLY || process.env.STRIPE_YEARLY_PRICE;

function mapPriceToPlan(priceId?: string | null): "pro_monthly" | "pro_yearly" | null {
  if (!priceId) return null;
  if (PRICE_MONTHLY && priceId === PRICE_MONTHLY) return "pro_monthly";
  if (PRICE_YEARLY && priceId === PRICE_YEARLY) return "pro_yearly";
  return null;
}

/** If user has stripeCustomerId but plan is free (or pro with bad/missing planActiveUntil), fetch active subscription from Stripe and update user. */
export async function syncUserPlanFromStripe(user: InstanceType<typeof User>): Promise<void> {
  if (!user.stripeCustomerId || !stripe) return;
  const isPaid = user.plan === "pro_monthly" || user.plan === "pro_yearly";
  const needsRefresh = !isPaid || !user.planActiveUntil || new Date() >= new Date(user.planActiveUntil);
  if (!needsRefresh) return;
  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "active",
      limit: 1,
    });
    if (subs.data.length === 0) {
      if (isPaid) {
        user.plan = PLAN_CODES.FREE;
        user.planActiveUntil = null;
        user.stripeSubscriptionId = null;
        await user.save();
      }
      return;
    }
    const sub = subs.data[0];
    const priceId = sub.items.data[0]?.price?.id ?? null;
    const mappedPlan = mapPriceToPlan(priceId);
    if (typeof sub.current_period_end !== "number") return;
    const periodEnd = new Date(sub.current_period_end * 1000);
    if (mappedPlan) {
      user.plan = mappedPlan;
      user.planActiveUntil = periodEnd;
      user.stripeSubscriptionId = sub.id;
    } else if (isPaid) {
      user.planActiveUntil = periodEnd;
      user.stripeSubscriptionId = sub.id;
    }
    await user.save();
  } catch (e) {
    console.warn("syncUserPlanFromStripe failed for user", user._id, e);
  }
}

/** If plan is pro_* and planActiveUntil is in the past, set user to free and save. Call after sync when reading plan. */
export async function expireUserPlanIfNeeded(user: InstanceType<typeof User>): Promise<void> {
  if (user.plan !== "pro_monthly" && user.plan !== "pro_yearly") return;
  if (!user.planActiveUntil) return;
  if (new Date() < new Date(user.planActiveUntil)) return;
  user.plan = PLAN_CODES.FREE;
  user.planActiveUntil = null;
  user.stripeSubscriptionId = null;
  await user.save();
}
