# État du plan (source de vérité pour les agents cloud)

- repo: `GremTristan/creperie-saas`
- base: `main`
- current: `S4`
- auto_merge: false
- last_pr: https://github.com/GremTristan/creperie-saas/pull/6
- blocker: none
- pos_adapter: zelty

## Fait

- SaaS multi-tenant (caisse, KDS, stock, direction)
- Cartes imprimées + inventaire Molard janvier 2026
- Taxonomie friction (canvas local, pas dans ce repo)
- S0 `capture_events` + hooks stores + backfill (PR #1)
- S1 direction L0 : activité (délais cuisine, temps à table, CA par personne, annulés/pertes, CSV tickets)
- S2 Molard : 15 plats tête de gondole (recettes quantifiées, coût/marge direction, théorique vs comptage ; le reste non chiffré)
- S3 OCR livraisons : `receipts` / `receipt_lines` / `supplier_prices`, matching stock, validation directeur

## En cours — S4 uniquement

Adaptateur POS externe **Zelty** → TicketNormalized → `capture_events` (idempotent). Pas de caisse concurrente.

## Ensuite

(fin du plan capture)
