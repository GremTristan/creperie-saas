# État du plan (source de vérité pour les agents cloud)

- repo: `GremTristan/creperie-saas`
- base: `main`
- current: `S3`
- auto_merge: false
- last_pr: none
- blocker: none

## Fait

- SaaS multi-tenant (caisse, KDS, stock, direction)
- Cartes imprimées + inventaire Molard janvier 2026
- Taxonomie friction (canvas local, pas dans ce repo)
- S0 `capture_events` + hooks stores + backfill (PR #1)
- S1 direction L0 : activité (délais cuisine, temps à table, CA par personne, annulés/pertes, CSV tickets)
- S2 Molard : 15 plats tête de gondole (recettes quantifiées, coût/marge direction, théorique vs comptage ; le reste non chiffré)

## En cours — S3 uniquement

OCR structuré sur `receipts` → lignes proposées, matching stock, `supplier_prices`, validation directeur.

## Ensuite

S4 (POS à choisir à S4, pas maintenant)
