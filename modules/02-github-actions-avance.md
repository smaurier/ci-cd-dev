---
titre: GitHub Actions — Avancé (matrix, cache, artefacts, workflows réutilisables)
cours: 15-cicd-devops
notions: ["matrix strategy (include/exclude/fail-fast)", "actions/cache@v4 + restore-keys", "artefacts upload/download-artifact v4", "reusable workflows (workflow_call)", "composite actions", "contexts et expressions", "concurrency (cancel-in-progress)", "conditions if et needs.result", "environments et approvals"]
outcomes:
  - sait construire une matrix build avec include/exclude et fail-fast
  - sait accélérer un pipeline avec actions/cache et restore-keys
  - sait passer des données entre jobs via artefacts et outputs
  - sait factoriser un pipeline en reusable workflow (workflow_call) et en composite action, et choisir lequel
  - sait piloter l'exécution avec contexts, expressions, concurrency, conditions if et environments
prerequis: [notions du module 00 (CI vs CD, boucle de feedback), workflow/jobs/steps/events/runners du module 01]
next: 03-testing-dans-ci
libs: []
tribuzen: pipeline CI/CD de TribuZen — le workflow .github/workflows/ci.yml (build, lint, test matriciel, artefact dist)
last-reviewed: 2026-07
---

# GitHub Actions — Avancé

> **Outcomes — tu sauras FAIRE :** construire une matrix build, mettre en cache les dépendances, transporter des artefacts entre jobs, factoriser un pipeline en reusable workflow et composite action, et piloter l'exécution avec contexts, concurrency, conditions `if` et environments.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module optimise et structure un pipeline déjà fonctionnel (module 01). Le contenu des tests en CI (coverage gate, parallélisation, flaky) est le sujet du **module 03**. Le build/push d'images Docker et son cache de layers arrivent au **module 04**. L'OIDC vers le cloud (déploiement sans secret long terme) est traité au **module 08**.

## 1. Cas concret d'abord

Le pipeline CI de TribuZen (`.github/workflows/ci.yml`, écrit au module 01) fonctionne mais commence à faire mal :

```yaml
# .github/workflows/ci.yml — état "naïf" après le module 01
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci          # ~90 s à chaque run, rien n'est mis en cache
      - run: npm run lint
      - run: npm run build    # produit dist/ ... qui est perdu à la fin du job
      - run: npm test         # une seule version de Node testée
```

**Quatre douleurs concrètes, toutes réglées dans ce module :**

1. `npm ci` réinstalle tout depuis zéro à **chaque** run (~90 s perdues) → **cache** (§2.2).
2. Le `dist/` produit par `build` est **détruit** à la fin du job — impossible de le déployer ou de l'inspecter → **artefacts** (§2.3).
3. On ne teste **qu'une** version de Node alors que le back tourne sur 20 et 22 → **matrix** (§2.1).
4. Chaque push sur une PR active lance un run complet ; 5 pushes rapides = 5 runs en parallèle qui se marchent dessus → **concurrency** (§2.6).

Et quand un deuxième workflow (`release.yml`) voudra relancer les mêmes tests, on ne va pas copier-coller ces steps → **reusable workflow / composite action** (§2.4).

À la fin du module, ce pipeline sera matriciel, caché, produira un artefact `dist/`, se factorisera et s'auto-annulera sur les pushes obsolètes.

---

## 2. Théorie complète, concise

### 2.1 Matrix strategy — tester N combinaisons avec un seul job

`strategy.matrix` déclare des axes ; GitHub génère **une exécution du job par combinaison** (produit cartésien).

```yaml
jobs:
  test:
    strategy:
      matrix:
        node: [20, 22]                       # 2 valeurs
        os: [ubuntu-latest, windows-latest]  # 2 valeurs
    runs-on: ${{ matrix.os }}                # → 2 × 2 = 4 jobs
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

Les valeurs d'un axe se lisent dans le **contexte `matrix`** (`${{ matrix.node }}`), utilisable partout dans le job.

**`include`** ajoute ou enrichit des combinaisons ; **`exclude`** en retire :

```yaml
strategy:
  matrix:
    node: [20, 22]
    os: [ubuntu-latest, windows-latest]
    exclude:
      - node: 20
        os: windows-latest        # on ne teste pas Node 20 sous Windows
    include:
      - node: 22
        os: macos-latest          # combinaison SUPPLÉMENTAIRE
        experimental: true        # variable en plus, seulement pour cette entrée
