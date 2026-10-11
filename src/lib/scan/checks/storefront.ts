import type { ScanContext } from "../context";
import type { CheckResult, TechDetection } from "../types";
import { makeCheck, shortUrl, stripHtml } from "./helpers";

const C = "storefront" as const;

export function mobileExperience(ctx: ScanContext): CheckResult {
  const def = { id: 1, key: "mobile", title: "Mobile experience", category: C, impact: 9 };
  const viewport = ctx.home.$('meta[name="viewport"]').attr("content") || "";
  const m = ctx.browser.mobile;
  const evidence: string[] = [viewport ? `Viewport: "${viewport}"` : "No viewport meta tag"];
  const recs: string[] = [];
  if (!m || !m.ok) {
    return makeCheck(def, {
      status: viewport.includes("width=device-width") ? "pass" : "fail",
      severity: "high",
      confidence: "low",
      summary: viewport ? "Viewport is configured; mobile rendering could not be verified in a browser." : "No mobile viewport configured.",
      evidence: [...evidence, m?.error ? `Browser: ${m.error}` : "Browser rendering unavailable"],
      recommendations: viewport ? [] : ['Add `<meta name="viewport" content="width=device-width,initial-scale=1">` to theme.liquid.'],
    });
  }
  let fails = 0;
  let warns = 0;
  if (!viewport.includes("width=device-width")) {
    fails++;
    recs.push('Add `<meta name="viewport" content="width=device-width,initial-scale=1">` in theme.liquid.');
  }
  if (m.overflowPx > 10) {
    fails++;
    evidence.push(`Page is ${m.overflowPx}px wider than the 390px mobile screen (horizontal scrolling)`);
    recs.push("Find the element causing horizontal scroll (often wide tables, images or carousels with fixed widths) and set `max-width: 100%`.");
  } else evidence.push("No horizontal overflow at 390px width");
  if (m.tinyTextRatio > 0.15) {
    warns++;
    evidence.push(`${Math.round(m.tinyTextRatio * 100)}% of visible text is smaller than 12px, e.g. ${m.tinyTextSamples.slice(0, 2).join("; ")}`);
    recs.push("Increase body/caption font sizes to at least 14px on mobile (theme settings → Typography).");
  }
  if (m.overlappingTapTargets > 3) {
    warns++;
    evidence.push(`${m.overlappingTapTargets} overlapping tappable elements`);
    recs.push("Fix overlapping buttons/links on mobile so each tap target is distinct.");
  }
  if (m.smallTapTargets > 10) {
    warns++;
    evidence.push(`${m.smallTapTargets} tap targets smaller than 24×24px, e.g. ${m.smallTapSamples.slice(0, 2).join("; ")}`);
    recs.push("Make buttons and links at least 44×44px on mobile (padding helps).");
  }
  if (!m.mobileNavFound) {
    warns++;
    evidence.push("No visible mobile menu toggle detected");
    recs.push("Ensure a clearly visible menu (hamburger) button exists in the mobile header.");
  } else evidence.push("Mobile navigation toggle found");
  return makeCheck(def, {
    status: fails ? "fail" : warns ? "warn" : "pass",
    severity: fails ? "high" : warns >= 2 ? "medium" : "low",
    confidence: "high",
    summary: fails
      ? "The store has mobile layout problems that make browsing on phones harder."
      : warns
        ? "Mobile layout works but has usability rough edges."
        : "The store renders well on a mobile viewport.",
    evidence,
    recommendations: recs,
  });
}

