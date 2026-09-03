import { fromZeltyMoney, extractZeltyOrders, normalizeZeltyOrder } from "@/lib/pos/zelty";
import { posCaptureKey } from "@/lib/pos/keys";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(fromZeltyMoney(2550) === 25.5, "cents → francs");
assert(fromZeltyMoney({ ttc_ent: 1400 }) === 14, "nested ttc_ent");
assert(fromZeltyMoney(12.5) === 12.5, "decimal francs stay");

const paid = normalizeZeltyOrder({
  id: 987,
  id_restaurant: 42,
  closed: true,
  closed_at: 1_700_000_000,
  mode: "eat_in",
  table: { name: "12" },
  price: { final_amount_inc_tax: 2550 },
  dishes: [{ id: 1, name: "Complète", quantity: 1, price: { ttc_ent: 1400 } }],
  transactions: [{ name: "TWINT", amount: 2550 }],
});
assert(paid?.type === "order.paid", "closed → paid");
assert(paid?.externalRestaurantId === "42", "restaurant id");
assert(paid?.tableLabel === "12", "table label");
assert(paid?.paymentMethod === "twint", "twint payment");
assert(paid?.total === 25.5, "order total");
assert(paid?.items[0]?.unitPrice === 14, "dish price");

const cancelled = normalizeZeltyOrder({
  id: "abc",
  id_restaurant: "7",
  status: "cancelled",
  created_at: "2026-09-03T10:00:00Z",
  items: [{ name: "Cidre", qty: 2, price: 500 }],
});
assert(cancelled?.type === "order.cancelled", "cancelled status");
assert(cancelled?.kind === null || cancelled?.kind === "table" || cancelled?.kind === "takeaway", "kind optional");

const extracted = extractZeltyOrders({ orders: [{ id: 1, id_restaurant: 2 }, { id: 3, id_restaurant: 2 }] });
assert(extracted.length === 2, "orders array");

const key1 = posCaptureKey("t1", "order.paid", "zelty", "987", "order.paid");
const key2 = posCaptureKey("t1", "order.paid", "zelty", "987", "order.paid");
assert(key1 === key2, "idempotency key stable");
assert(key1.includes("zelty:987"), "key embeds source+external id");

console.log("zelty adapter harness OK");