```

Règle mentale : `exclude` s'applique d'abord (il retranche du produit), puis `include` ajoute. Un `include` dont **tous** les axes matchent une combinaison existante l'enrichit au lieu d'en créer une nouvelle.

**`fail-fast`** (défaut `true`) : si une combinaison échoue, GitHub **annule** toutes les autres. Pour voir tous les échecs d'un coup, passe-le à `false` :

```yaml
strategy:
  fail-fast: false        # ne pas couper les autres jobs au premier échec
  max-parallel: 2         # au plus 2 combinaisons en parallèle
  matrix:
    node: [18, 20, 22]
```

`max-parallel` plafonne le nombre de combinaisons simultanées (utile pour ménager un service externe ou un quota de runners).

### 2.2 Cache des dépendances — `actions/cache@v4`

Deux niveaux. Le plus simple : `setup-node` sait cacher le **cache npm** (`~/.npm`) tout seul via `cache: 'npm'`.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'          # cache automatique de ~/.npm, keyé sur package-lock.json
- run: npm ci
```

Le cache générique `actions/cache@v4` sert quand tu veux cacher **autre chose** (build Vite, `.turbo`, Playwright browsers, `node_modules` complet…) :

```yaml
- uses: actions/cache@v4
  id: cache-deps
  with:
    path: |
      ~/.npm
      node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

- `key` : identité **exacte** du cache. On y met un `hashFiles(...)` du lockfile → dès qu'une dépendance change, la clé change, un nouveau cache est écrit.
- `restore-keys` : clés de **repli** essayées (préfixe) si la `key` exacte ne matche pas. On récupère alors un cache *proche* (moins à télécharger) même après un changement de lockfile.
- Sortie `cache-hit` : `'true'` si la `key` exacte a été trouvée. On l'utilise pour sauter l'install :

```yaml
- if: steps.cache-deps.outputs.cache-hit != 'true'
  run: npm ci
```

> **Cache ≠ artefact.** Le cache est un accélérateur *opportuniste* (best-effort, peut être évincé, partagé entre runs). L'artefact est un livrable *fiable* qu'on veut récupérer (§2.3). Ne mets jamais un livrable de build dans un cache.

### 2.3 Artefacts — transporter des fichiers entre jobs et après le run

Chaque job tourne sur une machine **neuve** : le système de fichiers d'un job n'est pas visible par les autres. Pour transmettre un `dist/`, un rapport de couverture ou un binaire, on **upload** un artefact dans un job et on le **download** dans un autre.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7        # supprimé après 7 jours (défaut repo sinon)

  deploy:
    needs: build                   # attend que build réussisse
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/              # restauré ici
      - run: ls dist/
```

**⚠️ Changement majeur en v4 : les artefacts sont immuables.** On **ne peut pas** uploader deux fois le même `name` dans un workflow (erreur). En matrix, chaque combinaison doit donc produire un nom unique :

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: dist-${{ matrix.os }}-node${{ matrix.node }}   # nom unique par combinaison
    path: dist/
```

Côté download, `actions/download-artifact@v4` télécharge par `name`, ou **tous** les artefacts si `name` est omis (un sous-dossier par artefact), avec un `pattern:` + `merge-multiple: true` pour regrouper. (`download-artifact@v5` existe et est rétro-compatible ; `v4` reste le duo standard avec `upload-artifact@v4`.)

### 2.4 Factoriser : reusable workflow vs composite action

Deux mécanismes de réutilisation, **souvent confondus** — ils n'opèrent pas au même niveau.

**Composite action** = un paquet de **steps** réutilisable *dans* un job. Fichier `action.yml`, `runs.using: composite`, chaque step exige `shell:`.

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup project'
description: 'Checkout deps + build TribuZen'
inputs:
  node-version:
    description: 'Version de Node'
    default: '22'
outputs:
  cache-hit:
    description: 'Le cache a-t-il matché ?'
    value: ${{ steps.deps.outputs.cache-hit }}
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    - id: deps
      run: npm ci
      shell: bash          # OBLIGATOIRE dans une composite action
    - run: npm run build
      shell: bash
```

