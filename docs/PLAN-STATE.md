# État du plan (source de vérité pour les agents cloud)

- repo: `GremTristan/creperie-saas`
- base: `main`
- current: `S1`
- auto_merge: false
- last_pr: https://github.com/GremTristan/creperie-saas/pull/1
- blocker: none

## Fait

- SaaS multi-tenant (caisse, KDS, stock, direction)
- Cartes imprimées + inventaire Molard janvier 2026
- Taxonomie friction (canvas local, pas dans ce repo)
- S0 `capture_events` + hooks stores + backfill (PR ouverte, pas mergée)

## En cours — S1 uniquement

Direction L0 (lecture seule, zéro champ salle neuf) : délais KDS p50/p90, CA par serveur, durée table, annulés/waste, export CSV tickets brut.

## Ensuite

S2 → S3 → S4 (POS à choisir à S4, pas maintenant)
