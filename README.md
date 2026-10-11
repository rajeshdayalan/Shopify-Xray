# Shopify X-Ray

Paste a Shopify store URL and get a storefront audit: an overall score, per-category scores, every detected issue, and the **top 3 fixes ranked by priority** (severity × business impact) with step-by-step instructions.

## Checks (MVP)

| Category | Checks |
| --- | --- |
| SEO | Title, meta description, single H1, canonical, Open Graph, structured data, robots.txt, sitemap.xml |
| Performance | Server response time, HTML weight, third-party app scripts, render-blocking scripts, lazy-loaded images, image dimensions (CLS) |
| Accessibility | Image alt text, `lang` attribute, mobile viewport |
| Trust & Conversion | HTTPS, favicon, store policies (privacy/refund/terms/shipping), contact info |
| Shopify | Shopify detection, theme name, password-protected store |

## Getting started

```bash
npm install
npm run dev
# open http://localhost:3000
```

API: `POST /api/scan` with `{ "url": "yourstore.com" }`.

## Project layout

- `src/lib/scanner.ts` – fetches the storefront and runs all checks
- `src/lib/safeFetch.ts` – fetch with timeouts, size limits, redirect handling and private-IP (SSRF) blocking
- `src/app/api/scan/route.ts` – scan API route
- `src/app/page.tsx` – UI
