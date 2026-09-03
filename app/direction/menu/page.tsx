import type { Metadata } from "next";
import { Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { ActionButton, AutoSaveForm, CreateForm, DeleteButton } from "@/components/direction/forms";
import { RecipeEditor } from "@/components/direction/recipe-editor";
import { EmptyState, PageHeader, SiteTabs } from "@/components/direction/ui";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addMenuItemAction, deleteMenuItemAction, propagateMenuAction, updateMenuItemAction } from "@/lib/direction-actions";
import { canUse } from "@/lib/billing/plans";
import { buildDishCostRow } from "@/lib/food-cost-math";
import { getInventoryBySite } from "@/lib/inventory-store";
import { getIngredientsForMenuItems, getMenuItems } from "@/lib/menu-store";
import { formatMoney } from "@/lib/money";
import { pageDirector } from "@/lib/page-guards";
import { getSitesForTenant } from "@/lib/site-store";
import { MENU_CATEGORY_LABELS, MENU_CATEGORY_ORDER } from "@/types";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site: siteParam } = await searchParams;
  const { tenant } = await pageDirector();
  const sites = (await getSitesForTenant(tenant.id)).filter((s) => s.active);
  const site = sites.find((s) => s.id === siteParam) ?? sites[0];
  if (!site) return <EmptyState title="Créez d’abord un établissement" />;

  const [menu, inventory] = await Promise.all([getMenuItems(site.id), getInventoryBySite(site.id)]);
  const ingredients = await getIngredientsForMenuItems(menu.map((m) => m.id));
  const recipesEnabled = canUse(tenant, "recipes");

  return (
    <>
      <PageHeader
        title="Menu"
        description="Produits, prix, disponibilité et recettes. « Copier cette carte » propage aussi les recettes vers les autres établissements (par nom d’article de stock)."
        action={
          sites.length > 1 ? (
            <ActionButton
              action={propagateMenuAction}
              fields={{ siteId: site.id }}
              message="Carte copiée vers les autres établissements"
              variant="secondary"
            >
              <Copy className="h-4 w-4" /> Copier cette carte vers les autres établissements
            </ActionButton>
          ) : undefined
        }
      />
      <SiteTabs sites={sites} current={site.id} basePath="/direction/menu" />

      <section className="mb-8 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-base font-bold text-foreground">Ajouter un produit</h2>
        <CreateForm action={addMenuItemAction} submitLabel="Ajouter" className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end">
          <input type="hidden" name="siteId" value={site.id} />
          <label className="block text-sm font-medium">
            Nom
            <Input name="name" required placeholder="Complète" className="mt-1 min-h-11" />
          </label>
          <label className="block text-sm font-medium">
            Prix ({tenant.currency})
            <Input name="price" type="number" step="0.10" min="0" required placeholder="14.00" className="mt-1 min-h-11" />
          </label>
          <label className="block text-sm font-medium">
            Catégorie
            <Select name="category" defaultValue="salee" className="mt-1 min-h-11 w-full">
              {MENU_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {MENU_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </label>
        </CreateForm>
      </section>

      {menu.length === 0 ? (
        <EmptyState title="La carte est vide" description="Ajoutez vos crêpes et boissons ci-dessus : elles apparaissent aussitôt sur les tablettes." />
      ) : (
        MENU_CATEGORY_ORDER.map((category) => {
          const items = menu.filter((m) => m.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="mb-6">
              <h2 className="mb-2 text-base font-bold text-muted-foreground">{MENU_CATEGORY_LABELS[category]}</h2>
              <ul className="space-y-2">
                {items.map((item) => {
                  const lines = ingredients.filter((i) => i.menuItemId === item.id);
                  const costRow =
                    site.slug === "molard"
                      ? buildDishCostRow({
                          menuItemId: item.id,
                          name: item.name,
                          price: item.price,
                          lines: lines.map((line) => {
                            const inv = inventory.find((i) => i.id === line.inventoryItemId);
                            return {
                              inventoryItemId: line.inventoryItemId,
                              inventoryName: inv?.name ?? "",
                              quantity: line.quantity,
                              unitPrice: inv?.unitPrice ?? 0,
                            };
                          }),
                          soldQty: 0,
                        })
                      : null;
                  return (
                  <li key={item.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <AutoSaveForm action={updateMenuItemAction} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={item.id} />
                        <Input name="name" defaultValue={item.name} aria-label="Nom" className="min-h-11 min-w-40 flex-1" />
                        <Input
                          name="price"
                          type="number"
                          step="0.10"
                          min="0"
                          defaultValue={item.price.toFixed(2)}
                          aria-label="Prix"
                          className="min-h-11 w-28 text-right tabular-nums"
                        />
                        <Select name="category" defaultValue={item.category} aria-label="Catégorie" className="min-h-11">
                          {MENU_CATEGORY_ORDER.map((c) => (
                            <option key={c} value={c}>
                              {MENU_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </Select>
                      </AutoSaveForm>
                      <ActionButton
                        action={updateMenuItemAction}
                        fields={{ id: item.id, available: item.available ? "false" : "true" }}
                        message={item.available ? `${item.name} retiré des tablettes` : `${item.name} de nouveau disponible`}
                        variant={item.available ? "secondary" : "outline"}
                        className={item.available ? "" : "border-warning text-warning"}
                      >
                        {item.available ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        {item.available ? "Disponible" : "En rupture"}
                      </ActionButton>
                      <DeleteButton action={deleteMenuItemAction} fields={{ id: item.id }} message={`${item.name} supprimé`} variant="ghost" size="icon" aria-label="Supprimer" confirmLabel="Supprimer ?">
                        <Trash2 className="h-5 w-5 text-destructive" />
                      </DeleteButton>
                    </div>
                    {costRow && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {costRow.cost === null ? (
                          "Non chiffré"
                        ) : (
                          <>
                            Coût matière {formatMoney(costRow.cost, tenant.currency)} · marge{" "}
                            {formatMoney(costRow.margin ?? 0, tenant.currency)} (
                            {costRow.marginPct?.toLocaleString("fr-CH", { maximumFractionDigits: 0 })} %)
                          </>
                        )}
                      </p>
                    )}
                    <RecipeEditor
                      menuItem={item}
                      inventory={inventory}
                      lines={lines}
                      enabled={recipesEnabled}
                    />
                  </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
