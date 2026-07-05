---
titre: Projet final — pipeline CI/CD complet de TribuZen
cours: 15-cicd-devops
notions: ["synthèse du pipeline de bout en bout", "assemblage des étages (quality → build → publish → deploy)", "coverage gate en CI", "build image multi-stage + push GHCR", "stratégie canary (5% → 25% → 100%)", "rollback automatique sur error rate", "preview env par PR + teardown", "OIDC sans secret long terme", "permissions least privilege par job", "métriques DORA du pipeline", "conception d'une architecture de pipeline"]
outcomes:
  - sait concevoir l'architecture complète d'un pipeline CI/CD de bout en bout
  - sait assembler quality (lint/test/coverage), build multi-stage, publish GHCR et deploy en un pipeline cohérent
  - sait implémenter une stratégie de déploiement canary avec rollback automatique
  - sait câbler des preview environments par PR avec teardown et l'OIDC sans secret long terme
  - sait instrumenter le pipeline avec les métriques DORA et des notifications d'échec
prerequis: [Modules 00-10 du cours 15-cicd-devops (CI/CD, GitHub Actions fondamentaux et avancé, tests en CI, conteneurisation, artefacts/registries, stratégies de déploiement, preview envs, sécurité/OIDC, IaC, monitoring)]
next: fin-parcours-15-cicd-devops
libs: []
tribuzen: pipeline CI/CD complet de TribuZen — de git push à la production (quality, image GHCR, canary + rollback, preview envs, OIDC, DORA)
last-reviewed: 2026-07
---

# Projet final — pipeline CI/CD complet de TribuZen

> **Outcomes — tu sauras FAIRE :** concevoir puis assembler le pipeline CI/CD complet de TribuZen (quality → build → publish → deploy), câbler une stratégie canary avec rollback, des preview environments par PR, l'OIDC sans secret long terme, et les métriques DORA.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le **capstone** du cours. Il ne présente **aucune notion neuve** : il synthétise et **assemble** ce que les modules 00 à 10 ont introduit séparément. Chaque brique renvoie à son module d'origine. La sécurité applicative en profondeur reste le **cours 14**, le cloud/AWS le **cours 12**, l'observabilité produit le **cours 16** — ici on reste au niveau *pipeline*.

## 1. Cas concret d'abord

Onze semaines de cours, onze pièces. Aujourd'hui, on les **assemble**.

TribuZen a aujourd'hui, éparpillés dans `.github/`, tous les morceaux vus au fil du cours : un `ci.yml` matriciel (module 02), un Dockerfile multi-stage (module 04), un workflow de publication GHCR (module 05), des scripts de déploiement canary (module 06), un embryon de preview env (module 07), une config OIDC (module 08). Mais **rien n'est branché ensemble** : le build ne déclenche pas le déploiement, le déploiement ne sait pas rollback, les PR n'ont pas d'URL de preview, et personne ne mesure si on livre vite ou lentement.

La mission du capstone : transformer ces morceaux en **un pipeline unique et cohérent** qui va de `git push` à la production, en respectant ce cahier des charges TribuZen :

```text
                         git push / pull_request
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │ (pull_request)           │ (push main / tag v*)      │
        ▼                          ▼                           ▼
  ┌───────────┐            ┌───────────────┐          ┌───────────────┐
  │  quality  │            │    quality    │          │    quality    │
  │ lint+test │            │ + coverage ≥80│          │ + coverage    │
  │ +coverage │            └───────┬───────┘          └───────┬───────┘
  └─────┬─────┘                    ▼                          ▼
        ▼                   ┌───────────────┐          ┌───────────────┐
  ┌───────────┐            │ build & push  │          │ build & push  │
  │  preview  │            │ image → GHCR  │          │ image → GHCR  │
  │  env /PR  │            │ (OIDC, tags)  │          │ (semver+sha)  │
  │  + URL    │            └───────┬───────┘          └───────┬───────┘
  └───────────┘                    ▼                          ▼
                            ┌───────────────┐          ┌───────────────┐
                            │ deploy staging│          │ deploy canary │
                            │  (auto)       │          │ 5→25→100 +    │
                            └───────────────┘          │ rollback      │
                                                       └───────┬───────┘
                                                               ▼
                                                     DORA metrics + Slack
```

