import { runScan } from "@/lib/scan";
import type { ScanEvent } from "@/lib/scan/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "Please enter a store URL" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ScanEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const result = await runScan(url as string, (step, percent) => send({ type: "progress", step, percent }));
        send({ type: "result", result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scan failed";
        send({ type: "error", error: `Couldn't scan this store: ${message}` });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