Utilisation — comme n'importe quelle action, avec un chemin local :

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-project    # pas de @ref pour un chemin local
    with:
      node-version: '20'
```

**Reusable workflow** = un **workflow entier** (avec ses jobs) appelé par un autre workflow. Déclenché par `workflow_call`.

```yaml
# .github/workflows/reusable-test.yml
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: '22'
    secrets:
      NPM_TOKEN:
        required: false
    outputs:
      coverage:
        description: 'Taux de couverture'
        value: ${{ jobs.test.outputs.coverage }}

jobs:
  test:
    runs-on: ubuntu-latest
    outputs:
      coverage: ${{ steps.cov.outputs.pct }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ inputs.node-version }}, cache: 'npm' }
      - run: npm ci
      - id: cov
        run: echo "pct=$(npm test --silent | tail -1)" >> "$GITHUB_OUTPUT"
```

Appel — dans le champ `uses` **d'un job** (pas d'un step) :

```yaml
# .github/workflows/ci.yml
jobs:
  call-tests:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '22'
    secrets: inherit        # transmet tous les secrets du caller (ou mappe-les 1 à 1)

  report:
    needs: call-tests
    runs-on: ubuntu-latest
    steps:
      - run: echo "Couverture=${{ needs.call-tests.outputs.coverage }}"
```

| | Composite action | Reusable workflow |
|---|---|---|
| Unité réutilisée | des **steps** | des **jobs** entiers |
| S'invoque via | `uses:` dans un **step** | `uses:` dans un **job** |
| Peut définir plusieurs jobs / runners | Non | Oui |
| Peut fixer `runs-on`, matrix, environment | Non (hérite du job appelant) | Oui |
| Secrets | via `inputs` | bloc `secrets:` + `secrets: inherit` |
| Bon pour | « installer + build » répété dans chaque job | « toute la CI » partagée entre plusieurs workflows |

Heuristique : **quelques steps répétés dans un job → composite** ; **un pipeline complet partagé entre workflows → reusable workflow**.

### 2.5 Contexts et expressions

Une **expression** vit entre `${{ }}` et lit des **contexts** (objets fournis par GitHub). Les plus courants :

| Context | Contient | Exemple |
|---|---|---|
| `github` | l'événement, la ref, l'acteur | `github.ref`, `github.event_name`, `github.sha` |
| `matrix` | les valeurs de la combinaison | `matrix.node` |
| `needs` | outputs + `result` des jobs requis | `needs.build.result` |
| `steps` | outputs des steps (`id`) | `steps.cache-deps.outputs.cache-hit` |
| `runner` | l'OS/arch du runner | `runner.os` |
| `secrets` | les secrets du repo/env | `secrets.NPM_TOKEN` |
| `env` | variables d'environnement | `env.NODE_ENV` |

Fonctions utiles dans les expressions : `hashFiles('**/package-lock.json')`, `contains(...)`, `startsWith(...)`, `format(...)`, et les fonctions de statut `success()`, `failure()`, `cancelled()`, `always()`.

```yaml
- name: Log contexte
  run: |
    echo "event=${{ github.event_name }}"
    echo "ref=${{ github.ref }}"
    echo "os=${{ runner.os }}"
