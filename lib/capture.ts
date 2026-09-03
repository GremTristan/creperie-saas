import "server-only";

import { db } from "@/lib/db/client";
import { captureEvents } from "@/lib/db/schema";
import type { CaptureEventType, CaptureSource } from "@/types";

export type CaptureEventInput = {
  tenantId: string;
  siteId: string;
  occurredAt: Date;
  type: CaptureEventType;
  source: CaptureSource;
  orderId?: string | null;
  inventoryItemId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
};

// Fire-and-forget append. Capture must never break POS / stock writes, so
// failures are logged and swallowed. Duplicate keys are ignored.
export async function capture(entry: CaptureEventInput): Promise<void> {
  try {
    await db
      .insert(captureEvents)
      .values({
        tenantId: entry.tenantId,
        siteId: entry.siteId,
        occurredAt: entry.occurredAt,
        type: entry.type,
        source: entry.source,
        orderId: entry.orderId ?? null,
        inventoryItemId: entry.inventoryItemId ?? null,
        payload: entry.payload ?? {},
        idempotencyKey: entry.idempotencyKey,
      })
      .onConflictDoNothing({ target: captureEvents.idempotencyKey });
  } catch (error) {
    console.error("[capture] failed to write event", entry.type, error);
  }
}
