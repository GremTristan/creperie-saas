import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSaveForm, CreateForm, DeleteButton } from "@/components/direction/forms";
import { PageHeader } from "@/components/direction/ui";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { getInventoryBySite, getSuppliers } from "@/lib/inventory-store";
import {
  addReceiptLineAction,
  rejectReceiptAction,
  setReceiptSupplierAction,
  updateReceiptLineAction,
  validateReceiptAction,
} from "@/lib/receipt-actions";
import { getReceipt, getReceiptLines } from "@/lib/receipt-store";
import { getSitesForTenant } from "@/lib/site-store";
import { MATCH_THRESHOLD } from "@/lib/ocr/match";
import { RECEIPT_STATUS_LABELS } from "@/types";

export const metadata: Metadata = { title: "Bon de livraison" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await pageDirector();
  const receipt = await getReceipt(tenant.id, id);
  if (!receipt) notFound();
  const [lines, inventory, suppliers, sites] = await Promise.all([
    getReceiptLines(tenant.id, receipt.id),
    getInventoryBySite(receipt.siteId),
    getSuppliers(tenant.id),
    getSitesForTenant(tenant.id),
  ]);
  const site = sites.find((s) => s.id === receipt.siteId);
  const locked = receipt.status === "validated" || receipt.status === "rejected";
  const unmatched = lines.filter((l) => l.status !== "ignored" && !l.proposedInventoryItemId).length;

  return (
    <>
      <PageHeader
        title={receipt.supplierNameRaw || "Bon de livraison"}
        description={`${site?.name ?? "Établissement"} · ${RECEIPT_STATUS_LABELS[receipt.status]}${receipt.invoiceRef ? ` · ${receipt.invoiceRef}` : ""}${receipt.invoiceDate ? ` · ${receipt.invoiceDate}` : ""}`}
        action={
          <Link href="/direction/livraisons" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
            ← Tous les bons
          </Link>
        }
      />

      {receipt.ocrError && receipt.status !== "validated" && (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-[13px] text-foreground">{receipt.ocrError}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          {!locked && (
            <AutoSaveForm action={setReceiptSupplierAction} className="mb-4">
              <input type="hidden" name="receiptId" value={receipt.id} />
              <label className="block text-sm font-medium">
                Fournisseur
                <Select name="supplierId" defaultValue={receipt.supplierId ?? ""} className="mt-1 min-h-11 w-full max-w-sm">
                  <option value="">— à choisir</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            </AutoSaveForm>
          )}

          {lines.length === 0 ? (
            <p className="mb-4 text-[13px] text-muted-foreground">Aucune ligne pour l’instant. Ajoutez-les ci-dessous.</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => {
                const item = inventory.find((i) => i.id === line.proposedInventoryItemId);
                const weak = line.proposedInventoryItemId && (line.matchScore ?? 0) < MATCH_THRESHOLD + 0.15;
                return (
                  <li key={line.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-[13px] font-medium text-foreground">{line.rawLabel}</p>
                    <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
                      {line.quantity} {line.unit ?? ""}
                      {line.unitPrice !== null ? ` · ${formatMoney(line.unitPrice, receipt.currency)} / unité` : " · prix non lu"}
                      {line.lineTotal !== null ? ` · ${formatMoney(line.lineTotal, receipt.currency)}` : ""}
                    </p>
                    {locked ? (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        {line.status === "ignored" ? "Ignorée" : item ? `Relié à ${item.name}` : "Non reliée"}
                      </p>
                    ) : (
                      <AutoSaveForm action={updateReceiptLineAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_7rem_8rem_8rem]">
                        <input type="hidden" name="id" value={line.id} />
                        <input type="hidden" name="receiptId" value={receipt.id} />
                        <label className="block text-xs text-muted-foreground">
                          Article stock {weak ? "· à vérifier" : ""}
                          <Select name="proposedInventoryItemId" defaultValue={line.proposedInventoryItemId ?? ""} className="mt-0.5 min-h-11 w-full">
                            <option value="">— non relié</option>
                            {inventory.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label className="block text-xs text-muted-foreground">
                          Qté
                          <Input name="quantity" type="number" step="0.01" min="0" defaultValue={line.quantity} className="mt-0.5 min-h-11 tabular-nums" />
                        </label>
                        <label className="block text-xs text-muted-foreground">
                          Prix d’achat
                          <Input name="unitPrice" type="number" step="0.01" min="0" defaultValue={line.unitPrice ?? ""} className="mt-0.5 min-h-11 tabular-nums" />
                        </label>
                        <label className="block text-xs text-muted-foreground">
                          Ligne
                          <Select name="status" defaultValue={line.status === "ignored" ? "ignored" : "proposed"} className="mt-0.5 min-h-11 w-full">
                            <option value="proposed">À valider</option>
                            <option value="ignored">Ignorer</option>
                          </Select>
                        </label>
                      </AutoSaveForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!locked && (
            <section className="mt-6 rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-[14px] font-semibold text-foreground">Ajouter une ligne</h2>
              <CreateForm action={addReceiptLineAction} submitLabel="Ajouter" className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_7rem_auto] sm:items-end">
                <input type="hidden" name="receiptId" value={receipt.id} />
                <label className="block text-sm font-medium">
                  Libellé
                  <Input name="rawLabel" required placeholder="Farine sarrasin 25 kg" className="mt-1 min-h-11" />
                </label>
                <label className="block text-sm font-medium">
                  Qté
                  <Input name="quantity" type="number" step="0.01" min="0" defaultValue="1" className="mt-1 min-h-11" />
                </label>
                <label className="block text-sm font-medium">
                  Unité
                  <Input name="unit" placeholder="kg" className="mt-1 min-h-11" />
                </label>
                <label className="block text-sm font-medium">
                  Prix
                  <Input name="unitPrice" type="number" step="0.01" min="0" placeholder="—" className="mt-1 min-h-11" />
                </label>
              </CreateForm>
            </section>
          )}

          {!locked && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <CreateForm action={validateReceiptAction} submitLabel="Valider les prix" resetOnSuccess={false} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="receiptId" value={receipt.id} />
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input type="checkbox" name="applyStock" value="true" defaultChecked className="h-5 w-5 accent-[var(--accent)]" />
                  Ajouter les quantités au stock
                </label>
              </CreateForm>
              <DeleteButton action={rejectReceiptAction} fields={{ receiptId: receipt.id }} message="Bon ignoré" variant="ghost" confirmLabel="Ignorer ?">
                Ignorer ce bon
              </DeleteButton>
              {unmatched > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  {unmatched} ligne{unmatched > 1 ? "s" : ""} sans article — elles ne seront pas enregistrées.
                </p>
              )}
            </div>
          )}
        </div>

        {receipt.hasImage && (
          <aside>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/receipts/${receipt.id}/image`}
              alt="Photo du bon"
              className="w-full rounded-lg border border-border bg-muted object-contain"
            />
          </aside>
        )}
      </div>
    </>
  );
}
