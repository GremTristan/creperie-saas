import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { capture } from "@/lib/capture";
import { captureKey } from "@/lib/capture-keys";
import { db } from "@/lib/db/client";
import { inventoryItems, stockMovements, suppliers } from "@/lib/db/schema";
import type { CaptureEventType, Category, InventoryItem, Role, SiteId, StaffInventoryItem, Supplier, Zone } from "@/types";

type InventoryItemRow = typeof inventoryItems.$inferSelect;

// `numeric` columns come back as strings from the Postgres driver — cast to
// number here so every caller keeps working with the same InventoryItem shape.
function toInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    name: row.name,
    zone: row.zone,
    unit: row.unit,
    unitsPerPackage: row.unitsPerPackage,
    packageContentLabel: row.packageContentLabel ?? undefined,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    lowStockThreshold: row.lowStockThreshold === null ? null : Number(row.lowStockThreshold),
    supplierId: row.supplierId,
    visibleToManager: row.visibleToManager,
    visibleToServer: row.visibleToServer,
    category: row.category,
  };
}

// Strips purchase price + supplier for cooks/waiters. Enforced here (data
// layer) so no screen can accidentally leak costs to operational roles.
export function toStaffItem(item: InventoryItem): StaffInventoryItem {
  const rest: Omit<InventoryItem, "unitPrice" | "supplierId"> & Partial<Pick<InventoryItem, "unitPrice" | "supplierId">> = { ...item };
  delete rest.unitPrice;
  delete rest.supplierId;
  return rest;
}

export function isLowStock(item: Pick<InventoryItem, "quantity" | "lowStockThreshold">): boolean {
  return item.lowStockThreshold !== null && item.quantity <= item.lowStockThreshold;
}

// --- Suppliers (tenant scope) ---

export async function getSuppliers(tenantId: string): Promise<Supplier[]> {
  return db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId)).orderBy(suppliers.name);
}

export async function addSupplier(tenantId: string, name: string): Promise<Supplier> {
  const [supplier] = await db.insert(suppliers).values({ tenantId, name }).returning();
  return supplier;
}

export async function renameSupplier(tenantId: string, id: string, name: string): Promise<void> {
  await db
    .update(suppliers)
    .set({ name })
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
}

export async function deleteSupplier(tenantId: string, id: string): Promise<void> {
  await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
}

// --- Inventory reads ---

export async function getInventoryForTenant(tenantId: string): Promise<InventoryItem[]> {
  const rows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
  return rows.map(toInventoryItem);
}

export async function getInventoryBySite(siteId: SiteId): Promise<InventoryItem[]> {
  const rows = await db.select().from(inventoryItems).where(eq(inventoryItems.siteId, siteId)).orderBy(inventoryItems.name);
  return rows.map(toInventoryItem);
}

export async function getInventoryItem(tenantId: string, itemId: string): Promise<InventoryItem | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
  return row ? toInventoryItem(row) : undefined;
}

// Staff-facing read: role-visibility filter + cost stripping.
export async function getStaffInventoryBySite(siteId: SiteId, role: Role): Promise<StaffInventoryItem[]> {
  const items = await getInventoryBySite(siteId);
  const visible =
    role === "waiter" ? items.filter((i) => i.visibleToServer) : items.filter((i) => i.visibleToManager);
  return visible.map(toStaffItem);
}

export async function getLowStockItems(siteId: SiteId): Promise<InventoryItem[]> {
  const items = await getInventoryBySite(siteId);
  return items.filter(isLowStock);
}

// --- Inventory writes (always verify tenant ownership of the row) ---

export async function setItemSupplier(tenantId: string, itemId: string, supplierId: string | null): Promise<void> {
  await db
    .update(inventoryItems)
    .set({ supplierId })
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
}

export async function setItemVisibility(
  tenantId: string,
  itemId: string,
  visible: boolean,
  forRole: "cook" | "waiter"
): Promise<void> {
  const column = forRole === "waiter" ? { visibleToServer: visible } : { visibleToManager: visible };
  await db
    .update(inventoryItems)
    .set(column)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
}

export async function setItemCategory(tenantId: string, itemId: string, category: Category): Promise<void> {
  await db
    .update(inventoryItems)
    .set({ category })
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
}

export async function updateInventoryItem(
  tenantId: string,
  itemId: string,
  changes: { quantity?: number; unitPrice?: number; lowStockThreshold?: number | null; name?: string }
): Promise<void> {
  const values: Partial<typeof inventoryItems.$inferInsert> = {};
  if (changes.quantity !== undefined) values.quantity = changes.quantity.toString();
  if (changes.unitPrice !== undefined) values.unitPrice = changes.unitPrice.toString();
  if (changes.lowStockThreshold !== undefined) {
    values.lowStockThreshold = changes.lowStockThreshold === null ? null : changes.lowStockThreshold.toString();
  }
  if (changes.name !== undefined) values.name = changes.name;
  if (Object.keys(values).length === 0) return;
  await db
    .update(inventoryItems)
    .set(values)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
}