export function productCompleteness(ctx: ScanContext): CheckResult {
  const def = { id: 2, key: "product-completeness", title: "Product page completeness", category: C, impact: 8 };
  if (!ctx.products.length) {
    return makeCheck(def, {
      status: "skipped",
      severity: "medium",
      confidence: "low",
      summary: "Couldn't find a public product page to inspect.",
      evidence: ["No products found via /products.json or home page links"],
    });
  }
  const evidence: string[] = [];
  let missingCritical = 0;
  let thin = 0;
  for (const { doc, data } of ctx.products) {
    const $ = doc.$;
    const images = data ? data.images.length : $("main img").length;
    const desc = data ? stripHtml(data.body_html) : $('[class*="description" i]').first().text().trim();
    const hasPrice = data
      ? data.variants.some((v) => Number(v.price) > 0)
      : !!$('meta[property="product:price:amount"], meta[property="og:price:amount"], [itemprop=price]').length ||
        /"price"\s*:\s*"?\d/.test(doc.html) ||
        (ctx.browser.product?.url === doc.url && ctx.browser.product.priceVisible);
    const hasForm =
      $("form[action*='/cart/add']").length > 0 ||
      $("button, input[type=submit]").filter((_, el) => /add to (cart|bag|basket)|buy now/i.test($(el).text() || $(el).attr("value") || "")).length > 0 ||
      (ctx.browser.product?.url === doc.url && ctx.browser.product.atcFound);
    const variants = data?.variants.length ?? 0;
    const problems: string[] = [];
    if (!images) problems.push("no images");
    if (!hasPrice) problems.push("no price");
    if (problems.length) missingCritical++;
    if (!hasForm) problems.push("add-to-cart button not in static HTML (may be rendered by JavaScript)");
    if (desc.length < 120) {
      thin++;
      problems.push(`short description (${desc.length} chars)`);
    }
    if (images === 1) problems.push("only 1 image");
    evidence.push(`${shortUrl(doc.url)}: ${images} images, ${variants || "?"} variants${problems.length ? ` — ${problems.join(", ")}` : " — complete"}`);
  }
  const p = ctx.browser.product;
  if (p?.ok) {
    evidence.push(
      `Mobile render: title ${p.titleVisible ? "visible" : "NOT visible"}, price ${p.priceVisible ? `visible (${p.priceText})` : "NOT visible"}, ${p.imagesVisible} product images visible, ${p.variantSelectors} variant controls`
    );
    if ((!p.priceVisible || !p.titleVisible) && !p.gated) missingCritical++;
    if (p.gated) evidence.push("Sampled product page is gated (members-only/password)");
  }
  return makeCheck(def, {
    status: missingCritical ? "fail" : thin ? "warn" : "pass",
    severity: missingCritical ? "high" : "medium",
    summary: missingCritical
      ? "Some product pages are missing essentials shoppers need to buy."
      : thin
        ? "Product pages work, but descriptions are thin."
        : "Sampled product pages have images, prices, descriptions and purchase controls.",
    evidence,
    recommendations: [
      ...(missingCritical ? ["Make sure every product has at least one image, a price and an active add-to-cart form."] : []),
      ...(thin ? ["Write descriptions of 150+ words covering benefits, materials/specs, sizing and care."] : []),
      "Use 3–6 images per product, including lifestyle and detail shots.",
    ],
  });
}

