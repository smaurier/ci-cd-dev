# Lab 04 — Conteneurisation dans le CI

> **Outcome :** à la fin, tu sais écrire un Dockerfile multi-stage pour l'API TribuZen et le builder dans GitHub Actions avec Buildx + cache de layers `type=gha`.
> **Vrai outil :** Docker (`docker build` / Buildx) + GitHub Actions (`docker/build-push-action@v7`). Aucun harnais simulé.
> **Feedback :** le coach valide en session — on lit le Dockerfile, on mesure la taille de l'image (`docker images`), et on observe le cache-hit sur un second run CI.

---

## Énoncé

L'API TribuZen (NestJS) est testée en CI (lab 03). Tu ajoutes l'étape qui produit son **image Docker**.

Point de départ — le Dockerfile mono-stage actuel, lourd et non optimisé :

```dockerfile
# apps/api/Dockerfile — AVANT (à remplacer)
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**Objectif :**

1. Réécrire ce Dockerfile en **multi-stage** : un stage `build` (toolchain complet + `npm run build`), un stage final **minimal** qui ne reçoit que `dist/` + les dépendances de production.
2. Ajouter un **`.dockerignore`** correct.
3. Utiliser **`npm ci`** (pas `npm install`) et un **ordre de layers** qui met le cache de `npm ci` à l'abri des changements de code.
4. Écrire un workflow **`.github/workflows/docker-build.yml`** qui build l'image (sans push) sur chaque PR, avec **cache `type=gha`**.

**Contraintes de réussite :**
- Image finale **< 250 Mo** (`docker images` pour vérifier).
- Un second `docker build` sans changer le code réutilise le cache de `npm ci` (layer `CACHED`).
- Pas de `node_modules`/`.env` de l'hôte embarqués dans l'image.

**Pas de gap-fill** — tu écris les deux fichiers depuis le starter minimal.

### Starter minimal

```
apps/api/
  package.json
  package-lock.json      # présent → npm ci fonctionne
  src/main.ts
  Dockerfile             # à réécrire
  .dockerignore          # à créer
.github/workflows/
  docker-build.yml       # à créer
```

Tu peux tester en local sans CI : `docker build -t tribuzen-api ./apps/api` puis `docker images tribuzen-api`.

---

## Étapes (en friction)

1. **Écris le stage `build`** — `FROM node:20-alpine AS build`, `WORKDIR /app`, copie `package*.json`, `npm ci`, puis `COPY . .` et `npm run build`.
2. **Écris le stage final** — nouveau `FROM node:20-alpine`, `npm ci --omit=dev`, puis `COPY --from=build /app/dist ./dist`. Termine par `EXPOSE 3000` et `CMD ["node", "dist/main.js"]`.
3. **Vérifie l'ordre des layers** — `package*.json` + `npm ci` doivent venir **avant** `COPY . .`. Sinon le cache d'install saute à chaque commit.
4. **Crée `.dockerignore`** — exclus au minimum `node_modules`, `dist`, `.git`, `.env*`, `*.log`.
5. **Build local et mesure** — `docker build -t tribuzen-api ./apps/api` puis `docker images` : note la taille. Relance le build sans rien changer → les layers doivent afficher `CACHED`.
6. **Écris le workflow** — job `build-image` sur `ubuntu-latest` : `checkout@v4`, `setup-buildx-action@v4`, puis `build-push-action@v7` avec `push: false`, `tags`, `cache-from: type=gha`, `cache-to: type=gha,mode=max`.
7. **Observe le cache en CI** — pousse deux commits (un changement de code, pas de deps). Au second run, la couche `npm ci` doit être réimportée du cache GHA (durée du step qui chute).
8. **Cas limite** — retire momentanément `.dockerignore` et rebuild : constate le contexte plus lourd et le risque d'embarquer `node_modules` de l'hôte. Remets-le.

---

## Corrigé complet commenté

**`apps/api/Dockerfile`**

```dockerfile
# ─── Stage 1 : build (image riche, jetée à la fin) ───
FROM node:20-alpine AS build
WORKDIR /app

# Manifeste d'abord : la layer npm ci n'est invalidée QUE si package*.json change.
# C'est ce qui rend le cache efficace commit après commit.
COPY package*.json ./
RUN npm ci                      # npm ci = install reproductible depuis le lockfile (toutes deps)

# Puis le code : n'invalide le cache qu'à partir d'ici.
COPY . .
RUN npm run build               # compile TypeScript → dist/

# ─── Stage 2 : runtime minimal (seul ce stage devient l'image finale) ───
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Dépendances de PRODUCTION uniquement → image plus légère, pas de tsc/nest-cli.
COPY package*.json ./
RUN npm ci --omit=dev

# On ne récupère QUE l'artefact compilé du stage build.
# Le toolchain et les devDependencies restent dans "build" et ne sont jamais expédiés.
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**`apps/api/.dockerignore`**

```dockerignore
node_modules
dist
.git
.env
.env.*
*.log
coverage
Dockerfile
.dockerignore
```