**Cinq exigences concrètes**, chacune reprise d'un module et **branchée** ici :

1. `quality` bloque tout si la couverture passe sous 80 % (**coverage gate**, module 03).
2. Le déploiement ne part **jamais** d'une PR, seulement de `main`/`tag`, derrière un `environment` protégé (modules 02 & 08).
3. La prod se déploie en **canary** `5% → 25% → 100%`, avec **rollback automatique** si le taux d'erreur dépasse le seuil (module 06).
4. Chaque PR obtient un **environnement de preview** éphémère + une URL commentée, détruit à la fermeture (module 07).
5. Aucun secret cloud long terme : l'auth se fait en **OIDC** au moindre privilège (module 08), et le pipeline **mesure** ses métriques DORA (module 10).

Ce module conçoit l'architecture, puis assemble les workflows qui satisfont ces cinq points.

---

## 2. Théorie complète, concise

> Rappel : rien de neuf ici. Chaque sous-section **rassemble** une brique déjà vue et montre **comment la brancher** aux autres.

### 2.1 Concevoir avant de câbler : le graphe de jobs

Un pipeline est un **graphe orienté de jobs** reliés par `needs`. Le concevoir revient à répondre à trois questions dans l'ordre :

1. **Quels événements** déclenchent quoi ? `pull_request` → quality + preview ; `push` sur `main` → quality + build + deploy ; `push` d'un `tag v*` → release en prod.
2. **Quel ordre de dépendances** ? `deploy` a besoin de `build`, qui a besoin de `quality`. On l'exprime par `needs`, jamais en supposant qu'un job voit le disque d'un autre (module 02).
3. **Quelles gardes** sur chaque transition ? Une condition `if` protège le passage vers un étage sensible (déployer seulement depuis `main`, seulement si `quality` est vert).

On sépare le pipeline en **workflows par intention** plutôt qu'un fichier géant :

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `ci.yml` | `pull_request`, `push` | quality (lint/test/coverage) — la porte d'entrée |
| `cd.yml` | `push` main, `tag v*` | build → publish GHCR → deploy (staging/canary) |
| `preview.yml` | `pull_request` (opened/synchronize) | déploie l'env éphémère + commente l'URL |
| `preview-cleanup.yml` | `pull_request` (closed) | détruit l'env éphémère |

Découper ainsi rend chaque workflow lisible, testable et réutilisable (un `reusable workflow` de test partagé entre `ci.yml` et `cd.yml`, module 02).

### 2.2 Étage quality — la porte d'entrée (coverage gate)

Premier étage, **bloquant** : lint + type-check + tests avec un **coverage gate**. La couverture est produite par le test runner ; le seuil se pose soit dans la config du runner (échec sous 80 %), soit par un step explicite qui lit le rapport. C'est ce job qui sert de *required status check* dans la branch protection (module 08).

```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]          # back testé sur 2 versions (module 02)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:cov     # échoue si coverage < 80% (seuil dans la config runner)
```

Tout le reste du pipeline `needs: quality` : rien ne se construit ni ne se déploie tant que cette porte n'est pas verte.

### 2.3 Étage build & publish — l'image immuable

Une fois `quality` vert, on produit **l'artefact déployable** : l'image Docker multi-stage (module 04), poussée sur GHCR avec des tags propres (module 05). C'est **le même commit** qui a été testé — traçabilité de bout en bout.

