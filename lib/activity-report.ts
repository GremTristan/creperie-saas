import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { captureEvents } from "@/lib/db/schema";
import { getWasteMovementsForTenant } from "@/lib/inventory-store";
import { getOrderHeadersForTenant } from "@/lib/order-store";
import type { Order, Site, User } from "@/types";

export interface WaiterRevenue {
  userId: string;
  name: string;
  total: number;
  count: number;
}

export interface ActivityReport {
  from: string;
  to: string;
  kitchenSample: number;
  kitchenP50Ms: number | null;
  kitchenP90Ms: number | null;
  tableSample: number;
  tableP50Ms: number | null;
  tableP90Ms: number | null;
  byWaiter: WaiterRevenue[];
  cancelledCount: number;
  cancelledTotal: number;
  wasteCount: number;
  wasteQty: number;
  ticketCount: number;
  captureEventCount: number;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = ms / 60_000;
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${minutes.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} min`;
}

function msBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const delta = new Date(end).getTime() - new Date(start).getTime();
  return delta >= 0 ? delta : null;
}

function rangeBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${addDays(to, 1)}T00:00:00.000Z`),
  };
}

export function buildActivityReport(
  orders: Order[],
  waste: { siteId: string; delta: number; createdAt: Date }[],
  users: User[],
  captureEventCount: number
): Omit<ActivityReport, "from" | "to"> {
  const kitchen: number[] = [];
  const table: number[] = [];
  for (const order of orders) {
    const cook = msBetween(order.sentAt, order.readyAt);
    if (cook !== null) kitchen.push(cook);
    if (order.kind === "table") {
      const dwell = msBetween(order.sentAt, order.servedAt ?? order.paidAt);
      if (dwell !== null) table.push(dwell);
    }
  }
  kitchen.sort((a, b) => a - b);
  table.sort((a, b) => a - b);

  const names = new Map(users.map((u) => [u.id, u.name]));
  const byWaiterMap = new Map<string, WaiterRevenue>();
  for (const order of orders.filter((o) => o.status === "paid")) {
    const entry = byWaiterMap.get(order.createdByUserId) ?? {
      userId: order.createdByUserId,
      name: names.get(order.createdByUserId) ?? "Inconnu",
      total: 0,
      count: 0,
    };
    entry.total += order.total;
    entry.count += 1;
    byWaiterMap.set(order.createdByUserId, entry);
  }

  const cancelled = orders.filter((o) => o.status === "cancelled");

  return {
    kitchenSample: kitchen.length,
    kitchenP50Ms: percentile(kitchen, 0.5),
    kitchenP90Ms: percentile(kitchen, 0.9),
    tableSample: table.length,
    tableP50Ms: percentile(table, 0.5),
    tableP90Ms: percentile(table, 0.9),
    byWaiter: Array.from(byWaiterMap.values()).sort((a, b) => b.total - a.total),
    cancelledCount: cancelled.length,
    cancelledTotal: cancelled.reduce((s, o) => s + o.total, 0),
    wasteCount: waste.length,
    wasteQty: waste.reduce((s, w) => s + Math.abs(w.delta), 0),
    ticketCount: orders.length,
    captureEventCount,
  };
}

export async function activityReport(
  tenantId: string,
  sites: Site[],
  users: User[],
  from: string,
  to: string,
  siteId: string | null
): Promise<ActivityReport> {
  const siteIds = new Set((siteId ? sites.filter((s) => s.id === siteId) : sites).map((s) => s.id));
  const { start, end } = rangeBounds(from, to);
  const [headers, waste] = await Promise.all([
    getOrderHeadersForTenant(tenantId, from, to),
    getWasteMovementsForTenant(tenantId, start, end),
  ]);
  let captureRows: { id: string; siteId: string }[] = [];
  try {
    captureRows = await db
      .select({ id: captureEvents.id, siteId: captureEvents.siteId })
      .from(captureEvents)
      .where(and(eq(captureEvents.tenantId, tenantId), gte(captureEvents.occurredAt, start), lt(captureEvents.occurredAt, end)));
  } catch (error) {
    console.error("[activity] capture_events unavailable", error);
  }
  const orders = headers.filter((o) => siteIds.has(o.siteId));
  const wasteScoped = waste.filter((w) => siteIds.has(w.siteId));
  const captureEventCount = captureRows.filter((e) => siteIds.has(e.siteId)).length;
  return { from, to, ...buildActivityReport(orders, wasteScoped, users, captureEventCount) };
}
