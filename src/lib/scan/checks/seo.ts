import type { Doc, ScanContext } from "../context";
import type { CheckResult } from "../types";
import { hasSearch, makeCheck, shortUrl, stripHtml } from "./helpers";

const C = "seo" as const;

function sampled(ctx: ScanContext): { label: string; doc: Doc }[] {
  return [
    { label: "Home", doc: ctx.home },
    ...ctx.products.map((p) => ({ label: "Product", doc: p.doc })),
    ...ctx.collectionDocs.map((d) => ({ label: "Collection", doc: d })),
  ];
}

export function titlesMeta(ctx: ScanContext): CheckResult {
  const def = { id: 13, key: "titles", title: "Title tags and meta descriptions", category: C, impact: 7 };
  const pages = sampled(ctx);
  const titles = new Map<string, number>();
  const descs = new Map<string, number>();
  const evidence: string[] = [];
  let missing = 0;
  let length = 0;
  for (const { label, doc } of pages) {
    const t = doc.$("title").first().text().trim();
    const d = doc.$('meta[name="description"]').attr("content")?.trim() || "";
    if (t) titles.set(t, (titles.get(t) || 0) + 1);
    if (d) descs.set(d, (descs.get(d) || 0) + 1);
    const issues: string[] = [];
    if (!t) issues.push("missing title");
    else if (t.length > 65) issues.push(`title ${t.length} chars`);
    else if (t.length < 15) issues.push(`title only ${t.length} chars`);
    if (!d) issues.push("missing meta description");
    else if (d.length > 165) issues.push(`description ${d.length} chars`);
    else if (d.length < 50) issues.push(`description only ${d.length} chars`);
    if (!t || !d) missing++;
    else if (issues.length) length++;
    evidence.push(`${label} ${shortUrl(doc.url)}: ${issues.length ? issues.join(", ") : "OK"}`);
  }
  const dupT = Array.from(titles.values()).filter((n) => n > 1).length;
  const dupD = Array.from(descs.values()).filter((n) => n > 1).length;
  if (dupT) evidence.push(`${dupT} duplicated titles across sampled pages`);
  if (dupD) evidence.push(`${dupD} duplicated meta descriptions across sampled pages`);
  return makeCheck(def, {
    status: missing ? "fail" : length || dupT || dupD ? "warn" : "pass",
    severity: missing ? "high" : "medium",
    summary: missing ? "Some pages are missing titles or meta descriptions." : length || dupT || dupD ? "Titles/descriptions exist but some are too long, short or duplicated." : `Titles and meta descriptions look good on ${pages.length} sampled pages.`,
    evidence,
    recommendations: [
      "Homepage: Online Store → Preferences. Products/collections: 'Search engine listing' section at the bottom of each item.",
      "Keep titles ≤ 60 characters and descriptions 120–160 characters, unique per page.",
    ],
  });
}

export function canonicalIndexing(ctx: ScanContext): CheckResult {
  const def = { id: 14, key: "canonical", title: "Canonical URLs and indexing signals", category: C, impact: 7 };
  const evidence: string[] = [];
  let noindex = 0;
  let missingCanon = 0;
  let crossHost = 0;
  for (const { label, doc } of sampled(ctx)) {
    const canon = doc.$('link[rel="canonical"]').attr("href");
    const robots = (doc.$('meta[name="robots"]').attr("content") || "") + " " + (doc.headers?.get("x-robots-tag") || "");
    const notes: string[] = [];
    if (/noindex/i.test(robots)) {
      noindex++;
      notes.push("noindex");
    }
    if (!canon) {
      missingCanon++;
      notes.push("no canonical");
    } else {
      try {
        const c = new URL(canon, doc.url);
        if (c.hostname !== ctx.finalUrl.hostname) {
          crossHost++;
          notes.push(`canonical points to ${c.hostname}`);
        } else if (c.pathname !== new URL(doc.url).pathname) notes.push(`canonical → ${c.pathname}`);
      } catch {
        notes.push("invalid canonical");
      }
    }
    evidence.push(`${label} ${shortUrl(doc.url)}: ${notes.length ? notes.join(", ") : "self-canonical, indexable"}`);
  }
  const robotsTxt = ctx.robots?.status && ctx.robots.status < 400 ? ctx.robots.body : "";
  const disallowAll = robotsBlocksAll(robotsTxt);
  if (disallowAll) evidence.push("robots.txt appears to block all crawlers (Disallow: /)");
  return makeCheck(def, {
    status: noindex || disallowAll ? "fail" : missingCanon || crossHost ? "warn" : "pass",
    severity: noindex || disallowAll ? "critical" : "medium",
    confidence: crossHost && !noindex ? "medium" : "high",
    summary: noindex || disallowAll ? "Important pages are blocked from search engines." : missingCanon || crossHost ? "Canonical signals need a look (may be intentional)." : "Pages are indexable with consistent canonical URLs.",
    evidence,
    recommendations: [
      ...(noindex ? ["Remove noindex tags from theme.liquid / SEO apps for pages you want in Google."] : []),
      ...(disallowAll ? ["Fix robots.txt.liquid so it doesn't disallow the whole site."] : []),
      ...(missingCanon ? ['Add `<link rel="canonical" href="{{ canonical_url }}">` to theme.liquid.'] : []),
      ...(crossHost ? ["Make sure canonicals use your primary domain (Settings → Domains → set primary)."] : []),
    ],
  });
}

