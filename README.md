# Shopify X-Ray

Paste a Shopify store URL and get a 25-point storefront audit. Every check returns a **status, evidence, severity, urgency, confidence and recommended action**. Issues are ranked by priority (severity × impact × confidence) and grouped by urgency (**Fix now / Fix this week / Plan for later**), with the top 3 pinned.

| Category | Checks |
| --- | --- |
| A. Storefront & conversion | 01 Mobile experience · 02 Product page completeness · 03 Add-to-cart usability · 04 Pricing clarity · 05 Shipping transparency · 06 Trust & social proof · 07 Returns & refund policy |
| B. Performance & technical | 08 Page loading (LCP/CLS/INP) · 09 Image optimization · 10 Broken links & assets · 11 HTTPS & security signals · 12 Accessibility basics |
| C. SEO & discoverability | 13 Titles & meta · 14 Canonicals & indexing · 15 Sitemap & robots.txt · 16 Structured data · 17 Product & collection discoverability |
| D. Customer experience | 18 Contact access · 19 Self-service · 20 Order tracking · 21 Returns/exchanges self-service · 22 Customer question coverage |
| E. Ecommerce intelligence | 23 App & tech footprint · 24 Catalog quality · 25 AI automation opportunity score |

## How it gathers evidence

- **Static fetches** – home page, `/products.json`, `/collections.json`, up to 3 product + 2 collection pages, policies, contact/FAQ/tracking/returns pages, robots.txt, sitemap.xml, link/asset status, TLS certificate.
- **Headless Chromium (Playwright)** – mobile (390px) and desktop renders: overflow, tiny text, tap targets, mobile nav, LCP/CLS, failed requests, mixed content, image weight/format, axe-core accessibility rules, keyboard Tab walk, and a real add-to-cart click in a throwaway session (checkout requests are blocked).
- **PageSpeed Insights (optional)** – set `PAGESPEED_API_KEY` to add Lighthouse scores and real-user (CrUX) LCP/CLS/INP.

All outbound requests (server and browser) are restricted to public hosts.

## Run locally

```bash
npm install
npx playwright install --with-deps chromium   # once
npm run dev                                    # http://localhost:3000
```

API: `POST /api/scan` with `{ "url": "yourstore.com" }` → NDJSON stream of `{type:"progress"}` events and a final `{type:"result"}`.

Env vars: `PAGESPEED_API_KEY` (optional), `MAX_BROWSER_SCANS` (default 2), `DISABLE_BROWSER=1` (static-only mode), `CHROMIUM_PATH` (custom Chromium).

## Deploy

Browser checks need a long-running Node server with Chromium (Render, Railway, Fly.io, a VPS…), not serverless. A `Dockerfile` based on the official Playwright image is included:

```bash
docker build -t shopify-xray . && docker run -p 3000:3000 -e PAGESPEED_API_KEY=... shopify-xray
```

## Code layout

- `src/lib/scan/context.ts` – gathers all evidence
- `src/lib/scan/browser.ts` – Playwright probes (mobile, desktop, product/add-to-cart)
- `src/lib/scan/checks/*.ts` – the 25 checks, one function each
- `src/lib/scan/tech.ts` – app/technology signatures
- `src/lib/scan/index.ts` – runs checks, scoring, urgency grouping
- `src/components/Report.tsx` – report UI
