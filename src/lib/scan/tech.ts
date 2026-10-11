import type { Confidence, TechDetection, TechType } from "./types";

interface Signature {
  name: string;
  type: TechType;
  patterns: RegExp[];
}

const SIGNATURES: Signature[] = [
  { name: "Judge.me", type: "reviews", patterns: [/judge\.me/i, /judgeme/i] },
  { name: "Yotpo", type: "reviews", patterns: [/yotpo/i] },
  { name: "Okendo", type: "reviews", patterns: [/okendo/i] },
  { name: "Loox", type: "reviews", patterns: [/loox\.io/i] },
  { name: "Stamped.io", type: "reviews", patterns: [/stamped\.io/i] },
  { name: "REVIEWS.io", type: "reviews", patterns: [/reviews\.io/i, /reviewsio/i] },
  { name: "Junip", type: "reviews", patterns: [/junip/i] },
  { name: "Trustpilot", type: "reviews", patterns: [/trustpilot/i] },
  { name: "Fera", type: "reviews", patterns: [/fera\.ai/i] },
  { name: "Shopify Product Reviews", type: "reviews", patterns: [/productreviews\.shopifycdn/i, /spr-badge/i] },
  { name: "Gorgias", type: "helpdesk", patterns: [/gorgias/i] },
  { name: "Zendesk", type: "helpdesk", patterns: [/zdassets\.com/i, /zendesk/i] },
  { name: "Freshdesk / Freshchat", type: "helpdesk", patterns: [/freshchat/i, /freshdesk/i, /freshworks/i] },
  { name: "Kustomer", type: "helpdesk", patterns: [/kustomer/i] },
  { name: "Gladly", type: "helpdesk", patterns: [/gladly/i] },
  { name: "Richpanel", type: "helpdesk", patterns: [/richpanel/i] },
  { name: "Re:amaze", type: "helpdesk", patterns: [/reamaze/i] },
  { name: "Help Scout", type: "helpdesk", patterns: [/helpscout/i, /beacon-v2/i] },
  { name: "eDesk", type: "helpdesk", patterns: [/edesk/i] },
  { name: "Intercom", type: "chat", patterns: [/intercom/i] },
  { name: "Tidio", type: "chat", patterns: [/tidio/i] },
  { name: "Shopify Inbox", type: "chat", patterns: [/shopify-chat/i, /shopify_chat/i, /inbox\.shopify/i] },
  { name: "Crisp", type: "chat", patterns: [/crisp\.chat/i] },
  { name: "LiveChat", type: "chat", patterns: [/livechatinc/i] },
  { name: "tawk.to", type: "chat", patterns: [/tawk\.to/i] },
  { name: "HubSpot", type: "chat", patterns: [/hs-scripts/i, /hubspot/i] },
  { name: "Zowie", type: "chat", patterns: [/zowie/i] },
  { name: "AfterShip Tracking", type: "tracking", patterns: [/aftership/i] },
  { name: "17TRACK", type: "tracking", patterns: [/17track/i] },
  { name: "Parcel Panel", type: "tracking", patterns: [/parcelpanel/i] },
  { name: "Route", type: "tracking", patterns: [/routeapp/i, /route\.com/i, /route-widget/i] },
  { name: "Malomo", type: "tracking", patterns: [/malomo/i] },
  { name: "Wonderment", type: "tracking", patterns: [/wonderment/i] },
  { name: "Narvar", type: "tracking", patterns: [/narvar/i] },
  { name: "Track123", type: "tracking", patterns: [/track123/i] },
  { name: "TrackingMore", type: "tracking", patterns: [/trackingmore/i] },
  { name: "Loop Returns", type: "returns", patterns: [/loopreturns/i, /loop-returns/i] },
  { name: "Return Prime", type: "returns", patterns: [/returnprime/i] },
  { name: "ReturnGO", type: "returns", patterns: [/returngo/i] },
  { name: "Redo", type: "returns", patterns: [/getredo/i, /redo\.com/i] },
  { name: "Happy Returns", type: "returns", patterns: [/happyreturns/i] },
  { name: "Rich Returns", type: "returns", patterns: [/richreturns/i, /richcommerce/i] },
  { name: "Returnly", type: "returns", patterns: [/returnly/i] },
  { name: "Google Analytics 4", type: "analytics", patterns: [/gtag\/js\?id=G-/i, /googletagmanager\.com\/gtag/i] },
  { name: "Google Tag Manager", type: "analytics", patterns: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]+/] },
  { name: "Meta Pixel", type: "analytics", patterns: [/connect\.facebook\.net/i, /fbq\(/] },
  { name: "TikTok Pixel", type: "analytics", patterns: [/analytics\.tiktok\.com/i] },
  { name: "Pinterest Tag", type: "analytics", patterns: [/s\.pinimg\.com\/ct/i, /pintrk/i] },
  { name: "Snap Pixel", type: "analytics", patterns: [/sc-static\.net/i] },
  { name: "Hotjar", type: "analytics", patterns: [/hotjar/i] },
  { name: "Microsoft Clarity", type: "analytics", patterns: [/clarity\.ms/i] },
  { name: "Triple Whale", type: "analytics", patterns: [/triplewhale/i, /triplepixel/i] },
  { name: "Elevar", type: "analytics", patterns: [/elevar/i] },
  { name: "Klaviyo", type: "marketing", patterns: [/klaviyo/i] },
  { name: "Attentive", type: "marketing", patterns: [/attn\.tv/i, /attentivemobile/i] },
  { name: "Postscript", type: "marketing", patterns: [/postscript\.io/i, /sdk\.postscript/i] },
  { name: "Omnisend", type: "marketing", patterns: [/omnisend/i] },
  { name: "Privy", type: "marketing", patterns: [/privy\.com/i, /widget\.privy/i] },
  { name: "Mailchimp", type: "marketing", patterns: [/chimpstatic/i, /mailchimp/i] },
  { name: "Justuno", type: "marketing", patterns: [/justuno/i] },
  { name: "Recharge", type: "subscriptions", patterns: [/rechargecdn/i, /rechargepayments/i, /rechargeapps/i] },
  { name: "Skio", type: "subscriptions", patterns: [/skio/i] },
  { name: "Appstle Subscriptions", type: "subscriptions", patterns: [/appstle/i] },
  { name: "Seal Subscriptions", type: "subscriptions", patterns: [/sealsubscriptions/i] },
  { name: "Rebuy", type: "search & merchandising", patterns: [/rebuyengine/i] },
  { name: "Nosto", type: "search & merchandising", patterns: [/nosto/i] },
  { name: "LimeSpot", type: "search & merchandising", patterns: [/limespot/i] },
  { name: "Searchanise", type: "search & merchandising", patterns: [/searchanise/i] },
  { name: "Boost Commerce", type: "search & merchandising", patterns: [/boostcommerce/i, /bc-sf-filter/i] },
  { name: "Klevu", type: "search & merchandising", patterns: [/klevu/i] },
  { name: "Algolia", type: "search & merchandising", patterns: [/algolia/i] },
  { name: "Shop Pay", type: "payments", patterns: [/shop-pay/i, /shopify-payment-button/i, /shop\.app/i] },
  { name: "Klarna", type: "payments", patterns: [/klarna/i] },
  { name: "Afterpay", type: "payments", patterns: [/afterpay/i] },
  { name: "Affirm", type: "payments", patterns: [/affirm\.com/i] },
  { name: "Sezzle", type: "payments", patterns: [/sezzle/i] },
];

export function detectTech(input: {
  html: string;
  scriptSrcs: string[];
  requestHosts: string[];
  theme: string | null;
}): TechDetection[] {
  const found: TechDetection[] = [];
  if (input.theme) {
    found.push({ name: input.theme, type: "theme", confidence: "high", evidence: "Shopify.theme object in page source" });
  }
  const strong = [...input.scriptSrcs, ...input.requestHosts].join("\n");
  for (const sig of SIGNATURES) {
    let confidence: Confidence | null = null;
    let evidence = "";
    for (const p of sig.patterns) {
      const strongMatch = strong.match(p);
      if (strongMatch) {
        confidence = "high";
        const line = [...input.scriptSrcs, ...input.requestHosts].find((s) => p.test(s)) || strongMatch[0];
        evidence = `Script/request: ${line.slice(0, 90)}`;
        break;
      }
    }
    if (!confidence) {
      for (const p of sig.patterns) {
        const m = input.html.match(p);
        if (m) {
          confidence = "medium";
          evidence = `Mentioned in page source: "${m[0]}"`;
          break;
        }
      }
    }
    if (confidence) found.push({ name: sig.name, type: sig.type, confidence, evidence });
  }
  return found;
}