```

> **⚠️ Un `${{ }}` en pleine prose casse le rendu du site.** Dans ce module, il n'apparaît **que** dans des blocs de code. En dehors, on écrit « le contexte `github.ref` » sans les délimiteurs.

### 2.6 Concurrency — annuler les runs obsolètes

`concurrency` regroupe des runs sous une **clé** ; un seul run par clé est actif à la fois.

```yaml
# Niveau workflow : un run par (workflow, branche)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true     # un nouveau push annule le run précédent de la même branche
```

- `group` : chaîne/expression identifiant le groupe. `github.workflow` + `github.ref` = « une CI vivante par branche ».
- `cancel-in-progress: true` : le nouveau run **tue** l'ancien du même groupe (idéal pour les PR : on ne teste que le dernier commit). À `false` (défaut), le nouveau **attend** que l'ancien finisse.

Se déclare au **niveau workflow** (tout le run) ou au **niveau job** (`jobs.<id>.concurrency`). Pour un déploiement, on veut souvent `cancel-in-progress: false` afin de ne pas interrompre un déploiement en cours.

### 2.7 Conditions `if` et exécution conditionnelle

`if` s'applique à un **job** ou à un **step**. Sans `${{ }}` obligatoires (GitHub les infère dans un `if`), mais on les met pour les expressions complexes.

```yaml
jobs:
  deploy:
    needs: [build, test]
    # ne déployer que si build ET test ont réussi ET qu'on est sur main
    if: |
      needs.build.result == 'success' &&
      needs.test.result == 'success' &&
      github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploy"
```

Piège des fonctions de statut : par défaut, un job/step est sauté si un précédent a échoué. `if: always()` force l'exécution (ex. un step d'upload de logs), `if: failure()` ne s'exécute **que** si un précédent a échoué. `needs.<job>.result` vaut `success` / `failure` / `cancelled` / `skipped`.

### 2.8 Environments et approvals

Un **environment** (`production`, `staging`) est un objet GitHub qui porte des **secrets dédiés** et des **règles de protection** : reviewers requis (jusqu'à 6, une seule approbation suffit), délai d'attente, branches autorisées.

```yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.tribuzen.fr     # lien affiché sur le déploiement
    steps:
      - run: ./deploy.sh
        env:
          TOKEN: ${{ secrets.DEPLOY_TOKEN }}   # secret DE l'environnement production
```

Quand `production` exige un reviewer, le job **se met en pause** et attend l'approbation manuelle avant de tourner ou d'accéder aux secrets de l'environnement. C'est le point de contrôle humain du Continuous **Delivery** (vu au module 00). La configuration des reviewers se fait dans l'UI (Settings → Environments), pas dans le YAML.

---

## 3. Worked examples

### Exemple 1 — le pipeline TribuZen optimisé de bout en bout

On reprend le `ci.yml` naïf du §1 et on applique matrix + cache + artefact + concurrency + condition de déploiement.

```yaml
# .github/workflows/ci.yml — version optimisée
name: CI
on:
  push:
    branches: [main]
  pull_request:

# Un run vivant par branche ; un nouveau push annule l'ancien
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    strategy:
      fail-fast: false                 # voir TOUS les échecs de version
      matrix:
        node: [20, 22]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'                 # cache npm géré par setup-node
      - run: npm ci
      - run: npm run lint
      - run: npm test

  build:
    needs: test                        # ne build que si tous les tests passent
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist                   # nom unique (un seul job build, hors matrix)
          path: dist/
          retention-days: 7

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'   # jamais depuis une PR
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - run: ./scripts/deploy.sh
        env:
          TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

Ce qu'on a gagné : tests sur Node 20 **et** 22 en parallèle, `npm ci` accéléré par le cache, `dist/` conservé 7 jours et **réutilisé** par le déploiement, runs obsolètes annulés, déploiement bloqué hors `main` et derrière une approbation `production`.

### Exemple 2 — extraire une composite action `setup-project`

Les jobs `test` et `build` ci-dessus répètent `checkout → setup-node → npm ci`. On factorise dans une composite action.

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup project'
description: 'Checkout deps TribuZen avec cache npm'
inputs:
  node-version:
    description: 'Version de Node'
    default: '22'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    - run: npm ci
      shell: bash                # requis : sans shell, l'action échoue au parse