```yaml
  publish:
    needs: quality
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write            # least privilege : écrire sur GHCR, rien de plus
    outputs:
      digest: ${{ steps.build.outputs.digest }}   # transmis au job deploy
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository_owner }}/tribuzen-api
          tags: |
            type=semver,pattern={{version}}
            type=sha
            type=raw,value=latest,enable={{is_default_branch}}
      - id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

La sortie `steps.build.outputs.digest` remonte en **output du job** (`jobs.publish.outputs.digest`) pour que `deploy` déploie **par digest** — la seule référence immuable (module 05), jamais `latest`.

### 2.4 Étage deploy — canary + rollback automatique

Le déploiement de prod suit une **stratégie canary** (module 06) : on route un petit % du trafic vers la nouvelle version, on **observe** les métriques, on promeut par paliers, et on **rollback** au moindre dépassement de seuil. Le job cible un `environment` protégé (approval + secrets dédiés, module 02/08).

```yaml
  deploy:
    needs: publish
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      id-token: write            # OIDC (module 08) — pas de clé cloud stockée
      contents: read
    environment:
      name: production
      url: https://app.tribuzen.fr
    concurrency:
      group: deploy-production    # un seul déploiement prod à la fois
      cancel-in-progress: false   # ne JAMAIS couper un déploiement en cours
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
          aws-region: eu-west-3
      - name: Canary 5%
        run: ./scripts/deploy-canary.sh 5 "${{ needs.publish.outputs.digest }}"
      - name: Observe (error rate gate)
        run: ./scripts/monitor.sh --duration=600 --error-threshold=1%
      - name: Promote 25%
        run: ./scripts/deploy-canary.sh 25 "${{ needs.publish.outputs.digest }}"
      - name: Observe
        run: ./scripts/monitor.sh --duration=600 --error-threshold=1%
      - name: Full rollout 100%
        run: ./scripts/deploy-canary.sh 100 "${{ needs.publish.outputs.digest }}"
      - name: Rollback si un step précédent a échoué
        if: failure()
        run: ./scripts/rollback.sh
```

Deux mécanismes clés :
- `./scripts/monitor.sh` sort en **code d'erreur ≠ 0** si l'error rate dépasse 1 % → le step échoue → les steps de promotion suivants sont sautés.
- Le step `if: failure()` (module 02) rattrape **n'importe quel** échec en amont dans le job et lance le `rollback.sh` : retour instantané à la version stable précédente.

`concurrency` avec `cancel-in-progress: false` garantit qu'un nouveau merge n'**interrompt pas** un déploiement en cours (piège classique : couper un canary à mi-course laisse le trafic partagé).

### 2.5 Preview environments par PR

Chaque PR déploie un **environnement éphémère** (module 07) et commente son URL, pour une review **visuelle** (pas seulement du code). Deux workflows symétriques : un pour créer/mettre à jour, un pour détruire.

```yaml
# preview.yml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write        # commenter la PR
      id-token: write             # OIDC vers l'infra de preview
    environment:
      name: preview-${{ github.event.number }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - id: deploy
        run: |
          URL=$(./scripts/deploy-preview.sh "pr-${{ github.event.number }}")
          echo "url=$URL" >> "$GITHUB_OUTPUT"
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `Preview déployée : ${{ steps.deploy.outputs.url }}`
            })
```

Le **teardown** vit dans un workflow distinct déclenché sur `pull_request: [closed]` (qu'elle soit mergée ou non), pour éviter que les environnements et leur base de données s'accumulent (coût). La stratégie de base de données de preview (partagée à schéma isolé vs éphémère par PR) est un choix produit, discuté au module 07.

### 2.6 OIDC — déployer sans secret long terme

L'auth vers le cloud n'utilise **aucune** clé stockée (module 08) : GitHub émet un **jeton OIDC éphémère**, le cloud l'échange contre des credentials courts via un rôle de confiance.

```yaml
permissions:
  id-token: write        # autorise GitHub à émettre le jeton OIDC pour ce job
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
      aws-region: eu-west-3
      # aucun aws-access-key-id / aws-secret-access-key : c'est tout l'intérêt
