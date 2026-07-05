# Lab 02 — GitHub Actions avancé : optimiser le pipeline TribuZen

> **Outcome :** à la fin, tu sais transformer un `ci.yml` naïf en pipeline matriciel, caché, produisant un artefact `dist`, et factorisé via un reusable workflow — le tout **vérifié par de vrais runs GitHub Actions**.
> **Vrai outil :** un dépôt GitHub (public gratuit) + l'onglet **Actions** qui exécute réellement tes workflows. Pas de simulateur.
> **Feedback :** le coach valide en session en lisant les logs de run (durées, matrix, artefact téléchargeable). Pas de test-runner auto-correcteur.

---

## Prérequis matériels

- Un dépôt GitHub (peut être vide, avec juste un `package.json` minimal — voir starter).
- Les workflows se lancent en poussant sur une branche. Chaque `git push` déclenche un run visible dans l'onglet **Actions**.

Starter minimal du dépôt (à committer une fois) :

```json
// package.json
{
  "name": "tribuzen-ci-lab",
  "version": "0.1.0",
  "scripts": {
    "lint": "echo 'lint ok'",
    "build": "mkdir -p dist && echo '<h1>TribuZen</h1>' > dist/index.html",
    "test": "echo 'tests ok'"
  }
}
```

(Scripts factices volontaires : le but du lab est le **pipeline**, pas l'app. Ils suffisent à produire un `dist/` réel et à faire passer les jobs.)

---

## Énoncé

Voici le pipeline de départ, déjà dans le dépôt (`.github/workflows/ci.yml`). Il fonctionne mais il est lent, mono-version, et jette son build :

```yaml
# .github/workflows/ci.yml — POINT DE DÉPART (à améliorer)
name: CI
on:
  push:
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

**Ta mission — 4 améliorations, chacune vérifiable dans l'onglet Actions :**

1. **Matrix** — faire tourner `lint` + `test` sur Node **20 et 22** en parallèle, avec `fail-fast: false`.
2. **Cache** — accélérer `npm ci` (via `setup-node` `cache: 'npm'`), et le vérifier sur un 2ᵉ run (log « Cache restored »).
3. **Artefact** — un job `build` séparé (`needs`) qui produit `dist/` et l'**upload** en artefact `dist` téléchargeable, `retention-days: 5`.
4. **Reusable workflow** — extraire le job de test dans `.github/workflows/reusable-test.yml` (`workflow_call`, input `node-version`) et l'appeler depuis `ci.yml` via une matrix d'appels.

**Pas de gap-fill.** Tu écris les deux fichiers YAML entiers.

---

## Étapes (en friction)

1. **Matrix d'abord** — ajoute `strategy.matrix.node: [20, 22]` au job `quality`, branche `node-version: ${{ matrix.node }}`, ajoute `fail-fast: false`. Push. Vérifie dans Actions que **2 jobs** apparaissent (`quality (20)`, `quality (22)`).
2. **Cache** — ajoute `cache: 'npm'` sur `setup-node`. Push **deux fois** (change un espace pour re-trigger). Ouvre les logs du step `setup-node` du 2ᵉ run : tu dois voir une ligne de restauration de cache.
3. **Sépare le build** — crée un job `build` avec `needs: quality`, qui refait checkout + install + `npm run build`, puis `actions/upload-artifact@v4` (`name: dist`, `path: dist/`, `retention-days: 5`). Push. Dans le run, l'artefact `dist` doit être **téléchargeable** (encart Artifacts en bas du run).
4. **Extrais le reusable workflow** — crée `.github/workflows/reusable-test.yml` avec `on.workflow_call` + input `node-version` (type string) ; déplaces-y le job de test. Dans `ci.yml`, remplace le job `quality` par un job qui appelle ce workflow via `uses: ./.github/workflows/reusable-test.yml` **dans une matrix** `node: [20, 22]`, en passant `with.node-version`.
5. **Vérifie le tout** — dernier push : Actions doit montrer les appels matriciels du reusable workflow, puis `build`, puis l'artefact `dist`. Les runs obsolètes (si tu ajoutes la concurrency bonus) s'annulent.
6. **Bonus** — ajoute au niveau workflow une `concurrency` `group: ${{ github.workflow }}-${{ github.ref }}` avec `cancel-in-progress: true`, puis pousse 2 commits coup sur coup : le premier run doit passer en **Cancelled**.

---

## Corrigé complet commenté

**`.github/workflows/reusable-test.yml`** — le workflow réutilisable :

```yaml
# Reusable workflow : tests d'une version de Node, appelable par d'autres workflows
name: Reusable test
on:
  workflow_call:            # ← rend ce workflow appelable via uses: dans un job
    inputs:
      node-version:
        description: 'Version de Node à tester'
        type: string        # workflow_call exige un type explicite
        default: '22'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}   # ← contexte inputs (pas matrix ici)
          cache: 'npm'                                # cache npm géré par setup-node
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

**`.github/workflows/ci.yml`** — l'orchestrateur :

```yaml
name: CI
on:
  push:
  pull_request:

# BONUS : un run vivant par branche ; un nouveau push annule l'ancien
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # 1 + 4 : appelle le reusable workflow une fois PAR version de Node (matrix d'appels)
  test:
    strategy:
      fail-fast: false        # on veut voir Node 20 ET Node 22, même si l'un casse
      matrix:
        node: ['20', '22']    # strings : l'input node-version est typé string
    uses: ./.github/workflows/reusable-test.yml   # uses au niveau JOB (pas step)
    with:
      node-version: ${{ matrix.node }}            # passe la valeur de la matrix en input

  # 3 : build isolé qui produit et publie l'artefact dist
  build:
    needs: test               # ne build que si tous les appels de test ont réussi
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'        # 2 : cache — 2e run = restauration visible dans les logs
      - run: npm ci
      - run: npm run build    # produit dist/index.html
      - uses: actions/upload-artifact@v4
        with:
          name: dist          # nom unique (un seul job build) → pas de collision v4
          path: dist/
          retention-days: 5
```

