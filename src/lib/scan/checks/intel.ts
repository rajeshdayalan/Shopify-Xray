import type { ScanContext } from "../context";
import type { CheckResult, Opportunity, OpportunityWorkflow, TechDetection } from "../types";
import { makeCheck, pct, stripHtml } from "./helpers";

const C = "intel" as const;

export function techFootprint(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 23, key: "tech", title: "Visible app and technology footprint", category: C, impact: 4 };
  const thirdPartyHosts = new Set(
    [...ctx.scriptSrcs, ...ctx.browser.requestHosts.map((h) => `https://${h}/`)]
      .map((s) => {
        try {
          return new URL(s).hostname;
        } catch {
          return "";
        }
      })
      .filter((h) => h && h !== ctx.finalUrl.hostname && !/shopify(cdn|svc)?\.com$|shopifycloud\.com$/.test(h))
  );
  const byType = new Map<string, string[]>();
  for (const t of tech) byType.set(t.type, [...(byType.get(t.type) || []), `${t.name}${t.confidence === "high" ? "" : ` (${t.confidence})`}`]);
  const evidence = [
    ...Array.from(byType.entries()).map(([type, names]) => `${type}: ${names.join(", ")}`),
    `${thirdPartyHosts.size} third-party domains loaded`,
  ];
  if (!tech.length) evidence.unshift("No known apps identified");
  const heavy = thirdPartyHosts.size > 25;
  return makeCheck(def, {
    status: heavy ? "warn" : "info",
    severity: heavy ? "medium" : "low",
    confidence: "medium",
    summary: `${tech.length} technologies identified${heavy ? "; a heavy third-party footprint is likely slowing the store" : ""}. Detections are based on public scripts and may be incomplete.`,
    evidence,
    recommendations: heavy ? ["Audit apps and tags; remove duplicates (e.g. multiple analytics or review tools)."] : [],
  });
}

export function catalogQuality(ctx: ScanContext): CheckResult {
  const def = { id: 24, key: "catalog", title: "Catalog quality and product-data consistency", category: C, impact: 6 };
  const cat = ctx.catalog;
  if (!cat?.length) {
    return makeCheck(def, { status: "skipped", severity: "low", confidence: "low", summary: "The public catalog (/products.json) isn't available, so catalog quality can't be sampled.", evidence: [] });
  }
  const n = cat.length;
  const noDesc = cat.filter((p) => stripHtml(p.body_html).length < 50);
  const noImg = cat.filter((p) => !p.images?.length);
  const oneImg = cat.filter((p) => p.images?.length === 1);
  const noType = cat.filter((p) => !p.product_type);
  const noTags = cat.filter((p) => !(Array.isArray(p.tags) ? p.tags.length : p.tags));
  const noSku = cat.filter((p) => p.variants.some((v) => !v.sku));
  const titles = new Map<string, number>();
  cat.forEach((p) => titles.set(p.title.toLowerCase(), (titles.get(p.title.toLowerCase()) || 0) + 1));
  const dupes = Array.from(titles.values()).filter((c) => c > 1).length;
  const badVariantNames = cat.filter((p) => p.variants.length > 1 && p.options.some((o) => /^(title|option\d?)$/i.test(o.name)));
  const evidence = [
    `${n}${n === 250 ? "+ (first 250 sampled)" : ""} products analysed`,
    `Missing/very short description: ${noDesc.length} (${pct(noDesc.length, n)}%)${noDesc[0] ? `, e.g. "${noDesc[0].title}"` : ""}`,
    `No images: ${noImg.length} · only one image: ${oneImg.length} (${pct(oneImg.length, n)}%)`,
    `No product type: ${noType.length} (${pct(noType.length, n)}%) · no tags: ${noTags.length} (${pct(noTags.length, n)}%)`,
    `Variants without SKU: ${noSku.length} products (${pct(noSku.length, n)}%)`,
    `Duplicate titles: ${dupes} · generic variant option names: ${badVariantNames.length}`,
  ];
  const score = pct(noDesc.length + noImg.length * 2 + oneImg.length * 0.5 + noType.length * 0.5 + noSku.length * 0.3 + badVariantNames.length, n);
  return makeCheck(def, {
    status: noImg.length || score > 60 ? "fail" : score > 20 ? "warn" : "pass",
    severity: noImg.length ? "high" : score > 60 ? "medium" : "low",
    summary: score > 20 || noImg.length ? "Product data has gaps that hurt SEO, filtering and AI/assistant answers." : "Catalog data is consistent and well structured.",
    evidence,
    recommendations: [
      ...(noDesc.length ? ["Fill in descriptions for products with little or no copy."] : []),
      ...(noImg.length || oneImg.length ? ["Add multiple images to every product."] : []),
      ...(noType.length || noTags.length ? ["Set product type and tags consistently (powers filters, search and recommendations)."] : []),
      ...(noSku.length ? ["Add SKUs to all variants (needed for inventory, fulfilment and support lookups)."] : []),
    ],
  });
}

