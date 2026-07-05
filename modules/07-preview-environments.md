---
titre: Preview Environments — environnements éphémères par pull request
cours: 15-cicd-devops
notions: ["pull_request events (opened/synchronize/reopened/closed)", "provisioning à l'ouverture / teardown à la fermeture", "detection du merge (github.event.pull_request.merged)", "URL de preview commentée sur la PR", "seed data (DB éphémère, schéma isolé, snapshot anonymisé)", "coût et nettoyage (TTL, cron de cleanup)", "plateformes (Vercel/Netlify previews, namespaces k8s éphémères)", "concurrency par PR"]
outcomes:
  - sait déclencher un déploiement de preview sur ouverture et mise à jour d'une PR
  - sait détruire l'environnement à la fermeture de la PR et détecter un merge
  - sait poster l'URL de preview en commentaire de la PR
  - sait choisir une stratégie de seed data et de base de données pour une preview
  - sait maîtriser le coût des environnements éphémères (TTL, cron de nettoyage)
  - sait situer les previews natives (Vercel, Netlify) face aux namespaces k8s éphémères
prerequis: [modules 00 à 06 du cours 15 (CI/CD, GitHub Actions fondamentaux et avancé, testing en CI, conteneurisation, artefacts/registries, stratégies de déploiement)]
next: 08-securite-pipelines
libs: []
tribuzen: pipeline CI/CD de TribuZen — workflow preview.yml qui déploie une instance jetable par PR pour tester une feature avant merge
last-reviewed: 2026-07
---

# Preview Environments

> **Outcomes — tu sauras FAIRE :** déployer une preview sur ouverture/mise à jour d'une PR, la détruire à la fermeture (merge inclus), commenter l'URL sur la PR, choisir une stratégie de seed data, et garder la facture sous contrôle.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module orchestre un déploiement *éphémère* par PR à partir des briques déjà vues — build/test (modules 01-03), image Docker (module 04), registry (module 05), stratégies de déploiement (module 06). L'**OIDC** pour déployer sans secret long terme est le sujet du **module 08**. L'IaC (Terraform pour provisionner l'infra) est vue au **module 09**. Ici on reste au niveau du **workflow de cycle de vie** de l'environnement.

## 1. Cas concret d'abord

Sur TribuZen, une contributrice ouvre la PR #42 : « refonte de l'écran `FamilyMemberList` ». Le code passe la CI (lint, tests, build). Mais la revieweuse veut **voir** l'écran avec de vraies données avant de merger — un diff ne montre pas qu'un badge Admin déborde sur mobile.

Aujourd'hui, elle doit `git fetch` la branche, `npm install`, lancer le back, seeder une base… 15 minutes pour 30 secondes de coup d'œil. Personne ne le fait, et des régressions visuelles passent en prod.

Ce qu'on veut : que **l'ouverture de la PR #42 déploie automatiquement** une instance jetable de TribuZen, accessible sur une URL du type `https://pr-42.preview.tribuzen.app`, avec des données de démo, et que **la fermeture de la PR détruise** cette instance pour ne rien payer.

```
PR #42 ouverte      → provisionne + déploie → https://pr-42.preview.tribuzen.app
PR #42 mise à jour  → redéploie le nouveau commit sur la MÊME URL
PR #42 fermée/mergée → détruit l'environnement (0 € ensuite)
```

Le reste du module construit ce cycle de vie avec GitHub Actions, en gérant les données, le coût et le choix de plateforme.

---

## 2. Théorie complète, concise

### 2.1 Qu'est-ce qu'un preview environment

Un **preview environment** (ou *ephemeral environment*, *PR environment*) est une instance **complète et isolée** de l'application, provisionnée **automatiquement pour une PR** et **détruite** quand la PR se ferme. Deux propriétés le définissent :

- **éphémère** — il n'existe que le temps de vie de la PR (pas un environnement permanent comme `staging`) ;
- **par PR** — chacun est isolé des autres (URL, données, souvent base dédiée), pas un espace partagé où les PR se marchent dessus.

À quoi ça sert : review **visuelle** (pas seulement le code), tests d'acceptation par un PO/designer, E2E sur une cible isolée, démo à un stakeholder — le tout **avant** le merge.

> **Preview ⊂ éphémère.** Toute preview est un environnement éphémère, mais tout éphémère n'est pas une preview (un runner de test l'est aussi). Ce qui fait la preview, c'est le couple *cycle de vie lié à la PR* + *isolation par PR*.

### 2.2 Le cycle de vie repose sur les activity types de `pull_request`

Tout tient dans l'événement `pull_request` et ses **activity types**. Quatre nous intéressent :

