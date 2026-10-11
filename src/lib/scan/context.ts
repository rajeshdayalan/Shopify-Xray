import tls from "node:tls";
import * as cheerio from "cheerio";
import { mapLimit, normalizeUrl, safeFetch, tryFetch, type FetchResult } from "../safeFetch";
import { runBrowserProbes, type BrowserReport } from "./browser";
import { runPageSpeed, type PsiResult } from "./psi";

export interface ShopifyVariant {
  title: string;
  price: string;
  compare_at_price: string | null;
  available?: boolean;
  sku?: string | null;
  option1?: string | null;
}

export interface ShopifyProduct {
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[] | string;
  variants: ShopifyVariant[];
  images: { src: string }[];
  options: { name: string; values: string[] }[];
}

export interface Doc {
  url: string;
  status: number;
  html: string;
  $: cheerio.CheerioAPI;
  text: string;
  headers?: Headers;
}

export interface ScanContext {
  inputUrl: string;
  finalUrl: URL;
  origin: string;
  home: Doc;
  homeElapsedMs: number;
  isShopify: boolean;
  passwordProtected: boolean;
  theme: string | null;
  storeName: string;
  scriptSrcs: string[];
  internalLinks: string[];
  robots: FetchResult | null;
  sitemap: FetchResult | null;
  policies: Record<"privacy" | "refund" | "terms" | "shipping", Doc | null>;
  policyStatus: Record<"privacy" | "refund" | "terms" | "shipping", number | null>;
  catalog: ShopifyProduct[] | null;
  collectionCount: number | null;
  products: { doc: Doc; data: ShopifyProduct | null }[];
  collectionDocs: Doc[];
  support: { contact: Doc | null; faq: Doc | null; tracking: Doc | null; returns: Doc | null };
  linkCheck: { checked: number; broken: { url: string; status: number | null }[] };
  security: { httpRedirectsToHttps: boolean | null; hsts: boolean; certDaysLeft: number | null; certError: string | null };
  browser: BrowserReport;
  psi: { mobile: PsiResult | null; desktop: PsiResult | null };
}

function toDoc(res: FetchResult): Doc {
  const $ = cheerio.load(res.body);
  const $t = cheerio.load(res.body);
  $t("script, style, noscript, svg").remove();
  return {
    url: res.finalUrl,
    status: res.status,
    html: res.body,
    $,
    text: $t("body").text().replace(/\s+/g, " ").trim(),
    headers: res.headers,
  };
}

const fetchStatus = new Map<string, number | null>();

async function fetchDoc(url: string): Promise<Doc | null> {
  const res = await tryFetch(url);
  fetchStatus.set(url, res ? res.status : null);
  if (!res || res.status >= 400) return null;
  return toDoc(res);
}

export function isUnverifiable(status: number | null | undefined) {
  return status === null || status === undefined || status === 429 || status >= 500;
}

function certInfo(host: string): Promise<{ daysLeft: number | null; error: string | null }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const err = socket.authorizationError ? String(socket.authorizationError) : null;
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ daysLeft: null, error: err });
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
      resolve({ daysLeft: days, error: authorized ? null : err });
    });
    socket.on("error", (e) => resolve({ daysLeft: null, error: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ daysLeft: null, error: "timeout" });
    });
  });
}

const findLink = (links: { href: string; text: string }[], re: RegExp) =>
  links.find((l) => re.test(l.href) || re.test(l.text));