```

Le job `build` devient :

```yaml
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4     # checkout reste AVANT (la composite lit le repo)
      - uses: ./.github/actions/setup-project
        with: { node-version: '22' }
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/, retention-days: 7 }
```

Note : `actions/checkout` reste dans le workflow car la composite action a besoin des fichiers du repo déjà présents. On aurait aussi pu l'inclure dans la composite — choix de granularité.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un job voit les fichiers d'un autre job

Chaque job démarre sur une machine vierge. Le `dist/` de `build` **n'existe pas** dans `deploy`. Il faut un **artefact** (upload puis download) ou un cache. Confondre les deux jobs comme un même disque est l'erreur n°1.

```yaml
# ❌ deploy ne trouvera jamais dist/ produit par build
deploy:
  needs: build
  steps:
    - run: ls dist/       # dossier vide → échec

# ✅ transiter par un artefact
    - uses: actions/download-artifact@v4
      with: { name: dist, path: dist/ }
```

### PIÈGE #2 — Uploader deux fois le même `name` d'artefact (v4)

En v4 les artefacts sont **immuables**. Dans une matrix, `name: dist` répété sur chaque combinaison lève une erreur au 2ᵉ upload.

```yaml
# ❌ collision : node 20 et node 22 uploadent tous deux "dist"
name: dist
# ✅ nom unique par combinaison
name: dist-node${{ matrix.node }}
```

### PIÈGE #3 — Confondre cache et artefact

Le **cache** est best-effort : il peut être évincé, il n'est **pas** garanti. Ne l'utilise **jamais** pour un livrable qu'un job suivant *doit* trouver — ça marchera 9 fois sur 10 puis cassera sans prévenir. Livrable → artefact. Accélération d'install → cache.

### PIÈGE #4 — Composite action sans `shell:`

Dans une composite action, tout step `run:` **exige** `shell:` (`bash`, `pwsh`…). Contrairement à un workflow classique où le shell est implicite. L'oubli produit une erreur de parsing, pas un warning.

### PIÈGE #5 — `fail-fast` masque des échecs

`fail-fast: true` (défaut) annule les autres combinaisons au premier échec. Pratique pour économiser des minutes, mais si Node 20 casse tôt, tu ne sauras **pas** si Node 22 passait. Pour un diagnostic complet, `fail-fast: false`.

### PIÈGE #6 — `if` de déploiement qui se déclenche depuis une PR

Un job de déploiement sans garde `github.ref == 'refs/heads/main'` peut partir en prod depuis une simple PR. Toujours garder la condition de branche **et** vérifier `needs.<job>.result` — un `needs` seul ne garantit pas le succès si un `if: always()` traîne en amont.

### PIÈGE #7 — Appeler un reusable workflow depuis un `step`

Un reusable workflow s'invoque dans le `uses` **d'un job**, pas d'un step. Une composite action, elle, s'invoque dans le `uses` **d'un step**. Inverser les deux est une confusion fréquente (voir tableau §2.4).

---

## 5. Ancrage TribuZen

Le fil-rouge de ce cours est le **pipeline CI/CD de TribuZen**. Ce module transforme le `ci.yml` embryonnaire du module 01 en pipeline de production :

- **`.github/workflows/ci.yml`** — matrix Node 20/22, cache npm, artefact `dist`, concurrency par branche, déploiement gardé sur `main` derrière l'environment `production` (Exemple 1).
- **`.github/actions/setup-project/action.yml`** — composite action « checkout deps » réutilisée par tous les jobs (Exemple 2).
- **`.github/workflows/reusable-test.yml`** — quand `release.yml` (tag `v*`) devra rejouer les tests, il appellera ce reusable workflow au lieu de dupliquer les steps.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  .github/
    workflows/
      ci.yml                  ← Exemple 1 (matrix, cache, artefact, concurrency)
      reusable-test.yml       ← reusable workflow (workflow_call)
    actions/
      setup-project/
        action.yml            ← Exemple 2 (composite action)
```

> Le **contenu** des tests (coverage gate, parallélisation) est le module 03 ; le **build d'image Docker** et son cache de layers, le module 04 ; l'**OIDC** pour déployer sans secret long terme, le module 08. Ici, on structure et on optimise le squelette.

---

## 6. Points clés

