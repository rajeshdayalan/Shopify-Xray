import type { ScanContext } from "../context";
import type { CheckResult, TechDetection } from "../types";
import { hasAccountLink, hasSearch, makeCheck, shortUrl } from "./helpers";

const C = "cx" as const;

export function contactAccess(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 18, key: "contact", title: "Contact and support accessibility", category: C, impact: 7 };
  const contact = ctx.support.contact;
  const $ = ctx.home.$;
  const contactForm = !!contact && contact.$("form[action*='/contact'], form#ContactForm, form[id*='contact' i]").length > 0;
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const email = $("a[href^='mailto:']").length > 0 || emailRe.test(ctx.home.text) || (!!contact && emailRe.test(contact.text));
  const phone = $("a[href^='tel:']").length > 0 || (!!contact && contact.$("a[href^='tel:']").length > 0);
  const chat = tech.filter((t) => t.type === "chat" || t.type === "helpdesk");
  const linked = ctx.internalLinks.some((l) => /contact|support|help/i.test(l));
  const channels = [contactForm && "contact form", email && "email", phone && "phone", chat.length && `chat/helpdesk (${chat.map((c) => c.name).join(", ")})`].filter(Boolean);
  const evidence = [
    `Contact page: ${contact ? shortUrl(contact.url) : "not found"}`,
    `Support link in navigation/footer: ${linked ? "yes" : "no"}`,
    `Channels: ${channels.join(", ") || "none detected"}`,
  ];
  return makeCheck(def, {
    status: channels.length === 0 ? "fail" : channels.length === 1 || !linked ? "warn" : "pass",
    severity: channels.length === 0 ? "high" : "medium",
    summary: channels.length === 0 ? "Shoppers have no obvious way to contact you." : channels.length === 1 ? "Only one support channel is visible." : "Multiple support channels are easy to find.",
    evidence,
    recommendations: [
      ...(!contact ? ["Create a Contact page (Online Store → Pages → template page.contact)."] : []),
      ...(!linked ? ["Link Contact/Help in the header or footer menu."] : []),
      ...(channels.length < 2 ? ["Offer at least two channels: e.g. contact form + email or live chat."] : []),
    ],
  });
}

export function selfService(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 19, key: "self-service", title: "Self-service support readiness", category: C, impact: 7 };
  const faq = ctx.support.faq;
  const faqQuestions = faq ? (faq.text.match(/\?/g) || []).length : 0;
  const helpCenter = ctx.home.$("a[href*='help.'], a[href*='gorgias.help'], a[href*='zendesk.com/hc'], a[href*='/hc/'], a[href*='helpcenter']").length > 0;
  const tracking = !!ctx.support.tracking || tech.some((t) => t.type === "tracking");
  const search = hasSearch(ctx);
  const account = hasAccountLink(ctx);
  const evidence = [
    `FAQ page: ${faq ? `${shortUrl(faq.url)} (~${faqQuestions} questions)` : "not found"}`,
    `Help center: ${helpCenter ? "linked" : "not found"}`,
    `Order tracking link/page: ${tracking ? "yes" : "no"}`,
    `Customer account login: ${account ? "linked" : "not linked"}`,
    `Site search: ${search ? "yes" : "no"}`,
  ];
  const score = [faq && faqQuestions >= 5, helpCenter, tracking, account].filter(Boolean).length + (faq ? 0.5 : 0);
  return makeCheck(def, {
    status: score < 1 ? "fail" : score < 3 ? "warn" : "pass",
    severity: score < 1 ? "high" : "medium",
    summary: score < 1 ? "Customers can't help themselves — every question becomes a support ticket." : score < 3 ? "Some self-service resources exist, but gaps will drive avoidable tickets." : "Good self-service: FAQ/help, tracking and account access are available.",
    evidence,
    recommendations: [
      ...(!faq ? ["Create an FAQ page covering shipping, returns, sizing and order changes; link it in the footer."] : []),
      ...(!tracking ? ["Add an order-tracking page (e.g. AfterShip, Parcel Panel) linked in the header/footer."] : []),
      ...(!account ? ["Enable customer accounts so shoppers can see their orders."] : []),
    ],
  });
}

export function orderTracking(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 20, key: "tracking", title: "Order-tracking experience", category: C, impact: 7 };
  const apps = tech.filter((t) => t.type === "tracking");
  const page = ctx.support.tracking;
  const trackLinks = ctx.home.$("a[href]")
    .map((_, el) => ({ href: ctx.home.$(el).attr("href") || "", text: ctx.home.$(el).text().trim() }))
    .get()
    .filter((l) => /track|order[-_ ]status/i.test(l.href) || /track/i.test(l.text));
  const evidence = [
    `Tracking links on home page: ${trackLinks.length ? trackLinks.slice(0, 3).map((l) => `"${l.text || l.href}"`).join(", ") : "none"}`,
    `Tracking page: ${page ? shortUrl(page.url) : "not found"}`,
    `Tracking apps: ${apps.length ? apps.map((a) => `${a.name} (${a.confidence})`).join(", ") : "none detected"}`,
    "We only check what's publicly visible; we don't know the status of real orders.",
  ];
  const ok = trackLinks.length > 0 || !!page;
  return makeCheck(def, {
    status: ok && apps.length ? "pass" : ok || apps.length ? "warn" : "fail",
    severity: ok || apps.length ? "medium" : "high",
    confidence: "medium",
    summary: ok ? "Shoppers can find a way to track orders." : "No visible order-tracking page — expect lots of \"Where is my order?\" tickets.",
    evidence,
    recommendations: ok
      ? apps.length
        ? []
        : ["Use a branded tracking page app so tracking happens on your site (and shows recommendations)."]
      : ["Add a 'Track your order' page and link it in the header and order emails.", "Send proactive shipping notifications (Settings → Notifications)."],
  });
}

