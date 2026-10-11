"use client";

import { useState } from "react";
import Report from "@/components/Report";
import type { ScanEvent, ScanResult } from "@/lib/scan/types";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ step: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ step: "Starting scan", percent: 2 });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Scan failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ScanEvent;
          if (event.type === "progress") setProgress({ step: event.step, percent: event.percent });
          else if (event.type === "result") {
            setResult(event.result);
            finished = true;
          } else if (event.type === "error") throw new Error(event.error);
        }
      }
      if (!finished) throw new Error("Scan ended unexpectedly");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <main className="min-h-screen">
      <section className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-emerald-500 px-4 pb-24 pt-16 text-white">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-indigo-100">Shopify X-Ray</p>
          <h1 className="mb-4 text-4xl font-bold sm:text-5xl">See what&apos;s holding your store back</h1>
          <p className="mb-8 text-lg text-indigo-100">
            25 checks across conversion, speed, SEO, customer support and AI readiness — prioritized by urgency.
          </p>
          <form onSubmit={scan} className="mx-auto flex max-w-xl flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourstore.com or yourstore.myshopify.com"
              className="flex-1 rounded-xl px-4 py-3 text-slate-900 outline-none ring-4 ring-transparent focus:ring-indigo-300"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Scanning…" : "Scan store"}
            </button>
          </form>
        </div>
      </section>

      <div className="mx-auto -mt-16 max-w-6xl px-4 pb-16">
        {loading && progress && (
          <div className="rounded-2xl bg-white p-8 shadow-lg">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
              <p className="font-medium text-slate-800">{progress.step}…</p>
              <span className="ml-auto text-sm text-slate-500">{progress.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-3 text-sm text-slate-500">A full scan takes 30–60 seconds: we load your store in a real mobile and desktop browser.</p>
          </div>
        )}

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-lg">{error}</div>}

        {result && <Report result={result} />}

        {!loading && !error && !result && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Storefront & conversion", "Mobile UX, product pages, add-to-cart, pricing, shipping, trust, returns."],
              ["Performance & technical", "Core Web Vitals, images, broken links, HTTPS, accessibility."],
              ["SEO & discoverability", "Titles, canonicals, sitemap, structured data, product discovery."],
              ["Customer experience", "Contact, self-service, order tracking, returns flow, question coverage."],
              ["Ecommerce intelligence", "App footprint, catalog quality and your AI automation opportunity."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl bg-white p-5 shadow-lg">
                <h3 className="mb-1 font-semibold text-slate-900">{t}</h3>
                <p className="text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