export function addToCart(ctx: ScanContext): CheckResult {
  const def = { id: 3, key: "add-to-cart", title: "Add-to-cart usability", category: C, impact: 10 };
  const p = ctx.browser.product;
  if (!p || !p.ok) {
    const hasForm = ctx.products.some((x) => x.doc.$("form[action*='/cart/add'] [type=submit], form[action*='/cart/add'] button").length);
    return makeCheck(def, {
      status: ctx.products.length ? (hasForm ? "warn" : "fail") : "skipped",
      severity: hasForm ? "medium" : "critical",
      confidence: "low",
      summary: hasForm
        ? "An add-to-cart form exists in the HTML, but the button could not be tested in a browser."
        : "No add-to-cart form found on sampled product pages.",
      evidence: [p?.error ? `Browser: ${p.error}` : ctx.browser.error || "Browser test unavailable"],
      recommendations: hasForm ? [] : ["Make sure your product template renders the product form with an Add to cart button."],
    });
  }
  const evidence = [`Tested on ${shortUrl(p.url)} (mobile, throwaway session, no checkout)`];
  if (p.gated) {
    evidence.push(`Page "${p.pageTitle}" is restricted (members-only, password or age gate)`);
    return makeCheck(def, {
      status: "skipped",
      severity: "medium",
      confidence: "low",
      summary: "The sampled product is gated (members-only/password), so add-to-cart couldn't be tested.",
      evidence,
    });
  }
  if (!p.atcFound) {
    return makeCheck(def, {
      status: "fail",
      severity: "critical",
      summary: "No add-to-cart button was found on the product page.",
      evidence,
      recommendations: ["Restore the product form/buy buttons block in the product template (Theme editor → Product page)."],
    });
  }
  evidence.push(`Button "${p.atcText}" — ${p.atcVisible ? "visible" : "not visible"}, ${p.atcEnabled ? "enabled" : "disabled"}`);
  if (!p.atcEnabled) {
    return makeCheck(def, {
      status: "info",
      severity: "medium",
      confidence: "medium",
      summary: "The add-to-cart button is disabled on the sampled product (likely sold out).",
      evidence,
      recommendations: ["Consider back-in-stock alerts for sold-out products, and hide sold-out items from top collections."],
    });
  }
  if (p.addedToCart === true) {
    evidence.push(`Cart went from ${p.cartBefore} to ${p.cartAfter} items after clicking`);
    return makeCheck(def, { status: "pass", severity: "low", summary: "Add to cart works on mobile.", evidence });
  }
  if (p.addedToCart === false) {
    evidence.push(`Cart count stayed at ${p.cartAfter} after clicking and no cart request succeeded`);
    return makeCheck(def, {
      status: "warn",
      severity: "high",
      confidence: "medium",
      summary: "Clicking Add to cart didn't visibly add the product in our automated test — please verify manually.",
      evidence,
      recommendations: [
        "Test add-to-cart manually on mobile (including variant selection); check the browser console for JavaScript errors from apps.",
        "If a variant must be chosen first, preselect the first available variant or show a clear 'Select a size' prompt.",
        "Temporarily disable cart-related apps (upsells, cart drawers) to find conflicts.",
      ],
    });
  }
  if (p.cartRequestOk) {
    evidence.push("A cart request succeeded after clicking (custom cart; /cart.js count not confirmed)");
    return makeCheck(def, { status: "pass", severity: "low", confidence: "medium", summary: "Add to cart appears to work on mobile.", evidence });
  }
  evidence.push("Could not read /cart.js to confirm the result");
  return makeCheck(def, {
    status: p.atcVisible ? "warn" : "fail",
    severity: p.atcVisible ? "medium" : "high",
    confidence: "medium",
    summary: p.atcVisible ? "Add-to-cart button is visible but the result couldn't be confirmed." : "Add-to-cart button exists but is not visible on mobile.",
    evidence,
    recommendations: p.atcVisible ? [] : ["Make the Add to cart button visible above the fold on mobile (consider a sticky buy bar)."],
  });
}

export function pricingClarity(ctx: ScanContext): CheckResult {
  const def = { id: 4, key: "pricing", title: "Pricing and offer clarity", category: C, impact: 7 };
  const catalog = ctx.catalog;
  if (!catalog?.length) {
    return makeCheck(def, { status: "skipped", severity: "low", confidence: "low", summary: "Product pricing data isn't publicly available.", evidence: ["/products.json not accessible"] });
  }
  const variants = catalog.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const zero = variants.filter(({ v }) => Number(v.price) === 0 && v.available !== false);
  const badCompare = variants.filter(({ v }) => v.compare_at_price && Number(v.compare_at_price) > 0 && Number(v.compare_at_price) <= Number(v.price));
  const onSale = variants.filter(({ v }) => v.compare_at_price && Number(v.compare_at_price) > Number(v.price));
  const evidence = [
    `${catalog.length} products / ${variants.length} variants analysed`,
    `${onSale.length} variants on sale (compare-at price higher than price)`,
  ];
  if (zero.length) evidence.push(`${zero.length} available variants priced at 0, e.g. "${zero[0].p.title} — ${zero[0].v.title}" (could be hidden placeholder/content products)`);
  if (badCompare.length) evidence.push(`${badCompare.length} variants with compare-at price ≤ price (no real discount shown), e.g. "${badCompare[0].p.title}"`);
  let mismatch = 0;
  for (const { doc, data } of ctx.products) {
    if (!data) continue;
    const prices = data.variants.map((v) => Number(v.price)).filter((n) => n > 0);
    if (!prices.length) continue;
    const min = Math.min(...prices);
    const variantsOfText = [min.toFixed(2), String(Math.round(min)), min.toLocaleString("en-US", { minimumFractionDigits: 2 }), min.toFixed(2).replace(".", ",")];
    if (!variantsOfText.some((t) => doc.text.includes(t))) {
      mismatch++;
      evidence.push(`${shortUrl(doc.url)}: catalog price ${min.toFixed(2)} not found in page text (could be currency conversion)`);
    }
  }
  const status = zero.length ? "fail" : badCompare.length || mismatch ? "warn" : "pass";
  return makeCheck(def, {
    status,
    severity: zero.length ? "high" : "medium",
    confidence: mismatch && !zero.length && !badCompare.length ? "low" : zero.length ? "medium" : "high",
    summary:
      status === "pass"
        ? "Prices and discounts look consistent."
        : zero.length
          ? "Some purchasable variants are priced at zero."
          : "Some prices or discounts may confuse shoppers.",
    evidence,
    recommendations: [
      ...(zero.length ? ["Fix zero-priced variants in Products → (product) → Variants, or mark them unavailable."] : []),
      ...(badCompare.length ? ["Remove or correct compare-at prices that are equal to or lower than the selling price."] : []),
      ...(mismatch ? ["Verify displayed prices match variant prices (check currency/market settings)."] : []),
    ],
  });
}

