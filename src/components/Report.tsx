"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  URGENCY_LABELS,
  type CategoryId,
  type CheckResult,
  type ScanResult,
  type Severity,
  type Status,
  type Urgency,
} from "@/lib/scan/types";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

const STATUS_STYLES: Record<Status, { label: string; cls: string; icon: string }> = {
  fail: { label: "Fail", cls: "bg-red-600 text-white", icon: "✕" },
  warn: { label: "Warning", cls: "bg-amber-400 text-amber-950", icon: "!" },
  pass: { label: "Pass", cls: "bg-emerald-500 text-white", icon: "✓" },
  info: { label: "Info", cls: "bg-sky-500 text-white", icon: "i" },
  skipped: { label: "Skipped", cls: "bg-slate-300 text-slate-700", icon: "–" },
};

const URGENCY_STYLES: Record<Urgency, { col: string; badge: string }> = {
  now: { col: "border-red-200 bg-red-50", badge: "bg-red-600 text-white" },
  week: { col: "border-amber-200 bg-amber-50", badge: "bg-amber-500 text-white" },
  later: { col: "border-slate-200 bg-slate-50", badge: "bg-slate-500 text-white" },
};

export function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-500";
  return "text-red-600";
}

function barColor(score: number) {
  return score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-400" : "bg-red-500";
}

function ScoreRing({ score, size = 144, label = "/ 100" }: { score: number; size?: number; label?: string }) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} strokeWidth="10" className="fill-none stroke-slate-200" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (score / 100) * circ}
          className={`fill-none stroke-current transition-all duration-700 ${scoreColor(score)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${className}`}>{children}</span>;
}

function StatusIcon({ status }: { status: Status }) {
  const s = STATUS_STYLES[status];
  return (
    <span title={s.label} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.cls}`}>
      {s.icon}
    </span>
  );
}

function fmtMs(ms: number | null) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2" title={hint}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 text-sm text-slate-700`}>
      {items.map((t, i) => (
        <li key={i} className="break-words">
          {t}
        </li>
      ))}
    </Tag>
  );
}

function TopCard({ check, rank, onOpen }: { check: CheckResult; rank: number; onOpen: (id: number) => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{rank}</span>
        <Badge className={SEVERITY_STYLES[check.severity]}>{check.severity}</Badge>
        <Badge className={`${URGENCY_STYLES[check.urgency].badge} ring-transparent`}>{URGENCY_LABELS[check.urgency]}</Badge>
      </div>
      <p className="text-xs text-slate-500">
        #{String(check.id).padStart(2, "0")} · {CATEGORY_LABELS[check.category]}
      </p>
      <h3 className="mb-2 text-lg font-semibold text-slate-900">{check.title}</h3>
      <p className="mb-3 text-sm text-slate-600">{check.summary}</p>
      {check.evidence.length > 0 && (
        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-700">
          {check.evidence.slice(0, 3).map((e, i) => (
            <div key={i} className="break-words">
              {e}
            </div>
          ))}
        </div>
      )}
      {check.recommendations.length > 0 && (
        <div className="mt-auto">
          <p className="mb-1 text-sm font-semibold text-slate-900">Recommended action</p>
          <List items={check.recommendations.slice(0, 3)} ordered />
        </div>
      )}
      <button onClick={() => onOpen(check.id)} className="mt-3 self-start text-xs font-medium text-indigo-600 hover:underline">
        See full evidence →
      </button>
    </div>
  );
}

