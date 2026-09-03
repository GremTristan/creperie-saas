import {
  costForStockQuantity,
  isMolardHeroDish,
  roundQty,
  specForInventoryName,
} from "@/lib/molard-heroes";

export interface RecipeCostLine {
  inventoryItemId: string;
  inventoryName: string;
  quantity: number;
  unitPrice: number;
}

export interface DishCostInput {
  menuItemId: string;
  name: string;
  price: number;
  lines: RecipeCostLine[];
  soldQty: number;
}

export interface DishCostRow {
  menuItemId: string;
  name: string;
  price: number;
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
  soldQty: number;
  soldRevenue: number;
  soldFoodCost: number | null;
  hero: boolean;
}

export interface IngredientVarianceInput {
  inventoryItemId: string;
  name: string;
  unit: string;
  currentQty: number;
  theoreticalQty: number;
  countDeltas: { delta: number; createdAt: Date }[];
}

export interface IngredientVarianceRow {
  inventoryItemId: string;
  name: string;
  unit: string;
  theoreticalQty: number;
  currentQty: number;
  countDelta: number | null;
  lastCountAt: Date | null;
}

export function recipeFoodCost(lines: RecipeCostLine[]): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    const spec = specForInventoryName(line.inventoryName);
    if (!spec || !(line.unitPrice > 0) || !(line.quantity > 0)) return null;
    const cost = costForStockQuantity(spec, line.unitPrice, line.quantity);
    if (cost === null) return null;
    total += cost;
  }
  return roundQty(total, 4);
}

export function buildDishCostRow(dish: DishCostInput): DishCostRow {
  const hero = isMolardHeroDish(dish.name);
  const cost = hero ? recipeFoodCost(dish.lines) : null;
  const margin = cost === null ? null : roundQty(dish.price - cost, 4);
  const marginPct = cost === null || dish.price <= 0 ? null : roundQty((margin! / dish.price) * 100, 1);
  const soldFoodCost = cost === null ? null : roundQty(cost * dish.soldQty, 4);
  return {
    menuItemId: dish.menuItemId,
    name: dish.name,
    price: dish.price,
    cost,
    margin,
    marginPct,
    soldQty: dish.soldQty,
    soldRevenue: roundQty(dish.price * dish.soldQty, 4),
    soldFoodCost,
    hero,
  };
}

export function buildIngredientVariance(item: IngredientVarianceInput): IngredientVarianceRow {
  const last = item.countDeltas.length
    ? [...item.countDeltas].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!
    : null;
  const countDelta =
    item.countDeltas.length === 0 ? null : roundQty(item.countDeltas.reduce((s, m) => s + m.delta, 0), 4);
  return {
    inventoryItemId: item.inventoryItemId,
    name: item.name,
    unit: item.unit,
    theoreticalQty: roundQty(item.theoreticalQty, 4),
    currentQty: item.currentQty,
    countDelta,
    lastCountAt: last?.createdAt ?? null,
  };
}