function robotsBlocksAll(txt: string): boolean {
  let agents: string[] = [];
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(val);
    } else if (key === "disallow" || key === "allow") {
      inRules = true;
      if (key === "disallow" && val === "/" && agents.includes("*")) return true;
    }
  }
  return false;
}

export function sitemapRobots(ctx: ScanContext): CheckResult {
  const def = { id: 15, key: "sitemap", title: "Sitemap and robots.txt", category: C, impact: 6 };
  const r = ctx.robots;
  const s = ctx.sitemap;
  const robotsOk = !!r && r.status < 400 && /user-agent/i.test(r.body);
  const robotsSitemap = robotsOk && /sitemap:/i.test(r!.body);
  const sitemapOk = !!s && s.status < 400 && /<(urlset|sitemapindex)/i.test(s.body);
  const childCount = sitemapOk ? (s!.body.match(/<loc>/gi) || []).length : 0;
  const productsSitemap = sitemapOk && /sitemap_products/i.test(s!.body);
  const evidence = [
    `robots.txt: ${robotsOk ? "valid" : r ? `HTTP ${r.status}, ${/user-agent/i.test(r.body) ? "" : "no User-agent rules"}` : "unreachable"}`,
    `robots.txt references sitemap: ${robotsSitemap ? "yes" : "no"}`,
    `sitemap.xml: ${sitemapOk ? `valid XML with ${childCount} entries` : s ? `HTTP ${s.status}, not valid sitemap XML` : "unreachable"}`,
    `Product sitemap present: ${productsSitemap ? "yes" : "no"}`,
  ];
  return makeCheck(def, {
    status: !sitemapOk || !robotsOk ? "fail" : !robotsSitemap ? "warn" : "pass",
    severity: !sitemapOk ? "high" : "medium",
    summary: sitemapOk && robotsOk ? "Sitemap and robots.txt are accessible and valid." : "Search engines can't read your sitemap or robots.txt correctly.",
    evidence,
    recommendations: sitemapOk && robotsOk ? ["Submit /sitemap.xml in Google Search Console."] : ["Ensure the store isn't password protected and robots.txt.liquid has no errors, then submit /sitemap.xml in Google Search Console."],
  });
}

interface LdNode {
  "@type"?: string | string[];
  [k: string]: unknown;
}

function collectLd(doc: Doc): { nodes: LdNode[]; invalid: number } {
  const nodes: LdNode[] = [];
  let invalid = 0;
  doc.$('script[type="application/ld+json"]').each((_, el) => {
    const raw = doc.$(el).html() || "";
    try {
      const parsed = JSON.parse(raw);
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          const o = n as LdNode;
          if (o["@type"]) nodes.push(o);
          if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(walk);
        }
      };
      walk(parsed);
    } catch {
      invalid++;
    }
  });
  return { nodes, invalid };
}

const typeIs = (n: LdNode, t: string) => (Array.isArray(n["@type"]) ? n["@type"].includes(t) : n["@type"] === t);

