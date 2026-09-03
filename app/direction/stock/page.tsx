import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Trash2 } from "lucide-react";
import { AutoSaveForm, CreateForm, DeleteButton } from "@/components/direction/forms";
import { EmptyState, PageHeader, SiteTabs, Stat } from "@/components/direction/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  addInventoryItemAction,
  addSupplierAction,
  deleteInventoryItemAction,
  deleteSupplierAction,
  updateInventoryItemAction,
} from "@/lib/direction-actions";
import { getInventoryBySite, getInventoryForTenant, getSuppliers, isLowStock } from "@/lib/inventory-store";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { getSitesForTenant } from "@/lib/site-store";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/types";

export const metadata: Metadata = { title: "Stock" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ site?: string; focus?: string }> }) {
  const { site: siteParam, focus } = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const site = sites.find((s) => s.id === siteParam) ?? null;
  const focusLow = focus === "low";

  const [items, suppliers, all] = await Promise.all([
    site ? getInventoryBySite(site.id) : Promise.resolve([]),
    getSuppliers(tenant.id),
    getInventoryForTenant(tenant.id),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const value = (list: typeof all) => list.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const lowItems = (site ? items : all).filter(isLowStock);

  return (
    <>
      <PageHeader
        title="Stock"
        description={
          focusLow
            ? "Exceptions uniquement — quantités sous le seuil d’alerte."
            : "Seuils, commandes à passer, fournisseurs. Les prix restent cachés aux tablettes cuisine/salle."
        }
        action={
          <Link
            href={site ? `/direction/livraisons?site=${site.id}` : "/direction/livraisons"}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-4 text-sm font-semibold text-foreground hover:bg-border/60"
          >
            {site ? "Photographier un bon" : "Livraisons"}
          </Link>
        }
      />
      <SiteTabs sites={sites} current={site?.id ?? null} basePath="/direction/stock" allLabel="Vue consolidée" query={focusLow ? { focus: "low" } : {}} />

      {/* EXCEPTION-FIRST — always surface anomalies before the full catalog */}
      {lowItems.length > 0 && (
        <section className="mb-5 rounded-lg border border-destructive/30 bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {lowItems.length} à traiter
            </h2>
            {!focusLow && (
              <a href={site ? `/direction/stock?site=${site.id}&focus=low` : "/direction/stock?focus=low"} className="text-[12px] font-medium text-muted-foreground hover:text-foreground">
                Voir seulement les exceptions →
              </a>
            )}
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {lowItems.slice(0, 12).map((i) => {
              const siteLabel = site ? null : sites.find((s) => s.id === i.siteId)?.name;
              return (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-md bg-destructive/5 px-2.5 py-2 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {i.name}
                    {siteLabel && <span className="text-muted-foreground"> · {siteLabel}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-destructive">
                    {i.quantity} / {i.lowStockThreshold} {i.unit}
                  </span>
                </li>
              );
            })}
          </ul>
          {site && (
            <a
              href={`/s/${site.id}/stock`}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
            >
              Compter sur la tablette
            </a>
          )}
        </section>
      )}

      {focusLow && lowItems.length === 0 && (
        <p className="mb-5 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          Aucune exception stock.{" "}
          <a href={site ? `/direction/stock?site=${site.id}` : "/direction/stock"} className="font-medium text-foreground underline-offset-2 hover:underline">
            Voir tout le catalogue
          </a>
        </p>
      )}

      {!focusLow && !site ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Valeur totale du stock" value={formatMoney(value(all), tenant.currency)} tone="accent" />
            <Stat label="Articles suivis" value={String(all.length)} />
            <Stat label="À commander" value={String(all.filter(isLowStock).length)} tone={all.some(isLowStock) ? "destructive" : undefined} />
            <Stat label="Fournisseurs" value={String(suppliers.length)} />
          </div>
          <section className="mt-6 grid gap-3 md:grid-cols-2">
            {sites.map((s) => {
              const own = all.filter((i) => i.siteId === s.id);
              const low = own.filter(isLowStock);
              return (
                <a key={s.id} href={`/direction/stock?site=${s.id}`} className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40">
                  <h3 className="text-lg font-bold text-foreground">{s.name}</h3>
                  <p className="text-[20px] font-bold tracking-tight tabular-nums">{formatMoney(value(own), tenant.currency)}</p>
                  <p className="text-sm text-muted-foreground">
                    {own.length} article{own.length > 1 ? "s" : ""}
                    {low.length > 0 && <span className="ml-2 font-semibold text-destructive">· {low.length} à commander</span>}
                  </p>
                  {low.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {low.slice(0, 6).map((i) => (
                        <li key={i.id} className="rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
                          {i.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </a>
              );
            })}
          </section>
          <section className="mt-8 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-bold text-foreground">Fournisseurs</h2>
            <ul className="mb-3 flex flex-wrap gap-2">
              {suppliers.map((s) => (
                <li key={s.id} className="flex items-center gap-1 rounded-md bg-muted pl-4 pr-1 text-sm font-medium">
                  {s.name}
                  <DeleteButton action={deleteSupplierAction} fields={{ id: s.id }} variant="ghost" size="icon" className="h-9 w-9" confirmLabel="OK ?" aria-label={`Supprimer ${s.name}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </DeleteButton>
                </li>
              ))}
              {suppliers.length === 0 && <li className="text-sm text-muted-foreground">Aucun fournisseur pour l’instant.</li>}
            </ul>
            <form action={addSupplierAction} className="flex gap-2">
              <Input name="name" placeholder="Nouveau fournisseur" required className="min-h-11 max-w-xs" />
              <Button type="submit" variant="secondary">
                Ajouter
              </Button>
            </form>
          </section>
        </>
      ) : !focusLow && site ? (
        <>
          <section className="mb-8 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-bold text-foreground">Ajouter un article — {site.name}</h2>
            <CreateForm action={addInventoryItemAction} submitLabel="Ajouter" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_6rem_9rem_6rem_7rem_7rem_auto] lg:items-end">
              <input type="hidden" name="siteId" value={site.id} />
              <label className="block text-sm font-medium">
                Nom
                <Input name="name" required placeholder="Farine de sarrasin" className="mt-1 min-h-11" />
              </label>
              <label className="block text-sm font-medium">
                Unité
                <Input name="unit" placeholder="kg" defaultValue="pièce" className="mt-1 min-h-11" />
              </label>
              <label className="block text-sm font-medium">
                Catégorie
                <Select name="category" defaultValue="sec" className="mt-1 min-h-11 w-full">
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm font-medium">
                Quantité
                <Input name="quantity" type="number" step="0.1" min="0" defaultValue="0" className="mt-1 min-h-11" />
              </label>
              <label className="block text-sm font-medium">
                Prix d’achat
                <Input name="unitPrice" type="number" step="0.01" min="0" defaultValue="0" className="mt-1 min-h-11" />
              </label>
              <label className="block text-sm font-medium">
                Seuil d’alerte
                <Input name="lowStockThreshold" type="number" step="0.1" min="0" placeholder="—" className="mt-1 min-h-11" />
              </label>
            </CreateForm>
          </section>

          {items.length === 0 ? (
            <EmptyState title="Aucun article pour cet établissement" description="Ajoutez vos matières premières : les cuisiniers pourront les compter depuis leur tablette." />
          ) : (
            CATEGORY_ORDER.map((category) => {
              const group = items.filter((i) => i.category === category);
              if (group.length === 0) return null;
              return (
                <section key={category} className="mb-6">
                  <h2 className="mb-2 text-base font-bold text-muted-foreground">
                    {CATEGORY_LABELS[category]} · {formatMoney(value(group), tenant.currency)}
                  </h2>
                  <ul className="space-y-2">
                    {group.map((item) => (
                      <li key={item.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                        <AutoSaveForm action={updateInventoryItemAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-[1fr_6rem_7rem_7rem_10rem_8rem_auto]">
                          <input type="hidden" name="id" value={item.id} />
                          <label className="col-span-2 block text-xs text-muted-foreground sm:col-span-3 lg:col-span-1">
                            <span className="flex items-center gap-1">
                              Article {isLowStock(item) && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                            </span>
                            <Input name="name" defaultValue={item.name} className="mt-0.5 min-h-11" />
                          </label>
                          <label className="block text-xs text-muted-foreground">
                            Qté ({item.unit})
                            <Input name="quantity" type="number" step="0.1" min="0" defaultValue={item.quantity} className="mt-0.5 min-h-11 tabular-nums" />
                          </label>
                          <label className="block text-xs text-muted-foreground">
                            Prix d’achat
                            <Input name="unitPrice" type="number" step="0.01" min="0" defaultValue={item.unitPrice.toFixed(2)} className="mt-0.5 min-h-11 tabular-nums" />
                          </label>
                          <label className="block text-xs text-muted-foreground">
                            Seuil d’alerte
                            <Input name="lowStockThreshold" type="number" step="0.1" min="0" defaultValue={item.lowStockThreshold ?? ""} placeholder="—" className="mt-0.5 min-h-11 tabular-nums" />
                          </label>
                          <label className="block text-xs text-muted-foreground">
                            Fournisseur
                            <Select name="supplierId" defaultValue={item.supplierId ?? ""} className="mt-0.5 min-h-11 w-full">
                              <option value="">—</option>
                              {suppliers.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </Select>
                          </label>
                          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                            <input type="hidden" name="visibleToServerField" value="1" />
                            <input
                              type="checkbox"
                              name="visibleToServer"
                              value="true"
                              defaultChecked={item.visibleToServer}
                              className="h-5 w-5 accent-[var(--accent)]"
                            />
                            Visible salle
                          </label>
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(item.quantity * item.unitPrice, tenant.currency)}</span>
                            <DeleteButton action={deleteInventoryItemAction} fields={{ id: item.id }} message={`${item.name} supprimé`} variant="ghost" size="icon" aria-label="Supprimer" confirmLabel="Supprimer ?">
                              <Trash2 className="h-5 w-5 text-destructive" />
                            </DeleteButton>
                          </div>
                        </AutoSaveForm>
                        {item.supplierId && <p className="mt-1 text-xs text-muted-foreground">Fournisseur : {supplierName.get(item.supplierId)}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </>
      ) : null}
    </>
  );
}