```

Trois garanties : pas de credential long terme à faire fuiter, jeton **éphémère** (~15 min), périmètre **limité** (le rôle IAM restreint la confiance au repo/branche précis via la condition `sub` du trust policy — configuré côté cloud, cours 12). `id-token: write` se déclare **par job**, jamais globalement.

### 2.7 Monitoring — métriques DORA & notifications

Un pipeline qu'on ne mesure pas ne s'améliore pas. On instrumente les **quatre métriques DORA** (module 10), au minimum via des annotations et un webhook :

| Métrique DORA | Ce qu'on mesure dans le pipeline |
|---|---|
| Deployment frequency | nombre de déploiements prod réussis / période |
| Lead time for changes | temps entre le commit et son déploiement en prod |
| Change failure rate | % de déploiements suivis d'un rollback/incident |
| Time to restore | temps entre l'incident et le retour à stable |

```yaml
  metrics:
    needs: deploy
    if: always()               # mesurer succès ET échec (change failure rate)
    runs-on: ubuntu-latest
    steps:
      - name: Émettre les métriques
        run: |
          echo "::notice::deploy_result=${{ needs.deploy.result }}"
          echo "::notice::sha=${{ github.sha }} run=${{ github.run_id }}"
      - name: Notifier l'échec
        if: needs.deploy.result == 'failure'
        run: |
          curl -sS -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"Deploy prod échoué sur ${{ github.ref_name }}\"}" \
            "${{ secrets.SLACK_WEBHOOK_URL }}"
```

`if: always()` sur le job `metrics` est indispensable : sans lui, un déploiement **échoué** ne serait pas comptabilisé, et le *change failure rate* serait faussement à 0 %.

---

## 3. Worked examples

### Exemple 1 — `cd.yml` assemblé de bout en bout

On câble les étages §2.2 → §2.7 en un seul workflow de livraison continue. C'est le cœur du capstone : chaque job `needs` le précédent, chaque garde protège la transition.

```yaml
# .github/workflows/cd.yml — livraison continue TribuZen
name: CD
on:
  push:
    branches: [main]
    tags: ['v*']

concurrency:
  group: cd-${{ github.ref }}
  cancel-in-progress: false        # ne pas couper une release en cours

jobs:
  # ── Étage 1 : porte d'entrée (bloquant) ──────────────────────────
  quality:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run test:cov       # coverage gate ≥ 80% (échoue sinon)

  # ── Étage 2 : image immuable → GHCR ──────────────────────────────
  publish:
    needs: quality
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository_owner }}/tribuzen-api
          tags: |
            type=semver,pattern={{version}}
            type=sha
            type=raw,value=latest,enable={{is_default_branch}}
      - id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ── Étage 3 : déploiement prod canary + rollback ─────────────────
  deploy:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      id-token: write               # OIDC, pas de clé cloud
      contents: read
    environment:
      name: production              # approval + secrets dédiés (UI)
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
          aws-region: eu-west-3
      - name: Canary 5%
        run: ./scripts/deploy-canary.sh 5 "${{ needs.publish.outputs.digest }}"
      - name: Observe 5%
        run: ./scripts/monitor.sh --duration=600 --error-threshold=1%
      - name: Promote 25%
        run: ./scripts/deploy-canary.sh 25 "${{ needs.publish.outputs.digest }}"
      - name: Observe 25%
        run: ./scripts/monitor.sh --duration=600 --error-threshold=1%
      - name: Full rollout 100%
        run: ./scripts/deploy-canary.sh 100 "${{ needs.publish.outputs.digest }}"
      - name: Rollback automatique
        if: failure()
        run: ./scripts/rollback.sh

  # ── Étage 4 : métriques DORA (toujours) ──────────────────────────
  metrics:
    needs: deploy
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo "::notice::deploy_result=${{ needs.deploy.result }} sha=${{ github.sha }}"
      - name: Notifier l'échec
        if: needs.deploy.result == 'failure'
        run: |
          curl -sS -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"Deploy prod échoué (${{ github.ref_name }})\"}" \
            "${{ secrets.SLACK_WEBHOOK_URL }}"
