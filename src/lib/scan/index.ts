import { buildContext } from "./context";
import { accessibilityBasics, brokenLinks, httpsSecurity, imageOptimization, pagePerformance } from "./checks/performance";
import { canonicalIndexing, discoverability, sitemapRobots, structuredData, titlesMeta } from "./checks/seo";
import { addToCart, mobileExperience, pricingClarity, productCompleteness, returnsPolicy, shippingTransparency, trustSocialProof } from "./checks/storefront";
import { contactAccess, orderTracking, questionCoverage, returnsSelfService, selfService } from "./checks/cx";
import { buildOpportunity, catalogQuality, opportunityCheck, techFootprint } from "./checks/intel";
import { makeCheck } from "./checks/helpers";
import { detectTech } from "./tech";
import type { CategoryId, CheckResult, ScanResult } from "./types";

const STATUS_SCORE: Record<string, number | null> = { pass: 100, warn: 55, fail: 10, info: null, skipped: null };
const URGENCY_ORDER = { now: 0, week: 1, later: 2 };

export async function runScan(input: string, progress: (step: string, pct: number) => void = () => {}): Promise<ScanResult> {
  const started = Date.now();
  const ctx = await buildContext(input, progress);
  const tech = detectTech({
    html: [ctx.home.html, ...ctx.products.map((p) => p.doc.html)].join("\n"),
    scriptSrcs: ctx.scriptSrcs,
    requestHosts: ctx.browser.requestHosts,
    theme: ctx.theme,
  });

  const checks: CheckResult[] = [
    mobileExperience(ctx),
    productCompleteness(ctx),
    addToCart(ctx),
    pricingClarity(ctx),
    shippingTransparency(ctx),
    trustSocialProof(ctx, tech),
    returnsPolicy(ctx),
    pagePerformance(ctx),
    imageOptimization(ctx),
    brokenLinks(ctx),
    httpsSecurity(ctx),
    accessibilityBasics(ctx),
    titlesMeta(ctx),
    canonicalIndexing(ctx),
    sitemapRobots(ctx),
    structuredData(ctx),
    discoverability(ctx),
    contactAccess(ctx, tech),
    selfService(ctx, tech),
    orderTracking(ctx, tech),
    returnsSelfService(ctx, tech),
    questionCoverage(ctx),
    techFootprint(ctx, tech),
    catalogQuality(ctx),
  ];
  const opportunity = buildOpportunity(ctx, checks, tech);
  checks.push(opportunityCheck(opportunity));

  if (ctx.passwordProtected) {
    checks.unshift(
      makeCheck(
        { id: 0, key: "password", title: "Store is password protected", category: "storefront", impact: 10 },
        {
          status: "fail",
          severity: "critical",
          summary: "Visitors and search engines see a password page, so most checks reflect the password page only.",
          evidence: [`Redirected to ${ctx.finalUrl.pathname}`],
          recommendations: ["Online Store → Preferences → remove password protection (requires a paid plan)."],
        }
      )
    );
  }

  const categoryScores = {} as Record<CategoryId, number>;
  for (const cat of ["storefront", "performance", "seo", "cx", "intel"] as CategoryId[]) {
    const scored = checks.filter((c) => c.category === cat && STATUS_SCORE[c.status] !== null);
    const w = scored.reduce((s, c) => s + c.impact, 0);
    categoryScores[cat] = w ? Math.round(scored.reduce((s, c) => s + STATUS_SCORE[c.status]! * c.impact, 0) / w) : 0;
  }
  const scoredAll = checks.filter((c) => STATUS_SCORE[c.status] !== null);
  const totalW = scoredAll.reduce((s, c) => s + c.impact, 0);
  const score = totalW ? Math.round(scoredAll.reduce((s, c) => s + STATUS_SCORE[c.status]! * c.impact, 0) / totalW) : 0;

  const issues = checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || b.priority - a.priority);

  const psiM = ctx.psi.mobile;
  const bm = ctx.browser.mobile;
  progress("Done", 100);
  return {
    url: ctx.inputUrl,
    finalUrl: ctx.finalUrl.toString(),
    storeName: ctx.storeName,
    isShopify: ctx.isShopify,
    theme: ctx.theme,
    passwordProtected: ctx.passwordProtected,
    score,
    categoryScores,
    checks,
    topIssues: [...issues].sort((a, b) => b.priority - a.priority).slice(0, 3),
    metrics: {
      responseTimeMs: ctx.homeElapsedMs,
      htmlSizeKb: Math.round(ctx.home.html.length / 1024),
      productsInCatalog: ctx.catalog?.length ?? null,
      collections: ctx.collectionCount,
      lcpMs: psiM?.field?.lcpMs ?? psiM?.lab.lcpMs ?? bm?.lcpMs ?? null,
      cls: psiM?.field?.cls ?? psiM?.lab.cls ?? bm?.cls ?? null,
      inpMs: psiM?.field?.inpMs ?? null,
      performanceScore: psiM?.performanceScore ?? null,
      totalTransferKb: bm?.transferKb ?? null,
      requests: bm?.requests ?? null,
      metricsSource: psiM ? "pagespeed" : bm?.ok ? "browser" : "static",
    },
    tech,
    opportunity,
    sampledPages: [ctx.home.url, ...ctx.products.map((p) => p.doc.url), ...ctx.collectionDocs.map((d) => d.url)],
    mobileScreenshot: bm?.screenshot ?? null,
    capabilities: { browser: ctx.browser.available, pagespeed: !!psiM },
    durationMs: Date.now() - started,
    scannedAt: new Date().toISOString(),
  };
}
