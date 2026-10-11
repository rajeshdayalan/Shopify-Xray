export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "SEO" | "Performance" | "Accessibility" | "Trust & Conversion" | "Shopify";

export interface Issue {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  impact: number;
  description: string;
  fix: string[];
  evidence?: string;
  priority: number;
}

export interface PassedCheck {
  id: string;
  title: string;
  category: Category;
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  isShopify: boolean;
  storeName?: string;
  theme?: string;
  passwordProtected: boolean;
  score: number;
  categoryScores: Record<Category, number>;
  stats: {
    responseTimeMs: number;
    htmlSizeKb: number;
    scripts: number;
    thirdPartyScripts: number;
    stylesheets: number;
    images: number;
  };
  issues: Issue[];
  topIssues: Issue[];
  passed: PassedCheck[];
  scannedAt: string;
}
