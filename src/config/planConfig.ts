/**
 * Plan codes used in the app and in Stripe metadata.
 * Keep limits here; later these can come from env or a feature-flag service.
 */
export const PLAN_CODES = {
  FREE: "free",
  PRO_MONTHLY: "pro_monthly",
  PRO_YEARLY: "pro_yearly",
} as const;

export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES];

export const PLAN_LIMITS: Record<PlanCode, { maxTrackedApplications: number }> = {
  [PLAN_CODES.FREE]: { maxTrackedApplications: 5 },
  [PLAN_CODES.PRO_MONTHLY]: { maxTrackedApplications: Number.POSITIVE_INFINITY },
  [PLAN_CODES.PRO_YEARLY]: { maxTrackedApplications: Number.POSITIVE_INFINITY },
};

/** Returns max tracked applications for a user, considering plan and planActiveUntil. */
export function getMaxTrackedApplications(plan: string, planActiveUntil: Date | null): number {
  if (plan === PLAN_CODES.PRO_MONTHLY || plan === PLAN_CODES.PRO_YEARLY) {
    if (planActiveUntil && new Date() < planActiveUntil) return Number.POSITIVE_INFINITY;
    if (!planActiveUntil) return Number.POSITIVE_INFINITY; // paid plan but no end date yet – give benefit of the doubt
    return 5; // expired subscription (planActiveUntil in the past)
  }
  return PLAN_LIMITS[PLAN_CODES.FREE].maxTrackedApplications;
}

export function isPaidPlan(plan: string): boolean {
  return plan === PLAN_CODES.PRO_MONTHLY || plan === PLAN_CODES.PRO_YEARLY;
}
