import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { canUse } from "@/lib/billing/plans";
import { capture } from "@/lib/capture";
import { captureKey } from "@/lib/capture-keys";
import { db } from "@/lib/db/client";
import { orderItems, orders } from "@/lib/db/schema";
import { todayPeriod } from "@/lib/dates";
import { consumeStock } from "@/lib/inventory-store";
import { getIngredientsForMenuItems, getMenuItems } from "@/lib/menu-store";
import { getTenantById } from "@/lib/tenant-store";
import type { Order, OrderItem, OrderKind, OrderStatus, PaymentMethod, SiteId } from "@/types";

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    orderId: row.orderId,
    menuItemId: row.menuItemId,
    name: row.name,
    unitPrice: Number(row.unitPrice),
    quantity: row.quantity,
    status: row.status,
    note: row.note,
  };
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    number: row.number,
    serviceDate: row.serviceDate,
    kind: row.kind,
    tableLabel: row.tableLabel,
    status: row.status,
    note: row.note,
    total: Number(row.total),
    paymentMethod: row.paymentMethod,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    sentAt: iso(row.sentAt),
    readyAt: iso(row.readyAt),
    servedAt: iso(row.servedAt),
    paidAt: iso(row.paidAt),
    items,
  };
}

async function attachItems(rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.id)));
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of itemRows) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(toOrderItem(item));
    byOrder.set(item.orderId, list);
  }
  return rows.map((row) => toOrder(row, byOrder.get(row.id) ?? []));
}

export const ACTIVE_STATUSES: OrderStatus[] = ["open", "sent", "ready", "served"];

export async function getOrder(tenantId: string, orderId: string): Promise<Order | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return undefined;
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  const [order] = await attachItems(rows);
  return order;
}

// Everything not yet paid/cancelled — the waiter's live board.
export async function getActiveOrders(siteId: SiteId): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.siteId, siteId), inArray(orders.status, ACTIVE_STATUSES)))
    .orderBy(asc(orders.createdAt));
  return attachItems(rows);
}

// Kitchen queue: sent (to prepare) and ready (waiting for pickup).
export async function getKitchenQueue(siteId: SiteId): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.siteId, siteId), inArray(orders.status, ["sent", "ready"])))
    .orderBy(asc(orders.sentAt));
  return attachItems(rows);
}

export async function getOrdersForDay(siteId: SiteId, day: string): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.siteId, siteId), eq(orders.serviceDate, day)))
    .orderBy(desc(orders.createdAt));
  return attachItems(rows);
}

export async function getPaidOrdersForTenant(tenantId: string, fromDay: string, toDay: string): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, "paid"),
        gte(orders.serviceDate, fromDay),
        lte(orders.serviceDate, toDay)
      )
    )
    .orderBy(asc(orders.serviceDate));
  return attachItems(rows);
}

export interface NewOrderLine {
  menuItemId: string;
  quantity: number;
  note?: string;
}

