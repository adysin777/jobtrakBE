import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.warn("STRIPE_SECRET_KEY is not set; billing endpoints will fail.");
}

export const stripe = secret
  ? new Stripe(secret)
  : (null as unknown as Stripe);
