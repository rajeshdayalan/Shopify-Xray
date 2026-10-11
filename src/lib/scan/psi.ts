export interface PsiResult {
  strategy: "mobile" | "desktop";
  performanceScore: number | null;
  lab: { lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null };
  field: { lcpMs: number | null; cls: number | null; inpMs: number | null; category: string | null } | null;
}

type Audit = { numericValue?: number };
interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, Audit>;
  };
  loadingExperience?: {
    overall_category?: string;
    metrics?: Record<string, { percentile?: number }>;
  };
}

async function runOne(url: string, strategy: "mobile" | "desktop", key?: string): Promise<PsiResult | null> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) params.set("key", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PsiResponse;
    const audits = data.lighthouseResult?.audits || {};
    const num = (k: string) => (typeof audits[k]?.numericValue === "number" ? Math.round(audits[k].numericValue!) : null);
    const m = data.loadingExperience?.metrics;
    const field = m
      ? {
          lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
          cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
          inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
          category: data.loadingExperience?.overall_category ?? null,
        }
      : null;
    const clsAudit = audits["cumulative-layout-shift"]?.numericValue;
    return {
      strategy,
      performanceScore:
        typeof data.lighthouseResult?.categories?.performance?.score === "number"
          ? Math.round(data.lighthouseResult.categories.performance.score * 100)
          : null,
      lab: {
        lcpMs: num("largest-contentful-paint"),
        cls: typeof clsAudit === "number" ? Math.round(clsAudit * 1000) / 1000 : null,
        tbtMs: num("total-blocking-time"),
        fcpMs: num("first-contentful-paint"),
      },
      field,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runPageSpeed(url: string): Promise<{ mobile: PsiResult | null; desktop: PsiResult | null }> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key && process.env.PAGESPEED_WITHOUT_KEY !== "1") return { mobile: null, desktop: null };
  const [mobile, desktop] = await Promise.all([runOne(url, "mobile", key), runOne(url, "desktop", key)]);
  return { mobile, desktop };
}
