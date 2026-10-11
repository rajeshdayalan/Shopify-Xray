import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { isPublicHost } from "../safeFetch";

let browserPromise: Promise<Browser> | null = null;
let axeSource: string | null = null;

function getAxeSource(): string {
  if (!axeSource) {
    const candidates = [
      path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
      path.join(__dirname, "..", "node_modules", "axe-core", "axe.min.js"),
    ];
    const file = candidates.find((f) => existsSync(f));
    if (!file) throw new Error("axe-core not found");
    axeSource = readFileSync(file, "utf8");
  }
  return axeSource;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

let active = 0;
const queue: (() => void)[] = [];
const MAX_CONCURRENT = Number(process.env.MAX_BROWSER_SCANS || 2);

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release() {
  active--;
  queue.shift()?.();
}

const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const DESKTOP = {
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 1,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

const PERF_INIT = `
window.__xray = { lcp: 0, cls: 0 };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__xray.lcp = e.startTime; })
    .observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__xray.cls += e.value; })
    .observe({ type: 'layout-shift', buffered: true });
} catch (e) {}
`;

export interface NetworkIssue {
  url: string;
  status: number | null;
  resourceType: string;
  reason?: string;
}

export interface PageProbe {
  url: string;
  ok: boolean;
  error?: string;
  lcpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  loadMs: number | null;
  transferKb: number | null;
  requests: number;
  failedRequests: NetworkIssue[];
  mixedContent: string[];
  consoleErrors: number;
  images: {
    total: number;
    broken: string[];
    oversized: { src: string; natural: string; rendered: string }[];
    legacyFormatHeavy: { src: string; kb: number; type: string }[];
    totalImageKb: number;
  };
}

export interface MobileProbe extends PageProbe {
  overflowPx: number;
  tinyTextRatio: number;
  tinyTextSamples: string[];
  smallTapTargets: number;
  smallTapSamples: string[];
  overlappingTapTargets: number;
  mobileNavFound: boolean;
  screenshot: string | null;
  axe: { id: string; impact: string | null; help: string; nodes: number; sample: string }[] | null;
}

export interface DesktopProbe extends PageProbe {
  keyboard: { tabStops: number; distinct: number; withFocusIndicator: number; samples: string[] } | null;
}

export interface ProductProbe {
  url: string;
  ok: boolean;
  error?: string;
  titleVisible: boolean;
  priceVisible: boolean;
  priceText: string | null;
  imagesVisible: number;
  variantSelectors: number;
  atcFound: boolean;
  atcVisible: boolean;
  atcEnabled: boolean;
  atcText: string | null;
  addedToCart: boolean | null;
  cartBefore: number | null;
  cartAfter: number | null;
  cartRequestOk: boolean;
  pageTitle: string | null;
  gated: boolean;
}

export interface BrowserReport {
  available: boolean;
  error?: string;
  mobile: MobileProbe | null;
  desktop: DesktopProbe | null;
  product: ProductProbe | null;
  requestHosts: string[];
}

async function guardContext(context: BrowserContext, hosts: Set<string>) {
  await context.route("**/*", async (route) => {
    try {
      const u = new URL(route.request().url());
      if (!["http:", "https:"].includes(u.protocol)) return route.continue();
      if (await isPublicHost(u.hostname)) {
        hosts.add(u.hostname);
        return route.continue();
      }
      return route.abort("blockedbyclient");
    } catch {
      return route.abort();
    }
  });
}

function attachNetworkWatch(page: Page, pageUrl: string) {
  const failed: NetworkIssue[] = [];
  const mixed: string[] = [];
  const imageTypes = new Map<string, string>();
  let consoleErrors = 0;
  let requests = 0;
  const https = pageUrl.startsWith("https:");
  page.on("request", (req) => {
    requests++;
    if (https && req.url().startsWith("http://")) mixed.push(req.url());
  });
  page.on("requestfailed", (req) => {
    const reason = req.failure()?.errorText || "failed";
    if (/blockedbyclient|ERR_ABORTED/i.test(reason)) return;
    failed.push({ url: req.url(), status: null, resourceType: req.resourceType(), reason });
  });
  page.on("response", (res) => {
    const type = res.request().resourceType();
    if (res.status() >= 400 && ["document", "script", "stylesheet", "image", "font"].includes(type)) {
      failed.push({ url: res.url(), status: res.status(), resourceType: type });
    }
    if (type === "image") imageTypes.set(res.url(), res.headers()["content-type"] || "");
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors++;
  });
  return { failed, mixed, imageTypes, get consoleErrors() { return consoleErrors; }, get requests() { return requests; } };
}

async function settle(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 35000 }).catch(async (err) => {
    if (!/Timeout/i.test(String(err))) throw err;
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3)).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function collectBase(page: Page, url: string, watch: ReturnType<typeof attachNetworkWatch>): Promise<PageProbe> {
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const transfer = resources.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) + (nav?.transferSize || 0);
    const imgRes = resources.filter((r) => r.initiatorType === "img" || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(r.name));
    const imgSizes: Record<string, number> = {};
    for (const r of imgRes) imgSizes[r.name] = r.encodedBodySize || r.transferSize || 0;
    const dpr = window.devicePixelRatio || 1;
    const imgs = Array.from(document.images);
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src) && !(i.currentSrc || i.src).startsWith("data:")).map((i) => i.currentSrc || i.src);
    const oversized = imgs
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 20 && i.naturalWidth > 800 && i.naturalWidth > r.width * dpr * 1.8;
      })
      .map((i) => {
        const r = i.getBoundingClientRect();
        return { src: i.currentSrc || i.src, natural: `${i.naturalWidth}×${i.naturalHeight}`, rendered: `${Math.round(r.width)}×${Math.round(r.height)}` };
      });
    const x = (window as unknown as { __xray?: { lcp: number; cls: number } }).__xray;
    return {
      lcp: x && x.lcp ? Math.round(x.lcp) : null,
      cls: x ? Math.round(x.cls * 1000) / 1000 : null,
      ttfb: nav ? Math.round(nav.responseStart) : null,
      load: nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      transferKb: Math.round(transfer / 1024),
      imgSizes,
      totalImages: imgs.length,
      broken: broken.slice(0, 10),
      oversized: oversized.slice(0, 10),
      oversizedCount: oversized.length,
    };
  });
  const legacy: { src: string; kb: number; type: string }[] = [];
  let totalImageKb = 0;
  for (const [src, bytes] of Object.entries(perf.imgSizes)) {
    const kb = Math.round(bytes / 1024);
    totalImageKb += kb;
    const type = watch.imageTypes.get(src) || "";
    if (kb > 60 && /jpe?g|png|gif/i.test(type)) legacy.push({ src, kb, type });
  }
  return {
    url,
    ok: true,
    lcpMs: perf.lcp,
    cls: perf.cls,
    ttfbMs: perf.ttfb,
    loadMs: perf.load,
    transferKb: perf.transferKb,
    requests: watch.requests,
    failedRequests: watch.failed.slice(0, 25),
    mixedContent: Array.from(new Set(watch.mixed)).slice(0, 20),
    consoleErrors: watch.consoleErrors,
    images: {
      total: perf.totalImages,
      broken: perf.broken,
      oversized: perf.oversized,
      legacyFormatHeavy: legacy.sort((a, b) => b.kb - a.kb).slice(0, 10),
      totalImageKb,
    },
  };
}

