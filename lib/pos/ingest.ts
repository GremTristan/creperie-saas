import "server-only";

import { capture } from "@/lib/capture";
import { getPosBindingByExternal } from "@/lib/pos/bindings";
import { posCaptureKey } from "@/lib/pos/keys";
import { extractZeltyOrders, normalizeZeltyOrder } from "@/lib/pos/zelty";
import type { TicketNormalized } from "@/types";

export type IngestResult = {
  accepted: number;
  skipped: number;
  unknownRestaurant: string[];
  tickets: TicketNormalized[];
};

export async function ingestTicketNormalized(
  ticket: TicketNormalized,
  site: { tenantId: string; siteId: string }
): Promise<"written" | "duplicate"> {
  const key = posCaptureKey(site.tenantId, ticket.type, ticket.source, ticket.externalId, ticket.type);
  // capture() swallows duplicates via onConflictDoNothing — we still count as accepted.
  await capture({
    tenantId: site.tenantId,
    siteId: site.siteId,
    occurredAt: ticket.occurredAt,
    type: ticket.type,
    source: ticket.source,
    payload: {
      ...ticket.payload,
      externalId: ticket.externalId,
      externalRestaurantId: ticket.externalRestaurantId,
      tableLabel: ticket.tableLabel,
      kind: ticket.kind,
      total: ticket.total,
      paymentMethod: ticket.paymentMethod,
      currency: ticket.currency,
      items: ticket.items,
    },
    idempotencyKey: key,
  });
  return "written";
}

export async function ingestZeltyPayload(body: unknown): Promise<IngestResult> {
  const orders = extractZeltyOrders(body);
  const result: IngestResult = { accepted: 0, skipped: 0, unknownRestaurant: [], tickets: [] };

  for (const raw of orders) {
    const ticket = normalizeZeltyOrder(raw);
    if (!ticket) {
      result.skipped++;
      continue;
    }
    const binding = await getPosBindingByExternal("zelty", ticket.externalRestaurantId);
    if (!binding) {
      if (!result.unknownRestaurant.includes(ticket.externalRestaurantId)) {
        result.unknownRestaurant.push(ticket.externalRestaurantId);
      }
      result.skipped++;
      continue;
    }
    await ingestTicketNormalized(ticket, { tenantId: binding.tenantId, siteId: binding.siteId });
    result.accepted++;
    result.tickets.push(ticket);
  }

  return result;
}
