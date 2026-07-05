# Lab 11 — Projet final : pipeline CI/CD complet de TribuZen (capstone)

> **Outcome :** à la fin, tu as **conçu et construit** le pipeline CI/CD complet de TribuZen de bout en bout — de `git push` à la production — sur un vrai dépôt GitHub : quality (coverage gate) → build & push GHCR → deploy canary + rollback → preview envs par PR → OIDC sans secret → métriques DORA.
> **Vrai outil :** un dépôt GitHub réel + GitHub Actions + Docker + GHCR. **Aucun harnais simulé.** Le feedback vient des runs réels dans l'onglet Actions.
> **Feedback :** le coach valide en session sur les runs GitHub (workflows verts, image publiée, PR commentée, rollback observable). Pas de test-runner auto-correcteur.

---

## Énoncé

C'est le **capstone** du cours. Tu assembles, dans **un seul dépôt**, tout ce que les modules 00-10 ont introduit séparément. On ne t'apprend rien de neuf : tu **branches ensemble** les briques que tu sais déjà écrire.

Tu pars du dépôt `smaurier/tribuzen` (ou un fork/dépôt d'entraînement contenant l'API NestJS avec un `Dockerfile` multi-stage et une commande `npm run test:cov`). Ta mission : livrer les **quatre workflows** et **trois briques** ci-dessous, tous fonctionnels sur des runs réels.

### Cahier des charges (contrat exact)

**A. `ci.yml` — la porte (bloquant)**
1. Déclenché sur `pull_request` et `push` sur `main`.
2. Job `quality` en matrix Node `20` et `22` : `npm ci` → `npm run lint` → `npm run test:cov`.
3. La couverture **échoue le job** sous 80 % (seuil dans la config du runner).
4. `concurrency` par branche avec `cancel-in-progress: true` (CI de PR).

**B. `cd.yml` — la livraison**
5. Déclenché sur `push` `main` et `tag v*`. `concurrency` avec `cancel-in-progress: false`.
6. `quality` (réutilisé ou appelé via `reusable-test.yml`) → `publish` → `deploy` → `metrics`.
7. `publish` : login GHCR au **moindre privilège** (`packages: write`), tags via `metadata-action` (semver + sha + latest), build+push avec cache `type=gha`, **remonte le `digest` en output de job**.
8. `deploy` : `environment: production`, **OIDC** (`id-token: write`), canary `5% → 25% → 100%` avec une **gate** `monitor.sh` entre chaque palier et un **rollback** `if: failure()`.
9. `metrics` : `if: always()`, émet le résultat du deploy + notifie l'échec (Slack webhook en secret).

**C. `preview.yml` + `preview-cleanup.yml` — les environnements de PR**
10. `preview.yml` sur `pull_request: [opened, synchronize]` : déploie l'env `preview-<n°>`, commente l'URL sur la PR (`github-script`).
11. `preview-cleanup.yml` sur `pull_request: [closed]` : détruit l'env.

**D. Les scripts (stubs autorisés)**
12. `scripts/deploy-canary.sh`, `monitor.sh`, `rollback.sh`, `deploy-preview.sh`, `destroy-preview.sh`. Pour le lab, ce sont des **stubs** qui `echo` leur action et retournent le bon code de sortie — l'important est le **câblage** du pipeline, pas l'infra cloud réelle. `monitor.sh` doit pouvoir `exit 1` pour prouver le rollback.

> **Pas de gap-fill.** Tu écris les fichiers complets à partir du squelette minimal. Le module 11 est ta référence ; ne le recopie pas sans comprendre chaque garde.

### Squelette de départ

```
tribuzen/
  apps/api/Dockerfile            # multi-stage, déjà présent (module 04)
  apps/api/.dockerignore
  package.json                   # scripts : lint, test:cov
  .github/workflows/             # ← à remplir : ci.yml, cd.yml, preview.yml, preview-cleanup.yml
  scripts/                       # ← à remplir : stubs .sh
```

---

## Étapes (en friction)

