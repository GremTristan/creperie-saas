import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { EmptyState, PageHeader, SiteTabs, Stat } from "@/components/direction/ui";
import { canUse } from "@/lib/billing/plans";
import { addDays, formatDayLabel, startOfMonth, startOfWeek, todayPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { salesReport } from "@/lib/reports";
import { getSitesForTenant } from "@/lib/site-store";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ventes" };

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

export default async function VentesPage({ searchParams }: { searchParams: Promise<{ site?: string; periode?: string }> }) {
  const params = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const period: Period = (["jour", "semaine", "mois", "30j"] as Period[]).includes(params.periode as Period) ? (params.periode as Period) : "semaine";
  const siteId = sites.some((s) => s.id === params.site) ? params.site! : null;
  const { from, to, label } = range(period);
  const exportsEnabled = canUse(tenant, "exports");
  const compareEnabled = canUse(tenant, "compareSites");

  const report = await salesReport(tenant.id, siteId ? sites.filter((s) => s.id === siteId) : sites, from, to);
  const scoped = siteId
    ? { ...report, total: report.bySite[0]?.total ?? 0, count: report.bySite[0]?.count ?? 0 }
    : report;
  const max = Math.max(1, ...report.series.map((p) => p.total));
  const query = (overrides: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { site: siteId, periode: period, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Ventes"
        description="Chiffre d’affaires encaissé, produits les plus vendus, comparaison entre établissements."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/direction/activite${query({})}`}
              className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Activité
            </Link>
            {exportsEnabled ? (
              <Link
                href={`/api/export/ventes${query({})}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-4 text-sm font-semibold text-foreground hover:bg-border/60"
              >
                <Download className="h-4 w-4" /> Export tableur (CSV)
              </Link>
            ) : (
              <Link
                href="/direction/abonnement"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-4 text-sm font-semibold text-muted-foreground hover:bg-border/60"
                title="Inclus dans la formule Pro"
              >
                <Download className="h-4 w-4" /> Export Pro
              </Link>
            )}
          </div>
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
      <SiteTabs sites={sites} current={siteId} basePath="/direction/ventes" query={{ periode: period }} allLabel="Tous les établissements" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`CA — ${label}`} value={formatMoney(scoped.total, tenant.currency)} tone="accent" />
        <Stat label="Tickets" value={String(scoped.count)} />
        <Stat label="Ticket moyen" value={formatMoney(scoped.count ? scoped.total / scoped.count : 0, tenant.currency)} />
        <Stat
          label="Répartition"
          value={`${Math.round(report.total ? (report.byMethod.card / report.total) * 100 : 0)} % carte`}
          hint={`Espèces ${formatMoney(report.byMethod.cash, tenant.currency)} · TWINT ${formatMoney(report.byMethod.twint, tenant.currency)}`}
        />
      </div>

      {report.count === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucune vente encaissée sur cette période" description="Les tickets encaissés depuis l’écran Caisse apparaissent ici en temps réel." />
        </div>
      ) : (
        <>
          {report.series.length > 1 && (
            <section className="mt-6 rounded-lg border border-border bg-card p-4">
              <h2 className="mb-4 text-base font-bold text-foreground">Chiffre d’affaires par jour</h2>
              <div className="flex h-40 items-end gap-1">
                {report.series.map((point) => (
                  <div key={point.day} className="group relative flex flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-t-md bg-accent/80 transition-colors group-hover:bg-accent"
                      style={{ height: `${Math.max(2, (point.total / max) * 100)}%` }}
                      title={`${formatDayLabel(point.day)} : ${formatMoney(point.total, tenant.currency)} (${point.count} tickets)`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{formatDayLabel(report.series[0].day)}</span>
                <span>{formatDayLabel(report.series[report.series.length - 1].day)}</span>
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {!siteId && sites.length > 1 && compareEnabled && (
              <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-base font-bold text-foreground">Comparaison des établissements</h2>
                <ul className="space-y-3">
                  {report.bySite.map((s) => (
                    <li key={s.siteId}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-semibold text-foreground">{s.siteName}</span>
                        <span className="tabular-nums text-foreground">
                          {formatMoney(s.total, tenant.currency)}{" "}
                          <span className="text-muted-foreground">· {s.count} tickets · moy. {formatMoney(s.averageTicket, tenant.currency)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-md bg-muted">
                        <div className="h-full rounded-md bg-accent" style={{ width: `${report.total ? (s.total / report.total) * 100 : 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-base font-bold text-foreground">Produits les plus vendus</h2>
              <ol className="divide-y divide-border">
                {report.topProducts.map((p, i) => (
                  <li key={p.menuItemId} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-6 text-right font-bold text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate font-medium text-foreground">{p.name}</span>
                    <span className="tabular-nums text-muted-foreground">{p.quantity} ×</span>
                    <span className="w-28 text-right tabular-nums font-semibold text-foreground">{formatMoney(p.revenue, tenant.currency)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </>
  );
}