// Records a stock count/adjustment as a movement + updates the quantity.
export async function setItemQuantity(input: {
  tenantId: string;
  siteId: string;
  itemId: string;
  quantity: number;
  userId: string;
  reason: "count" | "adjust" | "waste";
}): Promise<void> {
  const current = await getInventoryItem(input.tenantId, input.itemId);
  if (!current || current.siteId !== input.siteId) throw new Error("Article introuvable");
  const delta = input.quantity - current.quantity;
  await db
    .update(inventoryItems)
    .set({ quantity: input.quantity.toString() })
    .where(eq(inventoryItems.id, input.itemId));
  if (delta !== 0) {
    const [movement] = await db
      .insert(stockMovements)
      .values({
        tenantId: input.tenantId,
        siteId: input.siteId,
        inventoryItemId: input.itemId,
        delta: delta.toString(),
        reason: input.reason,
        userId: input.userId,
      })
      .returning();
    const type = `stock.${input.reason}` as CaptureEventType;
    await capture({
      tenantId: input.tenantId,
      siteId: input.siteId,
      occurredAt: movement.createdAt,
      type,
      source: "native",
      inventoryItemId: input.itemId,
      payload: { delta, quantity: input.quantity },
      idempotencyKey: captureKey(input.tenantId, type, input.itemId, movement.createdAt.toISOString()),
    });
  }
}

// Atomic decrement used by the order flow (never below zero).
export async function consumeStock(
  input: { tenantId: string; siteId: string; orderId: string; userId: string },
  lines: { inventoryItemId: string; quantity: number }[]
): Promise<void> {
  if (lines.length === 0) return;
  const ids = lines.map((l) => l.inventoryItemId);
  const rows = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(inArray(inventoryItems.id, ids), eq(inventoryItems.siteId, input.siteId)));
  const allowed = new Set(rows.map((r) => r.id));

  for (const line of lines) {
    if (!allowed.has(line.inventoryItemId) || line.quantity <= 0) continue;
    await db
      .update(inventoryItems)
      .set({ quantity: sql`GREATEST(0, ${inventoryItems.quantity} - ${line.quantity.toString()}::numeric)` })
      .where(eq(inventoryItems.id, line.inventoryItemId));
    const [movement] = await db
      .insert(stockMovements)
      .values({
        tenantId: input.tenantId,
        siteId: input.siteId,
        inventoryItemId: line.inventoryItemId,
        delta: (-line.quantity).toString(),
        reason: "sale",
        orderId: input.orderId,
        userId: input.userId,
      })
      .returning();
    await capture({
      tenantId: input.tenantId,
      siteId: input.siteId,
      occurredAt: movement.createdAt,
      type: "stock.sale",
      source: "native",
      orderId: input.orderId,
      inventoryItemId: line.inventoryItemId,
      payload: { delta: -line.quantity, quantity: line.quantity },
      idempotencyKey: captureKey(input.tenantId, "stock.sale", line.inventoryItemId, movement.createdAt.toISOString()),
    });
  }
}

export async function getWasteMovementsForTenant(
  tenantId: string,
  from: Date,
  to: Date
): Promise<{ siteId: string; delta: number; createdAt: Date }[]> {
  const rows = await db
    .select({
      siteId: stockMovements.siteId,
      delta: stockMovements.delta,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.reason, "waste"),
        gte(stockMovements.createdAt, from),
        lt(stockMovements.createdAt, to)
      )
    );
  return rows.map((row) => ({ siteId: row.siteId, delta: Number(row.delta), createdAt: row.createdAt }));
}

export async function deleteInventoryItem(tenantId: string, itemId: string): Promise<void> {
  await db.delete(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
}

export async function addInventoryItem(item: {
  tenantId: string;
  siteId: SiteId;
  name: string;
  unit: string;
  unitsPerPackage: number;
  packageContentLabel?: string;
  category: Category;
  zone: Zone;
  quantity: number;
  unitPrice: number;
  lowStockThreshold?: number | null;
}): Promise<InventoryItem> {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      tenantId: item.tenantId,
      siteId: item.siteId,
      name: item.name,
      unit: item.unit,
      unitsPerPackage: item.unitsPerPackage,
      packageContentLabel: item.packageContentLabel,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      lowStockThreshold: item.lowStockThreshold == null ? null : item.lowStockThreshold.toString(),
      supplierId: null,
      visibleToManager: true,
      visibleToServer: item.category === "boissons",
      category: item.category,
      zone: item.zone,
    })
    .returning();
  return toInventoryItem(row);
}
