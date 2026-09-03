// Remplace la carte générique par les menus imprimés (BDF, Molard, Philosophes,
// Vieux-Carouge) et l’inventaire Molard de janvier 2026. Vevey et Hoshy
// n’ont pas de PDF : ils reprennent la carte BDF. Le stock chiffré n’est
// posé qu’à Molard ; les autres établissements reçoivent le même catalogue
// à quantité 0 (à compter sur place). Crée aussi le directeur et 2 collaborateurs
// par établissement (service + cuisine) s’ils manquent. Idempotent.
// Usage : npm run seed:chain
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { inventoryItems, menuItemIngredients, menuItems, sites, suppliers, tenants, users } from "../lib/db/schema";
import { findInventoryMatch } from "./data/inventory-aliases";
import { MOLARD_HERO_BY_NAME, MOLARD_HERO_RECIPES, specForInventoryName, stockQtyFromPortion } from "../lib/molard-heroes";
import type { MenuCategory, Category, Zone } from "../types";
import { menus, type MenuItemKind, type SourceMenuItem } from "./data/menus";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const TENANT_SLUG = "creperies-group";
const DIRECTOR_EMAIL = "julien.perret@creperies-group.ch";
const DIRECTOR_PASSWORD = "Creperie2026!";

const SITE_NAMES: Record<string, string> = {
  bdf: "Crêperie du Bourg-de-Four",
  carouge: "Crêperie du Vieux-Carouge",
  molard: "Crêperie du Molard",
  vevey: "Crêperie de Vevey",
  philosophe: "Crêperie des Philosophes",
  hoshy: "Hoshy",
};

const DIRECTOR_NAME = "Julien Perret";

// Two people per site (service + cuisine) so a fresh migrate + seed:chain
// is immediately usable on every tablet without a prior bootstrap script.
const STAFF_ROSTER: { name: string; role: "waiter" | "cook"; siteSlug: string; pin: string }[] = [
  { name: "Alice Dubois", role: "waiter", siteSlug: "bdf", pin: "5821" },
  { name: "Léa Moreau", role: "cook", siteSlug: "bdf", pin: "6394" },
  { name: "Marc Fontaine", role: "waiter", siteSlug: "carouge", pin: "4718" },
  { name: "Nabil Haddad", role: "cook", siteSlug: "carouge", pin: "8263" },
  { name: "Sophie Berger", role: "waiter", siteSlug: "molard", pin: "3947" },
  { name: "Chloé Rossier", role: "cook", siteSlug: "molard", pin: "7519" },
  { name: "Julien Rey", role: "waiter", siteSlug: "vevey", pin: "2684" },
  { name: "Hugo Currat", role: "cook", siteSlug: "vevey", pin: "9156" },
  { name: "Camille Bovet", role: "waiter", siteSlug: "philosophe", pin: "4072" },
  { name: "Inès Zbinden", role: "cook", siteSlug: "philosophe", pin: "6831" },
  { name: "Thomas Gay", role: "waiter", siteSlug: "hoshy", pin: "5290" },
  { name: "Maxime Ducret", role: "cook", siteSlug: "hoshy", pin: "1748" },
];

const STAFF_PINS: Record<string, string> = Object.fromEntries(STAFF_ROSTER.map((s) => [s.name, s.pin]));

const NO_AUTO_INGREDIENT = new Set([
  "1 boule",
  "2 boules",
  "3 boules",
  "Coupe Smiley",
  "Fanta ou Sprite",
  "Rivella rouge ou bleu",
  "Thé froid pêche ou citron",
  "Nectars ananas ou abricot",
]);