| Type | Déclencheur | Action de preview |
|---|---|---|
| `opened` | la PR est créée | provisionner + déployer |
| `synchronize` | de nouveaux commits sont poussés sur la branche | redéployer (même URL) |
| `reopened` | une PR fermée est rouverte | reprovisionner |
| `closed` | la PR est fermée (mergée **ou** abandonnée) | **détruire** l'environnement |

```yaml
# Déploiement : à l'ouverture, aux pushes suivants, à la réouverture
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

```yaml
# Destruction : à la fermeture, quelle qu'en soit la raison
on:
  pull_request:
    types: [closed]
```

**Le numéro de PR** est la clé d'isolation. On le lit dans le contexte : `github.event.pull_request.number` (ou son alias `github.event.number`). Il sert à nommer l'environnement, l'URL, la base : `pr-42`.

### 2.3 `closed` ≠ « mergée » — détecter le merge

`closed` se déclenche que la PR soit **mergée** ou simplement **abandonnée** (fermée sans merge). Dans les deux cas on veut détruire la preview — donc pour le teardown, `closed` seul suffit. Mais si tu veux réagir **différemment** (ex. lancer un déploiement `staging` uniquement après un vrai merge), la distinction se fait avec le booléen `github.event.pull_request.merged` :

```yaml
jobs:
  teardown:
    if: always()                       # on détruit dans tous les cas de closed
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/destroy-preview.sh "pr-${{ github.event.pull_request.number }}"

  promote-to-staging:
    if: github.event.pull_request.merged == true   # seulement si VRAIMENT mergée
    runs-on: ubuntu-latest
    steps:
      - run: echo "La PR a été mergée — on peut promouvoir vers staging"
```

**Piège classique** : croire qu'il existe un événement « PR merged ». Il n'y en a pas — c'est `closed` + le champ `merged == true`.

### 2.4 Poster l'URL de preview sur la PR

Une preview invisible ne sert à rien : il faut **rendre l'URL cliquable** dans la PR. Deux mécanismes, souvent combinés.

**a) Un commentaire sur la PR** via `actions/github-script` (exécute l'API GitHub en JS, authentifié par le `GITHUB_TOKEN` du run) :

```yaml
- name: Commenter l'URL sur la PR
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,      // une PR EST une issue côté API
        body: `Preview déployée : ${{ steps.deploy.outputs.url }}`
      })
```

> Une PR est une *issue* pour l'API des commentaires → `issues.createComment`, et le numéro se lit via `context.issue.number`. Poster à chaque `synchronize` crée un commentaire par push (bruyant) ; en pratique on **met à jour** un commentaire existant (on le retrouve par un marqueur dans son `body`) plutôt que d'en empiler.

**b) Un GitHub Deployment + son statut** — l'objet natif de GitHub pour tracer « où tourne ce commit ». Le champ `environment_url` d'un *deployment status* fait apparaître un bouton **View deployment** directement dans la PR et l'onglet Environments. Un `environment:` avec `url:` dans le job produit le même effet de façon déclarative :

```yaml
jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    environment:
      name: pr-${{ github.event.pull_request.number }}   # un environment GitHub par PR
      url: ${{ steps.deploy.outputs.url }}                # affiché dans l'UI
    steps:
      - uses: actions/checkout@v4
      - id: deploy
        run: echo "url=https://pr-${{ github.event.pull_request.number }}.preview.tribuzen.app" >> "$GITHUB_OUTPUT"
```

### 2.5 Les données : le vrai point dur

Le déploiement du **code** est simple ; l'**état** (la base) est là où les previews se compliquent. Quatre stratégies, à choisir selon isolation vs coût :

| Stratégie | Isolation | Coût / complexité | Quand |
|---|---|---|---|
| **Base éphémère par PR** (une DB provisionnée puis détruite) | Totale | Élevé (provisioning + teardown) | Migrations de schéma, données mutées par les tests |
| **Base partagée, schéma/namespace isolé par PR** (`pr_42.*`) | Bonne | Moyen | La plupart des cas web |
| **Snapshot de prod anonymisé** (restauré par PR) | Totale, réaliste | Complexe (RGPD, taille) | Besoin de données proches du réel |
| **SQLite / base en mémoire, seedée au boot** | Totale | Très faible | Front + API stateless, démo |

**Seed data** = charger un jeu de données de démo reproductible au provisioning. Sur TribuZen, un script `seed:preview` insère 1 famille, 4 membres (dont 1 admin), quelques events — assez pour que la revieweuse voie un écran réaliste. Règle d'or : **jamais de vraies données personnelles** dans une preview (RGPD) — soit des données synthétiques, soit un snapshot **anonymisé**.

### 2.6 Coût et nettoyage — l'éphémère qui ne s'éteint pas coûte cher

Le danger d'un environnement par PR : les instances **orphelines**. Un teardown raté (workflow annulé, `closed` manqué) laisse une base et un service qui tournent — et facturent — indéfiniment. Trois filets de sécurité, cumulables :

1. **Teardown sur `closed`** (§2.3) — la voie normale.
2. **TTL / expiration** — chaque environnement porte une date limite ; au-delà, il est détruit même si la PR traîne ouverte.
3. **Cron de nettoyage** — un workflow planifié qui liste les environnements de preview et détruit ceux dont **la PR est déjà fermée** (rattrape les teardown ratés) :

```yaml
# .github/workflows/preview-reaper.yml
on:
  schedule:
    - cron: '0 3 * * *'          # chaque nuit à 03:00 UTC
