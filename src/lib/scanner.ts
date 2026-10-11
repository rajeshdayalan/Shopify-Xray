import * as cheerio from "cheerio";
import { normalizeUrl, safeFetch } from "./safeFetch";
import type { Category, Issue, PassedCheck, ScanResult, Severity } from "./types";

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const CATEGORIES: Category[] = ["SEO", "Performance", "Accessibility", "Trust & Conversion", "Shopify"];

type IssueInput = Omit<Issue, "priority">;

interface Check {
  id: string;
  title: string;
  category: Category;
  run: () => IssueInput | null | Promise<IssueInput | null>;
}

const FIRST_PARTY_HOSTS = ["cdn.shopify.com", "shopify.com", "shopifycdn.com", "shopifysvc.com"];

function hostOf(src: string, base: string): string | null {
  try {
    return new URL(src, base).hostname;
  } catch {
    return null;
  }
}

async function probe(url: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 8000, maxBytes: 500_000 });
    return { status: res.status, body: res.body };
  } catch {
    return null;
  }
}

export async function scanStore(input: string): Promise<ScanResult> {
  const url = normalizeUrl(input);
  const page = await safeFetch(url);
  if (page.status >= 400) {
    throw new Error(`Store responded with HTTP ${page.status}`);
  }

  const $ = cheerio.load(page.body);
  const html = page.body;
  const finalUrl = new URL(page.finalUrl);
  const origin = finalUrl.origin;
  const headers = page.headers;

  const isShopify =
    /cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.theme|myshopify\.com|shopify-section/i.test(html) ||
    !!headers.get("x-shopid") ||
    !!headers.get("x-shopify-stage") ||
    (headers.get("powered-by") || "").toLowerCase().includes("shopify");

  const passwordProtected =
    finalUrl.pathname.startsWith("/password") || $("body").hasClass("template-password");

  let theme: string | undefined;
  const themeMatch = html.match(/Shopify\.theme\s*=\s*(\{[^;]+\})/);
  if (themeMatch) {
    const nameMatch = themeMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) theme = nameMatch[1];
  }
  const storeName =
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    $("title").first().text().trim().split(/[|–-]/)[0]?.trim() ||
    finalUrl.hostname;

  const scripts = $("script[src]")
    .map((_, el) => $(el).attr("src") || "")
    .get()
    .filter(Boolean);
  const thirdPartyHosts = new Set<string>();
  for (const src of scripts) {
    const h = hostOf(src, origin);
    if (!h || h === finalUrl.hostname) continue;
    if (FIRST_PARTY_HOSTS.some((fp) => h === fp || h.endsWith(`.${fp}`))) continue;
    thirdPartyHosts.add(h);
  }
  const thirdPartyScripts = scripts.filter((src) => {
    const h = hostOf(src, origin);
    return h && thirdPartyHosts.has(h);
  }).length;
  const stylesheets = $('link[rel="stylesheet"]').length;
  const images = $("img");
  const htmlSizeKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);

  const [robots, sitemap, privacy, refund, terms, shipping] = await Promise.all([
    probe(`${origin}/robots.txt`),
    probe(`${origin}/sitemap.xml`),
    probe(`${origin}/policies/privacy-policy`),
    probe(`${origin}/policies/refund-policy`),
    probe(`${origin}/policies/terms-of-service`),
    probe(`${origin}/policies/shipping-policy`),
  ]);

  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";
  const h1s = $("h1");
  const canonical = $('link[rel="canonical"]').attr("href");
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");

  const imgsMissingAlt = images.filter((_, el) => $(el).attr("alt") === undefined).length;
  const imgsNotLazy = images.slice(3).filter((_, el) => {
    const loading = $(el).attr("loading");
    const cls = $(el).attr("class") || "";
    return loading !== "lazy" && !/lazy/i.test(cls) && !$(el).attr("data-src");
  }).length;
  const imgsNoDims = images.filter(
    (_, el) => !$(el).attr("width") || !$(el).attr("height")
  ).length;
  const renderBlockingScripts = $("head script[src]").filter(
    (_, el) => $(el).attr("async") === undefined && $(el).attr("defer") === undefined && $(el).attr("type") !== "module"
  ).length;
  const inlineScriptKb = Math.round(
    $("script:not([src])")
      .map((_, el) => ($(el).html() || "").length)
      .get()
      .reduce((a: number, b: number) => a + b, 0) / 1024
  );

  const checks: Check[] = [
    {
      id: "password",
      title: "Store is publicly accessible",
      category: "Shopify",
      run: () =>
        passwordProtected
          ? {
              id: "password",
              title: "Store is password protected",
              category: "Shopify",
              severity: "critical",
              impact: 10,
              description:
                "Visitors and search engines see a password page instead of your store, so you can't get organic traffic or sales.",
              fix: [
                "Shopify admin → Online Store → Preferences.",
                "Under 'Password protection', uncheck 'Restrict access to visitors with the password'.",
                "Make sure you're on a paid plan (password can't be removed on trial).",
              ],
            }
          : null,
    },
    {
      id: "https",
      title: "Served over HTTPS",
      category: "Trust & Conversion",
      run: () =>
        finalUrl.protocol !== "https:"
          ? {
              id: "https",
              title: "Store is not served over HTTPS",
              category: "Trust & Conversion",
              severity: "critical",
              impact: 10,
              description: "Browsers show 'Not secure' warnings, which kills trust and checkout conversion.",
              fix: [
                "Shopify admin → Settings → Domains.",
                "Check SSL status for your domain and fix DNS (A record 23.227.38.65, CNAME shops.myshopify.com) so Shopify can issue a certificate.",
              ],
            }
          : null,
    },
    {
      id: "response-time",
      title: "Fast server response",
      category: "Performance",
      run: () =>
        page.elapsedMs > 1500
          ? {
              id: "response-time",
              title: "Slow server response time",
              category: "Performance",
              severity: page.elapsedMs > 3000 ? "high" : "medium",
              impact: page.elapsedMs > 3000 ? 8 : 6,
              description:
                "The home page took a long time to respond. Every extra second of load time can reduce conversions significantly.",
              evidence: `Responded in ${page.elapsedMs} ms (target < 1500 ms)`,
              fix: [
                "Reduce Liquid complexity on the home page (fewer sections, fewer nested loops over collections).",
                "Remove unused apps — many inject Liquid snippets that slow rendering.",
                "Avoid redirect chains on the home URL.",
              ],
            }
          : null,
    },
    {
      id: "html-size",
      title: "Reasonable HTML size",
      category: "Performance",
      run: () =>
        htmlSizeKb > 500
          ? {
              id: "html-size",
              title: "Home page HTML is very heavy",
              category: "Performance",
              severity: htmlSizeKb > 1000 ? "high" : "medium",
              impact: htmlSizeKb > 1000 ? 7 : 5,
              description: "Large HTML documents take longer to download and parse, especially on mobile.",
              evidence: `HTML size: ${htmlSizeKb} KB (target < 500 KB)${inlineScriptKb > 50 ? `, of which ~${inlineScriptKb} KB inline scripts` : ""}`,
              fix: [
                "Reduce the number of home page sections and products rendered.",
                "Remove large inline JSON/scripts injected by apps.",
                "Avoid inlining SVG icon sprites repeatedly.",
              ],
            }
          : null,
    },
    {
      id: "third-party",
      title: "Limited third-party app scripts",
      category: "Performance",
      run: () =>
        thirdPartyHosts.size > 8
          ? {
              id: "third-party",
              title: "Too many third-party app scripts",
              category: "Performance",
              severity: thirdPartyHosts.size > 15 ? "high" : "medium",
              impact: thirdPartyHosts.size > 15 ? 9 : 7,
              description:
                "Each app script adds network requests and JavaScript execution, slowing your store and hurting Core Web Vitals.",
              evidence: `${thirdPartyScripts} scripts from ${thirdPartyHosts.size} external domains: ${Array.from(thirdPartyHosts).slice(0, 8).join(", ")}${thirdPartyHosts.size > 8 ? "…" : ""}`,
              fix: [
                "Audit installed apps (Shopify admin → Apps) and uninstall ones you don't use.",
                "After uninstalling, remove leftover app code from theme.liquid and snippets.",
                "Prefer apps that use Theme App Extensions (they load only where needed).",
              ],
            }
          : null,
    },
    {
      id: "render-blocking",
      title: "No render-blocking scripts",
      category: "Performance",
      run: () =>
        renderBlockingScripts > 2
          ? {
              id: "render-blocking",
              title: "Render-blocking scripts in <head>",
              category: "Performance",
              severity: "medium",
              impact: 6,
              description: "Synchronous scripts in the <head> block the page from displaying until they download and run.",
              evidence: `${renderBlockingScripts} scripts in <head> without async/defer`,
              fix: [
                "Add `defer` to theme scripts in theme.liquid.",
                "Move non-critical app scripts to the end of <body> or load them with `async`.",
              ],
            }
          : null,
    },
    {
      id: "lazy-images",
      title: "Images are lazy-loaded",
      category: "Performance",
      run: () =>
        imgsNotLazy > 5
          ? {
              id: "lazy-images",
              title: "Below-the-fold images are not lazy-loaded",
              category: "Performance",
              severity: "medium",
              impact: 6,
              description: "Loading every image up-front wastes bandwidth and slows the initial page load on mobile.",
              evidence: `${imgsNotLazy} images (after the first 3) without lazy loading`,
              fix: [
                "In your theme's Liquid, use `{{ image | image_url: width: 800 | image_tag: loading: 'lazy' }}` for below-the-fold images.",
                "Keep the hero/first image eager for a good LCP.",
              ],
            }
          : null,
    },
    {
      id: "image-dims",
      title: "Images have width/height",
      category: "Performance",
      run: () =>
        images.length > 0 && imgsNoDims / images.length > 0.3 && imgsNoDims > 3
          ? {
              id: "image-dims",
              title: "Images missing width/height (layout shift)",
              category: "Performance",
              severity: "low",
              impact: 4,
              description: "Images without dimensions cause content to jump while loading, hurting CLS (a Core Web Vital).",
              evidence: `${imgsNoDims} of ${images.length} images lack width/height attributes`,
              fix: ["Use Shopify's `image_tag` filter, which outputs width and height automatically."],
            }
          : null,
    },
    {
      id: "title",
      title: "Page title is set",
      category: "SEO",
      run: () => {
        if (!title)
          return {
            id: "title",
            title: "Missing page title",
            category: "SEO",
            severity: "high",
            impact: 9,
            description: "The <title> tag is the main headline shown in Google results.",
            fix: ["Shopify admin → Online Store → Preferences → set 'Homepage title' (50–60 characters, include your main keyword)."],
          };
        if (title.length < 15 || title.length > 70)
          return {
            id: "title",
            title: title.length < 15 ? "Page title is too short" : "Page title is too long",
            category: "SEO",
            severity: "medium",
            impact: 5,
            description: "Titles between 30 and 60 characters perform best in search results.",
            evidence: `"${title}" (${title.length} chars)`,
            fix: ["Shopify admin → Online Store → Preferences → edit 'Homepage title' to 30–60 characters with your brand + main product keyword."],
          };
        return null;
      },
    },
    {
      id: "meta-description",
      title: "Meta description is set",
      category: "SEO",
      run: () => {
        if (!metaDesc)
          return {
            id: "meta-description",
            title: "Missing meta description",
            category: "SEO",
            severity: "high",
            impact: 8,
            description: "Without a meta description Google picks random text for your search snippet, lowering click-through rate.",
            fix: ["Shopify admin → Online Store → Preferences → write a 'Homepage meta description' (120–160 characters) with a clear value proposition."],
          };
        if (metaDesc.length < 70 || metaDesc.length > 170)
          return {
            id: "meta-description",
            title: metaDesc.length < 70 ? "Meta description is too short" : "Meta description is too long",
            category: "SEO",
            severity: "low",
            impact: 4,
            description: "Meta descriptions of 120–160 characters get the best search snippets.",
            evidence: `${metaDesc.length} characters`,
            fix: ["Shopify admin → Online Store → Preferences → adjust 'Homepage meta description' to 120–160 characters."],
          };
        return null;
      },
    },
    {
      id: "h1",
      title: "Exactly one H1 heading",
      category: "SEO",
      run: () =>
        h1s.length !== 1
          ? {
              id: "h1",
              title: h1s.length === 0 ? "No H1 heading on the home page" : "Multiple H1 headings on the home page",
              category: "SEO",
              severity: h1s.length === 0 ? "medium" : "low",
              impact: h1s.length === 0 ? 6 : 3,
              description: "Search engines use the H1 to understand the main topic of the page. Use exactly one.",
              evidence: `${h1s.length} H1 tags found`,
              fix: [
                "In the theme editor, make your hero/banner heading the only H1.",
                "Change other section headings to H2 in the section's Liquid file.",
              ],
            }
          : null,
    },
    {
      id: "canonical",
      title: "Canonical URL is set",
      category: "SEO",
      run: () =>
        !canonical
          ? {
              id: "canonical",
              title: "Missing canonical URL",
              category: "SEO",
              severity: "medium",
              impact: 5,
              description: "Without a canonical tag, duplicate URLs can split your ranking signals.",
              fix: ["Add `<link rel=\"canonical\" href=\"{{ canonical_url }}\">` inside <head> in theme.liquid."],
            }
          : null,
    },
    {
      id: "open-graph",
      title: "Open Graph tags present",
      category: "SEO",
      run: () =>
        !ogTitle || !ogImage
          ? {
              id: "open-graph",
              title: "Missing social sharing (Open Graph) tags",
              category: "SEO",
              severity: "low",
              impact: 4,
              description: "Links shared on Facebook, WhatsApp, etc. won't show a proper title and image.",
              evidence: `og:title ${ogTitle ? "present" : "missing"}, og:image ${ogImage ? "present" : "missing"}`,
              fix: [
                "Shopify admin → Online Store → Preferences → upload a 'Social sharing image'.",
                "Ensure theme.liquid renders `{% render 'meta-tags' %}` (included in Shopify themes).",
              ],
            }
          : null,
    },
    {
      id: "structured-data",
      title: "Structured data present",
      category: "SEO",
      run: () =>
        !jsonLd.trim()
          ? {
              id: "structured-data",
              title: "No structured data (schema.org)",
              category: "SEO",
              severity: "medium",
              impact: 5,
              description: "Structured data enables rich results (ratings, price, availability) in Google.",
              fix: [
                "Add Organization/WebSite JSON-LD to theme.liquid.",
                "On product templates, output `{{ product | structured_data }}` inside a JSON-LD script tag.",
              ],
            }
          : null,
    },
    {
      id: "robots",
      title: "robots.txt available",
      category: "SEO",
      run: () =>
        !robots || robots.status >= 400
          ? {
              id: "robots",
              title: "robots.txt not reachable",
              category: "SEO",
              severity: "medium",
              impact: 5,
              description: "Search engines use robots.txt to understand what to crawl.",
              fix: ["Check whether robots.txt.liquid in your theme has errors (Online Store → Themes → Edit code → Templates)."],
            }
          : null,
    },
    {
      id: "sitemap",
      title: "sitemap.xml available",
      category: "SEO",
      run: () =>
        !sitemap || sitemap.status >= 400
          ? {
              id: "sitemap",
              title: "sitemap.xml not reachable",
              category: "SEO",
              severity: "medium",
              impact: 6,
              description: "A sitemap helps Google discover all your products and collections.",
              fix: ["Make sure the store isn't password protected, then submit /sitemap.xml in Google Search Console."],
            }
          : null,
    },
    {
      id: "img-alt",
      title: "Images have alt text",
      category: "Accessibility",
      run: () =>
        imgsMissingAlt > 0
          ? {
              id: "img-alt",
              title: "Images missing alt text",
              category: "Accessibility",
              severity: imgsMissingAlt > 10 ? "high" : "medium",
              impact: imgsMissingAlt > 10 ? 7 : 5,
              description:
                "Alt text makes images accessible to screen readers and helps them rank in Google Images.",
              evidence: `${imgsMissingAlt} of ${images.length} images have no alt attribute`,
              fix: [
                "Shopify admin → Products → open a product → click each image → 'Add alt text'.",
                "For theme images, edit the section in the theme editor and fill in the image alt field.",
              ],
            }
          : null,
    },
    {
      id: "lang",
      title: "HTML lang attribute set",
      category: "Accessibility",
      run: () =>
        !$("html").attr("lang")
          ? {
              id: "lang",
              title: "Missing language attribute",
              category: "Accessibility",
              severity: "low",
              impact: 3,
              description: "The lang attribute tells screen readers and search engines which language the store is in.",
              fix: ["In theme.liquid, set `<html lang=\"{{ request.locale.iso_code }}\">`."],
            }
          : null,
    },
    {
      id: "viewport",
      title: "Mobile viewport configured",
      category: "Accessibility",
      run: () =>
        !$('meta[name="viewport"]').length
          ? {
              id: "viewport",
              title: "Missing mobile viewport tag",
              category: "Accessibility",
              severity: "high",
              impact: 8,
              description: "Without a viewport tag, the store renders like a desktop page on phones — most Shopify traffic is mobile.",
              fix: ["Add `<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">` in theme.liquid <head>."],
            }
          : null,
    },
    {
      id: "favicon",
      title: "Favicon set",
      category: "Trust & Conversion",
      run: () =>
        !$('link[rel~="icon"]').length
          ? {
              id: "favicon",
              title: "Missing favicon",
              category: "Trust & Conversion",
              severity: "low",
              impact: 3,
              description: "A favicon makes your store recognizable in browser tabs and search results.",
              fix: ["Theme editor → Theme settings → Logo → upload a Favicon (32×32 px)."],
            }
          : null,
    },
    {
      id: "policies",
      title: "Store policies published",
      category: "Trust & Conversion",
      run: () => {
        const missing = [
          ["Privacy policy", privacy],
          ["Refund policy", refund],
          ["Terms of service", terms],
          ["Shipping policy", shipping],
        ]
          .filter(([, r]) => !r || (r as { status: number }).status >= 400)
          .map(([n]) => n as string);
        return missing.length
          ? {
              id: "policies",
              title: "Missing store policies",
              category: "Trust & Conversion",
              severity: missing.length >= 2 ? "high" : "medium",
              impact: missing.length >= 2 ? 7 : 5,
              description:
                "Shoppers look for refund and shipping policies before buying; they're also required by many payment providers and Google Merchant Center.",
              evidence: `Missing: ${missing.join(", ")}`,
              fix: [
                "Shopify admin → Settings → Policies → create the missing policies (templates available).",
                "Link them in your footer menu (Online Store → Navigation → Footer).",
              ],
            }
          : null;
      },
    },
    {
      id: "contact",
      title: "Contact information visible",
      category: "Trust & Conversion",
      run: () => {
        const hasContact =
          $('a[href*="/pages/contact"], a[href^="mailto:"], a[href^="tel:"]').length > 0 ||
          /contact us/i.test($("footer").text());
        return !hasContact
          ? {
              id: "contact",
              title: "No visible contact information",
              category: "Trust & Conversion",
              severity: "medium",
              impact: 5,
              description: "Shoppers trust stores they can contact. Missing contact info raises abandonment.",
              fix: [
                "Online Store → Pages → add a Contact page (template: page.contact).",
                "Add it to the header or footer navigation.",
              ],
            }
          : null;
      },
    },
  ];

  const issues: Issue[] = [];
  const passed: PassedCheck[] = [];
  for (const check of checks) {
    const result = await check.run();
    if (result) {
      issues.push({ ...result, priority: SEVERITY_WEIGHT[result.severity] * result.impact });
    } else {
      passed.push({ id: check.id, title: check.title, category: check.category });
    }
  }
  if (!isShopify) {
    issues.push({
      id: "not-shopify",
      title: "This doesn't look like a Shopify store",
      category: "Shopify",
      severity: "low",
      impact: 1,
      description: "We couldn't detect Shopify on this site. Results may be less accurate.",
      fix: ["Double-check the URL — try your primary domain or your .myshopify.com address."],
      priority: 0,
    });
  }

  issues.sort((a, b) => b.priority - a.priority);

  const penalty = issues.reduce((sum, i) => sum + i.priority, 0);
  const score = Math.max(0, Math.round(100 - penalty * 0.6));

  const categoryScores = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const catPenalty = issues.filter((i) => i.category === cat).reduce((s, i) => s + i.priority, 0);
      return [cat, Math.max(0, Math.round(100 - catPenalty * 1.5))];
    })
  ) as Record<Category, number>;

  return {
    url: url.toString(),
    finalUrl: page.finalUrl,
    isShopify,
    storeName,
    theme,
    passwordProtected,
    score,
    categoryScores,
    stats: {
      responseTimeMs: page.elapsedMs,
      htmlSizeKb,
      scripts: scripts.length,
      thirdPartyScripts,
      stylesheets,
      images: images.length,
    },
    issues,
    topIssues: issues.filter((i) => i.id !== "not-shopify").slice(0, 3),
    passed,
    scannedAt: new Date().toISOString(),
  };
}