interface MolardRow {
  supplier: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

function round(n: number, digits = 4) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function kindToCategory(kind: MenuItemKind): MenuCategory {
  if (kind === "boisson") return "boisson";
  if (kind === "crepe_sucree" || kind === "glace") return "sucree";
  return "salee";
}

function guessCategory(name: string): Category {
  const lower = name.toLowerCase();
  const rules: [Category, string[]][] = [
    [
      "boissons",
      [
        "cidre",
        "vin ",
        "bière",
        "biere",
        "jus ",
        "café",
        "cafe",
        "cappuccino",
        "espresso",
        "renversé",
        "renverse",
        "thé",
        "soda",
        "sirop",
        "valser",
        "coca",
        "fanta",
        "sprite",
        "rivella",
        "prosecco",
        "proseco",
        "aperol",
        "apérol",
        "whisky",
        "rhum",
        "vodka",
        "gin",
        "pastis",
        "campari",
        "martini",
        "matini",
        "grand marnier",
        "calvados",
        "poirée",
        "fuse tea",
        "granini",
        "kinley",
        "romanette",
        "cristallo",
        "feld",
        "lambig",
      ],
    ],
    [
      "viande",
      ["jambon", "saumon", "thon", "viande", "poulet", "bœuf", "boeuf", "porc", "bresaola", "saucisse", "saucisson", "chorizo", "lardons", "magret", "cerf"],
    ],
    [
      "frais",
      [
        "lait",
        "crème",
        "creme",
        "œuf",
        "oeuf",
        "fromage",
        "beurre",
        "mozzarella",
        "mozzraella",
        "chèvre",
        "chevre",
        "tomme",
        "yaourt",
        "gruyère",
        "parmesan",
        "parmiggiano",
        "raclette",
        "reblochon",
        "cheddar",
        "bûchette",
      ],
    ],
    ["sucre", ["confiture", "nutella", "chocolat", "sucre", "miel", "caramel", "glace", "sorbet", "compote", "kinder", "smarties", "caotina", "pirulo"]],
  ];
  for (const [category, keywords] of rules) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return "sec";
}

function zoneFor(category: Category, name: string): Zone {
  if (category === "boissons") return "salle";
  if (/glace|sorbet|pirulo/i.test(name)) return "cuisine";
  return "cuisine";
}

function packagesFromUnit(unit: string): { unitsPerPackage: number; packageContentLabel: string | null } {
  const caisse = unit.match(/(\d+)\s*[x×*]/i);
  if (caisse) return { unitsPerPackage: Number(caisse[1]), packageContentLabel: unit };
  const pack = unit.match(/pack de (\d+)/i);
  if (pack) return { unitsPerPackage: Number(pack[1]), packageContentLabel: unit };
  const carton = unit.match(/carton de (\d+)/i);
  if (carton) return { unitsPerPackage: Number(carton[1]), packageContentLabel: unit };
  return { unitsPerPackage: 1, packageContentLabel: null };
}

function recipeQuantity(ingredientName: string, unit: string, kind: MenuItemKind): number {
  const n = ingredientName.toLowerCase();
  const u = unit.toLowerCase();
  if (kind === "boisson" || /cidre|coca|valser|bière|prosecco|proseco|jus |thé|café|aperol|hugo|rivella|fanta|sprite/.test(n)) {
    return 1;
  }
  if (/œuf|oeuf/.test(n)) return 1;
  if (/farine/.test(n)) return 0.004;
  if (/glace|sorbet/.test(n)) return 0.08;
  if (/\bkg\b|kilo/.test(u)) return 0.04;
  return 0.05;
}

function menuForSlug(slug: string): SourceMenuItem[] {
  const found = menus.find((m) => m.siteSlug === slug);
  if (found) return found.items;
  return menus.find((m) => m.siteSlug === "bdf")?.items ?? [];
}

function loadMolardInventory(): MolardRow[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "data/molard-inventory.json"), "utf8");
  return JSON.parse(raw) as MolardRow[];
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is required");
  const db = drizzle(neon(url));

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG));
  if (!tenant) throw new Error(`Tenant « ${TENANT_SLUG} » introuvable. Appliquez d’abord les migrations.`);

  await db
    .update(tenants)
    .set({
      name: "Crêperies Group",
      legalName: "Crêperies Group SA",
      legalAddress: "Rue du Rhône 12, 1204 Genève",
      billingEmail: DIRECTOR_EMAIL,
      brandColor: "#1f6f5c",
      currency: "CHF",
      status: "active",
      plan: "pro",
    })
    .where(eq(tenants.id, tenant.id));

  const catalog = loadMolardInventory();
  const chainSites = await db.select().from(sites).where(eq(sites.tenantId, tenant.id));
  const siteIds = chainSites.map((s) => s.id);
  if (siteIds.length === 0) throw new Error("Aucun établissement sur Crêperies Group.");

  for (const site of chainSites) {
    const name = SITE_NAMES[site.slug];
    if (name && name !== site.name) {
      await db.update(sites).set({ name }).where(eq(sites.id, site.id));
      site.name = name;
    }
  }

  const supplierNames = [...new Set(catalog.map((row) => row.supplier))];
  const supplierIds = new Map<string, string>();
  for (const name of supplierNames) {
    const [existing] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenant.id), eq(suppliers.name, name)));
    if (existing) {
      supplierIds.set(name, existing.id);
    } else {
      const [row] = await db.insert(suppliers).values({ tenantId: tenant.id, name }).returning();
      supplierIds.set(name, row.id);
    }
  }

  if (siteIds.length > 0) {
    await db.delete(menuItems).where(inArray(menuItems.siteId, siteIds));
    await db.delete(inventoryItems).where(inArray(inventoryItems.siteId, siteIds));
  }

  let recipeLinks = 0;
  let createdExtras = 0;

  for (const site of chainSites) {
    const isMolard = site.slug === "molard";
    const stockRows = catalog.map((row) => {
      const category = guessCategory(row.name);
      const zone = zoneFor(category, row.name);
      const pack = packagesFromUnit(row.unit);
      const quantity = isMolard ? row.quantity : 0;
      const threshold = isMolard && quantity > 0 ? round(Math.max(quantity * 0.2, quantity >= 10 ? 2 : 0.2), 3) : null;
      return {
        tenantId: tenant.id,
        siteId: site.id,
        name: row.name,
        unit: row.unit,
        unitsPerPackage: pack.unitsPerPackage,
        packageContentLabel: pack.packageContentLabel,
        quantity: quantity.toString(),
        unitPrice: row.unitPrice.toFixed(2),
        lowStockThreshold: threshold === null ? null : threshold.toString(),
        category,
        zone,
        visibleToManager: true,
        visibleToServer: zone === "salle",
        supplierId: supplierIds.get(row.supplier) ?? null,
      };
    });

    const insertedStock = await db.insert(inventoryItems).values(stockRows).returning({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit });
    const stockByName = insertedStock.map((row) => ({ id: row.id, name: row.name, unit: row.unit }));

    const card = menuForSlug(site.slug);
    const menuRows = card.map((item, index) => ({
      tenantId: tenant.id,
      siteId: site.id,
      name: item.name,
      price: item.price.toFixed(2),
      category: kindToCategory(item.kind),
      available: true,
      sortOrder: index,
    }));
    const insertedMenu = await db.insert(menuItems).values(menuRows).returning();

    const recipeValues: { menuItemId: string; inventoryItemId: string; quantity: string }[] = [];

    for (let i = 0; i < card.length; i++) {
      const source = card[i];
      const menuRow = insertedMenu[i];
      const hero = isMolard ? MOLARD_HERO_BY_NAME.get(source.name) : undefined;
      // Molard: only the 15 tête-de-gondole dishes get a costed recipe. The rest stay « non chiffré ».
      if (isMolard && !hero) continue;

      const lines = hero
        ? hero.lines.map((line) => ({ ingredientName: line.ingredient, portion: line.portion }))
        : (source.ingredients ?? (NO_AUTO_INGREDIENT.has(source.name) ? [] : [source.name])).map((ingredientName) => ({
            ingredientName,
            portion: null,
          }));
      const seen = new Set<string>();

      for (const line of lines) {
        let inventoryItem = findInventoryMatch(line.ingredientName, stockByName);
        if (!inventoryItem) {
          if (hero) {
            throw new Error(
              `Molard: ingrédient « ${line.ingredientName} » introuvable dans l’inventaire pour ${source.name}`
            );
          }
          const category = guessCategory(line.ingredientName);
          const zone = source.kind === "boisson" ? "salle" : zoneFor(category, line.ingredientName);
          const [created] = await db
            .insert(inventoryItems)
            .values({
              tenantId: tenant.id,
              siteId: site.id,
              name: line.ingredientName,
              unit: source.kind === "boisson" ? "unité" : "portion",
              unitsPerPackage: 1,
              quantity: "0",
              unitPrice: "0.00",
              lowStockThreshold: null,
              category,
              zone,
              visibleToManager: true,
              visibleToServer: zone === "salle",
              supplierId: null,
            })
            .returning({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit });
          inventoryItem = created;
          stockByName.push({ id: created.id, name: created.name, unit: created.unit });
          createdExtras++;
        }
        if (seen.has(inventoryItem.id)) continue;
        seen.add(inventoryItem.id);

        let quantity: number;
        if (hero && line.portion) {
          const spec = specForInventoryName(inventoryItem.name);
          const qty = spec ? stockQtyFromPortion(line.portion, spec) : null;
          if (qty === null) {
            throw new Error(
              `Molard: conversion impossible ${line.ingredientName} → ${inventoryItem.name} (${inventoryItem.unit})`
            );
          }
          quantity = qty;
        } else {
          quantity = recipeQuantity(line.ingredientName, inventoryItem.unit, source.kind);
        }
        recipeValues.push({
          menuItemId: menuRow.id,
          inventoryItemId: inventoryItem.id,
          quantity: quantity.toString(),
        });
      }
    }

    if (recipeValues.length > 0) {
      await db.insert(menuItemIngredients).values(recipeValues);
      recipeLinks += recipeValues.length;
    }
  }

  const directorPasswordHash = await bcrypt.hash(DIRECTOR_PASSWORD, 10);
  const [existingDirector] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.role, "director")));
  if (existingDirector) {
    await db
      .update(users)
      .set({
        name: DIRECTOR_NAME,
        email: DIRECTOR_EMAIL,
        passwordHash: directorPasswordHash,
        pinHash: null,
        siteId: null,
        failedAttempts: 0,
        lockedUntil: null,
        active: true,
      })
      .where(eq(users.id, existingDirector.id));
  } else {
    await db.insert(users).values({
      tenantId: tenant.id,
      name: DIRECTOR_NAME,
      role: "director",
      email: DIRECTOR_EMAIL,
      passwordHash: directorPasswordHash,
      siteId: null,
      active: true,
    });
  }

  const sitesBySlug = new Map(chainSites.map((s) => [s.slug, s]));
  for (const member of STAFF_ROSTER) {
    const site = sitesBySlug.get(member.siteSlug);
    if (!site) continue;
    const pinHash = await bcrypt.hash(member.pin, 10);
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.name, member.name)));
    if (existing) {
      await db
        .update(users)
        .set({
          role: member.role,
          siteId: site.id,
          pinHash,
          email: null,
          passwordHash: null,
          failedAttempts: 0,
          lockedUntil: null,
          active: true,
        })
        .where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({
        tenantId: tenant.id,
        name: member.name,
        role: member.role,
        siteId: site.id,
        pinHash,
        active: true,
      });
    }
  }

  const staff = await db.select().from(users).where(eq(users.tenantId, tenant.id));
  const refreshedSites = await db.select().from(sites).where(eq(sites.tenantId, tenant.id));
  console.log(`Chaîne ${tenant.name} alignée sur les cartes imprimées + inventaire Molard janv. 2026.`);
  console.log(`  ${catalog.length} articles de stock (quantités réelles à Molard seulement)`);
  console.log(`  ${recipeLinks} liaisons recette · ${createdExtras} articles créés pour matcher la carte (qté 0)`);
  console.log(`  Molard : ${MOLARD_HERO_RECIPES.length} plats tête de gondole chiffrés, le reste non chiffré`);
  console.log(`  Direction : ${DIRECTOR_EMAIL}  /  ${DIRECTOR_PASSWORD}`);
  console.log("  Tablettes :");
  for (const site of refreshedSites.sort((a, b) => a.name.localeCompare(b.name, "fr"))) {
    const people = staff.filter((u) => u.siteId === site.id);
    const pins = people
      .map((u) => `${u.name} ${STAFF_PINS[u.name] ?? "—"} (${u.role === "cook" ? "cuisine" : "service"})`)
      .join(" · ");
    const card = menuForSlug(site.slug);
    const note = menus.some((m) => m.siteSlug === site.slug) ? `${card.length} produits` : `${card.length} produits (carte BDF, pas de PDF)`;
    console.log(`    ${site.name.padEnd(32)} code ${site.deviceCode}  —  ${note}`);
    if (pins) console.log(`      ${pins}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