**`.github/workflows/docker-build.yml`**

```yaml
name: docker-build

on:
  pull_request:
  push:
    branches: [main]

jobs:
  build-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Buildx est requis pour le cache distant type=gha
      # (le builder Docker legacy ne sait pas l'exporter).
      - name: Set up Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build image (cache GHA)
        uses: docker/build-push-action@v7
        with:
          context: ./apps/api          # dossier contenant Dockerfile + .dockerignore
          file: ./apps/api/Dockerfile
          push: false                  # PR : on valide le build, on ne publie pas encore
          tags: tribuzen-api:${{ github.sha }}
          cache-from: type=gha         # importe les layers cachées des runs précédents
          cache-to: type=gha,mode=max  # exporte TOUTES les layers pour le prochain run
```

**Pourquoi ce corrigé est correct :**
- **Multi-stage + copie sélective** : seul `dist/` (+ deps de prod) passe dans l'image finale via `COPY --from=build`. Le toolchain de `node:20-alpine` du stage build est jeté → image ~150–180 Mo au lieu de ~1 Go.
- **Ordre des layers** : `package*.json` → `npm ci` → `COPY . .`. Un changement de code n'invalide pas la couche d'install ; le cache `type=gha` la réimporte.
- **`npm ci` (×2)** : install reproductible ; le second `--omit=dev` allège l'image finale.
- **`.dockerignore`** : le `COPY . .` ne réintroduit pas `node_modules` de l'hôte (binaires potentiellement incompatibles) ni les `.env` locaux.
- **`push: false`** : sur une PR on prouve que l'image build sans publier. Le login au registry + `push: true` + tags sémantiques viennent au module 05.

**Grille d'auto-évaluation (coche — seuil de réussite en bas) :**

| Critère | OK ? |
|---|---|
| Dockerfile **multi-stage** : stage `build` (toolchain) + stage final minimal | ☐ |
| `COPY package*.json` + `npm ci` **avant** `COPY . .` (ordre de cache) | ☐ |
| Le stage final n'embarque que `dist/` + deps de prod (`npm ci --omit=dev`) | ☐ |
| `.dockerignore` exclut `node_modules`, `dist`, `.git`, `.env*`, `*.log` | ☐ |
| Image finale **< 250 Mo** (`docker images` pour vérifier) | ☐ |
| 2e build sans changer le code → la layer `npm ci` affiche `CACHED` | ☐ |
| Workflow : `setup-buildx-action@v4` **avant** `build-push-action@v7`, `push: false` | ☐ |
| Cache `cache-from` **et** `cache-to: type=gha` présents | ☐ |

**Seuil :** 7/8 cochés, dont **obligatoirement** « multi-stage » et « `npm ci` avant `COPY . .` » — le reste est optimisation, ces deux-là sont l'objectif du lab.

**Coach — conduite de session (relances + pièges) :**
- Relance si silence : « Déplace `COPY . .` avant `npm ci` dans ta tête — à quelle fréquence le cache d'install sautera-t-il désormais ? »
- « Ton image finale contient-elle `tsc` / nest-cli ? Où sont-ils censés rester ? »
- « Buildx n'est pas dans le workflow : `cache-to: type=gha` fonctionne-t-il avec le builder Docker legacy ? »
- « Tu retires `.dockerignore` : qu'est-ce qui risque d'entrer dans l'image depuis l'hôte ? »
- Piège à débusquer : `npm install` au lieu de `npm ci` ; `--omit=dev` oublié au stage final (image gonflée) ; `push: true` laissé sur une PR.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 04 :**

1. Refais le Dockerfile multi-stage **de mémoire, en 20 minutes**.
2. Remplace le stage final `node:20-alpine` par une base **distroless** (`gcr.io/distroless/nodejs20-debian12`). Adapte le `CMD` (l'entrypoint distroless-nodejs est déjà `node` : on ne passe que `["dist/main.js"]`) et copie aussi `node_modules` de production depuis le stage build.
3. Dans le workflow, ajoute un `scope` de cache (`cache-to: type=gha,mode=max,scope=api`) pour ne pas écraser le cache d'un autre service.

**Critère de réussite :** l'image build, tourne (`docker run`), et un second build affiche le cache réutilisé. Bonus : compare la taille distroless vs alpine (`docker images`).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen` :

```
tribuzen/
  apps/
    api/
      Dockerfile            ← multi-stage NestJS (ce lab)
      .dockerignore
  .github/
    workflows/
      docker-build.yml      ← job build-image, needs: test
```

**Différences par rapport au lab :**
- Le job `build-image` aura `needs: test` : on ne construit l'image que si le lab 03 (tests + coverage gate) est vert.
- Sur `main`, ce job passera à `push: true` vers GHCR avec des tags sémantiques (`docker/metadata-action@v6`) — c'est le **module 05**.
- Le front Vue/Nuxt aura son propre Dockerfile multi-stage suivant la même logique.

**Commit cible :**
```
ci(api): Dockerfile multi-stage + build image en CI avec cache GHA
```
