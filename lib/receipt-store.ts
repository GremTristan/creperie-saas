import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { receiptLines, receipts, supplierPrices, suppliers } from "@/lib/db/schema";
import { bestMatch } from "@/lib/ocr/match";
import { getInventoryBySite } from "@/lib/inventory-store";
import type {
  ImageMediaType,
  OcrInvoice,
  Receipt,
  ReceiptLine,
  ReceiptLineStatus,
  ReceiptStatus,
  SiteId,
  SupplierPrice,
} from "@/types";

const UUID = /^[0-9a-f-]{36}$/i;

type LineRow = typeof receiptLines.$inferSelect;
type ReceiptListRow = {
  id: string;
  tenantId: string;
  siteId: string;
  supplierId: string | null;
  submittedByUserId: string;
  submittedAt: Date;
  imageMediaType: ImageMediaType | null;
  hasImage: number | boolean;
  status: ReceiptStatus;
  supplierNameRaw: string | null;
  invoiceDate: string | null;
  invoiceRef: string | null;
  currency: string;
  ocrError: string | null;
  validatedByUserId: string | null;
  validatedAt: Date | null;
};

function toReceipt(row: ReceiptListRow): Receipt {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    supplierId: row.supplierId,
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt.toISOString(),
    imageMediaType: row.imageMediaType,
    hasImage: Number(row.hasImage) === 1 || row.hasImage === true,
    status: row.status,
    supplierNameRaw: row.supplierNameRaw,
    invoiceDate: row.invoiceDate,
    invoiceRef: row.invoiceRef,
    currency: row.currency,
    ocrError: row.ocrError,
    validatedByUserId: row.validatedByUserId,
    validatedAt: row.validatedAt ? row.validatedAt.toISOString() : null,
  };
}

function toLine(row: LineRow): ReceiptLine {
  return {
    id: row.id,
    tenantId: row.tenantId,
    receiptId: row.receiptId,
    rawLabel: row.rawLabel,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: row.unitPrice === null ? null : Number(row.unitPrice),
    lineTotal: row.lineTotal === null ? null : Number(row.lineTotal),
    proposedInventoryItemId: row.proposedInventoryItemId,
    matchScore: row.matchScore === null ? null : Number(row.matchScore),
    status: row.status,
    sortOrder: row.sortOrder,
  };
}

const LIST_COLUMNS = {
  id: receipts.id,
  tenantId: receipts.tenantId,
  siteId: receipts.siteId,
  supplierId: receipts.supplierId,
  submittedByUserId: receipts.submittedByUserId,
  submittedAt: receipts.submittedAt,
  imageMediaType: receipts.imageMediaType,
  hasImage: sql<number>`case when ${receipts.imageData} is not null then 1 else 0 end`,
  status: receipts.status,
  supplierNameRaw: receipts.supplierNameRaw,
  invoiceDate: receipts.invoiceDate,
  invoiceRef: receipts.invoiceRef,
  currency: receipts.currency,
  ocrError: receipts.ocrError,
  validatedByUserId: receipts.validatedByUserId,
  validatedAt: receipts.validatedAt,
};

async function matchSupplierId(tenantId: string, rawName: string | null): Promise<string | null> {
  if (!rawName) return null;
  const rows = await db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId));
  const hit = bestMatch(
    rawName,
    rows.map((row) => ({ id: row.id, name: row.name }))
  );
  return hit?.id ?? null;
}

export async function listReceipts(tenantId: string, siteId?: SiteId | null): Promise<Receipt[]> {
  const rows = siteId
    ? await db
        .select(LIST_COLUMNS)
        .from(receipts)
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.siteId, siteId)))
        .orderBy(desc(receipts.submittedAt))
        .limit(80)
    : await db
        .select(LIST_COLUMNS)
        .from(receipts)
        .where(eq(receipts.tenantId, tenantId))
        .orderBy(desc(receipts.submittedAt))
        .limit(80);
  return rows.map(toReceipt);
}

export async function getReceipt(tenantId: string, id: string): Promise<Receipt | undefined> {
  if (!UUID.test(id)) return undefined;
  const [row] = await db
    .select(LIST_COLUMNS)
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)));
  return row ? toReceipt(row) : undefined;
}

export async function getReceiptImage(
  tenantId: string,
  id: string
): Promise<{ mediaType: ImageMediaType; bytes: Buffer } | undefined> {
  if (!UUID.test(id)) return undefined;
  const [row] = await db
    .select({ imageMediaType: receipts.imageMediaType, imageData: receipts.imageData })
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)));
  if (!row?.imageData || !row.imageMediaType) return undefined;
  return { mediaType: row.imageMediaType, bytes: Buffer.from(row.imageData, "base64") };
}