const SHIP_RE = /shipping|delivery|dispatch|ships? (in|within)|free (uk |us )?shipping/i;
const ESTIMATE_RE = /(\d+\s*[-–to]+\s*\d+|\d+)\s*(business|working)?\s*days|arrives? by|deliver(y|ed) by|ships? (in|within|today|tomorrow)|order (by|within)/i;

export function shippingTransparency(ctx: ScanContext): CheckResult {
  const def = { id: 5, key: "shipping", title: "Shipping and delivery transparency", category: C, impact: 7 };
  const policy = ctx.policies.shipping;
  const policyOk = !!policy && policy.text.length > 200;
  const productText = ctx.products.map((p) => p.doc.text).join(" ");
  const onProduct = SHIP_RE.test(productText);
  const estimate = ESTIMATE_RE.test(productText) || (policy ? ESTIMATE_RE.test(policy.text) : false);
  const onHome = SHIP_RE.test(ctx.home.text);
  const freeThreshold = /free (standard )?shipping (on|over|for)[^.]{0,40}/i.exec(ctx.home.text + " " + productText);
  const evidence = [
    `Shipping policy: ${policyOk ? `published (${policy!.text.length} chars)` : policy ? "very short" : "not found at /policies/shipping-policy"}`,
    `Shipping info on product pages: ${onProduct ? "yes" : "no"}`,
    `Delivery time estimates found: ${estimate ? "yes" : "no"}`,
    `Shipping mentioned on home page: ${onHome ? "yes" : "no"}`,
  ];
  if (freeThreshold) evidence.push(`Offer: "${freeThreshold[0].trim()}"`);
  const status = !policyOk && !onProduct ? "fail" : !estimate || !onProduct ? "warn" : "pass";
  return makeCheck(def, {
    status,
    severity: status === "fail" ? "high" : "medium",
    summary:
      status === "pass"
        ? "Shoppers can find shipping costs and delivery estimates before checkout."
        : status === "fail"
          ? "Shoppers can't find shipping costs or delivery times before checkout — a top cause of cart abandonment."
          : "Shipping information exists but isn't shown where shoppers decide (product page) or lacks delivery estimates.",
    evidence,
    recommendations: [
      ...(!policyOk ? ["Settings → Policies → add a Shipping policy with costs, zones and delivery times."] : []),
      ...(!onProduct ? ["Add a shipping & returns block (collapsible tab) on the product page."] : []),
      ...(!estimate ? ['Show delivery estimates like "Arrives in 3–5 business days".'] : []),
    ],
  });
}