function CheckRow({ check, open, onToggle }: { check: CheckResult; open: boolean; onToggle: () => void }) {
  const actionable = check.status === "fail" || check.status === "warn";
  return (
    <li id={`check-${check.id}`} className="scroll-mt-24 border-b border-slate-100 last:border-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <StatusIcon status={check.status} />
        <span className="w-7 shrink-0 font-mono text-xs text-slate-400">{String(check.id).padStart(2, "0")}</span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-slate-900">{check.title}</span>
          <span className="block text-xs text-slate-500">{check.summary}</span>
        </span>
        <span className="hidden flex-wrap justify-end gap-1 sm:flex">
          {actionable && <Badge className={SEVERITY_STYLES[check.severity]}>{check.severity}</Badge>}
          {actionable && <Badge className={`${URGENCY_STYLES[check.urgency].badge} ring-transparent`}>{URGENCY_LABELS[check.urgency]}</Badge>}
        </span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="grid gap-4 px-4 pb-4 pl-14 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Evidence</p>
            {check.evidence.length ? <List items={check.evidence} /> : <p className="text-sm text-slate-500">No evidence collected.</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Recommended action</p>
            {check.recommendations.length ? <List items={check.recommendations} ordered /> : <p className="text-sm text-slate-500">Nothing to do.</p>}
            <p className="mt-3 text-xs text-slate-500">
              Severity: <b>{check.severity}</b> · Urgency: <b>{URGENCY_LABELS[check.urgency]}</b> · Confidence: <b>{check.confidence}</b> · Priority score: <b>{check.priority}</b>
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

export default function Report({ result }: { result: ScanResult }) {
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [catFilter, setCatFilter] = useState<CategoryId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "issues">("all");

  const issues = useMemo(() => result.checks.filter((c) => c.status === "fail" || c.status === "warn"), [result]);
  const byUrgency = useMemo(() => {
    const map: Record<Urgency, CheckResult[]> = { now: [], week: [], later: [] };
    for (const c of issues) map[c.urgency].push(c);
    for (const k of Object.keys(map) as Urgency[]) map[k].sort((a, b) => b.priority - a.priority);
    return map;
  }, [issues]);
  const visibleChecks = result.checks.filter(
    (c) => (catFilter === "all" || c.category === catFilter) && (statusFilter === "all" || c.status === "fail" || c.status === "warn")
  );
  const counts = {
    fail: result.checks.filter((c) => c.status === "fail").length,
    warn: result.checks.filter((c) => c.status === "warn").length,
    pass: result.checks.filter((c) => c.status === "pass").length,
  };

  const openCheck = (id: number) => {
    setCatFilter("all");
    setStatusFilter("all");
    setOpenIds((s) => new Set(s).add(id));
    setTimeout(() => document.getElementById(`check-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const toggle = (id: number) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const m = result.metrics;
  const techByType = result.tech.reduce<Record<string, typeof result.tech>>((acc, t) => {
    (acc[t.type] ||= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div className="grid gap-6 rounded-2xl bg-white p-6 shadow-lg lg:grid-cols-[auto_1fr_auto]">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={result.score} />
          <p className="text-xs text-slate-500">
            {counts.fail} fail · {counts.warn} warn · {counts.pass} pass
          </p>
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-900">{result.storeName}</h2>
          <a href={result.finalUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-600 hover:underline">
            {result.finalUrl}
          </a>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2 py-1 font-medium ${result.isShopify ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
              {result.isShopify ? "Shopify detected" : "Shopify not detected"}
            </span>
            {result.theme && <span className="rounded-full bg-indigo-100 px-2 py-1 font-medium text-indigo-800">Theme: {result.theme}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">Performance data: {m.metricsSource === "pagespeed" ? "Lighthouse + real users" : m.metricsSource === "browser" ? "headless Chrome lab" : "static only"}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="LCP (mobile)" value={fmtMs(m.lcpMs)} hint="Largest Contentful Paint — good ≤ 2.5s" />
            <Stat label="CLS" value={m.cls == null ? "—" : String(m.cls)} hint="Cumulative Layout Shift — good ≤ 0.1" />
            <Stat label="INP" value={m.inpMs == null ? "needs field data" : fmtMs(m.inpMs)} hint="Interaction to Next Paint — real-user data from PageSpeed" />
            <Stat label="Lighthouse" value={m.performanceScore == null ? "—" : `${m.performanceScore}/100`} />
            <Stat label="Products" value={m.productsInCatalog == null ? "—" : `${m.productsInCatalog}${m.productsInCatalog === 250 ? "+" : ""}`} />
            <Stat label="Collections" value={m.collections == null ? "—" : String(m.collections)} />
            <Stat label="Page weight" value={m.totalTransferKb == null ? "—" : `${m.totalTransferKb} KB`} />
            <Stat label="Requests" value={m.requests == null ? "—" : String(m.requests)} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(Object.keys(CATEGORY_LABELS) as CategoryId[]).map((cat) => (
              <div key={cat}>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{CATEGORY_LABELS[cat]}</span>
                  <span className={`font-semibold ${scoreColor(result.categoryScores[cat])}`}>{result.categoryScores[cat]}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100">
                  <div className={`h-1.5 rounded-full ${barColor(result.categoryScores[cat])}`} style={{ width: `${result.categoryScores[cat]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {result.mobileScreenshot && (
          <div className="hidden lg:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.mobileScreenshot} alt="Mobile rendering of the store" className="h-72 rounded-xl border-4 border-slate-800 object-cover object-top" />
            <p className="mt-1 text-center text-[11px] text-slate-500">Mobile render (390px)</p>
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-1 text-xl font-bold text-slate-900">Fix these 3 first</h2>
        <p className="mb-4 text-sm text-slate-600">Ranked by priority = severity × business impact × confidence.</p>
        {result.topIssues.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {result.topIssues.map((c, i) => (
              <TopCard key={c.id} check={c} rank={i + 1} onOpen={openCheck} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-50 p-6 text-emerald-800">No issues found — great job!</div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-bold text-slate-900">Action plan by urgency</h2>
        <p className="mb-4 text-sm text-slate-600">Every issue grouped by how soon it should be fixed, highest priority first.</p>
        <div className="grid gap-4 md:grid-cols-3">
          {(["now", "week", "later"] as Urgency[]).map((u) => (
            <div key={u} className={`rounded-2xl border p-4 ${URGENCY_STYLES[u].col}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">{URGENCY_LABELS[u]}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${URGENCY_STYLES[u].badge}`}>{byUrgency[u].length}</span>
              </div>
              {byUrgency[u].length ? (
                <ul className="space-y-2">
                  {byUrgency[u].map((c) => (
                    <li key={c.id}>
                      <button onClick={() => openCheck(c.id)} className="flex w-full items-start gap-2 rounded-lg bg-white p-2 text-left text-sm shadow-sm hover:ring-2 hover:ring-indigo-200">
                        <StatusIcon status={c.status} />
                        <span className="flex-1">
                          <span className="block font-medium text-slate-900">{c.title}</span>
                          <span className="text-xs text-slate-500">
                            {c.severity} severity · priority {c.priority}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Nothing here.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-lg">
          <div className="mb-4 flex items-center gap-4">
            <div className="rounded-full bg-white/95 p-1">
              <ScoreRing score={result.opportunity.score} size={96} label="/ 100" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-100">#25 AI automation opportunity</p>
              <h3 className="text-xl font-bold capitalize">{result.opportunity.level} opportunity</h3>
            </div>
          </div>
          <div className="space-y-3">
            {result.opportunity.workflows.map((w) => (
              <div key={w.key}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{w.label}</span>
                  <span className="font-semibold">{w.score}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/20">
                  <div className="h-1.5 rounded-full bg-white" style={{ width: `${w.score}%` }} />
                </div>
                {w.reasons.length > 0 && <p className="mt-1 text-xs text-indigo-100">{w.reasons.join(" · ")}</p>}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-indigo-200">{result.opportunity.disclaimer}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">#23 Visible technology footprint</p>
          <h3 className="mb-4 text-xl font-bold text-slate-900">{result.tech.length} technologies detected</h3>
          {result.tech.length ? (
            <div className="space-y-3">
              {Object.entries(techByType).map(([type, items]) => (
                <div key={type}>
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{type}</p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((t) => (
                      <span
                        key={t.name}
                        title={t.evidence}
                        className={`rounded-full px-3 py-1 text-xs ring-1 ${
                          t.confidence === "high" ? "bg-indigo-50 text-indigo-800 ring-indigo-200" : "bg-slate-50 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {t.name}
                        <span className="ml-1 text-[10px] opacity-70">{t.confidence}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No known apps identified from public scripts.</p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">All {result.checks.length} checks</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["all", ...Object.keys(CATEGORY_LABELS)] as (CategoryId | "all")[]).map((c) => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`rounded-full px-3 py-1 font-medium ${catFilter === c ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
              >
                {c === "all" ? "All" : CATEGORY_LABELS[c]}
              </button>
            ))}
            <button
              onClick={() => setStatusFilter(statusFilter === "all" ? "issues" : "all")}
              className={`rounded-full px-3 py-1 font-medium ${statusFilter === "issues" ? "bg-red-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
            >
              Issues only
            </button>
          </div>
        </div>
        <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {visibleChecks.map((c) => (
            <CheckRow key={c.id} check={c} open={openIds.has(c.id)} onToggle={() => toggle(c.id)} />
          ))}
          {!visibleChecks.length && <li className="p-4 text-sm text-slate-500">No checks match this filter.</li>}
        </ul>
      </section>

      <p className="text-xs text-slate-500">
        Scanned {result.sampledPages.length} pages in {(result.durationMs / 1000).toFixed(1)}s ·{" "}
        {result.capabilities.browser ? "browser tests on" : "browser tests unavailable"} ·{" "}
        {result.capabilities.pagespeed ? "PageSpeed Insights on" : "PageSpeed Insights off (add PAGESPEED_API_KEY for Lighthouse + INP)"} · {new Date(result.scannedAt).toLocaleString()}
      </p>
    </div>
  );
}