export async function getReceiptLines(tenantId: string, receiptId: string): Promise<ReceiptLine[]> {
  if (!UUID.test(receiptId)) return [];
  const rows = await db
    .select()
    .from(receiptLines)
    .where(and(eq(receiptLines.tenantId, tenantId), eq(receiptLines.receiptId, receiptId)))
    .orderBy(receiptLines.sortOrder, receiptLines.rawLabel);
  return rows.map(toLine);
}

export async function createReceipt(input: {
  tenantId: string;
  siteId: SiteId;
  userId: string;
  supplierId?: string | null;
  imageMediaType: ImageMediaType | null;
  imageData: string | null;
}): Promise<Receipt> {
  const [row] = await db
    .insert(receipts)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      supplierId: input.supplierId ?? null,
      submittedByUserId: input.userId,
      imageMediaType: input.imageMediaType,
      imageData: input.imageData,
      status: "pending",
    })
    .returning({ id: receipts.id });
  const created = await getReceipt(input.tenantId, row.id);
  if (!created) throw new Error("Bon introuvable");
  return created;
}

export async function applyOcrResult(
  tenantId: string,
  receiptId: string,
  invoice: OcrInvoice,
  ocrRaw: Record<string, unknown>,
  ocrError: string | null
): Promise<Receipt> {
  const receipt = await getReceipt(tenantId, receiptId);
  if (!receipt) throw new Error("Bon introuvable");

  const supplierId = receipt.supplierId ?? (await matchSupplierId(tenantId, invoice.supplierName));
  const inventory = await getInventoryBySite(receipt.siteId);
  const candidates = inventory.map((item) => ({ id: item.id, name: item.name, supplierId: item.supplierId }));

  await db.delete(receiptLines).where(and(eq(receiptLines.receiptId, receiptId), eq(receiptLines.tenantId, tenantId)));

  if (invoice.lines.length > 0) {
    await db.insert(receiptLines).values(
      invoice.lines.map((line, index) => {
        const hit = bestMatch(line.label, candidates, supplierId);
        return {
          tenantId,
          receiptId,
          rawLabel: line.label,
          quantity: line.quantity.toString(),
          unit: line.unit,
          unitPrice: line.unitPrice === null ? null : line.unitPrice.toString(),
          lineTotal: line.lineTotal === null ? null : line.lineTotal.toString(),
          proposedInventoryItemId: hit?.id ?? null,
          matchScore: hit ? hit.score.toFixed(3) : null,
          status: "proposed" as const,
          sortOrder: index,
        };
      })
    );
  }

  const status: ReceiptStatus = "proposed";
  await db
    .update(receipts)
    .set({
      supplierId,
      supplierNameRaw: invoice.supplierName,
      invoiceDate: invoice.invoiceDate,
      invoiceRef: invoice.invoiceRef,
      currency: invoice.currency || receipt.currency,
      ocrRaw,
      ocrError,
      status,
    })
    .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, tenantId)));
  const updated = await getReceipt(tenantId, receiptId);
  if (!updated) throw new Error("Bon introuvable");
  return updated;
}

export async function addReceiptLine(input: {
  tenantId: string;
  receiptId: string;
  rawLabel: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
}): Promise<ReceiptLine> {
  const receipt = await getReceipt(input.tenantId, input.receiptId);
  if (!receipt || receipt.status === "validated") throw new Error("Bon introuvable");
  const inventory = await getInventoryBySite(receipt.siteId);
  const hit = bestMatch(
    input.rawLabel,
    inventory.map((item) => ({ id: item.id, name: item.name, supplierId: item.supplierId })),
    receipt.supplierId
  );
  const existing = await getReceiptLines(input.tenantId, input.receiptId);
  const lineTotal = input.unitPrice === null ? null : Math.round(input.unitPrice * input.quantity * 100) / 100;
  const [row] = await db
    .insert(receiptLines)
    .values({
      tenantId: input.tenantId,
      receiptId: input.receiptId,
      rawLabel: input.rawLabel,
      quantity: input.quantity.toString(),
      unit: input.unit,
      unitPrice: input.unitPrice === null ? null : input.unitPrice.toString(),
      lineTotal: lineTotal === null ? null : lineTotal.toString(),
      proposedInventoryItemId: hit?.id ?? null,
      matchScore: hit ? hit.score.toFixed(3) : null,
      status: "proposed",
      sortOrder: existing.length,
    })
    .returning();
  if (receipt.status === "pending") {
    await db
      .update(receipts)
      .set({ status: "proposed" })
      .where(and(eq(receipts.id, input.receiptId), eq(receipts.tenantId, input.tenantId)));
  }
  return toLine(row);
}

