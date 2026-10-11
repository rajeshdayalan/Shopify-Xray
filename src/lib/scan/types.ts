export type Severity = "critical" | "high" | "medium" | "low";
export type Urgency = "now" | "week" | "later";
export type Status = "pass" | "warn" | "fail" | "info" | "skipped";
export type Confidence = "high" | "medium" | "low";
export type CategoryId = "storefront" | "performance" | "seo" | "cx" | "intel";

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  storefront: "Storefront & conversion",
  performance: "Performance & technical",
  seo: "SEO & discoverability",
  cx: "Customer experience & support",
  intel: "Ecommerce intelligence",
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  now: "Fix now",
  week: "Fix this week",
  later: "Plan for later",
};

export interface CheckResult {
  id: number;
  key: string;
  title: string;
  category: CategoryId;
  status: Status;
  severity: Severity;
  urgency: Urgency;
  confidence: Confidence;
  impact: number;
  priority: number;
  summary: string;
  evidence: string[];
  recommendations: string[];
}

export type TechType =
  | "theme"
  | "reviews"
  | "helpdesk"
  | "chat"
  | "tracking"
  | "returns"
  | "analytics"
  | "marketing"
  | "subscriptions"
  | "search & merchandising"
  | "payments"
  | "other";

export interface TechDetection {
  name: string;
  type: TechType;
  confidence: Confidence;
  evidence: string;
}

export type WorkflowKey = "wismo" | "returns" | "refunds" | "exchanges" | "product_questions";

export interface OpportunityWorkflow {
  key: WorkflowKey;
  label: string;
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
}

export interface Opportunity {
  score: number;
  level: "high" | "medium" | "low";
  workflows: OpportunityWorkflow[];
  disclaimer: string;
}

export interface ScanMetrics {
  responseTimeMs: number;
  htmlSizeKb: number;
  productsInCatalog: number | null;
  collections: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  performanceScore: number | null;
  totalTransferKb: number | null;
  requests: number | null;
  metricsSource: "pagespeed" | "browser" | "static";
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  storeName: string;
  isShopify: boolean;
  theme: string | null;
  passwordProtected: boolean;
  score: number;
  categoryScores: Record<CategoryId, number>;
  checks: CheckResult[];
  topIssues: CheckResult[];
  metrics: ScanMetrics;
  tech: TechDetection[];
  opportunity: Opportunity;
  sampledPages: string[];
  mobileScreenshot: string | null;
  capabilities: { browser: boolean; pagespeed: boolean };
  durationMs: number;
  scannedAt: string;
}

export type ScanEvent =
  | { type: "progress"; step: string; percent: number }
  | { type: "result"; result: ScanResult }
  | { type: "error"; error: string };
