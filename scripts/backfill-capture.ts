// Reconstructs capture_events from orders + stock_movements.
// Safe to re-run: unique idempotency_key drops duplicates.
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { captureEvents, orders, stockMovements } from "@/lib/db/schema";
import { captureKey } from "@/lib/capture-keys";
import type { CaptureEventType } from "@/types";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const STOCK_TYPE: Record<string, CaptureEventType | null> = {
  sale: "stock.sale",
  count: "stock.count",
  waste: "stock.waste",
  adjust: "stock.adjust",
  import: null,
};

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is required");
  }
  const db = drizzle(neon(url));

  const orderRows = await db.select().from(orders);
  const movementRows = await db.select().from(stockMovements);

  const values: (typeof captureEvents.$inferInsert)[] = [];

  for (const row of orderRows) {
    const createdAt = row.createdAt;
    values.push({
      tenantId: row.tenantId,
      siteId: row.siteId,
      occurredAt: createdAt,
      type: "order.created",
      source: "backfill",
      orderId: row.id,
      payload: { number: row.number, kind: row.kind, total: row.total },
      idempotencyKey: captureKey(row.tenantId, "order.created", row.id, createdAt.toISOString()),
    });
    if (row.sentAt) {
      values.push({
        tenantId: row.tenantId,
        siteId: row.siteId,
        occurredAt: row.sentAt,
        type: "order.sent",
        source: "backfill",
        orderId: row.id,
        payload: { number: row.number },
        idempotencyKey: captureKey(row.tenantId, "order.sent", row.id, row.sentAt.toISOString()),
      });
    }
    if (row.readyAt) {
      values.push({
        tenantId: row.tenantId,
        siteId: row.siteId,
        occurredAt: row.readyAt,
        type: "order.ready",
        source: "backfill",
        orderId: row.id,
        payload: {},
        idempotencyKey: captureKey(row.tenantId, "order.ready", row.id, row.readyAt.toISOString()),
      });
    }
    if (row.servedAt) {
      values.push({
        tenantId: row.tenantId,
        siteId: row.siteId,
        occurredAt: row.servedAt,
        type: "order.served",
        source: "backfill",
        orderId: row.id,
        payload: {},
        idempotencyKey: captureKey(row.tenantId, "order.served", row.id, row.servedAt.toISOString()),
      });
    }
    if (row.paidAt) {
      values.push({
        tenantId: row.tenantId,
        siteId: row.siteId,
        occurredAt: row.paidAt,
        type: "order.paid",
        source: "backfill",
        orderId: row.id,
        payload: { paymentMethod: row.paymentMethod },
        idempotencyKey: captureKey(row.tenantId, "order.paid", row.id, row.paidAt.toISOString()),
      });
    }
    if (row.status === "cancelled") {
      const at = row.sentAt ?? row.createdAt;
      values.push({
        tenantId: row.tenantId,
        siteId: row.siteId,
        occurredAt: at,
        type: "order.cancelled",
        source: "backfill",
        orderId: row.id,
        payload: {},
        idempotencyKey: captureKey(row.tenantId, "order.cancelled", row.id, "cancelled"),
      });
    }
  }

  for (const row of movementRows) {
    const type = STOCK_TYPE[row.reason];
    if (!type) continue;
    values.push({
      tenantId: row.tenantId,
      siteId: row.siteId,
      occurredAt: row.createdAt,
      type,
      source: "backfill",
      orderId: row.orderId,
      inventoryItemId: row.inventoryItemId,
      payload: { delta: row.delta, reason: row.reason, movementId: row.id },
      idempotencyKey: captureKey(row.tenantId, type, row.inventoryItemId, row.createdAt.toISOString()),
    });
  }

  let inserted = 0;
  const chunk = 200;
  for (let i = 0; i < values.length; i += chunk) {
    const slice = values.slice(i, i + chunk);
    const result = await db.insert(captureEvents).values(slice).onConflictDoNothing({ target: captureEvents.idempotencyKey }).returning({ id: captureEvents.id });
    inserted += result.length;
  }

  console.log(`Backfill considered ${values.length} events, inserted ${inserted}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
