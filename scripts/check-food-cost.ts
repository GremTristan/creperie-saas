import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findInventoryMatch } from "./data/inventory-aliases";
import { menus } from "./data/menus";
import {
  MOLARD_HERO_RECIPES,
  lineCost,
  specForInventoryName,
  stockQtyFromPortion,
} from "../lib/molard-heroes";
import { buildDishCostRow, buildIngredientVariance, recipeFoodCost } from "../lib/food-cost-math";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

interface MolardRow {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "data/molard-inventory.json"), "utf8")) as MolardRow[];
const molardMenu = menus.find((m) => m.siteSlug === "molard");
assert(molardMenu, "Molard menu present");

assert(MOLARD_HERO_RECIPES.length === 15, "exactly 15 tête de gondole dishes");

const menuNames = new Set(molardMenu!.items.map((i) => i.name));
for (const recipe of MOLARD_HERO_RECIPES) {
  assert(menuNames.has(recipe.name), `${recipe.name} is on the printed Molard menu`);
}

const complete = MOLARD_HERO_RECIPES.find((r) => r.name === "Complète jambon ou chorizo")!;
assert(
  complete.lines.every((l) => l.ingredient !== "Chorizo"),
  "Complète is costed as the jambon variant, not jambon+chorizo"
);

const candidates = catalog.map((row, i) => ({ id: String(i), name: row.name, unit: row.unit, unitPrice: row.unitPrice }));

for (const recipe of MOLARD_HERO_RECIPES) {
  const printed = molardMenu!.items.find((i) => i.name === recipe.name)!;
  const lines = recipe.lines.map((line) => {
    const match = findInventoryMatch(line.ingredient, candidates);
    assert(match, `${recipe.name}: ${line.ingredient} matches Molard inventory`);
    const spec = specForInventoryName(match!.name);
    assert(spec, `${match!.name} has a unit spec`);
    const qty = stockQtyFromPortion(line.portion, spec!);
    assert(qty !== null && qty > 0, `${recipe.name}: ${line.ingredient} converts to a stock quantity`);
    const cost = lineCost(spec!, match!.unitPrice, line.portion);
    assert(cost !== null && cost > 0, `${recipe.name}: ${line.ingredient} has a purchase price`);
    return {
      inventoryItemId: match!.id,
      inventoryName: match!.name,
      quantity: qty!,
      unitPrice: match!.unitPrice,
    };
  });
  const row = buildDishCostRow({
    menuItemId: recipe.name,
    name: recipe.name,
    price: printed.price,
    lines,
    soldQty: 2,
  });
  assert(row.hero, `${recipe.name} is marked tête de gondole`);
  assert(row.cost !== null && row.cost > 0, `${recipe.name} is costed`);
  assert(row.cost! < printed.price, `${recipe.name} cost ${row.cost} < price ${printed.price}`);
  assert(row.soldFoodCost === recipeFoodCost(lines)! * 2, `${recipe.name} scales with quantity sold`);
}

const nutella = MOLARD_HERO_RECIPES.find((r) => r.name === "Nutella")!;
const nutellaMatch = findInventoryMatch("Nutella", candidates)!;
const nutellaCost = lineCost(specForInventoryName(nutellaMatch.name)!, nutellaMatch.unitPrice, nutella.lines[0].portion)!;
assert(nutellaCost > 0.2 && nutellaCost < 0.6, `Nutella 40g costs ~0.35 CHF, got ${nutellaCost}`);

const uncosted = molardMenu!.items.filter((i) => !MOLARD_HERO_RECIPES.some((r) => r.name === i.name));
assert(uncosted.length > 15, "the rest of the Molard card is non chiffré");
const fake = buildDishCostRow({
  menuItemId: "x",
  name: uncosted[0].name,
  price: uncosted[0].price,
  lines: [{ inventoryItemId: "1", inventoryName: "Gruyère AOP râpé", quantity: 0.01, unitPrice: 14.6 }],
  soldQty: 1,
});
assert(fake.cost === null && !fake.hero, `${uncosted[0].name} stays non chiffré even with a recipe line`);

const variance = buildIngredientVariance({
  inventoryItemId: "ham",
  name: "Jambon Prestige",
  unit: "kg",
  currentQty: 23.5,
  theoreticalQty: 0.5,
  countDeltas: [
    { delta: -0.2, createdAt: new Date("2026-01-10T10:00:00Z") },
    { delta: 0.1, createdAt: new Date("2026-01-20T10:00:00Z") },
  ],
});
assert(variance.countDelta === -0.1, "count deltas sum to the observed gap");
assert(variance.lastCountAt?.toISOString() === "2026-01-20T10:00:00.000Z", "last count is the later one");
assert(buildIngredientVariance({ ...variance, countDeltas: [], theoreticalQty: 0.5, currentQty: 24, inventoryItemId: "ham", name: "Jambon Prestige", unit: "kg" }).countDelta === null, "no count → no écart");

console.log(`food-cost harness OK — ${MOLARD_HERO_RECIPES.length} Molard dishes costed, ${uncosted.length} non chiffrés`);
