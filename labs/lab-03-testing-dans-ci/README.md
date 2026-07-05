# Lab 03 — Lancer les tests de TribuZen en CI

> **Outcome :** à la fin, tu sais écrire un `ci.yml` qui gate le merge sur les tests unitaires **et** la couverture (≥ 80 %), provisionne une base Postgres pour les tests d'intégration, et sharde les tests e2e sur 4 runners avec rapports fusionnés.
> **Vrai outil :** GitHub Actions (workflow YAML réel), service container `postgres:16`, Vitest/Playwright comme runners. Aucun harnais simulé.
> **Feedback :** le coach relit ton YAML en session (ou tu le pushes sur une branche jetable et tu lis le run réel dans l'onglet Actions). Pas d'auto-correcteur.

---

## Énoncé

Tu reprends le squelette inutile du module (`.github/workflows/ci.yml`) et tu le transformes en **trois jobs** répondant au cahier des charges du lead TribuZen :

1. **`unit`** — tests unitaires + **gate de couverture ≥ 80 % de lignes**. Le job doit échouer si un test rouge **ou** si la couverture passe sous le seuil. Le rapport de couverture est conservé comme artefact **même en cas d'échec**.
2. **`integration`** — tests d'intégration contre une **vraie base Postgres** fournie par un service container, avec **health-check** (`pg_isready`) et migrations avant les tests. Connexion sur `localhost:5432`.
3. **`e2e`** — tests Playwright **shardés sur 4 runners** (`fail-fast: false`), chaque shard uploade un rapport à **nom unique**, un job `e2e-report` les **fusionne**.

**Portée :** tu n'écris **aucun test** dans ce lab (c'est le cours 06). Tu supposes que `npm run test:unit`, `npm run test:integration`, `npm run db:migrate` et `npx playwright test` existent. Tu câbles **l'orchestration**.

**Contexte fourni (déjà en place dans le repo TribuZen) :**

```jsonc
// package.json (extrait) — scripts supposés présents
{
  "scripts": {
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "db:migrate": "node scripts/migrate.js"
  }
}
```

```ts
// vitest.config.ts — la gate de couverture vit ICI (fournie)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
```

### Starter minimal

Crée `.github/workflows/ci.yml` à partir de ce squelette. **Pas de gap-fill** : tu écris les trois jobs complets.

```yaml
# .github/workflows/ci.yml — starter
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # À toi : setup-node + cache, npm ci, tests + gate couverture, upload rapport (if: always)

  # À toi : job integration (service postgres + health-check + migrate + tests)

  # À toi : job e2e (matrix shard 1..4, fail-fast: false) + job e2e-report (fusion)
```

---

## Étapes (en friction)

1. **Job `unit`** — ajoute `setup-node@v4` (node 22, `cache: npm`), `npm ci`, puis `npm run test:unit -- --coverage`. Vérifie mentalement : d'où vient le `exit 1` si la couverture est à 76 % ? (Réponse : du seuil dans `vitest.config.ts`, pas d'un script shell.)
2. **Conserve le rapport** — `upload-artifact@v4` avec `if: always()` et `path: coverage/`. Pourquoi `always()` ?
3. **Résumé** — écris la couverture dans `$GITHUB_STEP_SUMMARY` (lis `coverage/coverage-summary.json` avec `jq`).
4. **Job `integration`** — déclare un service `postgres:16` : `env` (DB/USER/PASSWORD), `ports: 5432:5432`, `options` health-check `pg_isready`. Lance `db:migrate` **avant** `test:integration`, tous deux avec `DATABASE_URL` sur `localhost`.
5. **Vérifie le host** — le job tourne-t-il *dans* un conteneur ou *sur* le runner ? En déduire `localhost` vs `postgres` comme host.
6. **Job `e2e`** — `strategy.matrix.shard: [1,2,3,4]` + `fail-fast: false`. `npx playwright test --shard=…/4`. Chaque shard uploade `report-<shard>` (`if: always()`).
7. **Job `e2e-report`** — `needs: e2e`, `download-artifact@v4` avec `pattern: report-*` et `merge-multiple: true`, puis (optionnel) un step qui agrège.
8. **Cas limites** — que se passe-t-il si tu nommes les 4 artefacts `report` (sans le numéro de shard) ? Si tu oublies `fail-fast: false` et qu'un shard plante ?

