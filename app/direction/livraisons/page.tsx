import type { Metadata } from "next";
import Link from "next/link";
import { Camera } from "lucide-react";
import { CreateForm } from "@/components/direction/forms";
import { EmptyState, PageHeader, SiteTabs } from "@/components/direction/ui";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ocrConfigured } from "@/lib/ocr/extract";
import { uploadReceiptAction } from "@/lib/receipt-actions";
import { listReceipts } from "@/lib/receipt-store";
import { pageDirector } from "@/lib/page-guards";
import { getInventoryBySite, getSuppliers } from "@/lib/inventory-store";
import { getSitesForTenant } from "@/lib/site-store";
import { RECEIPT_STATUS_LABELS } from "@/types";

export const metadata: Metadata = { title: "Livraisons" };

export default async function LivraisonsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site: siteParam } = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const site = sites.find((s) => s.id === siteParam) ?? null;
  const [receipts, suppliers] = await Promise.all([
    listReceipts(tenant.id, site ? site.id : null),
    getSuppliers(tenant.id),
  ]);
  const pending = receipts.filter((r) => r.status === "proposed" || r.status === "pending");
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const canOcr = ocrConfigured();
  const hasStock = site ? (await getInventoryBySite(site.id)).length > 0 : true;

  return (
    <>
      <PageHeader
        title="Livraisons"
        description="Photo d’un bon fournisseur : les lignes proposées, à relier au stock et à valider. Rien n’est enregistré tant que vous n’avez pas validé."
      />
      <SiteTabs sites={sites} current={site?.id ?? null} basePath="/direction/livraisons" allLabel="Tous les établissements" />

      {!site && sites.length > 0 && (
        <p className="mb-5 rounded-lg border border-dashed border-border bg-card px-4 py-5 text-center text-[13px] text-muted-foreground">
          Choisissez un établissement pour photographier un bon de livraison.
        </p>
      )}

      {site && (
        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <Camera className="h-4 w-4" />
            Nouveau bon — {site.name}
          </h2>
          {!canOcr && (
            <p className="mb-3 text-[13px] text-muted-foreground">
              La lecture automatique des photos n’est pas branchée. Vous pouvez quand même photographier le bon, puis saisir les lignes, ou déposer un fichier JSON.
            </p>
          )}
          {!hasStock && (
            <p className="mb-3 text-[13px] text-muted-foreground">
              Aucun article de stock sur cet établissement — les lignes ne pourront pas être reliées tant que le catalogue n’est pas là.
            </p>
          )}
          <CreateForm action={uploadReceiptAction} submitLabel="Lire le bon" className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
            <input type="hidden" name="siteId" value={site.id} />
            <label className="block text-sm font-medium">
              Photo ou JSON
              <Input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/json" required capture="environment" className="mt-1 min-h-11" />
            </label>
            <label className="block text-sm font-medium">
              Fournisseur
              <Select name="supplierId" className="mt-1 min-h-11 w-full">
                <option value="">— à détecter</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
          </CreateForm>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-[14px] font-semibold text-foreground">{pending.length} à valider</h2>
          <ul className="space-y-2">
            {pending.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/direction/livraisons/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-card px-3.5 py-3 hover:bg-muted/40"
                >
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {r.supplierNameRaw || "Fournisseur à confirmer"}
                    <span className="text-muted-foreground"> · {siteName.get(r.siteId)}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-warning">{RECEIPT_STATUS_LABELS[r.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipts.length === 0 ? (
        <EmptyState
          title="Aucun bon pour l’instant"
          description="Photographiez un bon de livraison : les lignes proposées apparaissent ici, à valider avant d’enregistrer les prix d’achat."
        />
      ) : (
        <section>
          <h2 className="mb-2 text-[14px] font-semibold text-muted-foreground">Historique</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link href={`/direction/livraisons/${r.id}`} className="flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-muted/40">
                  <span className="min-w-0 truncate text-[13px] text-foreground">
                    {r.supplierNameRaw || "Sans fournisseur"}
                    {r.invoiceRef ? ` · ${r.invoiceRef}` : ""}
                    <span className="text-muted-foreground"> · {siteName.get(r.siteId)}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{RECEIPT_STATUS_LABELS[r.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
