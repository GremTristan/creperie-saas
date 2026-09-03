import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader, SiteTabs, Stat } from "@/components/direction/ui";
import { addDays, formatDayLabel, localDay, startOfMonth, startOfWeek, todayPeriod } from "@/lib/dates";
import { foodCostReport } from "@/lib/food-cost";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { getSitesForTenant } from "@/lib/site-store";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Coûts" };

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

function formatQty(n: number): string {
  return n.toLocaleString("fr-CH", { maximumFractionDigits: 3 });
}

export default async function CoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; periode?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const molard = sites.find((s) => s.slug === "molard") ?? null;
  const period: Period = (["jour", "semaine", "mois", "30j"] as Period[]).includes(params.periode as Period)
    ? (params.periode as Period)
    : "semaine";
  const requested = sites.some((s) => s.id === params.site) ? params.site! : null;
  const siteId = requested ?? molard?.id ?? null;
  const { from, to, label } = range(period);
  const report = await foodCostReport(tenant.id, sites, from, to, siteId);
  const selected = sites.find((s) => s.id === siteId) ?? null;
  const isMolard = selected?.slug === "molard" || (siteId === null && Boolean(molard));

  const query = (overrides: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { site: siteId, periode: period, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };

  const medianMargin =
    report.costed.length === 0
      ? null
      : [...report.costed].sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))[Math.floor((report.costed.length - 1) / 2)]
          .marginPct;
  const counted = report.variance.filter((v) => v.countDelta !== null);
  const gapHint =
    counted.length === 0
      ? "Pas de comptage sur la période"
      : `${counted.length} article${counted.length > 1 ? "s" : ""} compté${counted.length > 1 ? "s" : ""}`;

  return (
    <>
      <PageHeader
        title="Coûts"
        description="Coût matière et marge des 15 plats tête de gondole à Molard, à partir des recettes et des prix d’achat. Le reste de la carte n’est pas chiffré. Écart entre la consommation théorique (tickets × recette) et le dernier comptage."
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
      <SiteTabs sites={sites} current={siteId} basePath="/direction/couts" query={{ periode: period }} />

      {!molard ? (
        <EmptyState
          title="Pas d’établissement Molard"
          description="Les 15 plats tête de gondole et leurs recettes sont posés sur Crêperie du Molard (seed de la chaîne)."
        />
      ) : !isMolard ? (
        <EmptyState
          title="Chiffré à Molard seulement"
          description="Les coûts matière des 15 plats tête de gondole sont calculés pour Crêperie du Molard. Choisissez cet établissement."
        />
      ) : report.costed.length === 0 ? (
        <EmptyState
          title="Recettes tête de gondole absentes"
          description="Relancez le seed de la chaîne (npm run seed:chain) pour poser les 15 recettes Molard et leurs quantités."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Plats chiffrés" value={String(report.costed.length)} hint={`${report.uncosted.length} non chiffrés`} />
            <Stat
              label="Marge médiane"
              value={medianMargin === null ? "—" : `${medianMargin.toLocaleString("fr-CH", { maximumFractionDigits: 0 })} %`}
              tone="accent"
            />
            <Stat
              label={`Coût des ventes — ${label}`}
              value={formatMoney(report.soldFoodCost, tenant.currency)}
              hint={
                report.soldRevenue
                  ? `sur ${formatMoney(report.soldRevenue, tenant.currency)} de ventes tête de gondole`
                  : "Aucun ticket envoyé en cuisine"
              }
            />
            <Stat
              label="Écarts au comptage"
              value={String(counted.filter((v) => v.countDelta !== 0).length)}
              tone={counted.some((v) => v.countDelta && v.countDelta !== 0) ? "warning" : undefined}
              hint={gapHint}
            />
          </div>

          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-bold text-foreground">Tête de gondole — coût et marge</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Plat</th>
                    <th className="pb-2 pr-3 text-right font-medium">Prix</th>
                    <th className="pb-2 pr-3 text-right font-medium">Coût</th>
                    <th className="pb-2 pr-3 text-right font-medium">Marge</th>
                    <th className="pb-2 text-right font-medium">Vendus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.costed.map((row) => (
                    <tr key={row.menuItemId}>
                      <td className="py-2.5 pr-3 font-medium text-foreground">{row.name}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(row.price, tenant.currency)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(row.cost ?? 0, tenant.currency)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                        {formatMoney(row.margin ?? 0, tenant.currency)}
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.marginPct?.toLocaleString("fr-CH", { maximumFractionDigits: 0 })} %
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">{row.soldQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-base font-bold text-foreground">Théorique vs comptage</h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              Consommation théorique = tickets envoyés en cuisine × recette. L’écart au comptage est la différence
              constatée quand le stock est compté (compté − théorique).
            </p>
            {report.variance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun ingrédient tête de gondole sur cet établissement.</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.variance.map((row) => (
                  <li key={row.inventoryItemId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      théorique {formatQty(row.theoreticalQty)} {row.unit}
                      {row.countDelta === null ? (
                        <span> · pas de comptage</span>
                      ) : (
                        <span className={row.countDelta === 0 ? "" : "font-semibold text-foreground"}>
                          {" "}
                          · écart {row.countDelta > 0 ? "+" : ""}
                          {formatQty(row.countDelta)}
                          {row.lastCountAt ? ` (${formatDayLabel(localDay(row.lastCountAt))})` : ""}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 rounded-lg border border-dashed border-border bg-card p-4">
            <h2 className="mb-2 text-base font-bold text-foreground">Non chiffré</h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              {report.uncosted.length} produit{report.uncosted.length > 1 ? "s" : ""} sans recette quantifiée — pas de
              coût matière.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {report.uncosted.slice(0, 24).map((item) => (
                <li key={item.menuItemId} className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {item.name}
                </li>
              ))}
              {report.uncosted.length > 24 && (
                <li className="rounded-md px-2.5 py-1 text-xs text-muted-foreground">+{report.uncosted.length - 24}</li>
              )}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
