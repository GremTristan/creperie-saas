import { parseAmount, parseQuantity, roundMoney } from "@/lib/ocr/normalize";
import type { OcrInvoice, OcrInvoiceLine } from "@/types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FR_DATE_RE = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : null;
}

function normalizeDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const iso = raw.match(DATE_RE);
  if (iso) return raw;
  const fr = raw.match(FR_DATE_RE);
  if (!fr) return null;
  const day = fr[1].padStart(2, "0");
  const month = fr[2].padStart(2, "0");
  let year = fr[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${month}-${day}`;
}

function normalizeCurrency(value: unknown): string {
  const raw = asString(value)?.toUpperCase() ?? "CHF";
  if (raw.includes("EUR") || raw === "€") return "EUR";
  return "CHF";
}

function parseLine(raw: unknown): OcrInvoiceLine | null {
  const row = asRecord(raw);
  if (!row) return null;
  const label = asString(row.label) ?? asString(row.name) ?? asString(row.designation);
  if (!label) return null;
  const rawQty = row.quantity ?? row.qty ?? row.qte;
  const quantity =
    rawQty === undefined || rawQty === null || rawQty === ""
      ? 1
      : parseQuantity(rawQty);
  if (quantity === null) return null;
  const unit = asString(row.unit) ?? asString(row.unite);
  const unitPrice = parseAmount(row.unitPrice ?? row.unit_price ?? row.prixUnitaire ?? row.prix);
  let lineTotal = parseAmount(row.lineTotal ?? row.line_total ?? row.total ?? row.montant);
  if (lineTotal === null && unitPrice !== null) lineTotal = roundMoney(unitPrice * quantity);
  return { label: label.slice(0, 160), quantity, unit, unitPrice, lineTotal };
}

export function parseInvoiceJson(input: unknown): OcrInvoice {
  const root = asRecord(input) ?? {};
  const nested = asRecord(root.invoice) ?? asRecord(root.facture) ?? root;
  const linesRaw = nested.lines ?? nested.lignes ?? nested.items;
  const lines = Array.isArray(linesRaw)
    ? linesRaw.map(parseLine).filter((line): line is OcrInvoiceLine => line !== null)
    : [];
  return {
    supplierName: asString(nested.supplierName) ?? asString(nested.supplier) ?? asString(nested.fournisseur),
    invoiceDate: normalizeDate(nested.invoiceDate ?? nested.date ?? nested.invoice_date),
    invoiceRef: asString(nested.invoiceRef) ?? asString(nested.reference) ?? asString(nested.ref),
    currency: normalizeCurrency(nested.currency ?? nested.devise),
    lines,
  };
}

export function parseInvoiceText(text: string): OcrInvoice {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parseInvoiceJson({ lines: parsed });
      return parseInvoiceJson(parsed);
    } catch {
      // fall through to empty — vision / manual entry will fill later
    }
  }
  return { supplierName: null, invoiceDate: null, invoiceRef: null, currency: "CHF", lines: [] };
}