Travaille **étage par étage**, en poussant après chaque étape pour voir le run réel. Ne câble pas tout d'un coup.

1. **Conçois d'abord sur papier.** Dessine le graphe : quels événements, quels `needs`, quelles gardes `if`. Valide-le avant d'écrire une ligne de YAML.
2. **`ci.yml`** — écris le job `quality` en matrix, avec cache npm. Ouvre une PR bidon : vérifie que les 2 jobs (Node 20/22) tournent. Casse volontairement un test → le job doit rougir.
3. **Coverage gate** — configure le seuil à 80 % dans le runner. Baisse la couverture sous le seuil → `quality` doit échouer.
4. **`cd.yml` / `publish`** — ajoute le job `publish` (`needs: quality`), login GHCR, `metadata-action`, `build-push-action` avec cache. Push sur `main` → vérifie l'image dans l'onglet **Packages** avec les tags `sha-…` et `latest`.
5. **Remonte le `digest`** — ajoute `outputs.digest` au job `publish`. Ajoute un job `deploy` qui l'`echo` via `needs.publish.outputs.digest`. Vérifie qu'il n'est **pas vide** dans les logs.
6. **`deploy` canary** — écris les stubs `deploy-canary.sh` / `monitor.sh` / `rollback.sh`. Câble les paliers 5/25/100 avec une gate `monitor.sh` entre chaque. Ajoute le step `if: failure()` de rollback.
7. **Prouve le rollback** — fais `monitor.sh` `exit 1` (simule un error rate haut). Push → observe : les promotions suivantes sautent, `rollback.sh` s'exécute.
8. **`environment: production` + OIDC** — ajoute `permissions: id-token: write`, l'`environment`, et `configure-aws-credentials@v4` (le rôle IAM peut être fictif pour le lab ; l'objectif est le câblage `permissions`).
9. **`preview.yml`** — sur PR, déploie l'env + commente l'URL. Ouvre une PR → vérifie le commentaire automatique.
10. **`preview-cleanup.yml`** — ferme la PR → vérifie que `destroy-preview.sh` tourne.
11. **`metrics`** — ajoute le job `if: always()` + notification Slack sur `failure`. Fais échouer un deploy → vérifie que `metrics` tourne **quand même**.
12. **Relis tes gardes.** Aucun `deploy` ne doit partir d'une PR ; aucun `cancel-in-progress: true` sur un job de déploiement ; aucun secret cloud long terme à côté de l'OIDC.

---

## Grille récapitulative (auto-évaluation avant le coach)

Coche chaque ligne **sur un run réel**, pas de tête.

| # | Critère | Preuve attendue | ✅ |
|---|---|---|---|
| 1 | `quality` bloquant en matrix 20/22 | 2 jobs verts sur une PR | ☐ |
| 2 | Coverage gate < 80 % échoue | run rouge après baisse de couverture | ☐ |
| 3 | Image publiée sur GHCR, tags propres | `sha-…` + `latest` dans Packages | ☐ |
| 4 | `digest` remonté en output de job | valeur non vide dans les logs `deploy` | ☐ |
| 5 | Déploie par digest, pas `latest` | `deploy-canary.sh` reçoit le `@sha256` | ☐ |
| 6 | Canary 5 → 25 → 100 avec gates | 3 paliers + 2 `monitor` dans les logs | ☐ |
| 7 | Rollback automatique | `monitor.sh exit 1` → `rollback.sh` s'exécute | ☐ |
| 8 | `deploy` jamais depuis une PR | garde de branche / déclencheur correct | ☐ |
| 9 | `cancel-in-progress: false` sur deploy | présent dans `cd.yml` | ☐ |
| 10 | OIDC, `id-token: write` par job | pas d'`AWS_SECRET_ACCESS_KEY` en secret | ☐ |
| 11 | `permissions` least privilege par job | aucun `write-all` | ☐ |
| 12 | Preview par PR + URL commentée | commentaire auto sur la PR | ☐ |
| 13 | Teardown à la fermeture de PR | `destroy-preview.sh` sur `closed` | ☐ |
| 14 | `metrics` avec `if: always()` | job tourne même sur deploy échoué | ☐ |
| 15 | Découpage par intention (4 workflows) | ci / cd / preview / cleanup séparés | ☐ |

