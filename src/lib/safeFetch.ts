import { lookup } from "node:dns/promises";
import net from "node:net";

const USER_AGENT =
  "Mozilla/5.0 (compatible; ShopifyXRay/0.1; +https://shopify-xray.local)";

function isPrivateIp(ip: string): boolean {
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

async function assertPublicHost(hostname: string) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Private addresses are not allowed");
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Private hosts are not allowed");
  }
  const records = await lookup(hostname, { all: true });
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error("Private addresses are not allowed");
  }
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: string;
  elapsedMs: number;
  redirectChain: string[];
}

export async function safeFetch(
  input: string | URL,
  { timeoutMs = 15000, maxRedirects = 5, maxBytes = 5_000_000 } = {}
): Promise<FetchResult> {
  let current = typeof input === "string" ? new URL(input) : input;
  const redirectChain: string[] = [];
  const start = Date.now();

  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicHost(current.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current);
        redirectChain.push(next.toString());
        current = next;
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
          if (total > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return {
        status: res.status,
        finalUrl: current.toString(),
        headers: res.headers,
        body,
        elapsedMs: Date.now() - start,
        redirectChain,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}
