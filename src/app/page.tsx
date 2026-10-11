"use client";

import { useState } from "react";
import type { Category, Issue, ScanResult, Severity } from "@/lib/types";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-500";
  return "text-red-600";
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative h-36 w-36">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} strokeWidth="10" className="fill-none stroke-slate-200" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={`fill-none stroke-current transition-all duration-700 ${scoreColor(score)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-xs text-slate-500">/ 100</span>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1 ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}

function TopIssueCard({ issue, rank }: { issue: Issue; rank: number }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {rank}
        </span>
        <SeverityBadge severity={issue.severity} />
        <span className="text-xs text-slate-500">{issue.category}</span>
      </div>
      <h3 className="mb-2 text-lg font-semibold text-slate-900">{issue.title}</h3>
      <p className="mb-3 text-sm text-slate-600">{issue.description}</p>
      {issue.evidence && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{issue.evidence}</p>
      )}
      <div className="mt-auto">
        <p className="mb-1 text-sm font-semibold text-slate-900">How to fix</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {issue.fix.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <SeverityBadge severity={issue.severity} />
        <span className="flex-1 text-sm font-medium text-slate-900">{issue.title}</span>
        <span className="hidden text-xs text-slate-500 sm:inline">{issue.category}</span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 text-sm text-slate-700">
          <p>{issue.description}</p>
          {issue.evidence && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs">{issue.evidence}</p>
          )}
          <ol className="list-decimal space-y-1 pl-5">
            {issue.fix.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <section className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-emerald-500 px-4 pb-24 pt-16 text-white">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-indigo-100">Shopify X-Ray</p>
          <h1 className="mb-4 text-4xl font-bold sm:text-5xl">See what&apos;s holding your store back</h1>
          <p className="mb-8 text-lg text-indigo-100">
            Paste your Shopify store URL. We&apos;ll scan your storefront and tell you the 3 fixes that matter most.
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

      <div className="mx-auto -mt-16 max-w-5xl px-4 pb-16">
        {loading && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-lg">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="text-slate-600">X-raying your storefront… this takes a few seconds.</p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-lg">{error}</div>
        )}

        {result && <Report result={result} />}

        {!loading && !error && !result && (
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["SEO", "Titles, meta descriptions, headings, structured data, sitemap."],
              ["Speed", "Server response, page weight, app scripts, lazy images."],
              ["Trust", "HTTPS, policies, contact info, accessibility basics."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl bg-white p-6 shadow-lg">
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

function Report({ result }: { result: ScanResult }) {
  const categories = Object.entries(result.categoryScores) as [Category, number][];
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white p-6 shadow-lg sm:flex-row">
        <ScoreRing score={result.score} />
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-2xl font-bold text-slate-900">{result.storeName}</h2>
          <a href={result.finalUrl} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
            {result.finalUrl}
          </a>
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs sm:justify-start">
            <span
              className={`rounded-full px-2 py-1 font-medium ${
                result.isShopify ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              {result.isShopify ? "Shopify detected" : "Shopify not detected"}
            </span>
            {result.theme && (
              <span className="rounded-full bg-indigo-100 px-2 py-1 font-medium text-indigo-800">Theme: {result.theme}</span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
              {result.issues.length} issues · {result.passed.length} checks passed
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Response" value={`${result.stats.responseTimeMs} ms`} />
            <Stat label="HTML size" value={`${result.stats.htmlSizeKb} KB`} />
            <Stat label="Scripts" value={`${result.stats.scripts} (${result.stats.thirdPartyScripts} 3rd-party)`} />
            <Stat label="Images" value={`${result.stats.images}`} />
          </div>
        </div>
        <div className="w-full space-y-2 sm:w-56">
          {categories.map(([cat, s]) => (
            <div key={cat}>
              <div className="flex justify-between text-xs text-slate-600">
                <span>{cat}</span>
                <span className={`font-semibold ${scoreColor(s)}`}>{s}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100">
                <div
                  className={`h-1.5 rounded-full ${s >= 80 ? "bg-emerald-500" : s >= 50 ? "bg-amber-400" : "bg-red-500"}`}
                  style={{ width: `${s}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-xl font-bold text-slate-900">Fix these 3 first</h2>
        <p className="mb-4 text-sm text-slate-600">Ranked by severity × business impact.</p>
        {result.topIssues.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {result.topIssues.map((issue, i) => (
              <TopIssueCard key={issue.id} issue={issue} rank={i + 1} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-50 p-6 text-emerald-800">No issues found — great job!</div>
        )}
      </section>

      {result.issues.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold text-slate-900">All issues ({result.issues.length})</h2>
          <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {result.issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold text-slate-900">Passed checks ({result.passed.length})</h2>
        <div className="flex flex-wrap gap-2">
          {result.passed.map((p) => (
            <span key={p.id} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200">
              ✓ {p.title}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