const emptyBase = (url: string, error: string): PageProbe => ({
  url,
  ok: false,
  error,
  lcpMs: null,
  cls: null,
  ttfbMs: null,
  loadMs: null,
  transferKb: null,
  requests: 0,
  failedRequests: [],
  mixedContent: [],
  consoleErrors: 0,
  images: { total: 0, broken: [], oversized: [], legacyFormatHeavy: [], totalImageKb: 0 },
});

async function probeMobile(browser: Browser, url: string, hosts: Set<string>): Promise<MobileProbe> {
  const context = await browser.newContext({ ...MOBILE, bypassCSP: true });
  await guardContext(context, hosts);
  await context.addInitScript(PERF_INIT);
  const page = await context.newPage();
  const watch = attachNetworkWatch(page, url);
  try {
    await settle(page, url);
    const base = await collectBase(page, url, watch);
    const layout = await page.evaluate(() => {
      const vw = window.innerWidth;
      const overflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
      const isVisible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
      };
      let textEls = 0;
      let tiny = 0;
      const tinySamples: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 2);
        if (!hasText || !isVisible(el)) continue;
        textEls++;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) {
          tiny++;
          if (tinySamples.length < 5) tinySamples.push(`${fs}px: "${(el.textContent || "").trim().slice(0, 40)}"`);
        }
      }
      const targets = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, [role=button]"))
        .filter(isVisible)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.top < window.innerHeight * 4);
      const small = targets.filter(({ r }) => r.width < 24 || r.height < 24);
      let overlaps = 0;
      const sample = targets.slice(0, 250);
      for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
          const a = sample[i].r;
          const b = sample[j].r;
          if (sample[i].el.contains(sample[j].el) || sample[j].el.contains(sample[i].el)) continue;
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 8 && iy > 8) overlaps++;
        }
      }
      const navSelectors = [
        "[aria-label*='menu' i]",
        "[aria-controls*='menu' i]",
        "[aria-controls*='drawer' i]",
        "[class*='hamburger' i]",
        "[class*='menu-toggle' i]",
        "[class*='menu-drawer' i] summary",
        "header details summary",
        "[data-action*='menu' i]",
      ];
      const mobileNavFound = navSelectors.some((s) => Array.from(document.querySelectorAll(s)).some(isVisible));
      const label = (el: Element) => {
        const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("href") || el.tagName).trim().replace(/\s+/g, " ");
        return t.slice(0, 40);
      };
      return {
        overflowPx,
        tinyTextRatio: textEls ? tiny / textEls : 0,
        tinySamples,
        smallTapTargets: small.length,
        smallTapSamples: small.slice(0, 5).map(({ el, r }) => `${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`),
        overlaps,
        mobileNavFound,
      };
    });
    let axe: MobileProbe["axe"] = null;
    try {
      await page.evaluate(getAxeSource());
      axe = await page.evaluate(async () => {
        const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[] }> } };
        const res = await w.axe.run(document, {
          runOnly: {
            type: "rule",
            values: [
              "color-contrast",
              "label",
              "button-name",
              "link-name",
              "image-alt",
              "input-image-alt",
              "select-name",
              "heading-order",
              "page-has-heading-one",
              "html-has-lang",
              "document-title",
              "aria-required-attr",
              "frame-title",
            ],
          },
          resultTypes: ["violations"],
        });
        return res.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          sample: (v.nodes[0]?.target || []).join(" ").slice(0, 80),
        }));
      });
    } catch {
      axe = null;
    }
    let screenshot: string | null = null;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
      screenshot = `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      screenshot = null;
    }
    return {
      ...base,
      overflowPx: layout.overflowPx,
      tinyTextRatio: Math.round(layout.tinyTextRatio * 100) / 100,
      tinyTextSamples: layout.tinySamples,
      smallTapTargets: layout.smallTapTargets,
      smallTapSamples: layout.smallTapSamples,
      overlappingTapTargets: layout.overlaps,
      mobileNavFound: layout.mobileNavFound,
      screenshot,
      axe,
    };
  } catch (err) {
    return {
      ...emptyBase(url, String(err instanceof Error ? err.message : err)),
      overflowPx: 0,
      tinyTextRatio: 0,
      tinyTextSamples: [],
      smallTapTargets: 0,
      smallTapSamples: [],
      overlappingTapTargets: 0,
      mobileNavFound: false,
      screenshot: null,
      axe: null,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function probeDesktop(browser: Browser, url: string, hosts: Set<string>): Promise<DesktopProbe> {
  const context = await browser.newContext(DESKTOP);
  await guardContext(context, hosts);
  await context.addInitScript(PERF_INIT);
  const page = await context.newPage();
  const watch = attachNetworkWatch(page, url);
  try {
    await settle(page, url);
    const base = await collectBase(page, url, watch);
    let keyboard: DesktopProbe["keyboard"] = null;
    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const seen: string[] = [];
      let withIndicator = 0;
      const tabs = 15;
      for (let i = 0; i < tabs; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const indicator =
            (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
            (s.boxShadow && s.boxShadow !== "none") ||
            el.matches(":focus-visible");
          const desc = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
          return { desc, indicator: !!indicator };
        });
        if (info) {
          seen.push(info.desc);
          if (info.indicator) withIndicator++;
        }
      }
      keyboard = {
        tabStops: seen.length,
        distinct: new Set(seen).size,
        withFocusIndicator: withIndicator,
        samples: Array.from(new Set(seen)).slice(0, 6),
      };
    } catch {
      keyboard = null;
    }
    return { ...base, keyboard };
  } catch (err) {
    return { ...emptyBase(url, String(err instanceof Error ? err.message : err)), keyboard: null };
  } finally {
    await context.close().catch(() => {});
  }
}

async function probeProduct(browser: Browser, url: string, hosts: Set<string>): Promise<ProductProbe> {
  const context = await browser.newContext(MOBILE);
  await guardContext(context, hosts);
  const page = await context.newPage();
  const result: ProductProbe = {
    url,
    ok: false,
    titleVisible: false,
    priceVisible: false,
    priceText: null,
    imagesVisible: 0,
    variantSelectors: 0,
    atcFound: false,
    atcVisible: false,
    atcEnabled: false,
    atcText: null,
    addedToCart: null,
    cartBefore: null,
    cartAfter: null,
    cartRequestOk: false,
    pageTitle: null,
    gated: false,
  };
  try {
    await page.goto(url, { waitUntil: "load", timeout: 35000 }).catch((err) => {
      if (!/Timeout/i.test(String(err))) throw err;
    });
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const h1 = document.querySelector("h1");
      const priceRe = /[$€£¥₹]\s?\d|\d[\d.,]*\s?(USD|EUR|GBP|CAD|AUD|INR|kr|zł|₹|€|£)/i;
      const priceEl = Array.from(document.querySelectorAll("[class*='price' i], [data-product-price], [itemprop=price], [data-price]"))
        .filter((el) => isVisible(el) && priceRe.test(el.textContent || "") && (el.textContent || "").trim().length < 60)
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      const main = document.querySelector("main") || document.body;
      const imgs = Array.from(main.querySelectorAll("img")).filter((i) => {
        const r = i.getBoundingClientRect();
        return isVisible(i) && r.width > 120;
      });
      const variantSelectors = main.querySelectorAll(
        "select[name^='options'], select[name='id'], input[type=radio][name*='ption' i], variant-radios, variant-selects, [class*='variant-picker' i] select, [class*='swatch' i] input, fieldset input[type=radio], [role=radiogroup] [role=radio], [role=radiogroup] button, [class*='size' i] button, [data-option-value], [data-variant-id]"
      ).length;
      const form = document.querySelector("form[action*='/cart/add']");
      const atcText = /add to (cart|bag|basket)|buy now|add to order|in den warenkorb|ajouter au panier|añadir al carrito/i;
      const btn =
        (form?.querySelector("button[type=submit], button[name=add], input[type=submit]") as HTMLButtonElement | null) ||
        (document.querySelector("button[name=add], [data-add-to-cart], button[id*='AddToCart' i], button[class*='add-to-cart' i]") as HTMLButtonElement | null) ||
        (Array.from(document.querySelectorAll("button, [role=button], input[type=submit]")).find(
          (el) => isVisible(el) && atcText.test((el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim())
        ) as HTMLButtonElement | undefined) ||
        null;
      if (btn) btn.setAttribute("data-xray-atc", "1");
      return {
        titleVisible: isVisible(h1),
        priceVisible: !!priceEl,
        priceText: priceEl ? (priceEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) : null,
        imagesVisible: imgs.length,
        variantSelectors,
        atcFound: !!btn,
        atcEnabled: !!btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true",
        atcText: btn ? (btn.textContent || btn.value || "").trim().replace(/\s+/g, " ").slice(0, 40) : null,
      };
    });
    Object.assign(result, info, { ok: true });
    result.pageTitle = await page.title().catch(() => null);
    result.gated = await page
      .evaluate(() => /members only|password|log ?in to (view|purchase)|access to this product is reserved|age verification/i.test(document.body.innerText.slice(0, 3000)))
      .catch(() => false);
    if (info.atcFound) {
      const btn = page.locator("[data-xray-atc='1']").first();
      await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      result.atcVisible = await btn.isVisible().catch(() => false);
      if (result.atcVisible && result.atcEnabled) {
        const cartCount = () =>
          page.evaluate(async () => {
            try {
              const r = await fetch("/cart.js", { headers: { accept: "application/json" } });
              const j = await r.json();
              return typeof j.item_count === "number" ? j.item_count : null;
            } catch {
              return null;
            }
          });
        result.cartBefore = await cartCount();
        await page.route(/\/checkout|\/checkouts\//, (route) => route.abort());
        let cartRequestOk = false;
        page.on("response", (res) => {
          const req = res.request();
          if (req.method() === "POST" && /cart|graphql/i.test(req.url()) && res.status() < 400) cartRequestOk = true;
        });
        await page
          .evaluate(() => {
            const sel = document.querySelector("select[name^='options'], select[name='id']") as HTMLSelectElement | null;
            if (sel && sel.selectedIndex <= 0 && sel.options.length > 1) {
              const opt = Array.from(sel.options).findIndex((o, i) => i > 0 && !o.disabled);
              if (opt > 0) {
                sel.selectedIndex = opt;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          })
          .catch(() => {});
        const choice = page
          .locator("[role=radiogroup] button:not([disabled]):not([aria-disabled=true]), fieldset label:not(.disabled), [class*='size' i] button:not([disabled])")
          .first();
        if ((await choice.count().catch(() => 0)) > 0 && result.variantSelectors > 0) {
          await choice.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3500);
        if (/\/checkout/.test(page.url())) await page.goBack().catch(() => {});
        result.cartAfter = await cartCount();
        result.cartRequestOk = cartRequestOk;
        result.addedToCart =
          result.cartBefore !== null && result.cartAfter !== null && result.cartAfter > result.cartBefore
            ? true
            : cartRequestOk
              ? null
              : result.cartBefore !== null && result.cartAfter !== null
                ? false
                : null;
      }
    }
    return result;
  } catch (err) {
    return { ...result, error: String(err instanceof Error ? err.message : err) };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function runBrowserProbes(homeUrl: string, productUrl: string | null): Promise<BrowserReport> {
  if (process.env.DISABLE_BROWSER === "1") {
    return { available: false, error: "Browser checks disabled", mobile: null, desktop: null, product: null, requestHosts: [] };
  }
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    return {
      available: false,
      error: `Headless browser unavailable: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      mobile: null,
      desktop: null,
      product: null,
      requestHosts: [],
    };
  }
  await acquire();
  const hosts = new Set<string>();
  try {
    const [mobile, desktop, product] = await Promise.all([
      probeMobile(browser, homeUrl, hosts),
      probeDesktop(browser, homeUrl, hosts),
      productUrl ? probeProduct(browser, productUrl, hosts) : Promise.resolve(null),
    ]);
    return { available: true, mobile, desktop, product, requestHosts: Array.from(hosts) };
  } finally {
    release();
  }
}