---

## Corrigé complet commenté

```yaml
# .github/workflows/ci.yml — corrigé
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  # ─────────────────────────────────────────────────────────────
  # JOB 1 — Unitaires + gate de couverture
  # ─────────────────────────────────────────────────────────────
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # cache: npm → clé dérivée du lockfile (module 02). Accélère npm ci.
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      # --coverage active la gate déclarée dans vitest.config.ts (thresholds.lines: 80).
      # Test rouge OU couverture < 80% → vitest exit 1 → étape rouge → job rouge → merge bloqué
      # (à condition d'avoir activé branch protection → required status checks sur main).
      - name: Tests unitaires + couverture
        run: npm run test:unit -- --coverage

      # if: always() → on garde le rapport MÊME si l'étape de test a échoué (le moment utile).
      - name: Conserver le rapport de couverture
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: coverage-unit          # nom unique (un seul job unit → pas de collision)
          path: coverage/

      # Résumé Markdown affiché directement sur la page du run, sans télécharger l'artefact.
      - name: Résumé couverture
        if: always()
        run: |
          PCT=$(jq '.total.lines.pct' coverage/coverage-summary.json)
          echo "### Couverture unitaire : ${PCT}% (seuil 80%)" >> "$GITHUB_STEP_SUMMARY"

  # ─────────────────────────────────────────────────────────────
  # JOB 2 — Intégration avec vraie base Postgres
  # ─────────────────────────────────────────────────────────────
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: tribuzen_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test        # base jetable, détruite en fin de job → PAS un secret
        ports:
          - 5432:5432                     # publie le port du conteneur sur le runner
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5             # GitHub attend que la base soit PRÊTE avant les steps
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      # Migrations d'abord : sans schéma, les tests d'intégration planteraient.
      - name: Migrations
        run: npm run db:migrate
        env:
          # Job SUR le runner (pas de container:) → host = localhost.
          DATABASE_URL: postgres://test:test@localhost:5432/tribuzen_test

      - name: Tests d'intégration
        run: npm run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/tribuzen_test

  # ─────────────────────────────────────────────────────────────
  # JOB 3 — E2E shardé sur 4 runners
  # ─────────────────────────────────────────────────────────────
  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false                    # ne PAS annuler les autres shards si un échoue
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps

      # Chaque runner exécute sa tranche : shard 1/4, 2/4, 3/4, 4/4.
      - name: E2E (shard ${{ matrix.shard }}/4)
        run: npx playwright test --shard=${{ matrix.shard }}/4

      # Nom UNIQUE par shard : un artefact v4 est immuable, deux "report" entreraient en collision.
      - name: Uploader le rapport partiel
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: report-${{ matrix.shard }}
          path: playwright-report/

  # ─────────────────────────────────────────────────────────────
  # JOB 4 — Fusion des rapports de shards
  # ─────────────────────────────────────────────────────────────
  e2e-report:
    needs: e2e
    if: always()                          # on veut le rapport agrégé même si un shard a échoué
    runs-on: ubuntu-latest
    steps:
      # pattern: report-* + merge-multiple → tous les shards dans un seul dossier.
      - uses: actions/download-artifact@v8
        with:
          pattern: report-*
          merge-multiple: true
          path: all-reports
      - name: Résumé e2e
        run: echo "### Rapports e2e fusionnés (4 shards)" >> "$GITHUB_STEP_SUMMARY"
```

**Pourquoi ce corrigé est correct :**
- La gate de couverture n'est **pas** dans le YAML : elle vit dans `vitest.config.ts`. Le workflow ne fait que passer `--coverage` — le seuil gate à l'identique en local. Zéro `jq`/`bc` fragile pour décider du pass/fail.
- `if: always()` sur les uploads : le rapport survit à un job rouge, sinon il manquerait pile quand on en a besoin.
- Le service Postgres a un **health-check** : les steps ne démarrent qu'une fois `pg_isready` vert → pas de `ECONNREFUSED` de démarrage. Host = `localhost` car le job tourne **sur** le runner (aucun `container:`).
- Sharding : **nom d'artefact unique par shard** (immutabilité v4) + `fail-fast: false` (voir tous les échecs) + job de fusion avec `pattern`/`merge-multiple`.

