// 15 plats tête de gondole Molard.
// Ingrédients = carte imprimée (scripts/data/menus.ts).
// Portions = grammages / pièces standard galette, convertis à l’unité de
// l’inventaire Molard janvier 2026 (prix d’achat = feuille fournisseur).
// Complète : variante jambon (le « ou chorizo » n’est pas chiffré en plus).

export type Portion = { kind: "g"; value: number } | { kind: "ml"; value: number } | { kind: "pc"; value: number };

export interface InventoryUnitSpec {
  /** Grams represented by inventory.quantity += 1. Also the weight of one piece when stockIsPiece. */
  stockUnitGrams?: number;
  stockUnitMl?: number;
  stockIsPiece?: boolean;
  /** How unitPrice is quoted on the Molard sheet. */
  price: "kg" | "stock" | "piece" | "liter" | "inner";
  innerGrams?: number;
  innersPerStock?: number;
}

export interface HeroRecipeLine {
  ingredient: string;
  portion: Portion;
}

export interface HeroRecipe {
  name: string;
  lines: HeroRecipeLine[];
}

const g = (value: number): Portion => ({ kind: "g", value });
const ml = (value: number): Portion => ({ kind: "ml", value });
const pc = (value: number): Portion => ({ kind: "pc", value });

// Unit of inventory.quantity + how unitPrice is quoted. Names match the sheet.
export const MOLARD_UNIT_BY_INVENTORY_NAME: Record<string, InventoryUnitSpec> = {
  "Gruyère AOP râpé": { stockUnitGrams: 5000, price: "kg" },
  "Jambon Prestige": { stockUnitGrams: 1000, price: "kg" },
  "Œufs 63/73 import plein air": { stockIsPiece: true, price: "piece" },
  "Œufs 63/73 import": { stockIsPiece: true, price: "piece" },
  "Champignons de paris brun": { stockUnitGrams: 1000, price: "kg" },
  "Épinard en branches": { stockUnitGrams: 5000, price: "kg" },
  "Epinard en branche (surgelé)": { stockUnitGrams: 5000, price: "kg" },
  "Chèvre Bûche Saint Maure": { stockIsPiece: true, stockUnitGrams: 250, price: "piece" },
  "Miel de fleur": { stockUnitGrams: 2800, price: "stock" },
  // Sheet OCR « Pack de 1g » — walnuts are sold by the kilo at this price.
  "Cerneaux de noix cassés": { stockUnitGrams: 1000, price: "kg" },
  Roquette: { stockUnitGrams: 1000, price: "kg" },
  "Mozzarella Cossette 45%": { stockUnitGrams: 2500, price: "kg" },
  "Jambon de Parme": { stockUnitGrams: 1000, price: "kg" },
  "Salade feuilles de chènes": { stockUnitGrams: 1000, price: "kg" },
  "Sauce Tomate": { stockUnitGrams: 1000, price: "kg" },
  "Parmesan pointe AOP": { stockUnitGrams: 1000, price: "kg" },
  "Lardons fumés cru": { stockUnitGrams: 1200, price: "kg" },
  "oignons demi emincés": { stockUnitGrams: 1000, price: "kg" },
  "LRG crème": { stockUnitMl: 1000, price: "liter" },
  "Oignons Confit": { stockUnitGrams: 1000, price: "kg" },
  "Saucisson de Jussy IGP kg": { stockUnitGrams: 1000, price: "kg" },
  "Tomme GRTA 100gr": { stockIsPiece: true, stockUnitGrams: 100, price: "piece" },
  Cornichons: { stockUnitGrams: 2850, price: "stock" },
  "Saumon fumé (surgelé)": { stockUnitGrams: 10000, price: "kg" },
  "Câpres capucines": { stockUnitGrams: 810, price: "stock" },
  "Crème acidulée 15%": { stockUnitGrams: 450, price: "stock" },
  "Poulet Hallal": { stockUnitGrams: 1000, price: "kg" },
  "Tomates cerises cherry": { stockUnitGrams: 1000, price: "kg" },
  "Nutella pot de 750g": { stockUnitGrams: 9000, price: "inner", innerGrams: 750, innersPerStock: 12 },
  "Oranges a jus": { stockUnitGrams: 1000, price: "kg" },
  "Grand Marnier": { stockUnitMl: 700, price: "stock" },
};

