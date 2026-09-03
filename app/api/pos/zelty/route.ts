import { NextResponse } from "next/server";
import { ingestZeltyPayload } from "@/lib/pos/ingest";

function authorized(request: Request): boolean {
  const secret = process.env.ZELTY_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const custom = request.headers.get("x-webhook-secret") ?? request.headers.get("x-zelty-token") ?? "";
  return bearer === secret || custom === secret;
}

// Zelty → TicketNormalized → capture_events. No native till writes.
export async function POST(request: Request) {
  if (!process.env.ZELTY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Zelty webhook not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await ingestZeltyPayload(body);
    return NextResponse.json({
      ok: true,
      accepted: result.accepted,
      skipped: result.skipped,
      unknownRestaurant: result.unknownRestaurant,
    });
  } catch (error) {
    console.error("[zelty webhook]", error);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
