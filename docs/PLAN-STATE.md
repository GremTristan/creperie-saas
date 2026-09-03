# État du plan (source de vérité pour les agents cloud)

- repo: `GremTristan/creperie-saas`
- base: `main`
- current: `S2`
- auto_merge: false
- last_pr: https://github.com/GremTristan/creperie-saas/pull/2
- blocker: none

## Fait

- SaaS multi-tenant (caisse, KDS, stock, direction)
- Cartes imprimées + inventaire Molard janvier 2026
- Taxonomie friction (canvas local, pas dans ce repo)
- S0 `capture_events` + hooks stores + backfill (PR #1, pas mergée)
- S1 direction L0 : activité (délais cuisine, temps à table, CA par personne, annulés/pertes, CSV tickets)

## En cours — S2 uniquement

15 plats tête de gondole Molard : quantités recette réelles, coût/marge direction, écart théorique vs count. Le reste « non chiffré ».

## Ensuite

S3 → S4 (POS à choisir à S4, pas maintenant)