export function buildOpportunity(ctx: ScanContext, checks: CheckResult[], tech: TechDetection[]): Opportunity {
  const st = (key: string) => checks.find((c) => c.key === key)?.status;
  const bad = (key: string) => st(key) === "fail" || st(key) === "warn";
  const helpdesk = tech.filter((t) => t.type === "helpdesk" || t.type === "chat");
  const trackingApp = tech.some((t) => t.type === "tracking");
  const returnsApp = tech.some((t) => t.type === "returns");
  const catalogSize = ctx.catalog?.length ?? 0;
  const sizeOptions = (ctx.catalog || []).filter((p) => p.options?.some((o) => /size/i.test(o.name))).length;
  const apparel = pct(sizeOptions, catalogSize || 1) > 30;
  const clamp = (n: number) => Math.max(5, Math.min(100, Math.round(n)));
  const level = (s: number): "high" | "medium" | "low" => (s >= 70 ? "high" : s >= 45 ? "medium" : "low");

  const wf = (key: OpportunityWorkflow["key"], label: string, base: number, factors: [boolean, number, string][]): OpportunityWorkflow => {
    let score = base;
    const reasons: string[] = [];
    for (const [cond, delta, reason] of factors) {
      if (cond) {
        score += delta;
        reasons.push(reason);
      }
    }
    const s = clamp(score);
    return { key, label, score: s, level: level(s), reasons };
  };

  const workflows: OpportunityWorkflow[] = [
    wf("wismo", "WISMO (Where is my order?)", 45, [
      [!trackingApp && bad("tracking"), 25, "No visible order-tracking page or app"],
      [bad("shipping"), 10, "Delivery times aren't clear before purchase"],
      [bad("self-service"), 10, "Limited self-service resources"],
      [catalogSize >= 100, 5, "Large catalog suggests meaningful order volume"],
      [trackingApp, -15, "Tracking app present — opportunity shifts to proactive updates"],
    ]),
    wf("returns", "Returns", 40, [
      [!returnsApp, 20, "No self-service returns portal detected"],
      [apparel, 15, `${pct(sizeOptions, catalogSize || 1)}% of products have size options (higher return rates)`],
      [bad("returns-policy"), 10, "Return policy is missing details or hard to find"],
      [returnsApp, -15, "Returns portal already in place"],
    ]),
    wf("refunds", "Refunds", 35, [
      [bad("returns-self-service"), 15, "Refund steps/timing aren't self-explanatory"],
      [bad("returns-policy"), 10, "Refund policy unclear"],
      [!returnsApp, 10, "Refund requests likely arrive by email"],
    ]),
    wf("exchanges", "Exchanges", 30, [
      [apparel, 25, "Size/variant-heavy catalog drives exchanges"],
      [!/exchange/i.test(ctx.policies.refund?.text || ""), 15, "Exchange process not explained in policy"],
      [!returnsApp, 10, "No exchange portal detected"],
    ]),
    wf("product_questions", "Product questions", 40, [
      [bad("question-coverage"), 20, "Common pre-purchase questions aren't answered on-page"],
      [catalogSize >= 100, 10, "Large catalog — many products to answer questions about"],
      [bad("catalog"), 10, "Product data gaps (descriptions/metadata)"],
      [!helpdesk.length, 10, "No live chat or helpdesk widget visible"],
    ]),
  ];
  if (helpdesk.length) {
    for (const w of workflows) w.reasons.push(`Can plug into existing ${helpdesk.map((h) => h.name).join(", ")}`);
  }
  const score = Math.round(workflows.reduce((s, w) => s + w.score, 0) / workflows.length);
  return {
    score,
    level: level(score),
    workflows: workflows.sort((a, b) => b.score - a.score),
    disclaimer:
      "This is an estimate of automation opportunity based on publicly visible signals — not a measurement of actual support volume or achievable automation.",
  };
}

export function opportunityCheck(opp: Opportunity): CheckResult {
  const def = { id: 25, key: "ai-opportunity", title: "AI automation opportunity score", category: C, impact: 5 };
  return makeCheck(def, {
    status: "info",
    severity: "low",
    confidence: "low",
    summary: `Estimated AI automation opportunity: ${opp.score}/100 (${opp.level}). Top workflow: ${opp.workflows[0].label}.`,
    evidence: opp.workflows.map((w) => `${w.label}: ${w.score}/100 — ${w.reasons.slice(0, 2).join("; ") || "baseline"}`),
    recommendations: [opp.disclaimer],
  });
}
