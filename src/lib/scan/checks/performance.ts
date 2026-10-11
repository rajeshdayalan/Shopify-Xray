import type { ScanContext } from "../context";
import type { CheckResult } from "../types";
import { makeCheck, shortUrl } from "./helpers";

const C = "performance" as const;

export function pagePerformance(ctx: ScanContext): CheckResult {
  const def = { id: 8, key: "performance", title: "Page loading performance", category: C, impact: 9 };
  const psiM = ctx.psi.mobile;
  const psiD = ctx.psi.desktop;
  const bm = ctx.browser.mobile;
  const bd = ctx.browser.desktop;
  const evidence: string[] = [];
  let lcp: number | null = null;
  let cls: number | null = null;
  let inp: number | null = null;
  let source = "static";
  if (psiM) {
    source = "Lighthouse (PageSpeed Insights)";
    lcp = psiM.field?.lcpMs ?? psiM.lab.lcpMs;
    cls = psiM.field?.cls ?? psiM.lab.cls;
    inp = psiM.field?.inpMs ?? null;
    evidence.push(`Lighthouse mobile performance score: ${psiM.performanceScore ?? "n/a"}${psiD ? ` · desktop: ${psiD.performanceScore ?? "n/a"}` : ""}`);
    evidence.push(`Lab (mobile): LCP ${fmtMs(psiM.lab.lcpMs)}, CLS ${psiM.lab.cls ?? "n/a"}, TBT ${fmtMs(psiM.lab.tbtMs)}`);
    if (psiM.field) evidence.push(`Real users (CrUX): LCP ${fmtMs(psiM.field.lcpMs)}, CLS ${psiM.field.cls ?? "n/a"}, INP ${fmtMs(psiM.field.inpMs)}`);
    else evidence.push("No real-user (CrUX) field data available for this store — INP not measurable");
  } else if (bm?.ok) {
    source = "headless Chrome lab test";
    lcp = bm.lcpMs;
    cls = bm.cls;
    evidence.push(`Mobile (lab, unthrottled): LCP ${fmtMs(bm.lcpMs)}, CLS ${bm.cls ?? "n/a"}, TTFB ${fmtMs(bm.ttfbMs)}, ${bm.requests} requests, ${bm.transferKb} KB transferred`);
    if (bd?.ok) evidence.push(`Desktop (lab): LCP ${fmtMs(bd.lcpMs)}, CLS ${bd.cls ?? "n/a"}, load ${fmtMs(bd.loadMs)}`);
    evidence.push("INP needs real-user data — add a PageSpeed API key to include it");
  } else {
    evidence.push(`Server response ${ctx.homeElapsedMs} ms, HTML ${Math.round(ctx.home.html.length / 1024)} KB`);
  }
  evidence.unshift(`Source: ${source}`);

  const problems: string[] = [];
  let poor = 0;
  if (lcp !== null) {
    if (lcp > 4000) {
      poor++;
      problems.push(`LCP ${fmtMs(lcp)} is poor (>4s)`);
    } else if (lcp > 2500) problems.push(`LCP ${fmtMs(lcp)} needs improvement (>2.5s)`);
  }
  if (cls !== null) {
    if (cls > 0.25) {
      poor++;
      problems.push(`CLS ${cls} is poor (>0.25)`);
    } else if (cls > 0.1) problems.push(`CLS ${cls} needs improvement (>0.1)`);
  }
  if (inp !== null) {
    if (inp > 500) {
      poor++;
      problems.push(`INP ${fmtMs(inp)} is poor (>500ms)`);
    } else if (inp > 200) problems.push(`INP ${fmtMs(inp)} needs improvement (>200ms)`);
  }
  if (psiM?.performanceScore != null && psiM.performanceScore < 50) {
    poor++;
    problems.push(`Lighthouse mobile score ${psiM.performanceScore}/100`);
  }
  if (source === "static" && ctx.homeElapsedMs > 2000) problems.push("Slow server response");
  evidence.push(...problems);
  const status = poor ? "fail" : problems.length ? "warn" : "pass";
  return makeCheck(def, {
    status,
    severity: poor ? "high" : "medium",
    confidence: psiM ? "high" : bm?.ok ? "medium" : "low",
    summary:
      status === "pass"
        ? "Core Web Vitals look healthy."
        : status === "fail"
          ? "The store loads slowly on mobile — this directly costs conversions and SEO."
          : "Performance is acceptable but has room for improvement.",
    evidence,
    recommendations:
      status === "pass"
        ? []
        : [
            "Remove unused apps and leftover app code from theme.liquid.",
            "Preload the hero image and serve it at the displayed size; avoid hero sliders.",
            "Defer non-critical third-party scripts (chat, reviews, pixels) until interaction.",
            "Reserve space for images/embeds (width/height) to avoid layout shift.",
          ],
  });
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function imageOptimization(ctx: ScanContext): CheckResult {
  const def = { id: 9, key: "images", title: "Image optimization", category: C, impact: 6 };
  const $ = ctx.home.$;
  const imgs = $("img");
  const noDims = imgs.filter((_, el) => !$(el).attr("width") || !$(el).attr("height")).length;
  const notLazy = imgs.slice(3).filter((_, el) => $(el).attr("loading") !== "lazy" && !/lazy/i.test($(el).attr("class") || "") && !$(el).attr("data-src")).length;
  const noSrcset = imgs.filter((_, el) => !$(el).attr("srcset") && !$(el).attr("data-srcset")).length;
  const m = ctx.browser.mobile;
  const evidence = [`${imgs.length} images on home page`];
  let issues = 0;
  if (m?.ok) {
    evidence.push(`Total image weight on mobile: ${m.images.totalImageKb} KB`);
    if (m.images.oversized.length) {
      issues++;
      evidence.push(`${m.images.oversized.length} oversized images, e.g. ${m.images.oversized.slice(0, 2).map((o) => `${shortUrl(o.src)} (${o.natural} shown at ${o.rendered})`).join("; ")}`);
    }
    if (m.images.legacyFormatHeavy.length) {
      issues++;
      evidence.push(`${m.images.legacyFormatHeavy.length} heavy JPEG/PNG images (no WebP/AVIF), e.g. ${m.images.legacyFormatHeavy.slice(0, 2).map((i) => `${shortUrl(i.src)} ${i.kb} KB`).join("; ")}`);
    }
    if (m.images.totalImageKb > 2500) issues++;
  }
  if (noDims > 3) {
    issues++;
    evidence.push(`${noDims} images without width/height (cause layout shift)`);
  }
  if (notLazy > 5) {
    issues++;
    evidence.push(`${notLazy} below-the-fold images not lazy-loaded`);
  }
  if (noSrcset > 5) evidence.push(`${noSrcset} images without responsive srcset`);
  return makeCheck(def, {
    status: issues >= 3 ? "fail" : issues ? "warn" : "pass",
    severity: issues >= 3 ? "medium" : "low",
    confidence: m?.ok ? "high" : "medium",
    summary: issues ? "Images could be lighter and better sized." : "Images are well optimized.",
    evidence,
    recommendations: issues
      ? [
          "Use `image_url` with an explicit width and the `image_tag` filter (adds srcset, width/height).",
          "Add `loading: 'lazy'` to below-the-fold images; keep the hero eager.",
          "Upload images at ≤2048px wide; Shopify's CDN serves WebP/AVIF automatically when using image_url.",
        ]
      : [],
  });
}

export function brokenLinks(ctx: ScanContext): CheckResult {
  const def = { id: 10, key: "broken", title: "Broken links and assets", category: C, impact: 6 };
  const rateLimited = ctx.linkCheck.broken.filter((b) => b.status === 429);
  const broken = ctx.linkCheck.broken.filter((b) => b.status !== 429);
  const failed = [...(ctx.browser.mobile?.failedRequests ?? []), ...(ctx.browser.desktop?.failedRequests ?? [])];
  const uniqFailed = Array.from(new Map(failed.map((f) => [f.url, f])).values());
  const firstPartyFailed = uniqFailed.filter((f) => {
    try {
      return new URL(f.url).hostname === ctx.finalUrl.hostname || /cdn\.shopify\.com/.test(f.url);
    } catch {
      return false;
    }
  });
  const brokenImgs = ctx.browser.mobile?.images.broken ?? [];
  const important = broken.filter((b) => /\/(products|collections|policies|pages)\//.test(b.url));
  const evidence = [
    `${ctx.linkCheck.checked} internal links/assets checked, ${broken.length} broken`,
    ...broken.slice(0, 5).map((b) => `${b.status ?? "no response"} — ${shortUrl(b.url)}`),
  ];
  if (rateLimited.length) evidence.push(`${rateLimited.length} links were rate-limited (HTTP 429) and not counted`);
  if (uniqFailed.length) {
    evidence.push(`${uniqFailed.length} failed network requests in the browser (${firstPartyFailed.length} first-party)`);
    evidence.push(...uniqFailed.slice(0, 4).map((f) => `${f.status ?? f.reason} ${f.resourceType}: ${f.url.slice(0, 90)}`));
  }
  if (brokenImgs.length) evidence.push(`${brokenImgs.length} images failed to load`);
  const total = broken.length + firstPartyFailed.length + brokenImgs.length;
  return makeCheck(def, {
    status: important.length || total > 3 ? "fail" : total || uniqFailed.length > 3 ? "warn" : "pass",
    severity: important.length ? "high" : "medium",
    summary: total ? "Some links or assets are broken." : "No broken links or assets found in the sample.",
    evidence,
    recommendations: total
      ? [
          "Fix or remove broken links in navigation menus (Online Store → Navigation).",
          "Create URL redirects for deleted products/pages (Online Store → Navigation → URL Redirects).",
          "Remove script tags left by uninstalled apps.",
        ]
      : [],
  });
}

export function httpsSecurity(ctx: ScanContext): CheckResult {
  const def = { id: 11, key: "https", title: "HTTPS and basic security signals", category: C, impact: 8 };
  const s = ctx.security;
  const https = ctx.finalUrl.protocol === "https:";
  const mixed = Array.from(new Set([...(ctx.browser.mobile?.mixedContent ?? []), ...(ctx.browser.desktop?.mixedContent ?? [])]));
  const staticMixed = ctx.home.$("script[src^='http:'], link[href^='http:'][rel=stylesheet], iframe[src^='http:']").length;
  const insecureForms = ctx.home.$("form[action^='http:']").length;
  const evidence = [
    `HTTPS: ${https ? "yes" : "no"}`,
    `Certificate: ${s.certError ? `problem — ${s.certError}` : s.certDaysLeft !== null ? `valid, expires in ${s.certDaysLeft} days` : "unknown"}`,
    `HTTP → HTTPS redirect: ${s.httpRedirectsToHttps === null ? "unknown" : s.httpRedirectsToHttps ? "yes" : "no"}`,
    `HSTS header: ${s.hsts ? "yes" : "no"}`,
    `Mixed content requests: ${mixed.length + staticMixed}`,
    ...mixed.slice(0, 3).map((u) => `Insecure: ${u.slice(0, 90)}`),
  ];
  if (insecureForms) evidence.push(`${insecureForms} forms submit over HTTP`);
  const fail = !https || !!s.certError || insecureForms > 0 || staticMixed > 0;
  const warn = mixed.length > 0 || s.httpRedirectsToHttps === false || (s.certDaysLeft !== null && s.certDaysLeft < 14) || !s.hsts;
  return makeCheck(def, {
    status: fail ? "fail" : warn ? "warn" : "pass",
    severity: fail ? "critical" : "low",
    summary: fail ? "Basic HTTPS security problems were found." : warn ? "HTTPS works; minor hardening signals are missing." : "HTTPS, certificate and redirects look good. (Basic public check, not a security audit.)",
    evidence,
    recommendations: [
      ...(!https || s.certError ? ["Settings → Domains: fix DNS so Shopify can issue an SSL certificate."] : []),
      ...(mixed.length || staticMixed ? ["Change any http:// asset URLs in theme code and settings to https://."] : []),
    ],
  });
}

export function accessibilityBasics(ctx: ScanContext): CheckResult {
  const def = { id: 12, key: "a11y", title: "Accessibility basics", category: C, impact: 6 };
  const $ = ctx.home.$;
  const evidence: string[] = [];
  let serious = 0;
  let minor = 0;
  const axe = ctx.browser.mobile?.axe;
  if (axe) {
    if (!axe.length) evidence.push("axe-core: no violations for tested rules");
    for (const v of axe) {
      const isSerious = v.impact === "critical" || v.impact === "serious";
      if (isSerious) serious++;
      else minor++;
      evidence.push(`axe ${v.id} (${v.impact}): ${v.help} — ${v.nodes} element${v.nodes === 1 ? "" : "s"}`);
    }
  } else {
    const noAlt = $("img:not([alt])").length;
    const unlabeled = $("input:not([type=hidden]):not([type=submit])").filter((_, el) => {
      const id = $(el).attr("id");
      return !$(el).attr("aria-label") && !$(el).attr("aria-labelledby") && !(id && $(`label[for="${id}"]`).length) && !$(el).closest("label").length;
    }).length;
    if (noAlt) minor++;
    if (unlabeled) serious++;
    evidence.push(`Static: ${noAlt} images without alt, ${unlabeled} unlabeled inputs, lang="${$("html").attr("lang") || "missing"}"`);
  }
  const headings = $("h1,h2,h3,h4,h5,h6").map((_, el) => Number(el.tagName.slice(1))).get();
  let skips = 0;
  for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i - 1] > 1) skips++;
  evidence.push(`Headings: ${headings.filter((h) => h === 1).length} H1, ${skips} skipped levels`);
  const kb = ctx.browser.desktop?.keyboard;
  if (kb) {
    evidence.push(`Keyboard: ${kb.distinct} distinct elements reached in 15 Tab presses, ${kb.withFocusIndicator} with visible focus style`);
    if (kb.distinct < 3) {
      minor++;
      evidence.push("Focus barely moved — a popup/modal may be trapping keyboard focus");
    } else if (kb.withFocusIndicator < kb.tabStops / 2) minor++;
  }
  return makeCheck(def, {
    status: serious >= 2 ? "fail" : serious || minor > 2 ? "warn" : "pass",
    severity: serious ? "medium" : "low",
    confidence: axe ? "high" : "medium",
    summary:
      serious >= 2
        ? "Some shoppers using screen readers or keyboards will struggle to use the store."
        : serious || minor > 2
          ? "Several accessibility issues found."
          : minor
            ? "Accessibility basics are mostly fine; a few minor issues found."
            : "Accessibility basics look good for the tested rules.",
    evidence,
    recommendations: [
      ...(axe?.some((v) => v.id === "color-contrast") ? ["Increase text/background contrast to at least 4.5:1 (theme colors)."] : []),
      ...(axe?.some((v) => ["button-name", "link-name"].includes(v.id)) ? ["Give icon buttons/links accessible names (aria-label), e.g. cart, search, social icons."] : []),
      ...(axe?.some((v) => ["label", "select-name"].includes(v.id)) ? ["Add labels to form fields (newsletter, search, variant selects)."] : []),
      ...(axe?.some((v) => v.id === "image-alt") ? ["Add alt text to product and banner images."] : []),
      ...(kb && kb.withFocusIndicator < kb.tabStops / 2 ? ["Don't remove focus outlines; add a visible :focus-visible style."] : []),
    ],
  });
}
