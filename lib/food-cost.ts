import "server-only";

import { addDays } from "@/lib/dates";
import { buildDishCostRow, buildIngredientVariance, type DishCostRow, type IngredientVarianceRow } from "@/lib/food-cost-math";
import { getInventoryBySite, getStockMovementsForTenant } from "@/lib/inventory-store";
import { getIngredientsForMenuItems, getMenuItems } from "@/lib/menu-store";
import { getSentOrdersWithItemsForTenant } from "@/lib/order-store";
import type { Site } from "@/types";

export interface FoodCostReport {
  from: string;
  to: string;
  siteId: string | null;
  costed: DishCostRow[];
  uncosted: { menuItemId: string; name: string; price: number }[];
  variance: IngredientVarianceRow[];
  soldFoodCost: number;
  soldRevenue: number;
}

function rangeBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${addDays(to, 1)}T00:00:00.000Z`),
  };
}

export async function foodCostReport(
  tenantId: string,
  sites: Site[],
  from: string,
  to: string,
  siteId: string | null
): Promise<FoodCostReport> {
  const scoped = siteId ? sites.filter((s) => s.id === siteId) : sites;
  const molard = scoped.filter((s) => s.slug === "molard");
  const target = molard.length > 0 ? molard : [];
  if (target.length === 0) {
    return { from, to, siteId, costed: [], uncosted: [], variance: [], soldFoodCost: 0, soldRevenue: 0 };
  }

  const { start, end } = rangeBounds(from, to);
  const [orders, movements] = await Promise.all([
    getSentOrdersWithItemsForTenant(tenantId, from, to),
    getStockMovementsForTenant(tenantId, start, end),
  ]);
  const siteIds = new Set(target.map((s) => s.id));
  const sent = orders.filter((o) => siteIds.has(o.siteId));

  const costed: DishCostRow[] = [];
  const uncosted: { menuItemId: string; name: string; price: number }[] = [];
  const theoretical = new Map<string, number>();
  const inventoryById = new Map<string, { name: string; unit: string; quantity: number }>();
  const heroInventoryIds = new Set<string>();

  for (const site of target) {
    const [menu, inventory] = await Promise.all([getMenuItems(site.id), getInventoryBySite(site.id)]);
    const ingredients = await getIngredientsForMenuItems(menu.map((m) => m.id));
    const invById = new Map(inventory.map((i) => [i.id, i]));
    for (const item of inventory) inventoryById.set(item.id, item);

    const soldByMenu = new Map<string, number>();
    for (const order of sent.filter((o) => o.siteId === site.id)) {
      for (const line of order.items) {
        if (!line.menuItemId) continue;
        soldByMenu.set(line.menuItemId, (soldByMenu.get(line.menuItemId) ?? 0) + line.quantity);
      }
    }

    for (const dish of menu) {
      const lines = ingredients
        .filter((l) => l.menuItemId === dish.id)
        .map((l) => {
          const inv = invById.get(l.inventoryItemId);
          return {
            inventoryItemId: l.inventoryItemId,
            inventoryName: inv?.name ?? "",
            quantity: l.quantity,
            unitPrice: inv?.unitPrice ?? 0,
          };
        });
      const row = buildDishCostRow({
        menuItemId: dish.id,
        name: dish.name,
        price: dish.price,
        lines,
        soldQty: soldByMenu.get(dish.id) ?? 0,
      });
      if (row.hero && row.cost !== null) {
        costed.push(row);
        for (const line of lines) {
          heroInventoryIds.add(line.inventoryItemId);
          const used = line.quantity * row.soldQty;
          theoretical.set(line.inventoryItemId, (theoretical.get(line.inventoryItemId) ?? 0) + used);
        }
      } else {
        uncosted.push({ menuItemId: dish.id, name: dish.name, price: dish.price });
      }
    }
  }

  const countsByItem = new Map<string, { delta: number; createdAt: Date }[]>();
  for (const movement of movements) {
    if (movement.reason !== "count" || !siteIds.has(movement.siteId)) continue;
    if (!heroInventoryIds.has(movement.inventoryItemId)) continue;
    const list = countsByItem.get(movement.inventoryItemId) ?? [];
    list.push({ delta: movement.delta, createdAt: movement.createdAt });
    countsByItem.set(movement.inventoryItemId, list);
  }

  const variance = Array.from(heroInventoryIds)
    .map((id) => {
      const item = inventoryById.get(id);
      if (!item) return null;
      return buildIngredientVariance({
        inventoryItemId: id,
        name: item.name,
        unit: item.unit,
        currentQty: item.quantity,
        theoreticalQty: theoretical.get(id) ?? 0,
        countDeltas: countsByItem.get(id) ?? [],
      });
    })
    .filter((row): row is IngredientVarianceRow => row !== null)
    .sort((a, b) => Math.abs(b.countDelta ?? 0) - Math.abs(a.countDelta ?? 0) || a.name.localeCompare(b.name, "fr"));

  costed.sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity) || a.name.localeCompare(b.name, "fr"));
  uncosted.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return {
    from,
    to,
    siteId,
    costed,
    uncosted,
    variance,
    soldFoodCost: costed.reduce((s, d) => s + (d.soldFoodCost ?? 0), 0),
    soldRevenue: costed.reduce((s, d) => s + d.soldRevenue, 0),
  };
}