**Seuil de passage capstone : 13/15**, dont **obligatoirement** les lignes 2, 7, 8, 10 et 13 (les gates qui protègent la prod et les coûts).

---

## Coach — points de contrôle en session

Le coach ne lit pas ton YAML ligne à ligne : il te fait **prouver** le comportement sur des runs.

- **« Montre-moi le rollback. »** Tu dois pouvoir forcer `monitor.sh` à échouer et montrer, dans les logs, que les promotions s'arrêtent et que le rollback part. Si tu ne peux pas le déclencher à la demande, ta gate ne casse pas le step (piège #3 du module).
- **« D'où vient l'image déployée ? »** Réponse attendue : le `digest` remonté par `publish`, pas un tag. S'il répond `latest`, revoir §2.3/§2.4 du module.
- **« Que se passe-t-il si je merge pendant un déploiement ? »** Réponse : rien n'interrompt le deploy en cours (`cancel-in-progress: false`). Si tu as mis `true`, explique pourquoi c'est un piège en prod.
- **« Où sont tes secrets cloud ? »** Réponse attendue : **nulle part** — OIDC. Un `AWS_SECRET_ACCESS_KEY` en secret « au cas où » est un carton rouge.
- **« Un contributeur ouvre une PR : que voit-il, et que reste-t-il après merge ? »** Une URL de preview commentée ; après merge/close, **plus rien** (teardown).

**Red flags à corriger avant de valider :** un `main.yml` géant ; `permissions: write-all` ; un `deploy` atteignable depuis `pull_request` sans garde ; un job `metrics` sans `if: always()` ; des preview envs sans workflow `closed`.

---

## Variante J+30 (fading)

**Même objectif, de mémoire, en 90 minutes, sur un dépôt vierge d'entraînement**, avec **trois contraintes ajoutées** :

1. **Sans rouvrir le module 11 ni ce corrigé.** Tu redessines d'abord le graphe de jobs sur papier, puis tu écris.
2. **Ajoute une signature d'image cosign keyless** (module 05) dans `publish` : signe le **digest** via l'OIDC, sans clé stockée.
3. **Ajoute un `reusable-test.yml`** (module 02) réellement appelé par `ci.yml` **et** `cd.yml` — zéro duplication du job de test entre les deux.

**Critère de réussite :** un `push` sur `main` déclenche quality (factorisé) → image signée sur GHCR → canary → et un `monitor.sh` forcé en échec déclenche le rollback. Tu l'expliques à voix haute sans regarder tes notes.

---

## Application TribuZen

Ce lab **est** l'aboutissement du fil-rouge : le vrai pipeline de `smaurier/tribuzen`, dans `.github/`.

```
tribuzen/
  .github/
    workflows/
      ci.yml
      cd.yml
      preview.yml
      preview-cleanup.yml
      reusable-test.yml
    actions/setup-project/action.yml
  apps/api/Dockerfile
  scripts/
    deploy-canary.sh  monitor.sh  rollback.sh
    deploy-preview.sh  destroy-preview.sh
```

**Différences avec le lab :**
- Les `scripts/*.sh` du lab sont des **stubs** ; dans le vrai TribuZen ils pilotent l'infra réelle (déclarée en IaC, module 09 / cours 12).
- Le rôle IAM d'OIDC est réel et restreint au repo/branche via la condition `sub` du trust policy (côté cloud).
- La base de données de preview suit une vraie stratégie (schéma isolé ou éphémère par PR, module 07), pas un stub.

**Commits cibles :**
```
ci(pipeline): quality matrix Node 20/22 + coverage gate ≥ 80%
ci(pipeline): cd.yml — publish GHCR (digest) → canary 5/25/100 + rollback
ci(pipeline): preview envs par PR + teardown à la fermeture
ci(pipeline): OIDC sans secret long terme + métriques DORA + Slack
```