**Pourquoi ce corrigé est correct :**

- Le job `test` de `ci.yml` **n'a pas de `steps`** : quand un job utilise `uses:`, il délègue entièrement au workflow appelé. La matrix génère **2 appels** (`test (20)`, `test (22)`), chacun exécutant le reusable workflow avec son `node-version`.
- Les valeurs de la matrix sont des **strings** (`'20'`) car l'input `node-version` est déclaré `type: string` côté reusable — passer un nombre marcherait par coercition, mais aligner les types évite les surprises.
- `cache: 'npm'` sur `setup-node` couvre le cas standard sans avoir à écrire un bloc `actions/cache@v4` manuel : au 2ᵉ run avec le même `package-lock.json`, le cache est restauré.
- L'artefact `dist` est **immuable en v4** : ici pas de risque de collision car un seul job `build`. Si tu avais uploadé depuis la matrix, il aurait fallu `name: dist-node${{ matrix.node }}`.
- `needs: test` fait attendre le build que **tous** les appels matriciels réussissent — un échec sur Node 20 bloque le build.
- La `concurrency` bonus utilise `github.workflow` + `github.ref` : deux pushes rapides sur la même branche → le premier run bascule en **Cancelled**.

---

## Grille d'auto-évaluation

| # | Critère | Vérif objective |
|---|---------|-----------------|
| 1 | Matrix active | L'onglet Actions montre 2 jobs de test (Node 20 + 22) |
| 2 | `fail-fast: false` | Casser volontairement Node 20 → Node 22 tourne quand même |
| 3 | Cache effectif | 2ᵉ run : log de restauration de cache dans `setup-node` |
| 4 | Artefact produit | Encart **Artifacts** du run propose `dist` en téléchargement |
| 5 | Reusable workflow | `ci.yml` appelle `reusable-test.yml` via `uses:` d'un job (0 step dans le job) |
| 6 | Input transmis | Les logs du reusable montrent bien Node 20 puis 22 |
| 7 | `needs` correct | `build` ne démarre qu'après le succès des deux appels de test |
| 8 | Bonus concurrency | 2 pushes rapides → 1er run **Cancelled** |

**Seuil de réussite :** 1 à 7 verts. Le 8 est un bonus.

---

## Coach — points de contrôle en session

- **« Pourquoi le job `test` de `ci.yml` n'a-t-il pas de `steps` ? »** — Réponse attendue : un job qui `uses:` un reusable workflow délègue tout ; les steps vivent dans le workflow appelé.
- **« Où mettrais-tu un `actions/cache@v4` explicite plutôt que `cache: 'npm'` ? »** — Attendu : pour cacher autre chose que le cache npm (build Vite, `.turbo`, navigateurs Playwright…).
- **« Si tu uploadais `dist` depuis la matrix, que se passerait-il ? »** — Attendu : collision d'artefact immuable en v4 → nom unique par combinaison requis.
- **Signal d'alarme si l'apprenant** met le `uses: ./.github/workflows/...` dans un `step` (confusion composite action / reusable workflow) → renvoyer au tableau §2.4 du module.
- **Piège fréquent** : oublier `fail-fast: false` et conclure à tort que Node 22 échoue alors que c'est Node 20 qui a coupé la matrix.

---

## Variante J+30 (fading)

**Même pipeline, reproduit de mémoire en 30 minutes, avec deux contraintes ajoutées :**

1. Remplace le `cache: 'npm'` par un bloc **`actions/cache@v4` explicite** (path `~/.npm` + `node_modules`, `key` avec `hashFiles('**/package-lock.json')`, `restore-keys`), et saute `npm ci` quand `cache-hit == 'true'`.
2. Extrais la séquence `checkout → setup-node → install` dans une **composite action** `.github/actions/setup-project/action.yml` (n'oublie pas `shell: bash` sur chaque `run`), et utilise-la dans le job `build`.

**Critère de réussite :** le pipeline tourne sur un vrai dépôt, le 2ᵉ run saute l'install grâce au `cache-hit`, et la composite action est appelée dans le `uses:` d'un **step** (pas d'un job). Sans rouvrir ce corrigé ni le module.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces fichiers vivent ici :

```
tribuzen/
  .github/
    workflows/
      ci.yml                ← orchestrateur (matrix d'appels + build + artefact)
      reusable-test.yml     ← workflow_call réutilisé par ci.yml et (plus tard) release.yml
    actions/
      setup-project/
        action.yml          ← composite action (variante J+30)
```

**Différences par rapport au lab :**

- Les scripts `lint` / `build` / `test` seront les **vrais** scripts du monorepo TribuZen (Vite build, ESLint, Vitest), pas des `echo`.
- Le reusable workflow `reusable-test.yml` sera aussi appelé par `release.yml` (déclenché sur tag `v*`) — c'est là que la factorisation paie : zéro duplication entre CI et release.
- L'artefact `dist` alimentera le job de déploiement (module 06) et le build d'image Docker (module 04).

**Commit cible :**

```
ci(actions): pipeline matriciel — Node 20/22, cache npm, artefact dist, reusable-test workflow
```
