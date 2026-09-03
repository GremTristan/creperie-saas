"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { hashSecret, isValidEmail, passwordProblem, pinProblem } from "@/lib/auth/password";
import { canUse, planOf, siteLimit } from "@/lib/billing/plans";
import { syncSeatCount } from "@/lib/billing/stripe";
import {
  addInventoryItem,
  addSupplier,
  deleteInventoryItem,
  deleteSupplier,
  getInventoryItem,
  setItemSupplier,
  setItemVisibility,
  updateInventoryItem,
} from "@/lib/inventory-store";
import {
  addMenuItem,
  deleteMenuItem,
  getMenuItem,
  propagateMenu,
  setIngredient,
  updateMenuItem,
} from "@/lib/menu-store";
import { destroySession, requireDirector } from "@/lib/session";
import {
  countSitesForTenant,
  createSite,
  deleteSite,
  getSiteForTenant,
  getSitesForTenant,
  renameSite,
  rotateDeviceCode,
  setSiteActive,
} from "@/lib/site-store";
import { deletePosBinding, upsertPosBinding } from "@/lib/pos/bindings";
import { updateTenant } from "@/lib/tenant-store";
import {
  createDirectorUser,
  createStaffUser,
  deleteStaffUser,
  getAuthUserByEmail,
  getUserById,
  moveUserToSite,
  renameUser,
  setUserActive,
  setUserPassword,
  setUserPin,
} from "@/lib/user-store";
import { CATEGORY_ORDER, MENU_CATEGORY_ORDER, STAFF_ROLES, type Category, type MenuCategory, type Role, type Zone } from "@/types";

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

const text = (v: FormDataEntryValue | null, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

async function ownSite(tenantId: string, siteId: string) {
  const site = await getSiteForTenant(tenantId, siteId);
  if (!site) throw new Error("Établissement introuvable");
  return site;
}

// ---------------------------------------------------------------- Menu

export async function addMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const siteId = text(formData.get("siteId"));
  const name = text(formData.get("name"));
  const price = num(formData.get("price"));
  const category = text(formData.get("category")) as MenuCategory;
  if (!name) return { error: "Indiquez le nom du produit." };
  if (!Number.isFinite(price) || price < 0) return { error: "Prix invalide." };
  if (!MENU_CATEGORY_ORDER.includes(category)) return { error: "Catégorie invalide." };
  await ownSite(tenant.id, siteId);
  const item = await addMenuItem({ tenantId: tenant.id, siteId, name, price, category });
  await audit({ tenantId: tenant.id, siteId, userId: user.id, action: "menu.add", targetType: "menu_item", targetId: item.id, details: { name, price } });
  revalidatePath("/direction/menu");
  return { ok: true, message: `« ${name} » ajouté` };
}

export async function updateMenuItemAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const item = await getMenuItem(tenant.id, id);
  if (!item) throw new Error("Produit introuvable");
  const changes: Parameters<typeof updateMenuItem>[2] = {};
  if (formData.has("name")) {
    const name = text(formData.get("name"));
    if (name) changes.name = name;
  }
  if (formData.has("price")) {
    const price = num(formData.get("price"));
    if (Number.isFinite(price) && price >= 0) changes.price = price;
  }
  if (formData.has("category")) {
    const category = text(formData.get("category")) as MenuCategory;
    if (MENU_CATEGORY_ORDER.includes(category)) changes.category = category;
  }
  if (formData.has("available")) changes.available = formData.get("available") === "true";
  await updateMenuItem(tenant.id, id, changes);
  if (changes.price !== undefined && changes.price !== item.price) {
    await audit({ tenantId: tenant.id, siteId: item.siteId, userId: user.id, action: "menu.price", targetType: "menu_item", targetId: id, details: { from: item.price, to: changes.price } });
  }
  revalidatePath("/direction/menu");
}

export async function deleteMenuItemAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const item = await getMenuItem(tenant.id, id);
  if (!item) return;
  await deleteMenuItem(tenant.id, id);
  await audit({ tenantId: tenant.id, siteId: item.siteId, userId: user.id, action: "menu.delete", targetType: "menu_item", targetId: id, details: { name: item.name } });
  revalidatePath("/direction/menu");
}

export async function propagateMenuAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const fromSiteId = text(formData.get("siteId"));
  await ownSite(tenant.id, fromSiteId);
  const targets = (await getSitesForTenant(tenant.id)).filter((s) => s.active && s.id !== fromSiteId).map((s) => s.id);
  const changed = await propagateMenu(tenant.id, fromSiteId, targets);
  await audit({ tenantId: tenant.id, siteId: fromSiteId, userId: user.id, action: "menu.propagate", details: { targets: targets.length, changed } });
  revalidatePath("/direction/menu");
}