jobs:
  reap:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/reap-stale-previews.sh   # détruit les previews sans PR ouverte
```

**Concurrency par PR** limite aussi le gaspillage : sur une PR très active, 5 pushes rapides ne doivent pas lancer 5 déploiements concurrents. On regroupe par PR et on annule l'obsolète :

```yaml
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

### 2.7 Plateformes : le natif vs le sur-mesure

**Vercel / Netlify** — pour un front (ou un fullstack JS), c'est **gratuit d'effort** : chaque push sur une branche de PR génère une *Preview Deployment* sur une URL unique, en général déployée en moins d'une minute, et **détruite** au merge/close. Tu n'écris presque pas de workflow ; l'intégration GitHub s'en charge et commente la PR. Idéal quand l'app est majoritairement statique/edge.

**Namespaces Kubernetes éphémères** — pour un système multi-services avec état (le cas d'un vrai back TribuZen : API + Postgres + Redis), on crée un **namespace `pr-42`** dans un cluster, on y déploie le stack, on expose une URL via l'Ingress, puis on **supprime le namespace** au close (ce qui détruit tout d'un coup). Plus puissant et réaliste, mais c'est **toi** qui écris le workflow et gères le cluster (souvent avec Helm/ArgoCD + l'IaC du module 09).

Heuristique : **front/SSR simple → preview native (Vercel/Netlify)** ; **back multi-services avec base → namespace k8s éphémère** (ou une PaaS type Railway qui provisionne aussi la DB par PR).

---

## 3. Worked examples

### Exemple 1 — le workflow de preview complet de TribuZen (deploy + teardown)

Deux workflows : un qui provisionne/redéploie, un qui détruit. On garde l'isolation par `pr-<number>`.

```yaml
# .github/workflows/preview.yml — provisioning à l'ouverture / mise à jour
name: Preview deploy
on:
  pull_request:
    types: [opened, synchronize, reopened]

# Une seule preview vivante par PR ; un nouveau push annule le déploiement obsolète
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write        # nécessaire pour commenter la PR

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    environment:
      name: pr-${{ github.event.pull_request.number }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build

      # Provisionne le stack jetable (namespace k8s pr-42, DB isolée, etc.)
      # et renvoie l'URL publique via un output de step.
      - name: Déployer la preview
        id: deploy
        run: |
          URL=$(./scripts/deploy-preview.sh "pr-${{ github.event.pull_request.number }}")
          echo "url=$URL" >> "$GITHUB_OUTPUT"

      # Seed reproductible : 1 famille, 4 membres, données SYNTHÉTIQUES (RGPD)
      - name: Seeder les données de démo
        run: ./scripts/seed-preview.sh "pr-${{ github.event.pull_request.number }}"

      # Rend l'URL cliquable dans la PR
      - name: Commenter l'URL sur la PR
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `Preview prête : ${{ steps.deploy.outputs.url }}`
            })
```

```yaml
# .github/workflows/preview-teardown.yml — destruction à la fermeture
name: Preview teardown
on:
  pull_request:
    types: [closed]              # mergée OU abandonnée : dans les deux cas on détruit

permissions:
  contents: read

jobs:
  destroy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Détruit le namespace / la DB / le service de la PR — idempotent :
      # ne DOIT PAS échouer si l'environnement n'existe déjà plus.
      - name: Détruire la preview
        run: ./scripts/destroy-preview.sh "pr-${{ github.event.pull_request.number }}"
```

Ce qu'on obtient : ouverture → URL commentée avec données de démo ; chaque push redéploie sur la même URL ; fermeture (merge ou non) → tout est détruit, facture à zéro.

### Exemple 2 — un filet de sécurité : le reaper des previews orphelines

Le teardown peut rater (run annulé, panne). Un cron nocturne rattrape les environnements dont la PR est **déjà fermée**.

```yaml
# .github/workflows/preview-reaper.yml
name: Preview reaper
on:
  schedule:
    - cron: '0 3 * * *'          # 03:00 UTC chaque nuit
  workflow_dispatch: {}          # déclenchable à la main aussi

permissions:
  contents: read
  pull-requests: read

jobs:
  reap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        id: open-prs
        with:
          # Récupère les numéros de PR ENCORE ouvertes → tout le reste est orphelin
          script: |
            const prs = await github.paginate(github.rest.pulls.list, {
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              per_page: 100,
            })
            return prs.map(pr => `pr-${pr.number}`).join(' ')
          result-encoding: string
      - name: Détruire les previews sans PR ouverte
        run: ./scripts/reap-stale-previews.sh "${{ steps.open-prs.outputs.result }}"
```

Le script compare la liste des environnements de preview réellement provisionnés à la liste des PR ouvertes, et détruit la différence. C'est la ceinture en plus des bretelles du `closed`.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'il existe un événement « PR merged »

Il n'y en a pas. Un merge déclenche `pull_request` avec `types: closed` — et `github.event.pull_request.merged == true`. Pour le teardown, `closed` suffit (on détruit dans tous les cas). Pour réagir *spécifiquement* au merge, teste le booléen `merged`.

### PIÈGE #2 — Oublier `closed` → environnements orphelins qui facturent

Un workflow de deploy sans workflow de teardown crée une preview par PR… qui ne meurt jamais. Au bout d'un mois, des dizaines de bases et services tournent en pur gaspillage. Le teardown sur `closed` **plus** un cron de nettoyage (Exemple 2) sont non négociables.

### PIÈGE #3 — Un teardown qui n'est pas idempotent

Le script de destruction peut être rejoué (cron + `closed`, ou double `closed`). S'il **échoue** quand l'environnement n'existe déjà plus, le workflow passe rouge sans raison. Un teardown doit être **idempotent** : « détruis si ça existe, sinon sors en succès ».

### PIÈGE #4 — Mettre de vraies données personnelles dans une preview

Une preview est souvent accessible par URL (parfois publique). Y restaurer un dump de production **non anonymisé** est une fuite RGPD. Utilise des données **synthétiques** seedées, ou un snapshot **anonymisé** — jamais les vraies PII.

### PIÈGE #5 — Une base partagée « à schéma isolé » mal cloisonnée

La stratégie « une seule DB, un schéma `pr_42` par PR » est économique mais fragile : si le code ne préfixe pas *toutes* ses requêtes par le bon schéma, la PR #42 lit/écrit les données de la #43. Choisis-la seulement si l'isolation par schéma est réellement étanche ; sinon, base éphémère par PR.

### PIÈGE #6 — Commenter à chaque `synchronize`

`opened` + N × `synchronize` = un commentaire par push si tu appelles `createComment` à chaque fois. La PR se noie sous les bots. **Mets à jour** un commentaire unique (repéré par un marqueur dans son `body`) au lieu d'en créer un nouveau à chaque run.

### PIÈGE #7 — Attendre un déploiement stateful d'une preview native

Vercel/Netlify déploient le **front** magnifiquement, mais ne provisionnent pas ton Postgres + Redis + workers. Pour un back multi-services avec état, il faut un namespace k8s éphémère (ou une PaaS qui gère la DB par PR). Ne force pas un back complet dans une preview conçue pour du edge/statique.

---

## 5. Ancrage TribuZen

Le fil-rouge est le **pipeline CI/CD de TribuZen**. Ce module lui ajoute le cycle de vie des previews par PR, en amont du merge :

- **`.github/workflows/preview.yml`** — sur `opened`/`synchronize`/`reopened`, build + `deploy-preview.sh` (namespace `pr-<n>`) + `seed-preview.sh` (1 famille, 4 membres synthétiques, quelques events) + commentaire de l'URL (Exemple 1).
- **`.github/workflows/preview-teardown.yml`** — sur `closed`, `destroy-preview.sh` idempotent (Exemple 1).
- **`.github/workflows/preview-reaper.yml`** — cron nocturne qui détruit les previews des PR déjà fermées (Exemple 2).

Concrètement, la refonte de `FamilyMemberList` (PR #42) déploie `https://pr-42.preview.tribuzen.app` : la revieweuse voit le badge Admin, teste le filtre « Masquer inactifs » sur mobile, valide — puis le merge détruit l'instance.

```
tribuzen/
  .github/
    workflows/
      preview.yml            ← deploy on open/synchronize/reopened (Exemple 1)
      preview-teardown.yml   ← destroy on closed (Exemple 1)
      preview-reaper.yml     ← cron cleanup des orphelins (Exemple 2)
  scripts/
    deploy-preview.sh        ← provisionne le namespace + renvoie l'URL
    seed-preview.sh          ← seed data synthétique (RGPD-safe)
    destroy-preview.sh       ← teardown idempotent
    reap-stale-previews.sh   ← nettoyage des previews sans PR ouverte
```

> L'**OIDC** pour que `deploy-preview.sh` s'authentifie au cloud sans secret long terme est le **module 08** ; le **provisioning IaC** du namespace/DB est le **module 09**. Ici, on câble le cycle de vie sur les événements de PR.

---

## 6. Points clés

1. Une preview est un environnement **éphémère + par PR** : provisionné à l'ouverture, détruit à la fermeture, isolé des autres.
2. Le cycle de vie se pilote via `pull_request` types : `opened`/`synchronize`/`reopened` → deploy ; `closed` → teardown. Le numéro de PR (`github.event.pull_request.number`) est la clé d'isolation.
3. `closed` couvre merge **et** abandon ; pour distinguer, tester `github.event.pull_request.merged == true`. Il n'existe pas d'événement « merged ».
4. Rendre l'URL visible : commentaire via `actions/github-script` (mis à jour, pas empilé) et/ou `environment.url` / GitHub Deployment.
5. Les **données** sont le point dur : DB éphémère par PR, schéma isolé, snapshot anonymisé ou base en mémoire seedée — jamais de vraies PII (RGPD).
6. Le coût se maîtrise par le teardown sur `closed` **+** un TTL **+** un cron reaper, plus `concurrency` par PR pour éviter les déploiements empilés.
7. Front simple → preview native (Vercel/Netlify, quasi zéro config) ; back multi-services avec état → namespace k8s éphémère (ou PaaS avec DB par PR).
8. Un teardown doit être **idempotent** — rejouable sans échouer si l'environnement n'existe plus.

---

## 7. Seeds Anki

```
Quels activity types de pull_request pilotent le cycle de vie d'une preview ?|opened + synchronize + reopened déclenchent le deploy/redeploy ; closed déclenche le teardown. Le numéro de PR (github.event.pull_request.number) sert de clé d'isolation (pr-42).
Comment détruire une preview aussi bien à un merge qu'à un abandon de PR ?|Écouter pull_request types: [closed] — il couvre les deux cas. Pas besoin de distinguer pour le teardown ; on détruit dans tous les cas.
Existe-t-il un événement GitHub Actions "PR merged" ?|Non. Un merge = pull_request type closed avec github.event.pull_request.merged == true. Pour réagir seulement au merge, on teste ce booléen dans un if.
Comment rendre l'URL de preview visible dans la PR ?|Commentaire via actions/github-script (github.rest.issues.createComment, une PR est une issue côté API) et/ou environment.url / GitHub Deployment qui affiche un bouton "View deployment". Mettre à jour un commentaire unique plutôt qu'en empiler à chaque synchronize.
Quelles stratégies de base de données pour une preview, et laquelle éviter côté RGPD ?|DB éphémère par PR (isolation totale, coûteux), schéma isolé sur DB partagée (économique, risque de collision), snapshot anonymisé (réaliste), base en mémoire seedée (front stateless). Jamais de dump de prod non anonymisé — fuite RGPD.
Comment éviter les preview environments orphelins qui facturent ?|Teardown sur closed + TTL/expiration + cron de nettoyage (reaper) qui détruit les previews dont la PR est déjà fermée. Concurrency par PR pour ne pas empiler les déploiements.
Pourquoi un script de teardown doit-il être idempotent ?|Il peut être rejoué (double closed, ou cron + closed). S'il échoue quand l'environnement n'existe déjà plus, le workflow passe rouge sans raison. Il doit détruire si présent, sinon sortir en succès.
Preview native (Vercel/Netlify) vs namespace k8s éphémère : quand choisir quoi ?|Front/SSR simple → preview native (quasi zéro config, deploy < 1 min, teardown auto au merge). Back multi-services avec état (API + Postgres + Redis) → namespace k8s éphémère supprimé au close, ou PaaS qui provisionne la DB par PR.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-07-preview-environments/README.md`. Concevoir de A à Z les deux workflows de preview de TribuZen (deploy on open / comment URL / teardown on close) — corrigé YAML commenté intégral, feedback coach en session.
