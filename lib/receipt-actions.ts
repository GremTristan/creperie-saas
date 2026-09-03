"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { captureKey } from "@/lib/capture-keys";
import type { ActionState } from "@/lib/direction-actions";
import { applyStockDelta, getInventoryItem, getSuppliers, setItemSupplier, updateInventoryItem } from "@/lib/inventory-store";
import { extractInvoice } from "@/lib/ocr/extract";
import {
  addReceiptLine,
  applyOcrResult,
  createReceipt,
  getReceipt,
  getReceiptLines,
  markReceiptValidated,
  recordSupplierPrices,
  rejectReceipt,
  setReceiptSupplier,
  updateReceiptLine,
} from "@/lib/receipt-store";
import { requireDirector } from "@/lib/session";
import { getSiteForTenant } from "@/lib/site-store";
import type { ImageMediaType, ReceiptLineStatus } from "@/types";

const MAX_IMAGE_BYTES = 2_000_000;
const IMAGE_TYPES = new Set<ImageMediaType>(["image/jpeg", "image/png", "image/webp"]);

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

function mediaOf(file: File): ImageMediaType | "application/json" | "text/plain" | null {
  if (IMAGE_TYPES.has(file.type as ImageMediaType)) return file.type as ImageMediaType;
  if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) return "application/json";
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return "text/plain";
  if (file.type === "image/jpg") return "image/jpeg";
  return null;
}

export async function uploadReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const siteId = text(formData.get("siteId"));
  const supplierId = text(formData.get("supplierId")) || null;
  const file = formData.get("file");
  if (!siteId) return { error: "Choisissez un établissement." };
  await ownSite(tenant.id, siteId);
  if (!(file instanceof File) || file.size === 0) return { error: "Ajoutez une photo du bon, ou un fichier JSON." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Fichier trop lourd (2 Mo max)." };
  const media = mediaOf(file);
  if (!media) return { error: "Formats acceptés : photo JPEG/PNG/WebP, ou JSON." };
  if (supplierId) {
    const known = await getSuppliers(tenant.id);
    if (!known.some((s) => s.id === supplierId)) return { error: "Fournisseur inconnu." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const isImage = media === "image/jpeg" || media === "image/png" || media === "image/webp";
  const receipt = await createReceipt({
    tenantId: tenant.id,
    siteId,
    userId: user.id,
    supplierId,
    imageMediaType: isImage ? media : null,
    imageData: isImage ? bytes.toString("base64") : null,
  });

  const { invoice, raw, error } = await extractInvoice({ mediaType: media, bytes });
  await applyOcrResult(tenant.id, receipt.id, invoice, raw, error);
  await audit({
    tenantId: tenant.id,
    siteId,
    userId: user.id,
    action: "receipt.upload",
    targetType: "receipt",
    targetId: receipt.id,
    details: { lines: invoice.lines.length, supplier: invoice.supplierName },
  });
  revalidatePath("/direction/livraisons");
  redirect(`/direction/livraisons/${receipt.id}`);
}

export async function addReceiptLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { tenant } = await requireDirector();
  const receiptId = text(formData.get("receiptId"));
  const rawLabel = text(formData.get("rawLabel"), 160);
  const quantity = num(formData.get("quantity"));
  const unit = text(formData.get("unit"), 24) || null;
  const priceRaw = text(formData.get("unitPrice"));
  const unitPrice = priceRaw === "" ? null : num(formData.get("unitPrice"));
  if (!rawLabel) return { error: "Indiquez le nom de l’article." };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: "Quantité invalide." };
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return { error: "Prix invalide." };
  const receipt = await getReceipt(tenant.id, receiptId);
  if (!receipt || receipt.status === "validated") return { error: "Bon introuvable." };
  await addReceiptLine({ tenantId: tenant.id, receiptId, rawLabel, quantity, unit, unitPrice });
  revalidatePath(`/direction/livraisons/${receiptId}`);
  return { ok: true, message: "Ligne ajoutée" };
}