export async function setIngredientAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  if (!canUse(tenant, "recipes")) throw new Error("Les recettes automatiques sont incluses dans la formule Pro.");
  const menuItemId = text(formData.get("menuItemId"));
  const inventoryItemId = text(formData.get("inventoryItemId"));
  const quantity = num(formData.get("quantity"));
  const [menuItem, inventoryItem] = await Promise.all([getMenuItem(tenant.id, menuItemId), getInventoryItem(tenant.id, inventoryItemId)]);
  if (!menuItem || !inventoryItem || menuItem.siteId !== inventoryItem.siteId) throw new Error("Données invalides");
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantité invalide");
  await setIngredient(menuItemId, inventoryItemId, quantity);
  revalidatePath("/direction/menu");
}

// --------------------------------------------------------------- Stock

const ZONES: Zone[] = ["cuisine", "salle"];

export async function addInventoryItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const siteId = text(formData.get("siteId"));
  const name = text(formData.get("name"));
  const unit = text(formData.get("unit"), 20) || "pièce";
  const category = text(formData.get("category")) as Category;
  const zone = (text(formData.get("zone")) || "cuisine") as Zone;
  const quantity = num(formData.get("quantity") || "0");
  const unitPrice = num(formData.get("unitPrice") || "0");
  const thresholdRaw = text(formData.get("lowStockThreshold"));
  const lowStockThreshold = thresholdRaw ? num(thresholdRaw) : null;
  if (!name) return { error: "Indiquez le nom de l’article." };
  if (!CATEGORY_ORDER.includes(category)) return { error: "Catégorie invalide." };
  if (!ZONES.includes(zone)) return { error: "Zone invalide." };
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return { error: "Quantité ou prix invalide." };
  if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) return { error: "Seuil invalide." };
  await ownSite(tenant.id, siteId);
  const item = await addInventoryItem({ tenantId: tenant.id, siteId, name, unit, unitsPerPackage: 1, category, zone, quantity, unitPrice, lowStockThreshold });
  await audit({ tenantId: tenant.id, siteId, userId: user.id, action: "stock.add", targetType: "inventory_item", targetId: item.id, details: { name } });
  revalidatePath("/direction/stock");
  return { ok: true, message: `« ${name} » ajouté` };
}

export async function updateInventoryItemAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const changes: Parameters<typeof updateInventoryItem>[2] = {};
  if (formData.has("name")) {
    const name = text(formData.get("name"));
    if (name) changes.name = name;
  }
  if (formData.has("quantity")) {
    const quantity = num(formData.get("quantity"));
    if (Number.isFinite(quantity) && quantity >= 0) changes.quantity = quantity;
  }
  if (formData.has("unitPrice")) {
    const unitPrice = num(formData.get("unitPrice"));
    if (Number.isFinite(unitPrice) && unitPrice >= 0) changes.unitPrice = unitPrice;
  }
  if (formData.has("lowStockThreshold")) {
    const raw = text(formData.get("lowStockThreshold"));
    if (raw === "") changes.lowStockThreshold = null;
    else {
      const threshold = num(raw);
      if (Number.isFinite(threshold) && threshold >= 0) changes.lowStockThreshold = threshold;
    }
  }
  await updateInventoryItem(tenant.id, id, changes);
  if (formData.has("supplierId")) {
    const supplierId = text(formData.get("supplierId"));
    await setItemSupplier(tenant.id, id, supplierId || null);
  }
  if (formData.has("visibleToServerField")) {
    await setItemVisibility(tenant.id, id, formData.get("visibleToServer") === "true", "waiter");
  }
  revalidatePath("/direction/stock");
}

export async function deleteInventoryItemAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const item = await getInventoryItem(tenant.id, id);
  if (!item) return;
  await deleteInventoryItem(tenant.id, id);
  await audit({ tenantId: tenant.id, siteId: item.siteId, userId: user.id, action: "stock.delete", targetType: "inventory_item", targetId: id, details: { name: item.name } });
  revalidatePath("/direction/stock");
}

export async function addSupplierAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  const name = text(formData.get("name"));
  if (!name) return;
  await addSupplier(tenant.id, name);
  revalidatePath("/direction/stock");
}

export async function deleteSupplierAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  await deleteSupplier(tenant.id, text(formData.get("id")));
  revalidatePath("/direction/stock");
}