1. `strategy.matrix` génère un job par combinaison ; `include` ajoute/enrichit, `exclude` retranche, `fail-fast: false` révèle tous les échecs, `max-parallel` plafonne.
2. `actions/cache@v4` accélère via `key` (identité exacte, souvent `hashFiles(lockfile)`) + `restore-keys` (replis) ; `setup-node` avec `cache: 'npm'` suffit pour le cas npm standard.
3. Chaque job a un disque neuf : transporter des fichiers = `upload-artifact@v4` / `download-artifact@v4`. En v4 les artefacts sont **immuables** → nom unique par combinaison matrix.
4. Composite action = steps réutilisés dans un job (`uses:` d'un step, `shell:` requis) ; reusable workflow = jobs réutilisés entre workflows (`uses:` d'un job, `workflow_call`).
5. Les expressions `${{ }}` lisent des contexts (`github`, `matrix`, `needs`, `steps`, `runner`, `secrets`) ; hors bloc de code, ne jamais écrire les délimiteurs.
6. `concurrency` + `cancel-in-progress: true` annule les runs obsolètes d'une même branche ; à laisser `false` pour un déploiement.
7. `if` garde un job/step ; `needs.<job>.result` + `github.ref` protègent un déploiement ; `always()`/`failure()` gèrent les cas d'échec.
8. Un `environment` porte secrets dédiés + approvals : le job se met en pause jusqu'à validation humaine (point de contrôle du Continuous Delivery).

---

## 7. Seeds Anki

```
Combien de jobs génère une matrix node:[20,22] os:[ubuntu,windows] ?|4 jobs — produit cartésien des axes (2 × 2). Chaque combinaison lit ses valeurs via le contexte matrix (matrix.node, matrix.os).
Différence entre include et exclude dans une matrix ?|exclude retire des combinaisons du produit cartésien ; include ajoute une combinaison supplémentaire (ou enrichit une existante si tous ses axes matchent). exclude est appliqué avant include.
À quoi sert fail-fast: false dans une matrix ?|Empêcher GitHub d'annuler les autres combinaisons dès qu'une échoue — on voit ainsi TOUS les échecs (ex. savoir si Node 22 passe même si Node 20 casse). Défaut = true.
Rôle de key vs restore-keys dans actions/cache@v4 ?|key = identité exacte du cache (souvent runner.os + hashFiles(lockfile)) ; si elle change, un nouveau cache est écrit. restore-keys = clés de repli par préfixe, essayées si la key exacte ne matche pas, pour récupérer un cache proche.
Cache ou artefact pour transmettre le dist/ de build à deploy ?|Artefact (upload-artifact puis download-artifact). Le cache est best-effort et peut être évincé — jamais pour un livrable qu'un job DOIT trouver. Chaque job a un disque neuf.
Pourquoi une matrix ne peut-elle pas uploader deux fois name: dist en v4 ?|Les artefacts sont immuables en v4 : deux uploads du même name lèvent une erreur. Il faut un nom unique par combinaison, ex. name: dist-node${{ matrix.node }}.
Composite action vs reusable workflow : lequel réutilise des steps, lequel des jobs ?|Composite action = paquet de STEPS réutilisé dans un job (uses d'un step, shell requis). Reusable workflow = WORKFLOW entier (jobs) appelé via workflow_call dans le uses d'un JOB.
Comment secrets: inherit se comporte pour un reusable workflow ?|Il transmet automatiquement tous les secrets du workflow appelant au workflow appelé, sans les mapper un à un. Alternative : bloc secrets: avec mapping explicite.
Que fait concurrency avec cancel-in-progress: true ?|Regroupe les runs sous une clé (souvent github.workflow-github.ref) ; un nouveau run du même groupe annule l'ancien en cours. Idéal pour les PR ; à laisser false pour un déploiement.
Pourquoi un environment production peut-il mettre un job en pause ?|S'il a une règle de protection « required reviewers », le job attend une approbation manuelle avant de tourner ou d'accéder aux secrets de l'environnement — c'est le point de contrôle humain du Continuous Delivery.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-02-github-actions-avance/README.md`. Optimiser le pipeline CI de TribuZen (matrix Node 20/22, cache, artefact `dist`, reusable workflow) sur un vrai dépôt GitHub — corrigé YAML commenté intégral, feedback coach en session.
