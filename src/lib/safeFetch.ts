import { lookup } from "node:dns/promises";
import net from "node:net";

export const USER_AGENT =
  "Mozilla/5.0 (Linux; x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ShopifyXRay/0.2";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  );
}

export function normalizeUrl(input: string): URL {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http(s) URLs are supported");
  }
  if (url.username || url.password) throw new Error("Credentials in URL are not allowed");
  return url;
}

const hostCache = new Map<string, Promise<boolean>>();

export function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let cached = hostCache.get(host);
  if (!cached) {
    cached = (async () => {
      if (net.isIP(host)) return !isPrivateIp(host);
      if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
        return false;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const records = await lookup(host, { all: true });
          return records.length > 0 && !records.some((r) => isPrivateIp(r.address));
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
        }
      }
      hostCache.delete(host);
      return false;
    })();
    hostCache.set(host, cached);
    if (hostCache.size > 5000) hostCache.clear();
  }
  return cached;
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Private addresses are not allowed");
  if (["localhost"].includes(host) || /\.(local|internal|localhost)$/.test(host)) {
    throw new Error("Private hosts are not allowed");
  }
  if (!(await isPublicHost(host))) throw new Error(`Host ${host} is private or could not be resolved`);
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: string;
  elapsedMs: number;
  redirectChain: string[];
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  accept?: string;
}

export async function safeFetch(
  input: string | URL,
  { timeoutMs = 15000, maxRedirects = 5, maxBytes = 5_000_000, accept = "text/html,*/*" }: SafeFetchOptions = {}
): Promise<FetchResult> {
  let current = typeof input === "string" ? new URL(input) : input;
  const redirectChain: string[] = [];
  const start = Date.now();

  for (let i = 0; i <= maxRedirects; i++) {
    if (!["http:", "https:"].includes(current.protocol)) throw new Error("Unsupported redirect protocol");
    await assertPublicHost(current.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "en-US,en;q=0.9" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current);
        redirectChain.push(next.toString());
        current = next;
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          chunks.push(value);
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
      return {
        status: res.status,
        finalUrl: current.toString(),
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        elapsedMs: Date.now() - start,
        redirectChain,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

export async function tryFetch(url: string, opts: SafeFetchOptions = {}): Promise<FetchResult | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 10000, maxBytes: 2_000_000, ...opts });
    if (res.status !== 429) return res;
    await new Promise((r) => setTimeout(r, 2500));
    return await safeFetch(url, { timeoutMs: 10000, maxBytes: 2_000_000, ...opts });
  } catch {
    return null;
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