export async function updateReceiptLine(
  tenantId: string,
  lineId: string,
  changes: {
    proposedInventoryItemId?: string | null;
    status?: ReceiptLineStatus;
    quantity?: number;
    unitPrice?: number | null;
  }
): Promise<void> {
  if (!UUID.test(lineId)) return;
  const [line] = await db
    .select()
    .from(receiptLines)
    .where(and(eq(receiptLines.id, lineId), eq(receiptLines.tenantId, tenantId)));
  if (!line) return;
  const receipt = await getReceipt(tenantId, line.receiptId);
  if (!receipt || receipt.status === "validated") throw new Error("Bon déjà validé");

  const values: Partial<typeof receiptLines.$inferInsert> = {};
  if (changes.proposedInventoryItemId !== undefined) {
    values.proposedInventoryItemId = changes.proposedInventoryItemId;
    values.matchScore = changes.proposedInventoryItemId ? "1.000" : null;
  }
  if (changes.status) values.status = changes.status;
  if (changes.quantity !== undefined) values.quantity = changes.quantity.toString();
  if (changes.unitPrice !== undefined) {
    values.unitPrice = changes.unitPrice === null ? null : changes.unitPrice.toString();
  }
  const qty = changes.quantity ?? Number(line.quantity);
  const price = changes.unitPrice !== undefined ? changes.unitPrice : line.unitPrice === null ? null : Number(line.unitPrice);
  if (changes.quantity !== undefined || changes.unitPrice !== undefined) {
    values.lineTotal = price === null ? null : (Math.round(price * qty * 100) / 100).toString();
  }
  if (Object.keys(values).length === 0) return;
  await db
    .update(receiptLines)
    .set(values)
    .where(and(eq(receiptLines.id, lineId), eq(receiptLines.tenantId, tenantId)));
}

export async function setReceiptSupplier(tenantId: string, receiptId: string, supplierId: string | null): Promise<void> {
  const receipt = await getReceipt(tenantId, receiptId);
  if (!receipt || receipt.status === "validated") throw new Error("Bon introuvable");
  await db
    .update(receipts)
    .set({ supplierId })
    .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, tenantId)));
}

export async function rejectReceipt(tenantId: string, receiptId: string): Promise<void> {
  await db
    .update(receipts)
    .set({ status: "rejected" })
    .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, tenantId), eq(receipts.status, "proposed")));
}

export async function listSupplierPrices(tenantId: string, inventoryItemId?: string): Promise<SupplierPrice[]> {
  const rows = inventoryItemId
    ? await db
        .select()
        .from(supplierPrices)
        .where(and(eq(supplierPrices.tenantId, tenantId), eq(supplierPrices.inventoryItemId, inventoryItemId)))
        .orderBy(desc(supplierPrices.observedAt))
        .limit(40)
    : await db
        .select()
        .from(supplierPrices)
        .where(eq(supplierPrices.tenantId, tenantId))
        .orderBy(desc(supplierPrices.observedAt))
        .limit(40);
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    supplierId: row.supplierId,
    inventoryItemId: row.inventoryItemId,
    unitPrice: Number(row.unitPrice),
    unit: row.unit,
    observedAt: row.observedAt.toISOString(),
    receiptId: row.receiptId,
  }));
}

export async function recordSupplierPrices(
  tenantId: string,
  receiptId: string,
  supplierId: string,
  lines: ReceiptLine[]
): Promise<void> {
  const priced = lines.filter(
    (line) => line.status !== "ignored" && line.proposedInventoryItemId && line.unitPrice !== null && line.unitPrice >= 0
  );
  if (priced.length === 0) return;
  await db.insert(supplierPrices).values(
    priced.map((line) => ({
      tenantId,
      supplierId,
      inventoryItemId: line.proposedInventoryItemId!,
      unitPrice: line.unitPrice!.toString(),
      unit: line.unit || "pièce",
      receiptId,
      receiptLineId: line.id,
    }))
  );
}

export async function markReceiptValidated(
  tenantId: string,
  receiptId: string,
  userId: string,
  acceptedIds: string[]
): Promise<void> {
  if (acceptedIds.length > 0) {
    await db
      .update(receiptLines)
      .set({ status: "accepted" })
      .where(and(eq(receiptLines.tenantId, tenantId), eq(receiptLines.receiptId, receiptId), inArray(receiptLines.id, acceptedIds)));
  }
  await db
    .update(receipts)
    .set({ status: "validated", validatedByUserId: userId, validatedAt: new Date() })
    .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, tenantId)));
}