// ---------------------------------------------------------------- Team

export async function addStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const siteId = text(formData.get("siteId"));
  const name = text(formData.get("name"));
  const role = text(formData.get("role")) as Role;
  const pin = text(formData.get("pin"), 6);
  if (name.length < 2) return { error: "Indiquez le prénom (ou le nom) de la personne." };
  if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) return { error: "Rôle invalide." };
  const problem = pinProblem(pin);
  if (problem) return { error: problem };
  await ownSite(tenant.id, siteId);
  const created = await createStaffUser({ tenantId: tenant.id, siteId, name, role: role as (typeof STAFF_ROLES)[number], pinHash: await hashSecret(pin) });
  await audit({ tenantId: tenant.id, siteId, userId: user.id, action: "team.add", targetType: "user", targetId: created.id, details: { name, role } });
  revalidatePath("/direction/equipe");
  return { ok: true, message: `${name} peut se connecter avec son code` };
}

export async function updateStaffAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const target = await getUserById(id);
  if (!target || target.tenantId !== tenant.id) throw new Error("Introuvable");
  if (formData.has("name")) {
    const name = text(formData.get("name"));
    if (name) await renameUser(tenant.id, id, name);
  }
  if (formData.has("active")) {
    if (target.id === user.id) throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
    const active = formData.get("active") === "true";
    await setUserActive(tenant.id, id, active);
    await audit({ tenantId: tenant.id, siteId: target.siteId, userId: user.id, action: active ? "team.activate" : "team.deactivate", targetType: "user", targetId: id });
  }
  if (formData.has("siteId") && target.role !== "director") {
    const siteId = text(formData.get("siteId"));
    await ownSite(tenant.id, siteId);
    await moveUserToSite(tenant.id, id, siteId);
  }
  revalidatePath("/direction/equipe");
}

export async function resetPinAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const pin = text(formData.get("pin"), 6);
  const target = await getUserById(id);
  if (!target || target.tenantId !== tenant.id || target.role === "director") return { error: "Introuvable." };
  const problem = pinProblem(pin);
  if (problem) return { error: problem };
  await setUserPin(tenant.id, id, await hashSecret(pin));
  await audit({ tenantId: tenant.id, siteId: target.siteId, userId: user.id, action: "team.reset_pin", targetType: "user", targetId: id });
  revalidatePath("/direction/equipe");
  return { ok: true, message: `Nouveau code enregistré pour ${target.name}` };
}

export async function deleteStaffAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const target = await getUserById(id);
  if (!target || target.tenantId !== tenant.id) return;
  await deleteStaffUser(tenant.id, id);
  await audit({ tenantId: tenant.id, siteId: target.siteId, userId: user.id, action: "team.delete", targetType: "user", targetId: id, details: { name: target.name } });
  revalidatePath("/direction/equipe");
}

export async function inviteDirectorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const name = text(formData.get("name"));
  const email = text(formData.get("email"), 120).toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (name.length < 2) return { error: "Indiquez le nom." };
  if (!isValidEmail(email)) return { error: "E-mail invalide." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (await getAuthUserByEmail(email)) return { error: "Cet e-mail est déjà utilisé." };
  const created = await createDirectorUser({ tenantId: tenant.id, name, email, passwordHash: await hashSecret(password) });
  await audit({ tenantId: tenant.id, userId: user.id, action: "team.add_director", targetType: "user", targetId: created.id, details: { email } });
  revalidatePath("/direction/equipe");
  return { ok: true, message: `${name} peut se connecter avec ${email}` };
}

// ------------------------------------------------------ Establishments

export async function addSiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const name = text(formData.get("name"));
  if (name.length < 2) return { error: "Indiquez le nom de l’établissement." };
  const limit = siteLimit(tenant);
  if (limit !== null && (await countSitesForTenant(tenant.id)) >= limit) {
    return { error: `Votre formule ${planOf(tenant).name} inclut ${limit} établissement. Passez à Pro pour en ajouter.` };
  }
  const site = await createSite(tenant.id, name);
  await audit({ tenantId: tenant.id, siteId: site.id, userId: user.id, action: "site.add", targetType: "site", targetId: site.id, details: { name } });
  await syncSeatCount(tenant.id);
  revalidatePath("/direction", "layout");
  return { ok: true, message: `${name} créé — code tablette : ${site.deviceCode}` };
}