```

**Lecture du pipeline :**
1. `quality` (matrix Node 20/22) est la seule porte. `publish` `needs: quality` → aucune image sans code vert.
2. `publish` sort le `digest` en **output de job** ; `deploy` le lit via `needs.publish.outputs.digest` → on déploie **par digest immuable**, pas par tag mouvant.
3. `deploy` déroule le canary ; chaque `monitor.sh` est une **gate** : s'il échoue, les promotions suivantes sont sautées et `if: failure()` déclenche le rollback.
4. `metrics` `if: always()` comptabilise **succès comme échec** — sinon le change failure rate serait biaisé.
5. Le `deploy` est derrière l'`environment: production` : approbation humaine + secrets dédiés, gérés dans l'UI GitHub, pas dans le YAML.

### Exemple 2 — preview par PR + teardown (deux workflows symétriques)

```yaml
# .github/workflows/preview.yml — créer / mettre à jour l'env de PR
name: Preview
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run test:cov       # même porte que la prod : pas de preview si rouge

  preview:
    needs: quality
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write          # commenter la PR
      id-token: write               # OIDC vers l'infra de preview
    environment:
      name: preview-${{ github.event.number }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - id: deploy
        run: |
          URL=$(./scripts/deploy-preview.sh "pr-${{ github.event.number }}")
          echo "url=$URL" >> "$GITHUB_OUTPUT"
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `Preview déployée : ${{ steps.deploy.outputs.url }}`
            })
```

```yaml
# .github/workflows/preview-cleanup.yml — détruire l'env à la fermeture
name: Preview cleanup
on:
  pull_request:
    types: [closed]                 # mergée OU fermée sans merge

jobs:
  destroy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/destroy-preview.sh "pr-${{ github.event.number }}"
```

**Pourquoi deux workflows :** le cycle de vie de l'environnement suit celui de la PR. `synchronize` (nouveau push sur la PR) **met à jour** la preview ; `closed` la **détruit** systématiquement — c'est la garde anti-accumulation qui borne les coûts. Séparer création et destruction évite une logique de branchement fragile dans un seul fichier.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Supposer qu'un job voit le disque (ou les outputs) d'un autre sans câblage

Chaque job démarre sur une machine neuve (module 02). `deploy` ne « voit » pas le `digest` de `publish` par magie : il faut le **remonter en output de job** (`outputs:` au niveau job, pas seulement `steps`) puis le lire via `needs.publish.outputs.digest`. Oublier le `outputs:` du job → la valeur arrive vide et le déploiement pointe vers rien.

### PIÈGE #2 — Déploiement déclenché depuis une PR

```yaml
# ❌ un job deploy sans garde peut partir en prod depuis une simple PR
deploy:
  needs: publish
  steps: [ ... ]

# ✅ garder la branche ET vérifier le résultat des needs
deploy:
  needs: publish
  if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
```

Le workflow `cd.yml` de l'Exemple 1 ne se déclenche **que** sur `push main`/`tag`, donc la garde y est implicite — mais dès qu'un `pull_request` peut atteindre le même job, la condition `if` de branche redevient obligatoire.

### PIÈGE #3 — Rollback qui ne se déclenche pas parce que le gate ne « casse » pas le job

Un `monitor.sh` qui **log** l'error rate mais sort toujours en code 0 ne bloque rien : les promotions continuent et `if: failure()` ne se déclenche jamais. La gate doit **échouer le step** (`exit 1`) quand le seuil est dépassé — c'est l'échec du step qui saute les promotions suivantes et arme le rollback.

### PIÈGE #4 — `cancel-in-progress: true` sur un déploiement

Sur la CI d'une PR, annuler le run obsolète est idéal. Sur un **déploiement**, c'est dangereux : couper un canary à 25 % laisse le trafic **partagé** entre deux versions, sans personne pour finir la promotion ni rollback. Pour tout job de déploiement : `cancel-in-progress: false` (module 02).

### PIÈGE #5 — `id-token: write` déclaré trop large (ou secret cloud gardé « au cas où »)

`id-token: write` se pose **par job**, uniquement sur ceux qui font de l'OIDC. Le mettre au niveau workflow expose tous les jobs. Et garder un `AWS_SECRET_ACCESS_KEY` en secret « en secours » à côté de l'OIDC annule tout le bénéfice : la clé long terme reste une cible. OIDC **ou** clé, pas les deux.

### PIÈGE #6 — Métriques DORA qui ne comptent que les succès

```yaml
# ❌ sans if: always(), un deploy échoué ne remonte aucune métrique
metrics:
  needs: deploy
  steps: [ ... ]        # sauté si deploy a échoué → change failure rate faux à 0%

