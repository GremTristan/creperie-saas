import type { CaptureEventType, OrderKind, PaymentMethod, TicketNormalized, TicketNormalizedItem } from "@/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Zelty amounts are integer cents by convention; decimals are treated as francs. */
export function fromZeltyMoney(value: unknown): number {
  const record = asRecord(value);
  if (record) {
    const nested =
      asNumber(record.final_amount_inc_tax) ??
      asNumber(record.ttc_ent) ??
      asNumber(record.ttc) ??
      asNumber(record.amount) ??
      asNumber(record.inc_tax) ??
      asNumber(record.value);
    if (nested !== null) return fromZeltyMoney(nested);
  }
  const n = asNumber(value);
  if (n === null) return 0;
  if (Number.isInteger(n)) return Math.round(n) / 100;
  return Math.round(n * 100) / 100;
}

function parseOccurredAt(raw: Record<string, unknown>): Date {
  const candidates = [raw.closed_at, raw.updated_at, raw.created_at, raw.date, raw.occurred_at];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      const ms = c > 1e12 ? c : c * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof c === "string" && c.trim()) {
      const asNum = Number(c);
      if (Number.isFinite(asNum) && asNum > 1e9) {
        const ms = asNum > 1e12 ? asNum : asNum * 1000;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) return d;
      }
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

function parseKind(raw: Record<string, unknown>): OrderKind | null {
  const mode = raw.mode ?? raw.order_mode ?? raw.service;
  const s = asString(mode)?.toLowerCase() ?? "";
  if (typeof mode === "number") {
    if (mode === 1) return "table";
    if (mode === 2 || mode === 3) return "takeaway";
  }
  if (s.includes("eat") || s.includes("sur_place") || s.includes("onsite") || s === "1") return "table";
  if (s.includes("take") || s.includes("emporter") || s.includes("delivery") || s.includes("livraison") || s === "2") {
    return "takeaway";
  }
  return null;
}

function parseTable(raw: Record<string, unknown>): string | null {
  const table = raw.table ?? raw.table_name ?? raw.tableLabel;
  if (typeof table === "string" || typeof table === "number") return asString(table)?.slice(0, 20) ?? null;
  const record = asRecord(table);
  return asString(record?.name ?? record?.label ?? record?.number)?.slice(0, 20) ?? null;
}

function parsePayment(raw: Record<string, unknown>): PaymentMethod | null {
  const txs = raw.transactions ?? raw.payments ?? raw.payment;
  const list = Array.isArray(txs) ? txs : txs ? [txs] : [];
  for (const entry of list) {
    const row = asRecord(entry) ?? {};
    const label = (asString(row.name) ?? asString(row.method) ?? asString(row.type) ?? "").toLowerCase();
    if (label.includes("twint")) return "twint";
    if (label.includes("cash") || label.includes("espece") || label.includes("espèce")) return "cash";
    if (label.includes("card") || label.includes("cb") || label.includes("carte") || label.includes("visa")) return "card";
  }
  return list.length ? "other" : null;
}

function parseItems(raw: Record<string, unknown>): TicketNormalizedItem[] {
  const list = raw.dishes ?? raw.items ?? raw.products ?? raw.lines ?? [];
  if (!Array.isArray(list)) return [];
  const items: TicketNormalizedItem[] = [];
  for (const entry of list) {
    const row = asRecord(entry) ?? {};
    const name = asString(row.name) ?? asString(row.label) ?? asString(row.dish_name);
    if (!name) continue;
    const quantity = Math.max(1, Math.round(asNumber(row.quantity ?? row.qty) ?? 1));
    const unitPrice = fromZeltyMoney(row.price ?? row.unit_price ?? row.amount);
    const externalId = asString(row.id) ?? undefined;
    items.push({
      name: name.slice(0, 160),
      quantity,
      unitPrice,
      ...(externalId ? { externalId } : {}),
    });
  }
  return items;
}

function parseEventType(raw: Record<string, unknown>): CaptureEventType {
  const status = raw.status ?? raw.state ?? raw.order_status;
  const statusStr = asString(status)?.toLowerCase() ?? "";
  const cancelled =
    raw.cancelled === true ||
    raw.canceled === true ||
    statusStr.includes("cancel") ||
    statusStr.includes("annul");
  if (cancelled) return "order.cancelled";

  const closed =
    raw.closed === true ||
    raw.paid === true ||
    asNumber(raw.closed_at) !== null ||
    asString(raw.closed_at) !== null ||
    statusStr.includes("close") ||
    statusStr.includes("paid") ||
    statusStr.includes("paye") ||
    statusStr.includes("payé") ||
    statusStr === "10" ||
    status === 10;
  if (closed) return "order.paid";

  if (statusStr.includes("ready") || statusStr.includes("prete") || statusStr.includes("prête")) return "order.ready";
  if (statusStr.includes("sent") || statusStr.includes("cuisine") || statusStr.includes("kitchen")) return "order.sent";
  return "order.created";
}

export function restaurantIdOf(raw: Record<string, unknown>): string | null {
  return (
    asString(raw.id_restaurant) ??
    asString(raw.restaurant_id) ??
    asString(raw.idRestaurant) ??
    asString(asRecord(raw.restaurant)?.id)
  );
}

export function normalizeZeltyOrder(rawInput: unknown): TicketNormalized | null {
  const wrapped = asRecord(rawInput);
  const raw = asRecord(wrapped?.order) ?? wrapped;
  if (!raw) return null;
  const externalId = asString(raw.id) ?? asString(raw.id_order) ?? asString(raw.remote_id);
  const restaurantId = restaurantIdOf(raw);
  if (!externalId || !restaurantId) return null;

  const items = parseItems(raw);
  const totalFromItems = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = fromZeltyMoney(raw.price ?? raw.total ?? raw.amount) || Math.round(totalFromItems * 100) / 100;
  const type = parseEventType(raw);

  return {
    source: "zelty",
    externalId,
    externalRestaurantId: restaurantId,
    occurredAt: parseOccurredAt(raw),
    type,
    tableLabel: parseTable(raw),
    kind: parseKind(raw),
    items,
    total,
    paymentMethod: parsePayment(raw),
    currency: "CHF",
    payload: {
      zelty: {
        id: externalId,
        id_restaurant: restaurantId,
        status: raw.status ?? null,
        mode: raw.mode ?? null,
      },
      items,
      total,
    },
  };
}

export function extractZeltyOrders(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const root = asRecord(body);
  if (!root) return [];
  if (Array.isArray(root.orders)) return root.orders;
  if (root.order) return [root.order];
  if (asString(root.id) && restaurantIdOf(root)) return [root];
  return [];
}