export function structuredData(ctx: ScanContext): CheckResult {
  const def = { id: 16, key: "schema", title: "Structured data", category: C, impact: 6 };
  const evidence: string[] = [];
  let invalidTotal = 0;
  const home = collectLd(ctx.home);
  invalidTotal += home.invalid;
  const hasOrg = home.nodes.some((n) => typeIs(n, "Organization") || typeIs(n, "OnlineStore") || typeIs(n, "WebSite"));
  evidence.push(`Home: ${home.nodes.map((n) => n["@type"]).join(", ") || "no JSON-LD"}`);
  let productIssues = 0;
  let productsWithSchema = 0;
  for (const { doc } of ctx.products) {
    const ld = collectLd(doc);
    invalidTotal += ld.invalid;
    const product = ld.nodes.find((n) => typeIs(n, "Product") || typeIs(n, "ProductGroup"));
    const microdata = doc.$('[itemtype*="schema.org/Product"]').length > 0;
    if (!product) {
      productIssues++;
      evidence.push(`${shortUrl(doc.url)}: no Product JSON-LD${microdata ? " (microdata present)" : ""}`);
      if (microdata) productsWithSchema++;
      continue;
    }
    productsWithSchema++;
    const offersRaw = product.offers ?? (product.hasVariant as LdNode[] | undefined)?.[0]?.offers;
    const offers = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as LdNode | undefined;
    const missing = [
      !product.name && "name",
      !product.image && "image",
      !offers && "offers",
      offers && !offers.price && !offers.lowPrice && "offers.price",
      offers && !offers.priceCurrency && "offers.priceCurrency",
      offers && !offers.availability && "offers.availability",
    ].filter(Boolean);
    const rating = product.aggregateRating as LdNode | undefined;
    const ratingIssue = rating && (!rating.ratingValue || !(rating.reviewCount || rating.ratingCount));
    if (missing.length || ratingIssue) productIssues++;
    evidence.push(
      `${shortUrl(doc.url)}: Product${missing.length ? ` missing ${missing.join(", ")}` : " complete"}${rating ? (ratingIssue ? ", aggregateRating incomplete" : ", has aggregateRating") : ""}`
    );
  }
  const crumbs = [...ctx.products.map((p) => p.doc), ...ctx.collectionDocs].some((d) => collectLd(d).nodes.some((n) => typeIs(n, "BreadcrumbList")));
  evidence.push(`BreadcrumbList: ${crumbs ? "present" : "not found"}`);
  if (invalidTotal) evidence.push(`${invalidTotal} JSON-LD blocks contain invalid JSON`);
  const noProductSchema = ctx.products.length > 0 && productsWithSchema === 0;
  return makeCheck(def, {
    status: invalidTotal || noProductSchema ? "fail" : productIssues || !hasOrg ? "warn" : crumbs ? "pass" : "warn",
    severity: noProductSchema || invalidTotal ? "medium" : "low",
    summary: noProductSchema ? "Product pages have no structured data, so they can't get rich results (price, stock, stars) in Google." : invalidTotal ? "Some structured data is invalid JSON." : productIssues || !hasOrg || !crumbs ? "Structured data is present but incomplete." : "Product, Organization and Breadcrumb markup look complete.",
    evidence,
    recommendations: [
      ...(noProductSchema || productIssues ? ["Output `{{ product | structured_data }}` in a JSON-LD script on the product template (Online Store 2.0 themes do this by default)."] : []),
      ...(!hasOrg ? ["Add Organization JSON-LD (name, logo, sameAs social links) to theme.liquid."] : []),
      ...(!crumbs ? ["Add BreadcrumbList JSON-LD on product and collection pages."] : []),
      ...(invalidTotal ? ["Fix invalid JSON-LD (validate with Google's Rich Results Test)."] : []),
    ],
  });
}

export function discoverability(ctx: ScanContext): CheckResult {
  const def = { id: 17, key: "discoverability", title: "Product and collection discoverability", category: C, impact: 6 };
  const productLinks = new Set(ctx.internalLinks.filter((l) => /\/products\/[^/?#]+/.test(l)).map((l) => l.split("?")[0]));
  const collectionLinks = new Set(ctx.internalLinks.filter((l) => /\/collections\/[^/?#]+/.test(l) && !/\/products\//.test(l)).map((l) => l.split("?")[0]));
  const search = hasSearch(ctx);
  const avgDesc = ctx.catalog?.length ? Math.round(ctx.catalog.reduce((s, p) => s + stripHtml(p.body_html).length, 0) / ctx.catalog.length) : null;
  const evidence = [
    `Catalog: ${ctx.catalog ? `${ctx.catalog.length}${ctx.catalog.length === 250 ? "+" : ""} public products` : "products.json not available"}, ${ctx.collectionCount ?? "?"} collections`,
    `Home page links to ${productLinks.size} products and ${collectionLinks.size} collections`,
    `Search: ${search ? "available" : "not found"}`,
    `Average product description: ${avgDesc ?? "?"} characters`,
  ];
  let warns = 0;
  if (collectionLinks.size < 2) warns++;
  if (productLinks.size < 4) warns++;
  if (!search) warns++;
  if (avgDesc !== null && avgDesc < 200) warns++;
  return makeCheck(def, {
    status: warns >= 3 ? "fail" : warns ? "warn" : "pass",
    severity: warns >= 3 ? "medium" : "low",
    summary: warns ? "Products and collections could be easier to find for shoppers and crawlers." : "Products and collections are well linked and searchable.",
    evidence,
    recommendations: [
      ...(collectionLinks.size < 2 ? ["Link your main collections from the header menu and home page."] : []),
      ...(productLinks.size < 4 ? ["Feature best-sellers on the home page (Featured collection section)."] : []),
      ...(!search ? ["Add a visible search icon/bar in the header."] : []),
      ...(avgDesc !== null && avgDesc < 200 ? ["Write longer, descriptive product content with the terms shoppers search for."] : []),
    ],
  });
}
