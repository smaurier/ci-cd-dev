---
titre: Lancer les tests en CI (gate de couverture, sharding, flaky, services)
cours: 15-cicd-devops
notions: ["job de test en CI", "code de sortie comme gate", "gate de couverture", "sharding via matrix", "artefacts immuables (upload-artifact v4+)", "download-artifact + merge", "services containers", "health-check de service", "flaky tests", "retry vs quarantine", "GITHUB_STEP_SUMMARY", "annotations de workflow"]
outcomes:
  - sait faire échouer un job GitHub Actions quand les tests ou la couverture passent sous le seuil
  - sait paralléliser une suite de tests par sharding matrix et recombiner les rapports
  - sait fournir une base Postgres à un job d'intégration via un service container avec health-check
  - sait diagnostiquer un test flaky et choisir entre retry, quarantine et correction
  - sait publier un rapport de test lisible (job summary, artefacts, annotations)
prerequis: [modules 00-02 du cours 15 — CI/CD, workflow/jobs/steps, matrix/artefacts/cache]
next: 04-conteneurisation-ci
libs: []
tribuzen: pipeline CI de TribuZen — étape de test du workflow ci.yml (unitaires + intégration Postgres + gate de couverture)
last-reviewed: 2026-07
---

# Lancer les tests en CI

> **Outcomes — tu sauras FAIRE :** faire échouer un job quand les tests ou la couverture tombent sous le seuil, paralléliser une suite par sharding, provisionner une base Postgres pour les tests d'intégration, dompter les tests flaky, publier un rapport lisible.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module traite l'**orchestration des tests en CI** — comment GitHub Actions *lance*, *parallélise*, *gate* et *rapporte* une suite de tests. **Écrire** les tests (assertions, mocks, testcontainers, Playwright en profondeur) est le sujet du **cours 06 — Testing**. Ici on suppose la suite déjà écrite : `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` existent. On câble le pipeline autour.

## 1. Cas concret d'abord

TribuZen a une suite de tests correcte en local. Mais il n'y a pas encore de garde en CI : n'importe quelle PR peut fusionner du code cassé tant qu'elle « a l'air verte ». La semaine dernière, une PR a mergé un bug sur `GET /families/:id` — les tests d'intégration existaient, personne ne les avait lancés.

Le lead te demande de câbler l'étape de test dans `.github/workflows/ci.yml` avec **trois exigences non négociables** :

1. Les **tests unitaires** tournent à chaque push et **bloquent le merge** s'ils échouent.
2. La **couverture** doit rester **≥ 80 %** de lignes — sous ce seuil, le job échoue.
3. Les **tests d'intégration** ont besoin d'une **vraie base Postgres** dans le runner (pas de mock).

Voici le squelette qu'on te laisse — il ne fait rien d'utile encore :

```yaml
# .github/workflows/ci.yml — AVANT
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test          # ← passe-t-il ? gate-t-il ? où est Postgres ? où est la couverture ?
```

**Trois trous** que ce module va boucher :
- `npm test` renvoie bien un code de sortie, mais **rien ne vérifie la couverture** ni ne rapporte le détail.
- Aucune **base Postgres** n'est disponible : les tests d'intégration planteront sur `ECONNREFUSED`.
- La suite grossit ; **sans parallélisation**, le CI mettra bientôt 15 min et personne ne l'attendra.

## 2. Théorie complète, concise

### 2.1 Le code de sortie est la gate

Une étape `run:` échoue si la commande renvoie un **code de sortie ≠ 0**. Un test-runner (Vitest, Jest, Playwright) renvoie `1` dès qu'un test échoue. C'est **tout le mécanisme de gate** : pas besoin d'action spéciale, un test rouge fait échouer l'étape, qui fait échouer le job, qui bloque la PR (si la branche est protégée).

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: actions/setup-node@v6
    with:
      node-version: 22
      cache: npm
  - run: npm ci                 # install reproductible (lockfile)
  - run: npm run test:unit      # exit 1 si un test échoue → job rouge → merge bloqué
