import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { EmptyState, PageHeader, SiteTabs, Stat } from "@/components/direction/ui";
import { activityReport, formatDurationMs } from "@/lib/activity-report";
import { addDays, startOfMonth, startOfWeek, todayPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { getSitesForTenant } from "@/lib/site-store";
import { getUsersForTenant } from "@/lib/user-store";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activité" };

type Period = "jour" | "semaine" | "mois" | "30j";

function range(period: Period): { from: string; to: string; label: string } {
  const today = todayPeriod();
  switch (period) {
    case "jour":
      return { from: today, to: today, label: "Aujourd’hui" };
    case "semaine":
      return { from: startOfWeek(today), to: today, label: "Cette semaine" };
    case "mois":
      return { from: startOfMonth(today), to: today, label: "Ce mois" };
    case "30j":
      return { from: addDays(today, -29), to: today, label: "30 derniers jours" };
  }
}

export default async function ActivitePage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; periode?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const users = await getUsersForTenant(tenant.id);
  const period: Period = (["jour", "semaine", "mois", "30j"] as Period[]).includes(params.periode as Period)
    ? (params.periode as Period)
    : "semaine";
  const siteId = sites.some((s) => s.id === params.site) ? params.site! : null;
  const { from, to, label } = range(period);
  const report = await activityReport(tenant.id, sites, users, from, to, siteId);

  const query = (overrides: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { site: siteId, periode: period, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Activité"
        description="Délais cuisine, temps à table, encaissement par personne, annulations et pertes — lecture seule, à partir des tickets déjà pris."
        action={
          <Link
            href={`/api/export/tickets${query({})}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-4 text-sm font-semibold text-foreground hover:bg-border/60"
          >
            <Download className="h-4 w-4" /> Tickets (CSV)
          </Link>
        }
      />

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {(["jour", "semaine", "mois", "30j"] as Period[]).map((p) => (
          <Link
            key={p}
            href={query({ periode: p })}
            className={cn(
              "min-h-11 inline-flex shrink-0 items-center rounded-md px-4 text-sm font-semibold",
              period === p ? "bg-foreground text-background" : "bg-card text-foreground shadow-sm hover:bg-muted"
            )}
          >
            {range(p).label}
          </Link>
        ))}
      </div>
      <SiteTabs sites={sites} current={siteId} basePath="/direction/activite" query={{ periode: period }} allLabel="Tous les établissements" />

      {report.ticketCount === 0 ? (
        <EmptyState
          title={`Aucun ticket sur ${label.toLowerCase()}`}
          description="Les délais apparaissent dès que la cuisine marque une commande prête et que la table est servie ou encaissée."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Cuisine — médiane"
              value={formatDurationMs(report.kitchenP50Ms)}
              hint={
                report.kitchenSample
                  ? `${report.kitchenSample} tickets · 9 sur 10 sous ${formatDurationMs(report.kitchenP90Ms)}`
                  : "Pas encore de passage « prête »"
              }
            />
            <Stat
              label="Temps à table"
              value={formatDurationMs(report.tableP50Ms)}
              hint={
                report.tableSample
                  ? `${report.tableSample} tables · 9 sur 10 sous ${formatDurationMs(report.tableP90Ms)}`
                  : "Envoi cuisine → servie (ou encaissée)"
              }
            />
            <Stat
              label="Annulées"
              value={String(report.cancelledCount)}
              tone={report.cancelledCount > 0 ? "warning" : undefined}
              hint={report.cancelledCount ? formatMoney(report.cancelledTotal, tenant.currency) : "Aucun ticket annulé"}
            />
            <Stat
              label="Pertes stock"
              value={String(report.wasteCount)}
              tone={report.wasteCount > 0 ? "destructive" : undefined}
              hint={report.wasteCount ? `${report.wasteQty.toLocaleString("fr-CH", { maximumFractionDigits: 2 })} unités` : "Aucun mouvement perte"}
            />
          </div>

          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-bold text-foreground">Encaissé par personne</h2>
            {report.byWaiter.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pas encore de ticket encaissé sur cette période.</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.byWaiter.map((row) => (
                  <li key={row.userId} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span className="truncate font-medium text-foreground">{row.name}</span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {formatMoney(row.total, tenant.currency)}
                      <span className="text-muted-foreground"> · {row.count} ticket{row.count > 1 ? "s" : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-4 text-[12px] text-muted-foreground">
            {report.ticketCount} ticket{report.ticketCount > 1 ? "s" : ""}
            {report.captureEventCount > 0 ? ` · ${report.captureEventCount} événements journalisés` : ""}
            {" · "}
            <Link href="/direction/ventes" className="underline-offset-2 hover:underline">
              Voir le chiffre d’affaires
            </Link>
          </p>
        </>
      )}
    </>
  );
}