export function returnsSelfService(ctx: ScanContext, tech: TechDetection[]): CheckResult {
  const def = { id: 21, key: "returns-self-service", title: "Returns, exchanges and refund self-service", category: C, impact: 7 };
  const portals = tech.filter((t) => t.type === "returns");
  const policyText = ctx.policies.refund?.text || "";
  const allText = policyText + " " + (ctx.support.returns?.text || "") + " " + (ctx.support.faq?.text || "");
  const howTo = /(start|initiate|request|submit) (a |your )?(return|exchange|refund)|return(s)? (portal|center|centre)|contact us (at|via)|email us/i.test(allText);
  const exchange = /exchange/i.test(allText);
  const cancel = /cancel/i.test(allText);
  const refundTiming = /refund[^.]{0,80}(\d+\s*(business|working)?\s*days)/i.test(allText);
  const evidence = [
    `Returns portal: ${portals.length ? portals.map((p) => p.name).join(", ") : ctx.support.returns ? `page at ${shortUrl(ctx.support.returns.url)}` : "none detected"}`,
    `Explains how to start a return: ${howTo ? "yes" : "no"}`,
    `Exchanges explained: ${exchange ? "yes" : "no"} · Cancellations: ${cancel ? "yes" : "no"} · Refund timing: ${refundTiming ? "yes" : "no"}`,
  ];
  const coverage = [howTo, exchange, cancel, refundTiming].filter(Boolean).length;
  return makeCheck(def, {
    status: portals.length && coverage >= 2 ? "pass" : !policyText && !portals.length ? "fail" : "warn",
    severity: !policyText && !portals.length ? "high" : "medium",
    summary: portals.length ? "A self-service returns flow is available." : coverage >= 3 ? "Return steps are explained, but customers must contact support to start one." : "Customers can't easily see how to start a return, exchange or cancellation.",
    evidence,
    recommendations: [
      ...(!portals.length ? ["Add a self-service returns/exchanges portal so customers don't need to email support."] : []),
      ...(!howTo ? ["Spell out step-by-step how to start a return in the refund policy and FAQ."] : []),
      ...(!exchange ? ["Explain exchanges (encourage exchanges over refunds to keep revenue)."] : []),
      ...(!cancel ? ["State your order cancellation window."] : []),
    ],
  });
}

const TOPICS: { key: string; re: RegExp }[] = [
  { key: "Sizing / fit", re: /size (guide|chart)|sizing|fits? (true|small|large)|measurements?/i },
  { key: "Materials / ingredients", re: /material|fabric|ingredients?|made (of|from|with)|composition/i },
  { key: "Compatibility / specs", re: /compatib|dimensions?|specifications?|specs\b|works with/i },
  { key: "Shipping", re: /shipping|delivery/i },
  { key: "Returns", re: /returns?|exchange|refund/i },
  { key: "Care / product use", re: /care instructions|how to use|washing|wash |directions|usage/i },
];

export function questionCoverage(ctx: ScanContext): CheckResult {
  const def = { id: 22, key: "question-coverage", title: "Customer question coverage", category: C, impact: 6 };
  const text = [...ctx.products.map((p) => p.doc.text), ctx.support.faq?.text || ""].join(" ");
  const covered = TOPICS.filter((t) => t.re.test(text));
  const missing = TOPICS.filter((t) => !t.re.test(text));
  const evidence = [
    `Sources: ${ctx.products.length} product pages${ctx.support.faq ? " + FAQ" : ""}`,
    `Covered: ${covered.map((t) => t.key).join(", ") || "none"}`,
    `Not found: ${missing.map((t) => t.key).join(", ") || "none"}`,
  ];
  return makeCheck(def, {
    status: covered.length >= 5 ? "pass" : covered.length >= 3 ? "warn" : "fail",
    severity: covered.length >= 3 ? "low" : "medium",
    confidence: "medium",
    summary: `${covered.length} of ${TOPICS.length} common pre-purchase topics are answered on product pages or the FAQ.`,
    evidence,
    recommendations: missing.length
      ? [
          `Add answers about ${missing.map((t) => t.key.toLowerCase()).join(", ")} to product pages (collapsible tabs) or the FAQ — not every topic applies to every catalog.`,
          "Mine past support tickets for the top 10 pre-purchase questions and answer them on-page.",
        ]
      : [],
  });
}
