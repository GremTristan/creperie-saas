import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { CreateForm } from "@/components/direction/forms";
import { PageHeader } from "@/components/direction/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { canUse } from "@/lib/billing/plans";
import { changePasswordAction, requestDeletionAction, updateBrandAction } from "@/lib/direction-actions";
import { pageDirector } from "@/lib/page-guards";

export const metadata: Metadata = { title: "Plus" };

export default async function ReglagesPage() {
  const { tenant } = await pageDirector({ allowInactiveTenant: true });
  const whiteLabel = canUse(tenant, "whiteLabel");

  return (
    <>
      <PageHeader title="Plus" description="Menu, sites, facturation et réglages de l’enseigne." />

      <nav className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Raccourcis">
        {[
          { href: "/direction/menu", label: "Menu" },
          { href: "/direction/couts", label: "Coûts" },
          { href: "/direction/etablissements", label: "Sites" },
          { href: "/direction/abonnement", label: "Billing" },
          { href: "/direction", label: "Accueil" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-muted"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Enseigne et tickets</h2>
        <CreateForm action={updateBrandAction} submitLabel="Enregistrer" resetOnSuccess={false} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Nom de l’enseigne
            <Input name="name" defaultValue={tenant.name} required className="mt-1 min-h-12" />
          </label>
          <label className="block text-sm font-medium">
            Devise
            <Select name="currency" defaultValue={tenant.currency} className="mt-1 min-h-12 w-full">
              <option value="CHF">CHF — franc suisse</option>
              <option value="EUR">EUR — euro</option>
            </Select>
          </label>
          <label className="block text-sm font-medium">
            Raison sociale (sur les tickets)
            <Input name="legalName" defaultValue={tenant.legalName ?? ""} placeholder="Ty Breizh SA" className="mt-1 min-h-12" />
          </label>
          <label className="block text-sm font-medium">
            E-mail de facturation
            <Input name="billingEmail" type="email" defaultValue={tenant.billingEmail ?? ""} className="mt-1 min-h-12" />
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            Adresse (sur les tickets)
            <Input name="legalAddress" defaultValue={tenant.legalAddress ?? ""} placeholder="Rue du Marché 12, 1204 Genève · TVA CHE-123.456.789" className="mt-1 min-h-12" />
          </label>
          <div className="sm:col-span-2 mt-2 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-foreground">À vos couleurs</h3>
            {!whiteLabel && (
              <p className="mt-1 text-xs text-warning">
                Logo et couleur personnalisés sont inclus dans la formule Pro.{" "}
                <Link href="/direction/abonnement" className="underline">
                  Voir les formules
                </Link>
              </p>
            )}
          </div>
          <label className="block text-sm font-medium">
            Couleur principale
            <div className="mt-1 flex items-center gap-3">
              <input type="color" name="brandColor" defaultValue={tenant.brandColor ?? "#1f6f5c"} disabled={!whiteLabel} className="h-12 w-16 cursor-pointer rounded-control border-0 bg-muted p-1" />
              <span className="text-xs text-muted-foreground">Boutons et accents sur toutes les tablettes</span>
            </div>
          </label>
          <label className="block text-sm font-medium">
            Logo (adresse https d’une image carrée)
            <Input name="logoUrl" type="url" defaultValue={tenant.logoUrl ?? ""} placeholder="https://…/logo.png" disabled={!whiteLabel} className="mt-1 min-h-12" />
          </label>
        </CreateForm>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-bold text-foreground">Mot de passe</h2>
        <CreateForm action={changePasswordAction} submitLabel="Changer le mot de passe" className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Nouveau mot de passe
            <Input name="password" type="password" required minLength={10} autoComplete="new-password" className="mt-1 min-h-12" />
          </label>
          <label className="block text-sm font-medium">
            Confirmation
            <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="mt-1 min-h-12" />
          </label>
        </CreateForm>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-bold text-foreground">Vos données</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Vos données vous appartiennent. Téléchargez-les à tout moment (format lisible par un tableur ou un développeur), ou demandez la suppression définitive de votre compte.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/api/export/donnees" className="inline-flex min-h-12 items-center gap-2 rounded-md bg-muted px-5 text-sm font-semibold text-foreground hover:bg-border/60">
            <Download className="h-4 w-4" /> Exporter toutes mes données (JSON)
          </Link>
        </div>
        <form action={requestDeletionAction} className="mt-6 rounded-lg border border-destructive/30 p-4">
          <h3 className="text-sm font-bold text-destructive">Supprimer le compte</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            L’accès est coupé immédiatement pour toute l’enseigne ; les données sont effacées définitivement sous 30 jours (délai légal de rétractation), sauf pièces comptables conservées selon la loi.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Input name="confirm" placeholder="Tapez SUPPRIMER" required className="min-h-12 max-w-52" />
            <ConfirmButton variant="secondary" confirmLabel="Oui, supprimer définitivement">
              Supprimer mon compte
            </ConfirmButton>
          </div>
        </form>
      </section>
    </>
  );
}