```

**Point clé :** pour que le job rouge *bloque réellement* le merge, il faut activer **Branch protection → Require status checks** sur `main` (côté GitHub, réglage repo — pas dans le YAML). Sans ça, le CI n'est qu'indicatif.

Trois pièges qui **cachent** un échec derrière un job vert :
- Un `|| true` ou un `continue-on-error: true` malencontreux avale le code de sortie.
- Un pipe shell (`npm test | tee log.txt`) renvoie le code du **dernier** maillon (`tee`), pas celui de `npm test`.
- Un script npm `"test": "vitest"` sans `run` : `vitest` seul lance le **mode watch** et bloque le runner. En CI, il faut `vitest run`. (Vitest détecte souvent `CI=true` et bascule en mode run, mais ne compte pas dessus — écris `vitest run`.)

### 2.2 La gate de couverture

Faire tourner les tests ne suffit pas : on veut aussi garantir qu'une **proportion minimale du code est exercée**. Deux façons de gater, la bonne et la fragile.

**La bonne — seuil déclaré dans la config du runner.** Vitest (comme Jest) sait échouer lui-même si la couverture passe sous un seuil. On le configure une fois, et `--coverage` suffit en CI :

```ts
// vitest.config.ts — la GATE vit ici (détails du runner = cours 06)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'], // text = lisible en log, lcov = pour un service, json-summary = machine
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
})
```

```yaml
- run: npm run test:unit -- --coverage   # exit 1 automatique si couverture < seuil
```

Avantage : le seuil est **versionné avec le code**, il gate identiquement en local et en CI, et le message d'erreur est explicite (`ERROR: Coverage for lines (76%) does not meet threshold (80%)`).

**La fragile — parser la couverture à la main en shell.** On voit souvent ce genre de hack (`jq` sur le `json-summary` + `bc`). Il fonctionne mais il est verbeux, dépend d'outils installés sur le runner, et duplique une logique que le runner sait déjà faire. À éviter sauf besoin très spécifique.

> **Défère :** *comment écrire des tests qui couvrent les bonnes branches* = cours 06. Ici, on ne fait que **brancher la gate** sur un chiffre.

### 2.3 Parallélisation par sharding

Quand la suite dépasse ~5 min, on la **découpe en tranches (shards)** exécutées en parallèle sur plusieurs runners, via une `matrix`. Chaque runner exécute `shard k/N` de la suite. C'est le module 02 (matrix) appliqué aux tests.

```yaml
jobs:
  e2e:
    strategy:
      fail-fast: false          # ← ne PAS annuler les autres shards si un échoue (sinon on perd le rapport)
      matrix:
        shard: [1, 2, 3, 4]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test --shard=${{ matrix.shard }}/4
```

Deux règles de sharding :
- **`fail-fast: false`** est presque toujours voulu pour des tests : tu veux voir *tous* les échecs, pas seulement le premier shard qui plante.
- Chaque shard produit un **rapport partiel**. Pour avoir un verdict global lisible, il faut **collecter puis fusionner** les rapports (voir 2.6). Sinon tu lis 4 rapports séparés.

Le sharding réduit le **temps mural** (4 shards ≈ 4× plus vite) mais **augmente les minutes-runner facturées** (4 jobs au lieu d'1). C'est un arbitrage vitesse-de-feedback vs coût.

### 2.4 Services containers : une vraie base pour l'intégration

Les tests d'intégration ont besoin de dépendances réelles (Postgres, Redis…). GitHub Actions démarre des **service containers** à côté du job : des conteneurs Docker éphémères, vivants le temps du job, déclarés sous `services:`.

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: tribuzen_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432          # ← publie 5432 du conteneur sur le runner
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/tribuzen_test
```

Trois mécanismes à comprendre :