async function nextOrderNumber(siteId: SiteId, serviceDate: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${orders.number}), 0)` })
    .from(orders)
    .where(and(eq(orders.siteId, siteId), eq(orders.serviceDate, serviceDate)));
  return Number(row?.max ?? 0) + 1;
}

// Creates an order from the waiter's cart and (by default) sends it to the
// kitchen in the same step: one tap, no intermediate screen. Idempotent on
// clientId so an offline replay never creates a duplicate ticket.
export async function createOrder(input: {
  tenantId: string;
  siteId: SiteId;
  userId: string;
  kind: OrderKind;
  tableLabel: string | null;
  note: string | null;
  lines: NewOrderLine[];
  clientId: string | null;
}): Promise<Order> {
  if (input.clientId) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.siteId, input.siteId), eq(orders.clientId, input.clientId)));
    if (existing) {
      const [order] = await attachItems([existing]);
      return order;
    }
  }

  const menu = await getMenuItems(input.siteId);
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const lines = input.lines
    .map((line) => ({ ...line, menu: menuById.get(line.menuItemId) }))
    .filter((line): line is typeof line & { menu: NonNullable<typeof line.menu> } => Boolean(line.menu) && line.quantity > 0);
  if (lines.length === 0) throw new Error("Commande vide");

  const total = lines.reduce((sum, l) => sum + l.menu.price * l.quantity, 0);
  const serviceDate = todayPeriod();
  const now = new Date();

  const [row] = await db
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      number: await nextOrderNumber(input.siteId, serviceDate),
      serviceDate,
      kind: input.kind,
      tableLabel: input.tableLabel,
      status: "sent",
      note: input.note,
      total: total.toFixed(2),
      createdByUserId: input.userId,
      createdAt: now,
      sentAt: now,
      clientId: input.clientId,
    })
    .returning();

  await db.insert(orderItems).values(
    lines.map((l) => ({
      orderId: row.id,
      menuItemId: l.menu.id,
      name: l.menu.name,
      unitPrice: l.menu.price.toFixed(2),
      quantity: l.quantity,
      note: l.note ?? null,
    }))
  );

  await consumeForLines(input, row.id, lines.map((l) => ({ menuItemId: l.menu.id, quantity: l.quantity })));

  await capture({
    tenantId: input.tenantId,
    siteId: input.siteId,
    occurredAt: now,
    type: "order.created",
    source: "native",
    orderId: row.id,
    payload: { number: row.number, kind: row.kind, total },
    idempotencyKey: captureKey(input.tenantId, "order.created", row.id, now.toISOString()),
  });
  await capture({
    tenantId: input.tenantId,
    siteId: input.siteId,
    occurredAt: now,
    type: "order.sent",
    source: "native",
    orderId: row.id,
    payload: { number: row.number },
    idempotencyKey: captureKey(input.tenantId, "order.sent", row.id, now.toISOString()),
  });

  const [order] = await attachItems([row]);
  return order;
}

async function consumeForLines(
  ctx: { tenantId: string; siteId: SiteId; userId: string },
  orderId: string,
  lines: { menuItemId: string; quantity: number }[]
) {
  const tenant = await getTenantById(ctx.tenantId);
  if (!tenant || !canUse(tenant, "recipes")) return;
  const recipes = await getIngredientsForMenuItems(lines.map((l) => l.menuItemId));
  if (recipes.length === 0) return;
  const totals = new Map<string, number>();
  for (const line of lines) {
    for (const r of recipes.filter((r) => r.menuItemId === line.menuItemId)) {
      totals.set(r.inventoryItemId, (totals.get(r.inventoryItemId) ?? 0) + r.quantity * line.quantity);
    }
  }
  await consumeStock(
    { tenantId: ctx.tenantId, siteId: ctx.siteId, orderId, userId: ctx.userId },
    Array.from(totals.entries()).map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }))
  );
}

// Adds lines to an unpaid order (a table orders dessert later). The order
// goes back to "sent" so the kitchen sees the new items.
export async function appendOrderLines(input: {
  tenantId: string;
  siteId: SiteId;
  userId: string;
  orderId: string;
  lines: NewOrderLine[];
}): Promise<Order> {
  const order = await getOrder(input.tenantId, input.orderId);
  if (!order || order.siteId !== input.siteId) throw new Error("Commande introuvable");
  if (order.status === "paid" || order.status === "cancelled") throw new Error("Commande clôturée");

  const menu = await getMenuItems(input.siteId);
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const lines = input.lines
    .map((line) => ({ ...line, menu: menuById.get(line.menuItemId) }))
    .filter((line): line is typeof line & { menu: NonNullable<typeof line.menu> } => Boolean(line.menu) && line.quantity > 0);
  if (lines.length === 0) return order;

  await db.insert(orderItems).values(
    lines.map((l) => ({
      orderId: order.id,
      menuItemId: l.menu.id,
      name: l.menu.name,
      unitPrice: l.menu.price.toFixed(2),
      quantity: l.quantity,
      note: l.note ?? null,
    }))
  );
  const added = lines.reduce((sum, l) => sum + l.menu.price * l.quantity, 0);
  await db
    .update(orders)
    .set({ total: (order.total + added).toFixed(2), status: "sent", sentAt: new Date(), readyAt: null })
    .where(eq(orders.id, order.id));

  await consumeForLines(input, order.id, lines.map((l) => ({ menuItemId: l.menu.id, quantity: l.quantity })));

  const occurredAt = new Date();
  await capture({
    tenantId: input.tenantId,
    siteId: input.siteId,
    occurredAt,
    type: "order.appended",
    source: "native",
    orderId: order.id,
    payload: { added, lineCount: lines.length },
    idempotencyKey: captureKey(input.tenantId, "order.appended", order.id, occurredAt.toISOString()),
  });

  return (await getOrder(input.tenantId, order.id))!;
}

export async function markOrderReady(tenantId: string, siteId: SiteId, orderId: string): Promise<void> {
  await db
    .update(orderItems)
    .set({ status: "ready" })
    .where(eq(orderItems.orderId, orderId));
  const [updated] = await db
    .update(orders)
    .set({ status: "ready", readyAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.siteId, siteId), eq(orders.status, "sent")))
    .returning();
  if (updated?.readyAt) {
    await capture({
      tenantId,
      siteId,
      occurredAt: updated.readyAt,
      type: "order.ready",
      source: "native",
      orderId,
      payload: {},
      idempotencyKey: captureKey(tenantId, "order.ready", orderId, updated.readyAt.toISOString()),
    });
  }
}

// Kitchen "un-ready" (tapped by mistake) — back to the queue.
export async function markOrderPreparing(tenantId: string, siteId: SiteId, orderId: string): Promise<void> {
  const [updated] = await db
    .update(orders)
    .set({ status: "sent", readyAt: null })
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.siteId, siteId), eq(orders.status, "ready")))
    .returning();
  if (updated) {
    const occurredAt = new Date();
    await capture({
      tenantId,
      siteId,
      occurredAt,
      type: "order.sent",
      source: "native",
      orderId,
      payload: { unready: true },
      idempotencyKey: captureKey(tenantId, "order.sent", orderId, occurredAt.toISOString()),
    });
  }
}

export async function markOrderServed(tenantId: string, siteId: SiteId, orderId: string): Promise<void> {
  const [updated] = await db
    .update(orders)
    .set({ status: "served", servedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.siteId, siteId), inArray(orders.status, ["sent", "ready"])))
    .returning();
  if (updated?.servedAt) {
    await capture({
      tenantId,
      siteId,
      occurredAt: updated.servedAt,
      type: "order.served",
      source: "native",
      orderId,
      payload: {},
      idempotencyKey: captureKey(tenantId, "order.served", orderId, updated.servedAt.toISOString()),
    });
  }
}

export async function payOrder(input: {
  tenantId: string;
  siteId: SiteId;
  orderId: string;
  method: PaymentMethod;
  userId: string;
}): Promise<Order | undefined> {
  const [updated] = await db
    .update(orders)
    .set({ status: "paid", paidAt: new Date(), paymentMethod: input.method, paidByUserId: input.userId })
    .where(
      and(
        eq(orders.id, input.orderId),
        eq(orders.tenantId, input.tenantId),
        eq(orders.siteId, input.siteId),
        inArray(orders.status, ACTIVE_STATUSES)
      )
    )
    .returning();
  if (updated?.paidAt) {
    await capture({
      tenantId: input.tenantId,
      siteId: input.siteId,
      occurredAt: updated.paidAt,
      type: "order.paid",
      source: "native",
      orderId: input.orderId,
      payload: { paymentMethod: input.method },
      idempotencyKey: captureKey(input.tenantId, "order.paid", input.orderId, updated.paidAt.toISOString()),
    });
  }
  return getOrder(input.tenantId, input.orderId);
}

export async function cancelOrder(tenantId: string, siteId: SiteId, orderId: string): Promise<void> {
  const [updated] = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.siteId, siteId), inArray(orders.status, ACTIVE_STATUSES)))
    .returning();
  if (updated) {
    const occurredAt = new Date();
    await capture({
      tenantId,
      siteId,
      occurredAt,
      type: "order.cancelled",
      source: "native",
      orderId,
      payload: {},
      idempotencyKey: captureKey(tenantId, "order.cancelled", orderId, "cancelled"),
    });
  }
}

export { summarizePaid, type DayTotals } from "@/lib/order-store-shared";
