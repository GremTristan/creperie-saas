import Link from "next/link";
import type { Metadata } from "next";
import { RefreshCw, Tablet, Trash2 } from "lucide-react";
import { ActionButton, AutoSaveForm, CreateForm, DeleteButton } from "@/components/direction/forms";
import { PageHeader } from "@/components/direction/ui";
import { Input } from "@/components/ui/input";
import { addSiteAction, deleteSiteAction, updateSiteAction } from "@/lib/direction-actions";
import { pageDirector } from "@/lib/page-guards";
import { listPosBindings } from "@/lib/pos/bindings";
import { getSitesForTenant } from "@/lib/site-store";
import { getUsersForTenant } from "@/lib/user-store";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Établissements" };

export default async function EtablissementsPage() {
  const { tenant } = await pageDirector({ allowInactiveTenant: true });
  const [sites, users, bindings] = await Promise.all([
    getSitesForTenant(tenant.id),
    getUsersForTenant(tenant.id),
    listPosBindings(tenant.id, "zelty"),
  ]);
  const zeltyBySite = new Map(bindings.map((b) => [b.siteId, b.externalId]));
  const webhookReady = Boolean(process.env.ZELTY_WEBHOOK_SECRET);

  return (
    <>
      <PageHeader
        title="Établissements"
        description="Chaque point de vente a son code tablette : saisi une fois sur la tablette, il donne accès au pavé de connexion de l’équipe."
      />

      <section className="mb-8 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-base font-bold text-foreground">Ouvrir un nouvel établissement</h2>
        <CreateForm action={addSiteAction} submitLabel="Créer" className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1 text-sm font-medium">
            Nom
            <Input name="name" required placeholder="Lausanne – Flon" className="mt-1 min-h-11" />
          </label>
        </CreateForm>
        <p className="mt-2 text-xs text-muted-foreground">Facturé par établissement actif — voir « Abonnement ».</p>
      </section>

      <ul className="grid gap-3 md:grid-cols-2">
        {sites.map((site) => {
          const team = users.filter((u) => u.siteId === site.id && u.active).length;
          return (
            <li key={site.id} className={cn("rounded-lg border border-border bg-card p-4", !site.active && "opacity-60")}>
              <AutoSaveForm action={updateSiteAction}>
                <input type="hidden" name="id" value={site.id} />
                <Input name="name" defaultValue={site.name} aria-label="Nom de l’établissement" className="min-h-11 text-lg font-bold" />
              </AutoSaveForm>
              <p className="mt-2 text-sm text-muted-foreground">
                {team} personne{team > 1 ? "s" : ""} dans l’équipe · {site.active ? "actif" : "désactivé"}
              </p>

              <div className="mt-4 flex items-center gap-3 rounded-control bg-muted p-3">
                <Tablet className="h-6 w-6 shrink-0 text-accent" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Code tablette</p>
                  <p className="font-mono text-[20px] font-bold tracking-tight tracking-[0.3em] text-foreground">{site.deviceCode}</p>
                </div>
                <ActionButton action={updateSiteAction} fields={{ id: site.id, rotateCode: "1" }} message="Nouveau code généré — les tablettes déjà reliées restent connectées" variant="ghost" size="icon" aria-label="Générer un nouveau code">
                  <RefreshCw className="h-5 w-5" />
                </ActionButton>
              </div>

              <AutoSaveForm action={updateSiteAction} className="mt-4" message="Lien Zelty enregistré">
                <input type="hidden" name="id" value={site.id} />
                <label className="block text-sm font-medium">
                  ID restaurant Zelty
                  <Input
                    name="zeltyRestaurantId"
                    defaultValue={zeltyBySite.get(site.id) ?? ""}
                    placeholder="ex. 12345"
                    className="mt-1 min-h-11 font-mono"
                  />
                </label>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Les tickets Zelty alimentent l’activité sans ouvrir une deuxième caisse.
                  {!webhookReady && " Secret webhook non configuré côté serveur."}
                </p>
              </AutoSaveForm>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/direction/equipe?site=${site.id}`} className="min-h-11 inline-flex items-center rounded-md bg-muted px-4 text-sm font-medium hover:bg-border/60">
                  Équipe
                </Link>
                <Link href={`/direction/menu?site=${site.id}`} className="min-h-11 inline-flex items-center rounded-md bg-muted px-4 text-sm font-medium hover:bg-border/60">
                  Menu
                </Link>
                <ActionButton
                  action={updateSiteAction}
                  fields={{ id: site.id, active: site.active ? "false" : "true" }}
                  message={site.active ? `${site.name} mis en pause` : `${site.name} réactivé`}
                  variant="secondary"
                  size="sm"
                >
                  {site.active ? "Mettre en pause" : "Réactiver"}
                </ActionButton>
                {sites.length > 1 && (
                  <DeleteButton action={deleteSiteAction} fields={{ id: site.id }} message={`${site.name} supprimé`} variant="ghost" size="icon" aria-label="Supprimer" confirmLabel="Tout supprimer ?">
                    <Trash2 className="h-5 w-5 text-destructive" />
                  </DeleteButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