export async function buildContext(input: string, progress: (step: string, pct: number) => void): Promise<ScanContext> {
  const url = normalizeUrl(input);
  progress("Fetching storefront", 5);
  const homeRes = await safeFetch(url);
  if (homeRes.status >= 400) throw new Error(`Store responded with HTTP ${homeRes.status}`);
  const home = toDoc(homeRes);
  const finalUrl = new URL(homeRes.finalUrl);
  const origin = finalUrl.origin;
  const $ = home.$;
  const headers = homeRes.headers;

  const psiPromise = runPageSpeed(finalUrl.toString());

  const isShopify =
    /cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.theme|myshopify\.com|shopify-section/i.test(home.html) ||
    !!headers.get("x-shopid") ||
    !!headers.get("x-shopify-stage") ||
    (headers.get("powered-by") || "").toLowerCase().includes("shopify");
  const passwordProtected = finalUrl.pathname.startsWith("/password") || $("body").hasClass("template-password");

  let theme: string | null = null;
  const themeMatch = home.html.match(/Shopify\.theme\s*=\s*(\{[\s\S]*?\});/);
  if (themeMatch) {
    const name = themeMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
    const schema = themeMatch[1].match(/"schema_name"\s*:\s*"([^"]+)"/);
    theme = name ? name[1] + (schema && schema[1] !== name[1] ? ` (${schema[1]})` : "") : schema ? schema[1] : null;
  }
  const storeName =
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    $("title").first().text().trim().split(/[|–-]/)[0]?.trim() ||
    finalUrl.hostname;

  const scriptSrcs = $("script[src]")
    .map((_, el) => $(el).attr("src") || "")
    .get()
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s, origin).toString();
      } catch {
        return s;
      }
    });

  const links = $("a[href]")
    .map((_, el) => ({ href: $(el).attr("href") || "", text: $(el).text().trim().toLowerCase() }))
    .get()
    .map((l) => {
      try {
        return { href: new URL(l.href, origin).toString(), text: l.text };
      } catch {
        return null;
      }
    })
    .filter((l): l is { href: string; text: string } => !!l && /^https?:/.test(l.href));
  const internal = links.filter((l) => new URL(l.href).hostname === finalUrl.hostname);
  const internalLinks = Array.from(new Set(internal.map((l) => l.href.split("#")[0])));

  progress("Reading catalog, policies and support pages", 15);
  const pol = (p: string) => fetchDoc(`${origin}/policies/${p}`);
  const [robots, sitemap, productsRes, collectionsRes, privacy, refund, terms, shipping] = await Promise.all([
    tryFetch(`${origin}/robots.txt`, { accept: "text/plain,*/*" }),
    tryFetch(`${origin}/sitemap.xml`, { accept: "application/xml,*/*" }),
    tryFetch(`${origin}/products.json?limit=250`, { accept: "application/json", maxBytes: 6_000_000 }),
    tryFetch(`${origin}/collections.json?limit=250`, { accept: "application/json" }),
    pol("privacy-policy"),
    pol("refund-policy"),
    pol("terms-of-service"),
    pol("shipping-policy"),
  ]);

  let catalog: ShopifyProduct[] | null = null;
  try {
    if (productsRes && productsRes.status < 400) catalog = JSON.parse(productsRes.body).products ?? null;
  } catch {
    catalog = null;
  }
  let collectionCount: number | null = null;
  let collectionHandles: string[] = [];
  try {
    if (collectionsRes && collectionsRes.status < 400) {
      const cols = JSON.parse(collectionsRes.body).collections ?? [];
      collectionCount = cols.length;
      collectionHandles = cols.map((c: { handle: string }) => c.handle);
    }
  } catch {
    collectionCount = null;
  }

  const productUrls: { url: string; data: ShopifyProduct | null }[] = [];
  if (catalog?.length) {
    const sellable = (p: ShopifyProduct) =>
      p.images?.length > 0 && p.variants?.some((v) => v.available !== false && Number(v.price) > 0);
    const avail = catalog.filter(sellable);
    for (const p of (avail.length ? avail : catalog).slice(0, 6)) {
      productUrls.push({ url: `${origin}/products/${p.handle}`, data: p });
    }
  } else {
    for (const l of internal.filter((l) => /\/products\/[^/?#]+/.test(l.href)).slice(0, 6)) {
      productUrls.push({ url: l.href.split("?")[0], data: null });
    }
  }
  const collectionUrls = (
    collectionHandles.length
      ? collectionHandles.filter((h) => h !== "frontpage").slice(0, 2).map((h) => `${origin}/collections/${h}`)
      : internal.filter((l) => /\/collections\/[^/?#]+$/.test(l.href.split("?")[0])).slice(0, 2).map((l) => l.href)
  ).filter((v, i, a) => a.indexOf(v) === i);

  const contactLink = findLink(internal, /\/pages\/contact|contact/i)?.href || `${origin}/pages/contact`;
  const faqLink = findLink(links, /faq|frequently|help ?cent(er|re)|\/help\b|support/i)?.href;
  const trackLink = findLink(links, /track|order[-_ ]status|where.*order/i)?.href;
  const returnsLink = findLink(links, /returns?[-_ ]?(portal|center|centre)?|exchange|loopreturns|returnprime|returngo/i)?.href;

  const safeExternal = (u?: string) => (u && /^https?:/.test(u) ? u : null);
  const [productDocs, collectionDocs, contact, faq, tracking, returns] = await Promise.all([
    mapLimit(productUrls, 4, async (p) => ({ doc: await fetchDoc(p.url), data: p.data })),
    mapLimit(collectionUrls, 2, fetchDoc),
    fetchDoc(contactLink),
    safeExternal(faqLink) ? fetchDoc(faqLink!) : fetchDoc(`${origin}/pages/faq`),
    safeExternal(trackLink) ? fetchDoc(trackLink!) : fetchDoc(`${origin}/apps/track`),
    safeExternal(returnsLink) && !/\/policies\/refund/.test(returnsLink!) ? fetchDoc(returnsLink!) : Promise.resolve(null),
  ]);
  const rank = (d: Doc) =>
    (d.$("form[action*='/cart/add']").length ? 2 : 0) + (/noindex/i.test(d.$('meta[name="robots"]').attr("content") || "") ? 0 : 1);
  const products = productDocs
    .filter((p): p is { doc: Doc; data: ShopifyProduct | null } => !!p.doc)
    .map((p, i) => ({ p, i, r: rank(p.doc) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.p);

  progress("Running mobile & desktop browser tests", 35);
  const browserPromise = runBrowserProbes(finalUrl.toString(), products[0]?.doc.url || productUrls[0]?.url || null);

  progress("Checking links, assets and HTTPS", 45);
  const toCheck = Array.from(
    new Set([
      ...internalLinks.filter((l) => !/\/(cart|account|search|checkout)/.test(l)).slice(0, 35),
      ...$("img[src]")
        .map((_, el) => $(el).attr("src") || "")
        .get()
        .filter((s) => s && !s.startsWith("data:"))
        .slice(0, 10)
        .map((s) => {
          try {
            return new URL(s, origin).toString();
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ])
  );
  const httpUrl = new URL(finalUrl.toString());
  httpUrl.protocol = "http:";
  const [linkResults, httpRes, cert] = await Promise.all([
    mapLimit(toCheck, 4, async (u) => {
      const r = await tryFetch(u, { maxBytes: 20_000, timeoutMs: 10000 });
      return { url: u, status: r ? r.status : null };
    }),
    finalUrl.protocol === "https:"
      ? (async () => {
          try {
            const r = await fetch(httpUrl, { redirect: "manual", signal: AbortSignal.timeout(8000) });
            return r.status >= 300 && r.status < 400 && (r.headers.get("location") || "").startsWith("https:");
          } catch {
            return null;
          }
        })()
      : Promise.resolve(false),
    finalUrl.protocol === "https:" ? certInfo(finalUrl.hostname) : Promise.resolve({ daysLeft: null, error: "Not served over HTTPS" }),
  ]);
  const broken = linkResults.filter((r) => r.status === null || r.status >= 400);

  progress("Waiting for browser and performance measurements", 60);
  const [browser, psi] = await Promise.all([browserPromise, psiPromise]);
  progress("Scoring 25 checks", 90);

  return {
    inputUrl: url.toString(),
    finalUrl,
    origin,
    home,
    homeElapsedMs: homeRes.elapsedMs,
    isShopify,
    passwordProtected,
    theme,
    storeName,
    scriptSrcs,
    internalLinks,
    robots,
    sitemap,
    policies: { privacy, refund, terms, shipping },
    policyStatus: {
      privacy: fetchStatus.get(`${origin}/policies/privacy-policy`) ?? null,
      refund: fetchStatus.get(`${origin}/policies/refund-policy`) ?? null,
      terms: fetchStatus.get(`${origin}/policies/terms-of-service`) ?? null,
      shipping: fetchStatus.get(`${origin}/policies/shipping-policy`) ?? null,
    },
    catalog,
    collectionCount,
    products,
    collectionDocs: collectionDocs.filter((d): d is Doc => !!d),
    support: { contact, faq, tracking, returns },
    linkCheck: { checked: toCheck.length, broken },
    security: {
      httpRedirectsToHttps: httpRes,
      hsts: !!headers.get("strict-transport-security"),
      certDaysLeft: cert.daysLeft,
      certError: cert.error,
    },
    browser,
    psi,
  };
}
