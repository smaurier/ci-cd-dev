---
titre: Conteneurisation dans le CI
cours: 15-cicd-devops
notions: [Docker en CI, Dockerfile multi-stage, "COPY --from", docker buildx, "layer caching type=gha", "cache-from / cache-to", build-push-action, dockerignore, images legeres alpine, distroless, build reproductible, npm ci lockfile]
outcomes:
  - sait ecrire un Dockerfile multi-stage qui separe build et runtime pour une image legere
  - sait builder une image dans GitHub Actions avec docker/build-push-action et Buildx
  - sait activer le cache de layers en CI avec cache-from/cache-to type=gha
  - sait rediger un .dockerignore et choisir une image de base minimale (alpine / distroless)
  - comprend ce qui rend un build reproductible (npm ci, tags de base epingles, ordre des layers)
prerequis: [GitHub Actions fondamentaux et avance — modules 00 a 03 du cours 15-cicd-devops]
next: 05-artefacts-registries
libs: []
tribuzen: pipeline CI/CD TribuZen — build de l'image Docker de l'API (NestJS) dans le job CI
last-reviewed: 2026-07
---

# Conteneurisation dans le CI

> **Outcomes — tu sauras FAIRE :** écrire un Dockerfile multi-stage pour l'API TribuZen, le builder dans GitHub Actions avec Buildx, activer le cache de layers en CI, et réduire la taille de l'image avec `.dockerignore` + image de base minimale.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre la **construction** d'une image dans le CI (Dockerfile, Buildx, cache). L'authentification vers un registry, la stratégie de tags/versioning, la signature et la provenance sont détaillées au **module 05 (artefacts & registries)** — ici on se contente d'un `push` de base pour montrer le flux complet. Le scan de vulnérabilités d'image relève de la **sécurité des pipelines (module 08)**.

## 1. Cas concret d'abord

L'API TribuZen (NestJS) passe ses tests en CI (module 03). L'étape suivante du pipeline doit produire un **artefact déployable** : une image Docker. Un collègue a écrit ce premier Dockerfile :

```dockerfile
# Dockerfile — PREMIÈRE VERSION, à problèmes
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Le build passe, mais en CI l'image sort à **1,1 Go** et chaque build prend 4 minutes, même quand une seule ligne de code change. Quatre problèmes concrets :

1. **`FROM node:20`** embarque tout le toolchain (compilateurs, git, ~1 Go). Le runtime n'a besoin que de Node.
2. **`COPY . .` avant `npm install`** : le moindre changement dans le code source invalide le cache de la couche `npm install` — les dépendances sont réinstallées à chaque commit.
3. **Pas de `.dockerignore`** : `node_modules`, `.git`, `.env` locaux sont copiés dans le contexte de build (lent, et fuite potentielle de secrets).
4. **`npm install`** (pas `npm ci`) : peut résoudre des versions différentes du lockfile → build non reproductible.
5. Les outils de build (devDependencies, `dist/` intermédiaire) se retrouvent dans l'image finale expédiée en production.

Ce module transforme ce Dockerfile en une image **multi-stage < 200 Mo**, buildée en CI avec un **cache de layers** qui rend les builds incrémentaux quasi instantanés.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi conteneuriser dans le CI

Le CI ne se contente pas de tester : il produit l'**artefact** qu'on déploiera. Pour une API, cet artefact est une image Docker — une unité immuable qui contient le code compilé + le runtime + les dépendances. Builder l'image **dans** le pipeline garantit que ce qui est testé et ce qui est déployé partent du même commit. Le déploiement (module 06) ne fait plus que « lancer l'image N ».

### 2.2 Dockerfile multi-stage : séparer build et runtime

Un build multi-stage utilise **plusieurs `FROM`** dans un même Dockerfile. Chaque `FROM` démarre un *stage*. On compile dans un stage riche (toolchain complet), puis on **copie uniquement le résultat** dans un stage final minimal. Tout ce qui reste dans les stages intermédiaires est jeté.

```dockerfile
# Stage "build" : image riche, sert à compiler
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                 # installe TOUTES les deps (dont devDependencies)
COPY . .
RUN npm run build          # produit dist/

