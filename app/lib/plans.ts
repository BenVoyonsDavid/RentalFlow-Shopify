export type PlanCode = "BASIC" | "STARTER" | "BUSINESS" | "PRO";

export type FeatureCode =
  | "WEEKLY_PRICING"
  | "MONTHLY_PRICING"
  | "LONG_TERM_DISCOUNT"
  | "ADVANCED_CALENDAR_VIEWS"
  | "CUSTOMER_DISCOUNT"
  | "DOCUMENTS"
  | "PAYMENTS"
  | "SECURITY_DEPOSIT"
  | "INSPECTIONS"
  | "FULL_HISTORY"
  | "UNLIMITED_ASSETS";

export const PLAN_ORDER: PlanCode[] = ["BASIC", "STARTER", "BUSINESS", "PRO"];

export const ASSET_LIMITS: Record<PlanCode, number | null> = {
  BASIC: 5,
  STARTER: 25,
  BUSINESS: 100,
  PRO: null,
};

const FEATURE_MINIMUM_PLAN: Record<FeatureCode, PlanCode> = {
  WEEKLY_PRICING: "STARTER",
  MONTHLY_PRICING: "BUSINESS",
  LONG_TERM_DISCOUNT: "BUSINESS",
  ADVANCED_CALENDAR_VIEWS: "BUSINESS",
  CUSTOMER_DISCOUNT: "BUSINESS",
  DOCUMENTS: "STARTER",
  PAYMENTS: "STARTER",
  SECURITY_DEPOSIT: "STARTER",
  INSPECTIONS: "BUSINESS",
  FULL_HISTORY: "BUSINESS",
  UNLIMITED_ASSETS: "PRO",
};

export function normalizePlan(value: string | null | undefined): PlanCode {
  const plan = String(value || "BASIC").toUpperCase();
  return PLAN_ORDER.includes(plan as PlanCode) ? (plan as PlanCode) : "BASIC";
}

export function hasFeature(planValue: string | null | undefined, feature: FeatureCode): boolean {
  const plan = normalizePlan(planValue);
  const minimum = FEATURE_MINIMUM_PLAN[feature];
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(minimum);
}

export function assetLimit(planValue: string | null | undefined): number | null {
  return ASSET_LIMITS[normalizePlan(planValue)];
}
