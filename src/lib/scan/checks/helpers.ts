import type { ScanContext } from "../context";
import type { CategoryId, CheckResult, Confidence, Severity, Status, Urgency } from "../types";

export interface CheckDef {
  id: number;
  key: string;
  title: string;
  category: CategoryId;
  impact: number;
}

export interface Draft {
  status: Status;
  severity: Severity;
  summary: string;
  evidence?: string[];
  recommendations?: string[];
  confidence?: Confidence;
  urgency?: Urgency;
  impact?: number;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_FACTOR: Record<Status, number> = { fail: 1, warn: 0.6, pass: 0, info: 0, skipped: 0 };
const CONFIDENCE_FACTOR: Record<Confidence, number> = { high: 1, medium: 0.85, low: 0.7 };

function deriveUrgency(status: Status, severity: Severity): Urgency {
  if (status === "fail") return severity === "critical" || severity === "high" ? "now" : severity === "medium" ? "week" : "later";
  if (status === "warn") return severity === "critical" ? "now" : severity === "high" ? "week" : "later";
  return "later";
}

export function makeCheck(def: CheckDef, d: Draft): CheckResult {
  const impact = d.impact ?? def.impact;
  const confidence = d.confidence ?? "high";
  const priority = Math.round(SEVERITY_WEIGHT[d.severity] * impact * STATUS_FACTOR[d.status] * CONFIDENCE_FACTOR[confidence] * 10) / 10;
  return {
    id: def.id,
    key: def.key,
    title: def.title,
    category: def.category,
    status: d.status,
    severity: d.severity,
    urgency: d.urgency ?? deriveUrgency(d.status, d.severity),
    confidence,
    impact,
    priority,
    summary: d.summary,
    evidence: (d.evidence ?? []).filter(Boolean),
    recommendations: d.recommendations ?? [],
  };
}

export const has = (text: string, re: RegExp) => re.test(text);
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const stripHtml = (html: string | null | undefined) =>
  (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    return (x.pathname + x.search).slice(0, 80) || "/";
  } catch {
    return u.slice(0, 80);
  }
};

export const hasSearch = (ctx: ScanContext) =>
  ctx.home.$("form[action*='/search'], a[href*='/search'], input[type=search], [aria-label*='search' i], predictive-search, details-modal.header__search").length > 0;

export const hasAccountLink = (ctx: ScanContext) =>
  ctx.home.$("a[href]").filter((_, el) => /\/account(\/|$|\?)|\/customer_authentication|shopify\.com\/\d+\/account/i.test(ctx.home.$(el).attr("href") || "")).length > 0;