export function trustSocialProof(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 6, key: "trust", title: "Trust and social proof", category: C, impact: 7 };
  const reviews = tech.filter((t) => t.type === "reviews");
  const allHtml = [ctx.home.html, ...ctx.products.map((p) => p.doc.html)].join("\n");
  const allText = [ctx.home.text, ...ctx.products.map((p) => p.doc.text)].join(" ");
  const rating = /"aggregateRating"/.test(allHtml);
  const reviewText = /\b\d[\d,.]*\s*(reviews|ratings)\b|★|customer reviews|testimonials?/i.test(allText);
  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(ctx.home.text) || ctx.home.$("a[href^='mailto:']").length > 0;
  const phone = ctx.home.$("a[href^='tel:']").length > 0;
  const about = ctx.internalLinks.some((l) => /about|our-story|who-we-are/i.test(l));
  const evidence = [
    `Review apps: ${reviews.length ? reviews.map((r) => r.name).join(", ") : "none detected"}`,
    `Rating markup (aggregateRating): ${rating ? "yes" : "no"}`,
    `Review/testimonial text visible: ${reviewText ? "yes" : "no"}`,
    `Contact details on home page: ${[email && "email", phone && "phone"].filter(Boolean).join(", ") || "none"}`,
    `About/brand story page linked: ${about ? "yes" : "no"}`,
  ];
  const hasProof = reviews.length > 0 || rating || reviewText;
  const signals = [hasProof, email || phone, about].filter(Boolean).length;
  return makeCheck(def, {
    status: signals === 3 ? "pass" : !hasProof && !(email || phone) ? "fail" : "warn",
    severity: !hasProof ? "high" : "medium",
    confidence: "medium",
    summary: hasProof
      ? signals === 3
        ? "Reviews, contact details and brand information are visible. (Presence doesn't prove authenticity.)"
        : "Social proof is present, but some trust signals are missing."
      : "No customer reviews or ratings were found — shoppers rely heavily on them.",
    evidence,
    recommendations: [
      ...(!hasProof ? ["Install a review app (e.g. Judge.me, Okendo, Loox) and request reviews after delivery."] : []),
      ...(!(email || phone) ? ["Show a support email/phone in the footer."] : []),
      ...(!about ? ["Add an About page with your brand story, team and location."] : []),
    ],
  });
}

export function returnsPolicy(ctx: ScanContext): CheckResult {
  const def = { id: 7, key: "returns-policy", title: "Returns and refund policy", category: C, impact: 7 };
  const refund = ctx.policies.refund;
  const linked = ctx.home.$("footer a, a")
    .map((_, el) => ctx.home.$(el).attr("href") || "")
    .get()
    .some((h) => /refund|return/i.test(h));
  const text = refund?.text || "";
  const windowMatch = text.match(/\b(\d{1,3})[- ]days?\b/i);
  const exchanges = /exchange/i.test(text);
  const cancel = /cancel/i.test(text);
  const evidence = [
    `Refund policy: ${refund ? `published (${text.length} chars)` : "not found at /policies/refund-policy"}`,
    `Linked from home page/footer: ${linked ? "yes" : "no"}`,
    `Return window stated: ${windowMatch ? `${windowMatch[1]} days` : "not found"}`,
    `Mentions exchanges: ${exchanges ? "yes" : "no"} · cancellations: ${cancel ? "yes" : "no"}`,
  ];
  const status = !refund || text.length < 150 ? "fail" : !linked || !windowMatch ? "warn" : "pass";
  return makeCheck(def, {
    status,
    severity: status === "fail" ? "high" : "medium",
    summary:
      status === "pass"
        ? "A clear refund policy with a return window is published and linked."
        : status === "fail"
          ? "No usable refund/returns policy was found."
          : "A refund policy exists but is hard to find or missing key details.",
    evidence,
    recommendations: [
      ...(status === "fail" ? ["Settings → Policies → create a Refund policy (return window, condition, who pays shipping, refund timing)."] : []),
      ...(!linked ? ["Link the Returns/Refund policy in the footer menu."] : []),
      ...(!windowMatch && refund ? ['State the return window explicitly, e.g. "30 days from delivery".'] : []),
      ...(!exchanges && refund ? ["Explain how exchanges work."] : []),
    ],
  });
}