export async function updateSiteAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  await ownSite(tenant.id, id);
  if (formData.has("name")) {
    const name = text(formData.get("name"));
    if (name) await renameSite(tenant.id, id, name);
  }
  if (formData.has("active")) {
    const active = formData.get("active") === "true";
    await setSiteActive(tenant.id, id, active);
    await audit({ tenantId: tenant.id, siteId: id, userId: user.id, action: active ? "site.activate" : "site.deactivate", targetType: "site", targetId: id });
    await syncSeatCount(tenant.id);
  }
  if (formData.get("rotateCode") === "1") {
    await rotateDeviceCode(tenant.id, id);
    await audit({ tenantId: tenant.id, siteId: id, userId: user.id, action: "site.rotate_code", targetType: "site", targetId: id });
  }
  if (formData.has("zeltyRestaurantId")) {
    const externalId = text(formData.get("zeltyRestaurantId"), 64);
    if (externalId) {
      await upsertPosBinding({ tenantId: tenant.id, siteId: id, source: "zelty", externalId });
      await audit({
        tenantId: tenant.id,
        siteId: id,
        userId: user.id,
        action: "site.pos_bind",
        targetType: "site",
        targetId: id,
        details: { source: "zelty", externalId },
      });
    } else {
      await deletePosBinding(tenant.id, id, "zelty");
      await audit({
        tenantId: tenant.id,
        siteId: id,
        userId: user.id,
        action: "site.pos_unbind",
        targetType: "site",
        targetId: id,
        details: { source: "zelty" },
      });
    }
  }
  revalidatePath("/direction", "layout");
}

export async function deleteSiteAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const site = await ownSite(tenant.id, id);
  const all = await getSitesForTenant(tenant.id);
  if (all.length <= 1) throw new Error("Impossible de supprimer le dernier établissement.");
  await deleteSite(tenant.id, id);
  await audit({ tenantId: tenant.id, userId: user.id, action: "site.delete", targetType: "site", targetId: id, details: { name: site.name } });
  await syncSeatCount(tenant.id);
  revalidatePath("/direction", "layout");
}

// ------------------------------------------------------------ Settings

export async function updateBrandAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector({ allowInactiveTenant: true });
  const name = text(formData.get("name"));
  const brandColorRaw = text(formData.get("brandColor"), 7);
  const legalName = text(formData.get("legalName"), 120);
  const legalAddress = text(formData.get("legalAddress"), 300);
  const billingEmail = text(formData.get("billingEmail"), 120).toLowerCase();
  const currency = text(formData.get("currency"), 3).toUpperCase();
  const logoUrl = text(formData.get("logoUrl"), 500);
  if (name.length < 2) return { error: "Le nom de l’enseigne est requis." };
  if (brandColorRaw && !/^#[0-9a-fA-F]{6}$/.test(brandColorRaw)) return { error: "Couleur invalide." };
  if (billingEmail && !isValidEmail(billingEmail)) return { error: "E-mail de facturation invalide." };
  if (!["CHF", "EUR"].includes(currency)) return { error: "Devise non prise en charge." };
  if (logoUrl && !/^https:\/\//.test(logoUrl)) return { error: "Le logo doit être une adresse https." };
  const whiteLabel = canUse(tenant, "whiteLabel");
  await updateTenant(tenant.id, {
    name,
    brandColor: whiteLabel ? brandColorRaw || null : tenant.brandColor,
    logoUrl: whiteLabel ? logoUrl || null : tenant.logoUrl,
    legalName: legalName || null,
    legalAddress: legalAddress || null,
    billingEmail: billingEmail || null,
    currency,
  });
  await audit({ tenantId: tenant.id, userId: user.id, action: "tenant.update", details: { name, currency } });
  revalidatePath("/direction", "layout");
  return { ok: true, message: "Réglages enregistrés" };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector({ allowInactiveTenant: true });
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "Les deux mots de passe ne correspondent pas." };
  await setUserPassword(user.id, await hashSecret(password));
  await audit({ tenantId: tenant.id, userId: user.id, action: "auth.change_password" });
  return { ok: true, message: "Mot de passe modifié" };
}

export async function requestDeletionAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector({ allowInactiveTenant: true });
  if (text(formData.get("confirm"), 40).toUpperCase() !== "SUPPRIMER") throw new Error("Confirmation incorrecte");
  // Suspends immediately; the actual purge is run by the editor after the
  // legal retention window (see README › RGPD).
  await updateTenant(tenant.id, { status: "canceled" });
  await audit({ tenantId: tenant.id, userId: user.id, action: "tenant.deletion_requested" });
  await destroySession();
  redirect("/connexion");
}