**Grille d'auto-évaluation (coche — seuil de réussite en bas) :**

| Critère | OK ? |
|---|---|
| Job `unit` : `--coverage`, la gate 80 % vient de `vitest.config.ts` (pas d'un `if` shell) | ☐ |
| Le rapport de couverture est uploadé avec `if: always()` | ☐ |
| Job `integration` : service `postgres:16` avec health-check `pg_isready` | ☐ |
| `db:migrate` s'exécute **avant** `test:integration` | ☐ |
| Host de la DB = `localhost` (job sur le runner, aucun `container:`) | ☐ |
| Job `e2e` : `matrix.shard [1,2,3,4]` **+** `fail-fast: false` | ☐ |
| Chaque shard uploade un artefact à **nom unique** (`report-<shard>`) | ☐ |
| Job `e2e-report` fusionne via `download-artifact` `pattern: report-*` + `merge-multiple: true` | ☐ |

**Seuil :** 7/8 cochés, dont **obligatoirement** « gate hors YAML » et « nom d'artefact unique par shard » — les deux pièges qui font échouer silencieusement le pipeline.

**Coach — conduite de session (relances + pièges) :**
- Relance si silence : « À 76 % de couverture, d'où vient exactement le `exit 1` — de ton YAML, ou d'ailleurs ? »
- « Ton service Postgres : le step de test démarre-t-il avant ou après que la base soit prête ? Qu'est-ce qui le garantit ? »
- « Tu nommes tes 4 rapports `report` tout court : que répond GitHub au 2e upload, sachant que les artefacts sont immuables ? »
- « Sans `fail-fast: false`, un shard qui plante fait quoi aux trois autres ? »
- Piège à débusquer : host `postgres` au lieu de `localhost` quand le job tourne **sur** le runner ; gate de couverture recodée en `jq`/`bc` au lieu de s'appuyer sur le seuil de `vitest.config.ts`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées — de mémoire, en 30 min, sans rouvrir ce corrigé :**

1. Ajoute un **service Redis** au job `integration` (health-check `redis-cli ping`) et une seconde variable `REDIS_URL`.
2. Ajoute un **job `gate`** final qui `needs: [unit, integration, e2e-report]` et qui n'est vert **que si les trois passent** — c'est ce job unique que tu mettras en *required status check* (au lieu d'en exiger trois séparément).
3. Fais en sorte que le job `e2e` ne tourne **que sur les PR vers `main`** (condition `if:` sur l'event), pas sur chaque push de branche.

**Critère de réussite :** le workflow est valide (pas d'erreur de parse dans l'onglet Actions), Redis répond dans les tests d'intégration, et un seul check `gate` conditionne le merge.

---

## Application TribuZen

Dans `smaurier/tribuzen`, ce workflow vit ici :

```
tribuzen/
  .github/
    workflows/
      ci.yml              ← les 4 jobs de ce lab
  vitest.config.ts        ← gate couverture (thresholds) — fournie, cours 06 pour le contenu
  playwright.config.ts    ← retries: process.env.CI ? 2 : 0
  scripts/migrate.js      ← db:migrate
```

**Différences par rapport au lab :**
- Le **contenu** des tests (factories, testcontainers, sélecteurs Playwright) vient du **cours 06** — ici on ne câble que l'orchestration.
- En vrai, `unit` + `integration` peuvent partager une **composite action** `setup-project` (checkout + setup-node + npm ci) pour éviter la répétition (module 02).
- La branch protection de `main` exige le check `gate` (variante J+30) — sans ça, un job rouge n'empêche pas le merge.

**Commit cible :**
```
ci(test): ci.yml — unit (gate 80%), integration Postgres+Redis, e2e shardé 4× fusionné
```