# ✅ mesurer succès ET échec
metrics:
  needs: deploy
  if: always()
```

Le *change failure rate* n'a de sens que si on **compte les échecs**. Un dashboard DORA qui n'agrège que les runs verts ment sur la stabilité.

### PIÈGE #7 — Preview environments jamais détruits

Sans workflow `closed`, chaque PR laisse un environnement + une base de données qui vivent indéfiniment → facture qui gonfle en silence et quotas saturés. Le teardown sur `pull_request: [closed]` est aussi important que le déploiement lui-même.

### PIÈGE #8 — Un seul workflow géant

Empiler quality + build + deploy + preview + cleanup dans un `main.yml` unique rend les gardes `if` illisibles et couple des cycles de vie différents (une PR n'a rien à voir avec une release taggée). Découper par **intention** (`ci` / `cd` / `preview` / `cleanup`) garde chaque fichier lisible et permet de factoriser les tests en `reusable workflow`.

---

## 5. Ancrage TribuZen

Le capstone **est** le fil-rouge : le pipeline CI/CD complet de TribuZen, de `git push` à la production. Toutes les briques des modules 00-10 convergent dans `.github/` :

```
tribuzen/
  .github/
    workflows/
      ci.yml                 ← quality (lint/test/coverage gate) sur PR + main   [mod. 02-03]
      cd.yml                 ← publish GHCR → deploy canary + rollback + DORA     [Exemple 1]
      preview.yml            ← env éphémère par PR + URL commentée                [Exemple 2]
      preview-cleanup.yml    ← teardown à la fermeture de PR                      [mod. 07]
      reusable-test.yml      ← tests factorisés, appelés par ci.yml et cd.yml     [mod. 02]
    actions/
      setup-project/
        action.yml           ← composite : checkout deps + cache npm             [mod. 02]
  apps/
    api/
      Dockerfile             ← multi-stage NestJS (build → runtime alpine)        [mod. 04]
      .dockerignore
  scripts/
    deploy-canary.sh         ← route N% du trafic vers le digest                 [mod. 06]
    monitor.sh               ← gate error-rate (exit ≠ 0 si > seuil)             [mod. 06]
    rollback.sh              ← retour à la version stable précédente             [mod. 06]
    deploy-preview.sh        ← provisionne l'env de PR, imprime l'URL            [mod. 07]
    destroy-preview.sh       ← détruit l'env de PR                               [mod. 07]