**Le mapping réseau dépend d'où tourne le job.**
- Job **directement sur le runner** (cas ci-dessus, pas de `container:`) : tu dois **publier les ports** avec `ports:` et te connecter sur **`localhost:5432`** (ou `127.0.0.1`).
- Job **dans un conteneur** (`container:` défini) : tu te connectes par le **nom du service** (`postgres:5432`) sur le réseau Docker interne, et `ports:` n'est pas nécessaire. Ne mélange pas les deux modèles.

**Le health-check évite la course au démarrage.** Sans `options` de health-check, le job démarre alors que Postgres n'accepte pas encore les connexions → `ECONNREFUSED` intermittent. `--health-cmd pg_isready` fait attendre GitHub que la base soit *prête* avant de lancer tes steps. C'est la parade au flaky d'infrastructure le plus courant.

**Le secret n'en est pas un.** `POSTGRES_PASSWORD: test` est une base jetable, détruite en fin de job — pas besoin de `secrets.`. On ne met en `secrets.` que ce qui touche du réel (module 08).

### 2.5 Tests flaky : diagnostiquer avant de masquer

Un test **flaky** passe et échoue **sans changement de code** — au hasard des runs. Causes classiques : dépendance temporelle (`sleep` au lieu d'attendre une condition), ordre des tests, état partagé (base non nettoyée), course réseau (le service pas prêt → cf. health-check).

GitHub Actions offre un bouton facile : le **retry**.

```yaml
# Retry natif du runner (Playwright/Vitest ont un champ `retries`) — préférer ça à une action tierce
# playwright.config.ts : retries: process.env.CI ? 2 : 0
```

Le retry est un **anesthésiant, pas un remède** :
- **Retry** = re-jouer le test échoué N fois avant de le déclarer rouge. Utile pour absorber une flakiness résiduelle *inévitable* (E2E réseau). Mais un retry masque un vrai bug de concurrence aussi bien qu'une vraie flakiness.
- **Quarantine** = sortir le test flaky de la gate (le marquer `test.skip` / tag `@flaky` non-bloquant) **et ouvrir un ticket**. Le pipeline redevient fiable, le test reste tracké pour correction. Préférable au retry aveugle car il rend la dette *visible*.
- **Correction** = la seule vraie issue : rendre le test déterministe (attendre une condition, isoler l'état, nettoyer la base entre tests).

Règle de décision : **retry pour tenir le temps de corriger**, jamais comme état permanent. Un `retries: 2` qui traîne depuis 6 mois cache des bugs de prod.

### 2.6 Rapports, artefacts et annotations

Un job rouge dit *qu'il* a échoué, pas *quoi*. Trois niveaux pour rendre l'échec lisible.

**Artefacts — garder les fichiers de rapport.** Un rapport JUnit/HTML ou le dossier de couverture se conserve avec `upload-artifact`. Le `if: always()` est essentiel : sans lui, l'upload est sauté quand les tests échouent… c'est-à-dire pile quand tu en as besoin.

```yaml
- run: npm run test:unit -- --coverage --reporter=junit --outputFile=reports/junit.xml
- uses: actions/upload-artifact@v7
  if: always()               # ← upload MÊME si l'étape de test a échoué
  with:
    name: test-report-unit   # depuis v4, un artefact est IMMUABLE : un même nom ne peut être ré-uploadé
    path: |
      reports/junit.xml
      coverage/
```

⚠️ **Sharding + artefacts (v4+) :** un artefact v4 est immuable, donc **deux shards ne peuvent pas uploader `test-report`** — le second échoue. Il faut un **nom unique par shard**, puis fusionner au download :

```yaml
# dans le job shardé :
- uses: actions/upload-artifact@v7
  if: always()
  with:
    name: report-${{ matrix.shard }}   # nom unique par shard
    path: reports/

# dans un job d'agrégation (needs: e2e) :
- uses: actions/download-artifact@v8
  with:
    pattern: report-*                  # récupère tous les shards
    merge-multiple: true               # les fusionne dans un seul dossier
    path: all-reports
```

*(`upload-artifact@v7` est la majeure courante ; l'immutabilité des artefacts est introduite depuis `@v4`.)*

**Job summary — un résumé Markdown dans l'onglet run.** Écrire dans le fichier pointé par `$GITHUB_STEP_SUMMARY` affiche du Markdown directement sur la page du run, sans télécharger d'artefact.

```yaml
- name: Résumé
  if: always()
  run: |
    echo "### Résultat des tests" >> "$GITHUB_STEP_SUMMARY"
    echo "- Couverture lignes : $(jq '.total.lines.pct' coverage/coverage-summary.json)%" >> "$GITHUB_STEP_SUMMARY"
```

**Annotations — pointer la ligne fautive.** Les *workflow commands* `::error::` créent une annotation attachée à un fichier/ligne, affichée en rouge dans l'UI et sur la PR. La plupart des reporters JUnit-vers-annotations (ex. actions tierces de type *test-reporter*) automatisent ça à partir du XML.

```yaml
- run: echo "::error file=src/families/family.service.ts,line=42::Test échoué : getFamily renvoie null"
```

## 3. Worked examples

### Exemple 1 — Job unitaire avec gate de couverture (TribuZen)

On boucle le trou 1 et 2 du cas concret : tests unitaires + gate 80 % + rapport conservé.

```yaml
# .github/workflows/ci.yml — job unit
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # setup-node avec cache npm : le lockfile hashé sert de clé de cache (module 02)
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      # --coverage déclenche la gate définie dans vitest.config.ts (thresholds).
      # Si lignes < 80 %, Vitest exit 1 → étape rouge → job rouge → merge bloqué.
      - name: Tests unitaires + couverture
        run: npm run test:unit -- --coverage

      # if: always() → on garde le rapport même quand les tests plantent (le moment où il sert).
      - name: Publier le rapport
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: coverage-unit
          path: coverage/

      # Résumé lisible sur la page du run, sans télécharger l'artefact.
      - name: Résumé couverture
        if: always()
        run: |
          PCT=$(jq '.total.lines.pct' coverage/coverage-summary.json)
          echo "### Couverture unitaire : ${PCT}% (seuil 80%)" >> "$GITHUB_STEP_SUMMARY"
```

Ce que la gate garantit : impossible de merger si un test unitaire échoue **ou** si la couverture de lignes passe sous 80 %. Le seuil vit dans `vitest.config.ts`, donc il gate à l'identique en local (`npm run test:unit -- --coverage`).

### Exemple 2 — Job d'intégration avec Postgres

On boucle le trou 3 : une vraie base pour les tests d'intégration.

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: tribuzen_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test      # base jetable → pas un secret
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5           # GitHub attend que la base soit prête avant les steps
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: 22, cache: npm }
      - run: npm ci

      # Migrations sur la base éphémère avant les tests (schéma vide sinon).
      - run: npm run db:migrate
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/tribuzen_test

      # Job sur le runner (pas de container:) → on se connecte sur localhost:5432.
      - run: npm run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/tribuzen_test
```

Le health-check `pg_isready` supprime le flaky `ECONNREFUSED` du premier test. La chaîne `migrate` → `test` garantit un schéma présent. En fin de job, le conteneur est détruit : chaque run repart d'une base propre.

## 4. Pièges & misconceptions

### PIÈGE #1 — Le job vert qui cache un échec

```yaml
# ❌ continue-on-error avale le code de sortie : le job reste vert même si les tests plantent
- run: npm run test:unit
  continue-on-error: true

# ❌ le pipe renvoie le code de tee (0), pas de vitest
- run: npm run test:unit | tee test.log

# ✅ laisser le code de sortie remonter tel quel
- run: npm run test:unit
```

Un test-runner gate **par son code de sortie**. Tout ce qui l'intercepte (`|| true`, `continue-on-error`, pipe) transforme la gate en décoration.

### PIÈGE #2 — `localhost` vs nom de service

```yaml
# Job SUR le runner (pas de container:) → localhost + ports: obligatoire
env: { DATABASE_URL: "postgres://test:test@localhost:5432/db" }

# Job DANS un conteneur (container: node:22) → nom du service, PAS localhost, ports: inutile
env: { DATABASE_URL: "postgres://test:test@postgres:5432/db" }
```

Erreur classique : copier une config « job en conteneur » (`@postgres`) dans un job runner → `ENOTFOUND postgres`. Le host dépend du modèle d'exécution du job.

### PIÈGE #3 — Service sans health-check

Sans `options: --health-cmd`, GitHub lance tes steps dès que le conteneur *démarre*, pas quand il est *prêt*. Le premier test tape une base qui n'écoute pas encore → `ECONNREFUSED` **intermittent**. Ce n'est pas un test flaky, c'est une course au démarrage : la corriger avec un health-check, pas avec un retry.

### PIÈGE #4 — Retry qui masque un vrai bug

```yaml
# retries: 2 permanent → un test qui échoue 1 fois sur 3 « passe »
# … mais s'il échoue à cause d'une vraie race condition en prod, tu ne le sauras jamais.
```

Le retry est légitime **temporairement** (le temps de corriger) ou pour une flakiness réseau **irréductible** (E2E). En faire un état permanent revient à désactiver silencieusement une partie de tes assertions. Préfère la **quarantine tracée** (skip + ticket) : la dette reste visible.

### PIÈGE #5 — Sharding : deux artefacts de même nom (v4+)

```yaml
# ❌ chaque shard tente d'uploader `test-report` → le 2e échoue (artefact immuable en v4)
- uses: actions/upload-artifact@v7
  with: { name: test-report, path: reports/ }

# ✅ nom unique par shard, fusion au download
- uses: actions/upload-artifact@v7
  with: { name: report-${{ matrix.shard }}, path: reports/ }
```

Depuis v4, un artefact est immuable : un même nom ne peut être écrit deux fois. En matrix, il **faut** un nom paramétré par `matrix.*`.

### PIÈGE #6 — `fail-fast` qui tue les rapports

Par défaut, une `matrix` a `fail-fast: true` : dès qu'un shard échoue, GitHub **annule les autres**. Pour des tests, tu perds alors la vue d'ensemble (les autres shards auraient peut-être révélé 5 autres échecs). Mets `fail-fast: false` sur les matrices de test.

## 5. Ancrage TribuZen

Le pipeline CI de TribuZen (`.github/workflows/ci.yml`) enchaîne trois jobs de test, câblés dans ce module :

```
.github/
  workflows/
    ci.yml            ← jobs: unit (gate 80%), integration (Postgres service), e2e (sharded 4×)
tribuzen/
  vitest.config.ts    ← coverage.thresholds : la gate de couverture vit ICI
  playwright.config.ts← retries: CI ? 2 : 0 (flakiness E2E irréductible, tracée)
```

- **`unit`** : `npm run test:unit -- --coverage`. Gate 80 % lignes déclarée dans `vitest.config.ts`. Bloque le merge sur `main` (branch protection activée).
- **`integration`** : service `postgres:16` avec `pg_isready`, `DATABASE_URL` sur `localhost:5432`, migrations avant tests. Couvre `family.service`, `auth.service`, les repositories.
- **`e2e`** : Playwright shardé sur 4 runners (`fail-fast: false`), rapports uploadés en `report-1..4`, fusionnés dans un job `e2e-report`.

> **Défère :** le *contenu* de ces tests (testcontainers, factories, mocks, sélecteurs Playwright) = **cours 06**. Ici, TribuZen n'apporte que l'**orchestration** : jobs, services, gate, rapports.

Commit cible dans `smaurier/tribuzen` :
```
ci(test): job unit avec gate couverture 80%, integration Postgres, e2e shardé 4×
```

## 6. Points clés

1. La gate de test = le **code de sortie** du runner ; tout ce qui l'intercepte (`|| true`, `continue-on-error`, pipe) casse la garde.
2. Pour bloquer réellement un merge, il faut **branch protection → required status checks** côté repo, pas seulement un job rouge.
3. La **gate de couverture** se déclare dans la config du runner (`coverage.thresholds`), pas en shell — versionnée et identique local/CI.
4. Le **sharding** (matrix) réduit le temps mural mais multiplie les minutes facturées ; toujours `fail-fast: false` pour des tests.
5. Un **service container** fournit une vraie dépendance ; sur un job runner on publie `ports:` et on se connecte à **`localhost`** (nom de service seulement si le job tourne *dans* un conteneur).
6. Le **health-check** (`--health-cmd pg_isready`) supprime la course au démarrage, cause n°1 des `ECONNREFUSED` intermittents.
7. Un test **flaky** se corrige (déterminisme) ou se met en **quarantine tracée** ; le **retry** est un pansement temporaire, jamais un état permanent.
8. Conserver un rapport : `upload-artifact@v4` **avec `if: always()`** ; artefact immuable → **nom unique par shard** + `download-artifact` `pattern`/`merge-multiple`.
9. `$GITHUB_STEP_SUMMARY` affiche un résumé Markdown sur la page du run ; `::error file=…,line=…::` crée une annotation ciblée.

## 7. Seeds Anki

```
Qu'est-ce qui fait échouer un job GitHub Actions quand un test rouge apparaît ?|Le code de sortie du runner : Vitest/Jest/Playwright renvoient 1 dès qu'un test échoue → l'étape run échoue → le job échoue. Aucune action spéciale requise.
Pourquoi un job de test peut-il rester vert alors que des tests échouent ?|Le code de sortie a été intercepté : continue-on-error: true, un `|| true`, ou un pipe (npm test | tee) qui renvoie le code du dernier maillon, pas celui du runner.
Où déclarer la gate de couverture, et pourquoi pas en shell ?|Dans la config du runner (vitest coverage.thresholds : lines 80, etc.). Elle est alors versionnée avec le code et gate identiquement en local et en CI. Le parsing jq/bc en shell est fragile et duplique une logique native.
Comment un job SUR le runner se connecte-t-il à un service Postgres, vs un job DANS un conteneur ?|Sur le runner : publier ports: 5432:5432 et se connecter à localhost:5432. Dans un conteneur (container:) : se connecter au nom du service (postgres:5432) sur le réseau Docker interne, ports: inutile.
À quoi sert --health-cmd pg_isready sur un service container ?|À faire attendre GitHub que la base soit PRÊTE (pas seulement démarrée) avant de lancer les steps. Supprime les ECONNREFUSED intermittents dus à la course au démarrage.
Retry vs quarantine face à un test flaky : quand utiliser quoi ?|Retry = re-jouer N fois, pansement temporaire ou flakiness réseau irréductible (E2E). Quarantine = sortir le test de la gate (skip + ticket) pour garder la dette visible. La vraie issue reste rendre le test déterministe.
Pourquoi un artefact upload-artifact v4 ne peut-il pas être uploadé deux fois sous le même nom ?|Depuis v4, les artefacts sont immuables : un nom ne peut être écrit qu'une fois. En matrix/sharding, il faut un nom unique (report-${{ matrix.shard }}) puis download-artifact avec pattern + merge-multiple.
Pourquoi mettre fail-fast: false sur une matrix de tests ?|Par défaut fail-fast: true annule les autres shards dès qu'un échoue → on perd la vue d'ensemble des échecs. fail-fast: false laisse tous les shards finir et rapporter.
Pourquoi if: always() sur l'étape upload-artifact d'un rapport de test ?|Sans lui, l'upload est sauté quand une étape précédente échoue — c'est-à-dire pile quand le rapport d'échec est le plus utile.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-03-testing-dans-ci/README.md`. Câbler l'étape de test de `ci.yml` pour TribuZen — gate de couverture, service Postgres avec health-check, e2e shardé — corrigé YAML complet commenté, zéro harnais simulé.