export async function updateReceiptLineAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  const id = text(formData.get("id"));
  const receiptId = text(formData.get("receiptId"));
  const itemId = text(formData.get("proposedInventoryItemId"));
  const status = text(formData.get("status")) as ReceiptLineStatus;
  const quantity = formData.has("quantity") ? num(formData.get("quantity")) : undefined;
  const priceRaw = formData.has("unitPrice") ? text(formData.get("unitPrice")) : undefined;
  await updateReceiptLine(tenant.id, id, {
    proposedInventoryItemId: formData.has("proposedInventoryItemId") ? itemId || null : undefined,
    status: status === "ignored" || status === "proposed" || status === "accepted" ? status : undefined,
    quantity: quantity !== undefined && Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    unitPrice: priceRaw === undefined ? undefined : priceRaw === "" ? null : Number.isFinite(num(priceRaw)) ? num(priceRaw) : undefined,
  });
  revalidatePath(`/direction/livraisons/${receiptId}`);
}

export async function setReceiptSupplierAction(formData: FormData): Promise<void> {
  const { tenant } = await requireDirector();
  const receiptId = text(formData.get("receiptId"));
  const supplierId = text(formData.get("supplierId")) || null;
  if (supplierId) {
    const known = await getSuppliers(tenant.id);
    if (!known.some((s) => s.id === supplierId)) throw new Error("Fournisseur inconnu");
  }
  await setReceiptSupplier(tenant.id, receiptId, supplierId);
  revalidatePath(`/direction/livraisons/${receiptId}`);
}

export async function rejectReceiptAction(formData: FormData): Promise<void> {
  const { user, tenant } = await requireDirector();
  const receiptId = text(formData.get("receiptId"));
  const receipt = await getReceipt(tenant.id, receiptId);
  if (!receipt) return;
  await rejectReceipt(tenant.id, receiptId);
  await audit({
    tenantId: tenant.id,
    siteId: receipt.siteId,
    userId: user.id,
    action: "receipt.reject",
    targetType: "receipt",
    targetId: receiptId,
  });
  revalidatePath("/direction/livraisons");
  redirect("/direction/livraisons");
}

export async function validateReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, tenant } = await requireDirector();
  const receiptId = text(formData.get("receiptId"));
  const applyStock = formData.get("applyStock") === "true";
  const receipt = await getReceipt(tenant.id, receiptId);
  if (!receipt || receipt.status === "validated") return { error: "Bon introuvable." };
  if (!receipt.supplierId) return { error: "Choisissez un fournisseur avant de valider." };
  const lines = await getReceiptLines(tenant.id, receiptId);
  const usable = lines.filter((line) => line.status !== "ignored" && line.proposedInventoryItemId);
  if (usable.length === 0) return { error: "Aucune ligne reliée au stock. Associez au moins un article, ou ignorez le bon." };

  for (const line of usable) {
    const item = await getInventoryItem(tenant.id, line.proposedInventoryItemId!);
    if (!item || item.siteId !== receipt.siteId) return { error: "Article de stock invalide." };
  }

  await recordSupplierPrices(tenant.id, receiptId, receipt.supplierId, usable);
  await markReceiptValidated(
    tenant.id,
    receiptId,
    user.id,
    usable.map((line) => line.id)
  );

  for (const line of usable) {
    const item = (await getInventoryItem(tenant.id, line.proposedInventoryItemId!))!;
    if (line.unitPrice !== null) {
      await updateInventoryItem(tenant.id, item.id, { unitPrice: line.unitPrice });
    }
    if (!item.supplierId) await setItemSupplier(tenant.id, item.id, receipt.supplierId);
    if (applyStock && line.quantity > 0) {
      await applyStockDelta({
        tenantId: tenant.id,
        siteId: receipt.siteId,
        itemId: item.id,
        delta: line.quantity,
        userId: user.id,
        reason: "adjust",
        source: "ocr",
        idempotencyKey: captureKey(tenant.id, "stock.adjust", item.id, `ocr:${receiptId}:${line.id}`),
      });
    }
  }

  await audit({
    tenantId: tenant.id,
    siteId: receipt.siteId,
    userId: user.id,
    action: "receipt.validate",
    targetType: "receipt",
    targetId: receiptId,
    details: { lines: usable.length, applyStock },
  });
  revalidatePath("/direction/livraisons");
  revalidatePath("/direction/stock");
  redirect(`/direction/livraisons/${receiptId}`);
}
