import { handle } from "@/lib/api";
import { addDays, startOfMonth, startOfWeek, todayPeriod } from "@/lib/dates";
import { getOrderHeadersForTenant } from "@/lib/order-store";
import { requireDirector } from "@/lib/session";
import { getSitesForTenant } from "@/lib/site-store";
import { getUsersForTenant } from "@/lib/user-store";
import { ORDER_STATUS_LABELS } from "@/types";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rangeFromPeriod(period: string): { from: string; to: string } {
  const today = todayPeriod();
  if (period === "jour") return { from: today, to: today };
  if (period === "mois") return { from: startOfMonth(today), to: today };
  if (period === "30j") return { from: addDays(today, -29), to: today };
  return { from: startOfWeek(today), to: today };
}

// One row per ticket (all statuses). Director-only, no extra salle fields.
export async function GET(request: Request) {
  return handle(async () => {
    const { tenant } = await requireDirector();
    const url = new URL(request.url);
    const { from, to } = rangeFromPeriod(url.searchParams.get("periode") ?? "semaine");
    const siteFilter = url.searchParams.get("site");

    const [orders, sites, users] = await Promise.all([
      getOrderHeadersForTenant(tenant.id, from, to),
      getSitesForTenant(tenant.id),
      getUsersForTenant(tenant.id),
    ]);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const header = [
      "Date",
      "Établissement",
      "Ticket",
      "Type",
      "Table",
      "Statut",
      "Total",
      "Prise par",
      "Créée",
      "Cuisine",
      "Prête",
      "Servie",
      "Encaissée",
    ];
    const rows = [header.join(";")];
    for (const order of orders) {
      if (siteFilter && order.siteId !== siteFilter) continue;
      rows.push(
        [
          order.serviceDate,
          siteName.get(order.siteId) ?? "",
          order.number,
          order.kind === "takeaway" ? "À emporter" : "Table",
          order.tableLabel ?? "",
          ORDER_STATUS_LABELS[order.status],
          order.total.toFixed(2),
          userName.get(order.createdByUserId) ?? "",
          order.createdAt,
          order.sentAt ?? "",
          order.readyAt ?? "",
          order.servedAt ?? "",
          order.paidAt ?? "",
        ]
          .map(csvCell)
          .join(";")
      );
    }

    return new Response(`\uFEFF${rows.join("\r\n")}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tickets-${from}-${to}.csv"`,
      },
    });
  });
}