export const MOLARD_HERO_RECIPES: HeroRecipe[] = [
  {
    name: "Complète jambon ou chorizo",
    lines: [
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Œuf", portion: pc(1) },
      { ingredient: "Jambon", portion: g(50) },
    ],
  },
  {
    name: "Jambon Gruyère AOP",
    lines: [
      { ingredient: "Jambon", portion: g(50) },
      { ingredient: "Gruyère AOP", portion: g(60) },
    ],
  },
  {
    name: "Jambon, Gruyère AOP et champignons",
    lines: [
      { ingredient: "Jambon", portion: g(50) },
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Champignons", portion: g(80) },
    ],
  },
  {
    name: "Jambon, Gruyère AOP et épinards",
    lines: [
      { ingredient: "Jambon", portion: g(50) },
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Épinards", portion: g(70) },
    ],
  },
  {
    name: "Bergère",
    lines: [
      { ingredient: "Fromage de chèvre", portion: g(80) },
      { ingredient: "Miel", portion: g(20) },
      { ingredient: "Noix", portion: g(15) },
      { ingredient: "Roquette", portion: g(20) },
    ],
  },
  {
    name: "Italienne",
    lines: [
      { ingredient: "Mozzarella", portion: g(80) },
      { ingredient: "Jambon de Parme", portion: g(40) },
      { ingredient: "Salade", portion: g(30) },
      { ingredient: "Sauce tomate au basilic", portion: g(40) },
      { ingredient: "Parmesan", portion: g(10) },
    ],
  },
  {
    name: "Forestière",
    lines: [
      { ingredient: "Champignons", portion: g(80) },
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Lardons", portion: g(50) },
      { ingredient: "Oignons crus", portion: g(30) },
    ],
  },
  {
    name: "Breizh",
    lines: [
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Œuf", portion: pc(1) },
      { ingredient: "Lardons", portion: g(50) },
      { ingredient: "Crème", portion: ml(40) },
      { ingredient: "Oignons confits", portion: g(30) },
    ],
  },
  {
    name: "Végétarienne",
    lines: [
      { ingredient: "Mozzarella", portion: g(80) },
      { ingredient: "Champignons", portion: g(80) },
      { ingredient: "Épinards", portion: g(70) },
      { ingredient: "Sauce tomate au basilic", portion: g(40) },
    ],
  },
  {
    name: "Genevoise",
    lines: [
      { ingredient: "Saucisse", portion: g(80) },
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Tomme genevoise", portion: pc(1) },
      { ingredient: "Oignons confits", portion: g(30) },
      { ingredient: "Cornichons", portion: g(20) },
    ],
  },
  {
    name: "Popeye",
    lines: [
      { ingredient: "Gruyère AOP", portion: g(60) },
      { ingredient: "Épinards", portion: g(70) },
      { ingredient: "Œuf", portion: pc(1) },
    ],
  },
  {
    name: "Saumon",
    lines: [
      { ingredient: "Saumon fumé", portion: g(50) },
      { ingredient: "Câpres", portion: g(10) },
      { ingredient: "Crème acidulée", portion: g(30) },
      { ingredient: "Oignons crus", portion: g(30) },
    ],
  },
  {
    name: "Pesto",
    lines: [
      { ingredient: "Émincé de poulet", portion: g(80) },
      { ingredient: "Mozzarella", portion: g(80) },
      { ingredient: "Tomates cerises confites", portion: g(40) },
    ],
  },
  {
    name: "Nutella",
    lines: [{ ingredient: "Nutella", portion: g(40) }],
  },
  {
    name: "La Suzette du Molard",
    lines: [
      { ingredient: "Zestes d'oranges", portion: g(20) },
      { ingredient: "Grand Marnier", portion: ml(20) },
    ],
  },
];

export const MOLARD_HERO_NAMES = new Set(MOLARD_HERO_RECIPES.map((r) => r.name));

export const MOLARD_HERO_BY_NAME = new Map(MOLARD_HERO_RECIPES.map((r) => [r.name, r]));

export function isMolardHeroDish(name: string): boolean {
  return MOLARD_HERO_NAMES.has(name);
}

export function roundQty(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function stockQtyFromPortion(portion: Portion, spec: InventoryUnitSpec): number | null {
  if (portion.kind === "pc") {
    if (spec.stockIsPiece) return roundQty(portion.value);
    return null;
  }
  if (portion.kind === "g") {
    if (spec.price === "inner" && spec.innerGrams && spec.innersPerStock) {
      return roundQty(portion.value / spec.innerGrams / spec.innersPerStock);
    }
    if (spec.stockIsPiece && spec.stockUnitGrams) {
      return roundQty(portion.value / spec.stockUnitGrams);
    }
    if (spec.stockUnitGrams) return roundQty(portion.value / spec.stockUnitGrams);
    return null;
  }
  if (spec.stockUnitMl) return roundQty(portion.value / spec.stockUnitMl);
  if (spec.stockUnitGrams) return roundQty(portion.value / spec.stockUnitGrams);
  return null;
}

export function costForStockQuantity(spec: InventoryUnitSpec, unitPrice: number, stockQty: number): number | null {
  if (!(unitPrice > 0) || !(stockQty > 0)) return null;
  switch (spec.price) {
    case "kg":
      return roundQty((stockQty * (spec.stockUnitGrams ?? 1000) / 1000) * unitPrice, 4);
    case "liter":
      return roundQty((stockQty * (spec.stockUnitMl ?? 1000) / 1000) * unitPrice, 4);
    case "piece":
    case "stock":
      return roundQty(stockQty * unitPrice, 4);
    case "inner":
      return roundQty(stockQty * (spec.innersPerStock ?? 1) * unitPrice, 4);
  }
}

export function specForInventoryName(name: string): InventoryUnitSpec | undefined {
  return MOLARD_UNIT_BY_INVENTORY_NAME[name];
}

export function lineCost(spec: InventoryUnitSpec, unitPrice: number, portion: Portion): number | null {
  const qty = stockQtyFromPortion(portion, spec);
  if (qty === null) return null;
  return costForStockQuantity(spec, unitPrice, qty);
}
