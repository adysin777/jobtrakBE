import type { Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../config/stripe";
import { User } from "../models/User";
import { PLAN_CODES } from "../config/planConfig";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PRICE_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_MONTHLY_PRICE;
const PRICE_YEARLY = process.env.STRIPE_PRICE_PRO_YEARLY || process.env.STRIPE_YEARLY_PRICE;

function mapPriceToPlan(priceId?: string | null): "pro_monthly" | "pro_yearly" | null {
  if (!priceId) return null;
  if (PRICE_MONTHLY && priceId === PRICE_MONTHLY) return "pro_monthly";
  if (PRICE_YEARLY && priceId === PRICE_YEARLY) return "pro_yearly";
  return null;
}

export async function stripeWebhook(req: Request, res: Response) {
  if (!stripe || !WEBHOOK_SECRET) {
    console.error("Stripe webhook misconfigured: missing client or secret.");
    return res.status(500).send("Stripe not configured");
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    return res.status(400).send("Missing stripe-signature header");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(400).send(`Webhook Error: ${message}`);
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const user = await User.findOne({ stripeCustomerId: customerId });
        if (!user) {
          console.warn("Stripe webhook: no user for customer", customerId);
          break;
        }

        let sub = subscription;
        let periodEnd: Date | null =
          typeof subscription.current_period_end === "number"
            ? new Date(subscription.current_period_end * 1000)
            : null;
        if ((subscription.status === "active" || subscription.status === "trialing") && !periodEnd) {
          try {
            const full = await stripe.subscriptions.retrieve(subscription.id);
            if (typeof full.current_period_end === "number") {
              periodEnd = new Date(full.current_period_end * 1000);
              sub = full;
            }
          } catch (e) {
            console.warn("Stripe webhook: could not retrieve subscription", subscription.id, e);
          }
        }

        const priceId = sub.items.data[0]?.price?.id ?? null;
        const mappedPlan = mapPriceToPlan(priceId);
        const status = sub.status;

        if (status === "active" || status === "trialing") {
          if (mappedPlan) {
            user.plan = mappedPlan;
          } else if (user.plan === "free" || user.plan === "premium") {
            user.plan = PLAN_CODES.PRO_MONTHLY;
          }
          user.planActiveUntil = periodEnd;
          user.stripeSubscriptionId = sub.id;
        } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired" || status === "past_due") {
          user.plan = PLAN_CODES.FREE;
          user.planActiveUntil = null;
          user.stripeSubscriptionId = sub.id;
        }

        await user.save();
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string | null;
        const metadataUserId = (session.metadata?.userId as string | undefined) ?? undefined;

        if (customerId && metadataUserId) {
          const user = await User.findById(metadataUserId);
          if (user && !user.stripeCustomerId) {
            user.stripeCustomerId = customerId;
            await user.save();
          }
        }
        break;
      }

      default:
        // Ignore other events for now.
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
}