```

**Ce que le pipeline garantit à TribuZen :**
- Le **même commit** est testé, imagé et déployé — le `digest` circule de `publish` à `deploy` (traçabilité totale).
- Aucun secret cloud long terme (**OIDC** partout où on parle à l'infra).
- Une régression en prod **rollback toute seule** (canary + `monitor.sh` + `if: failure()`).
- Chaque PR est **cliquable** avant merge (preview + URL), et l'infra se nettoie seule.
- L'équipe **voit** sa vélocité et sa stabilité (DORA + Slack sur échec).

> Le provisioning cloud sous-jacent (rôles IAM, réseau, base de données) relève de l'**IaC (module 09)** et du **cours 12 (cloud)**. Ici, on orchestre ; l'infra est déclarée ailleurs et référencée par le pipeline.

---

## 6. Points clés

1. Un pipeline est un **graphe de jobs** relié par `needs` + gardé par `if` ; on le **conçoit** (événements → dépendances → gardes) avant de l'écrire.
2. On découpe par **intention** (`ci` / `cd` / `preview` / `cleanup`), pas en un fichier géant, et on factorise les tests en `reusable workflow`.
3. `quality` (lint/test/**coverage gate**) est la **porte** : tout le reste `needs: quality`.
4. `publish` build l'image multi-stage et la pousse sur GHCR ; il **remonte le `digest`** en output de job pour que `deploy` déploie par référence **immuable**.
5. Le **canary** promeut par paliers `5% → 25% → 100%`, chaque `monitor.sh` est une gate qui doit **échouer le step** au dépassement de seuil ; `if: failure()` arme le **rollback**.
6. Un déploiement se protège par `environment` (approval + secrets), garde de branche, et `concurrency` avec `cancel-in-progress: false`.
7. **OIDC** (`id-token: write` par job) remplace toute clé cloud long terme ; least privilege partout (`permissions` par job).
8. Les **preview envs** vivent et meurent avec la PR (`opened/synchronize` → deploy, `closed` → teardown) — le teardown borne les coûts.
9. Les **métriques DORA** s'instrumentent avec un job `if: always()` (sinon le change failure rate ignore les échecs) + notification Slack sur `failure`.

---

## 7. Seeds Anki

```
Pourquoi séparer le pipeline en ci.yml / cd.yml / preview.yml plutôt qu'un fichier unique ?|Chaque workflow a un déclencheur et un cycle de vie propres (PR vs release taggée). Découper par intention garde les gardes if lisibles, permet de factoriser en reusable workflow, et évite de coupler des étages sans rapport.
Comment le job deploy récupère-t-il l'image produite par le job publish ?|publish déclare outputs.digest au niveau JOB (pas seulement step) ; deploy le lit via needs.publish.outputs.digest et déploie par digest immuable @sha256, jamais par latest. Sans le outputs: du job, la valeur arrive vide.
Qu'est-ce qui déclenche concrètement le rollback automatique dans un canary ?|monitor.sh sort en code ≠ 0 si l'error rate dépasse le seuil → le step échoue → les promotions suivantes sont sautées → le step if: failure() lance rollback.sh. Si monitor ne fait que logger (exit 0), rien ne se déclenche.
Pourquoi cancel-in-progress doit-il être false sur un job de déploiement ?|Couper un canary à mi-course (ex. 25%) laisse le trafic partagé entre deux versions sans personne pour finir ou rollback. Sur une CI de PR, true est idéal ; sur un déploiement, toujours false.
Pourquoi le job metrics doit-il avoir if: always() ?|Sans always(), un déploiement échoué saute le job metrics → le change failure rate serait faussement à 0%. On doit compter succès ET échecs pour que les métriques DORA reflètent la vraie stabilité.
Comment déployer vers le cloud sans stocker de secret long terme ?|OIDC : permissions id-token: write PAR JOB, une action comme configure-aws-credentials@v4 avec role-to-assume, aucun access key. GitHub émet un jeton éphémère (~15 min), le cloud l'échange via un rôle de confiance restreint au repo/branche.
Comment garantir qu'un job deploy ne parte jamais depuis une PR ?|Garde if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'), ET vérifier le résultat des needs. Un déclencheur limité à push main/tag rend la garde implicite, mais dès qu'un pull_request peut l'atteindre, le if de branche est obligatoire.
Quel est le cycle de vie d'un preview environment et pourquoi le teardown est-il critique ?|opened/synchronize → deploy + URL commentée ; closed (mergée ou non) → destroy. Sans workflow closed, chaque PR laisse un env + une DB qui vivent indéfiniment : coûts et quotas explosent. Le teardown vaut autant que le déploiement.
Quelles sont les 4 métriques DORA et comment les capter dans le pipeline ?|Deployment frequency (nb de deploys réussis), Lead time (commit → prod), Change failure rate (% de deploys suivis d'un rollback), Time to restore (incident → stable). Captées via annotations ::notice::, résultats de jobs (needs.deploy.result) et un job metrics if: always().
```

---

## Pont vers le lab

> Lab associé : `labs/lab-11-projet-final/README.md`. **Capstone** : concevoir puis construire le pipeline CI/CD complet de TribuZen de bout en bout (quality → publish GHCR → deploy canary + rollback → preview envs → OIDC → DORA) sur un vrai dépôt GitHub. Grille récapitulative, feedback coach en session, variante J+30. Aucun harnais simulé.

---

> **Note :** ce module est le **dernier module du parcours 15-cicd-devops**. Le `next` pointe vers `fin-parcours-15-cicd-devops` — tu as couvert l'intégralité du curriculum CI/CD & DevOps, de la boucle de feedback (module 00) au pipeline complet assemblé ici.

← [Module 10 — Monitoring des pipelines](10-monitoring-pipelines.md)