# Stage final : image minimale, ne reçoit que le nécessaire
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev      # deps de PRODUCTION seulement
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- `FROM node:20-alpine AS build` : nomme le stage `build` (le `AS <nom>` évite de dépendre d'un index numérique).
- `COPY --from=build /app/dist ./dist` : copie l'artefact compilé depuis le stage `build` vers le stage final. Le toolchain et les devDependencies restent dans `build` et **ne sont jamais expédiés**.
- Le stage final ne garde que : Node runtime + deps de prod + `dist/`.

`COPY --from=` peut aussi référencer une **image externe** : `COPY --from=nginx:latest /etc/nginx/nginx.conf ./`. Avec BuildKit, seuls les stages dont dépend la cible sont exécutés.

### 2.3 Ordre des layers = clé du cache

Chaque instruction Dockerfile crée une **layer**. Docker met en cache une layer et la réutilise tant que **ni l'instruction ni les fichiers qu'elle copie n'ont changé**. Dès qu'une layer est invalidée, **toutes les suivantes** le sont aussi.

Conséquence : copier ce qui change **rarement** avant ce qui change **souvent**.

```dockerfile
# ✅ BON ordre : le manifeste des deps AVANT le code source
COPY package*.json ./
RUN npm ci                 # cette layer ne se rejoue QUE si package*.json change
COPY . .                   # le code change à chaque commit → invalide seulement à partir d'ici
RUN npm run build
```

```dockerfile
# ❌ MAUVAIS ordre : tout copié d'un coup
COPY . .
RUN npm ci                 # le moindre changement de code réinstalle toutes les deps
```

### 2.4 `.dockerignore` : maîtriser le contexte de build

Avant de builder, Docker envoie le **contexte** (le répertoire courant) au moteur. Sans filtre, `node_modules/`, `.git/`, les fichiers `.env` locaux partent aussi : build lent et risque de fuite. `.dockerignore` (à la racine, syntaxe proche de `.gitignore`) les exclut.

```dockerignore
node_modules
dist
.git
.env
.env.*
*.log
Dockerfile
.dockerignore
coverage
```

Bénéfices : contexte plus léger (upload plus rapide), pas de secret local embarqué, et le `COPY . .` ne réintroduit pas un `node_modules` de l'hôte (potentiellement compilé pour une autre plateforme).

### 2.5 Images légères : alpine et distroless

Le choix de l'image de base **finale** décide de la taille et de la surface d'attaque.

| Base | Taille approx. | Contient un shell / package manager ? | Usage |
|---|---|---|---|
| `node:20` | ~1 Go | oui (Debian complet) | build uniquement |
| `node:20-alpine` | ~130 Mo | oui (busybox, apk) | choix par défaut raisonnable |
| `gcr.io/distroless/nodejs20-debian12` | ~110 Mo | **non** | runtime durci en prod |

Une image **distroless** ne contient ni shell ni gestionnaire de paquets : juste le runtime Node et ton app. Surface d'attaque réduite, mais **pas de `sh`** pour débugger (`docker exec ... sh` échoue) et le `CMD` doit pointer directement le binaire/entrée Node.

```dockerfile
# Stage final durci en distroless
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# distroless nodejs : l'entrypoint EST node, on ne passe que les args
CMD ["dist/main.js"]
```

Règle simple : **alpine** comme défaut pragmatique ; **distroless** quand on veut durcir le runtime de prod.

### 2.6 Buildx et BuildKit

`docker buildx` est le builder moderne (front-end de **BuildKit**). Il apporte, par rapport au builder legacy : le cache exportable/importable, les builds multi-plateformes, et l'exécution parallèle des stages indépendants. En CI on l'active explicitement (l'action `docker/setup-buildx-action`), car c'est lui qui débloque le cache distant `type=gha`.

### 2.7 Builder dans GitHub Actions

Les actions officielles Docker font le travail. Versions majeures courantes (vérifiées 2026-07) : `docker/setup-buildx-action@v4`, `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/metadata-action@v6`.

```yaml
name: build-image
on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build (sans push)
        uses: docker/build-push-action@v7
        with:
          context: .
          push: false
          tags: tribuzen-api:${{ github.sha }}
```

`context: .` = répertoire de build (là où sont Dockerfile et `.dockerignore`). `push: false` build sans publier — utile pour valider le build sur une PR sans polluer le registry.

### 2.8 Cache de layers en CI avec `type=gha`

Problème : chaque run CI démarre sur une machine **neuve**, sans cache local Docker → tout se reconstruit. Solution : exporter/importer le cache de layers via le **cache GitHub Actions** (`type=gha`).

```yaml
      - name: Build avec cache
        uses: docker/build-push-action@v7
        with:
          context: .
          push: false
          tags: tribuzen-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- `cache-from: type=gha` : importe les layers cachées du cache GHA (builds précédents).
- `cache-to: type=gha,mode=max` : exporte les layers pour le prochain run. `mode=max` cache **toutes** les layers (y compris intermédiaires) → meilleur taux de réutilisation que `mode=min` (défaut).
- Restriction GitHub : seul le cache de la branche courante, de sa base, ou de la branche par défaut est accessible.

Résultat : si seul le code change, la layer `npm ci` est réimportée du cache et le build tombe de plusieurs minutes à quelques secondes.

### 2.9 Build reproductible

Un build est reproductible si le **même commit** produit une image **équivalente**, indépendamment de la machine et de la date. Leviers concrets :

- `npm ci` (pas `npm install`) : installe **exactement** ce que dit `package-lock.json`, échoue si le lock est incohérent.
- **Épingler la base** : `node:20-alpine` est déjà mieux que `node:latest` ; pour du strict, épingler par digest `node:20-alpine@sha256:...`.
- Ordre de layers déterministe + `.dockerignore` : le contexte ne dépend pas de fichiers locaux parasites.
- Éviter les commandes non déterministes (téléchargements « latest », horodatages) dans le Dockerfile.

### 2.10 Pousser l'image (survol — détaillé au module 05)

Pour publier, on ajoute un login au registry et on passe `push: true`. L'authentification, les tags sémantiques (`metadata-action`), la signature et la provenance sont le sujet du **module 05** — voici juste le flux minimal pour voir la boucle complète :

```yaml
      - name: Login GHCR
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 3. Worked examples

### Exemple 1 — Transformer le Dockerfile du §1 en multi-stage

On repart du Dockerfile mono-stage à 1,1 Go et on le refactorise.

```dockerfile
# ─── Dockerfile — API TribuZen (NestJS), multi-stage ───

# Stage 1 : build (toolchain complet)
FROM node:20-alpine AS build
WORKDIR /app

# 1) Manifeste d'abord → la layer npm ci ne se rejoue que si package*.json change
COPY package*.json ./
RUN npm ci                       # toutes les deps, dont devDependencies (tsc, nest-cli)

# 2) Puis le code → n'invalide le cache qu'à partir d'ici
COPY . .
RUN npm run build                # compile TS → dist/

# Stage 2 : runtime minimal
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Deps de production uniquement (image finale plus légère)
COPY package*.json ./
RUN npm ci --omit=dev

# On ne récupère QUE l'artefact compilé du stage build
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Accompagné de son `.dockerignore` :

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

**Ce qu'on a gagné :**
- Le toolchain (`build`) est jeté : l'image finale ≈ 150–180 Mo au lieu de 1,1 Go.
- `npm ci` (×2) rend l'install reproductible ; l'ordre `package*.json` → `npm ci` → `COPY . .` rend le cache efficace.
- `.dockerignore` évite d'embarquer `node_modules` de l'hôte et les `.env` locaux.

### Exemple 2 — Workflow CI qui build l'image avec cache

Job qui build (sans push) l'image sur chaque PR, avec cache de layers.

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

      # Buildx : requis pour le cache type=gha
      - name: Set up Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build image (cache GHA)
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          push: false                       # PR : on valide le build, on ne publie pas
          tags: tribuzen-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Déroulé :** au **premier** run, `cache-to` remplit le cache GHA. Aux runs suivants, si seul le code applicatif a bougé, `cache-from` réimporte la layer `npm ci` — le build ne recompile que `dist/`. Temps qui tombe de ~4 min à ~30 s.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — `COPY . .` avant `npm ci`

```dockerfile
# ❌ Le moindre changement de code invalide la layer d'install
COPY . .
RUN npm ci
```

Le cache de la couche install est cassé à chaque commit → réinstall complète à chaque build. **Correct :** copier `package*.json` et lancer `npm ci` **avant** `COPY . .`.

### PIÈGE #2 — Oublier `.dockerignore` (surtout `node_modules`)

Sans `.dockerignore`, `COPY . .` embarque le `node_modules` de l'hôte. Il peut être compilé pour une autre plateforme (binaires natifs macOS vs Linux) → l'image casse au runtime. Et les `.env` locaux fuient dans les layers. Toujours exclure au minimum `node_modules`, `.git`, `.env*`.

### PIÈGE #3 — Croire que le multi-stage réduit seul la taille sans copie sélective

Le multi-stage ne réduit rien si le stage final **repart d'une base lourde** ou **recopie tout**. Ce qui allège, c'est : (1) une base finale minimale (`alpine`/distroless) **et** (2) `COPY --from=build` seulement l'artefact (`dist/`) + les deps de prod. Un `COPY --from=build /app /app` recopie tout le toolchain et annule le gain.

### PIÈGE #4 — `npm install` au lieu de `npm ci` en CI

`npm install` peut **mettre à jour** le lockfile et résoudre d'autres versions → deux builds du même commit divergent. `npm ci` installe exactement le lockfile et échoue s'il est incohérent. En CI/conteneur, toujours `npm ci`.

### PIÈGE #5 — Croire que le cache Docker local persiste entre runs CI

Chaque job CI part d'une machine neuve : **aucun** cache Docker local n'est conservé. Sans `cache-from/cache-to type=gha` (ou un autre backend de cache), Buildx reconstruit tout à chaque fois. Le cache ne « marche » en CI que si on l'exporte/importe explicitement.

### PIÈGE #6 — <code v-pre>${{ }}</code> en prose casse le rendu

Les expressions GitHub Actions comme <code v-pre>${{ github.sha }}</code> doivent **toujours** rester dans un bloc de code, jamais en texte courant. En prose, parle de « l'expression `github.sha` » sans les délimiteurs.

### PIÈGE #7 — Vouloir débugger une image distroless avec un shell

Une image distroless n'a **pas** de `sh`. `docker exec -it <c> sh` échoue. Pour inspecter, on build en s'arrêtant à un stage riche (`--target build`) ou on utilise une variante `:debug`. Ne pas conclure « l'image est cassée » parce que le shell manque.

---

## 5. Ancrage TribuZen

Dans le pipeline TribuZen, la conteneurisation est l'étape qui transforme le code testé de l'**API NestJS** en artefact déployable.

Position dans le pipeline :
1. `test` (module 03) — lint + tests + coverage gate.
2. **`build-image` (ce module)** — build multi-stage de l'image de l'API, avec cache `type=gha`.
3. `push` + tags (module 05) — publication vers GHCR.
4. `deploy` (module 06) — le déploiement lance l'image publiée.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  apps/
    api/
      Dockerfile              ← multi-stage NestJS (Exemple 1)
      .dockerignore
  .github/
    workflows/
      docker-build.yml        ← job build-image avec cache GHA (Exemple 2)
```

Le job `build-image` dépend du job `test` (`needs: test`) : on ne construit l'image que si le code est vert. L'image produite ici est **exactement** celle qui sera déployée — même commit, même artefact, du CI à la prod.

> Le front-office TribuZen (Vue/Nuxt) suit le même pattern : Dockerfile multi-stage (`build` → serveur statique/Node), même logique de cache. Le module se concentre sur l'API car c'est le premier service déployé.

---

## 6. Points clés

1. Le CI ne fait pas que tester : il **produit l'image**, artefact immuable déployé tel quel.
2. Un Dockerfile **multi-stage** compile dans un stage riche et ne copie que l'artefact (`COPY --from=build`) dans un stage final minimal.
3. L'**ordre des layers** conditionne le cache : `package*.json` + `npm ci` **avant** `COPY . .`.
4. `.dockerignore` allège le contexte et évite d'embarquer `node_modules`/`.env` de l'hôte.
5. Base finale minimale : **alpine** par défaut, **distroless** pour durcir le runtime (pas de shell).
6. **Buildx** (via `docker/setup-buildx-action`) débloque le cache distant `type=gha` en CI.
7. `cache-from: type=gha` + `cache-to: type=gha,mode=max` rend les builds incrémentaux quasi instantanés.
8. `npm ci` + base épinglée + ordre déterministe = build **reproductible**.
9. Le `push` vers un registry (auth, tags, signature) est le sujet du **module 05**.

---

## 7. Seeds Anki

```
Pourquoi copier package*.json et lancer npm ci AVANT COPY . . dans un Dockerfile ?|Le cache de la layer npm ci n'est invalidé que si package*.json change. Si le code est copié avant, chaque commit réinstalle toutes les deps. Ordre = deps stables avant code volatil.
Qu'est-ce qu'un build multi-stage et que gagne-t-on ?|Plusieurs FROM dans un Dockerfile. On compile dans un stage riche (toolchain) puis on copie seulement l'artefact (COPY --from=build) dans un stage final minimal. Le toolchain et les devDependencies ne sont jamais expédiés → image bien plus légère.
À quoi sert cache-from/cache-to type=gha dans build-push-action ?|À exporter (cache-to) et importer (cache-from) les layers Docker via le cache GitHub Actions. Sans ça, chaque run CI part d'une machine neuve sans cache local et reconstruit tout. mode=max cache toutes les layers.
Pourquoi npm ci plutôt que npm install en CI/conteneur ?|npm ci installe exactement le package-lock.json et échoue si le lock est incohérent → reproductible. npm install peut mettre à jour le lock et résoudre d'autres versions → builds divergents pour un même commit.
Que contient (ou non) une image distroless et quelle est la contrepartie ?|Elle contient le runtime + l'app, mais pas de shell ni de gestionnaire de paquets → surface d'attaque réduite. Contrepartie : impossible de faire docker exec ... sh pour débugger ; il faut une variante debug ou builder --target sur un stage riche.
À quoi sert .dockerignore et que doit-il exclure au minimum ?|Il filtre le contexte de build envoyé à Docker. Exclure au minimum node_modules (binaires de l'hôte), .git, .env* (secrets locaux). Sinon build lent, fuite de secrets, node_modules incompatible embarqué.
Pourquoi active-t-on docker/setup-buildx-action en CI ?|Buildx (front-end BuildKit) débloque le cache exportable type=gha, les builds parallèles de stages et multi-plateformes. Le builder legacy ne sait pas exporter le cache de layers vers le cache GitHub Actions.
Quelle est la version majeure courante de docker/build-push-action (2026) ?|v7. Compagnons : setup-buildx-action@v4, login-action@v4, metadata-action@v6, setup-qemu-action@v4.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-04-conteneurisation-ci/README.md`. Tu écris le Dockerfile multi-stage de l'API TribuZen puis le workflow qui le build en CI avec cache GHA — vrai Docker + vrai `docker build`, corrigé commenté intégral, zéro harnais simulé.
