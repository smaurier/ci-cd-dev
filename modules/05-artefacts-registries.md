---
titre: Artefacts & registries de conteneurs
cours: 15-cicd-devops
notions: [artefact de build vs image, upload/download-artifact, registry de conteneurs, GHCR, Docker Hub, tagging semver, tag sha, tag latest, immutabilité vs mutabilité des tags, rétention et suppression, login/push authentifié, signature cosign, provenance et SBOM]
outcomes:
  - sait distinguer un artefact de build (upload-artifact) d'une image publiée dans un registry
  - sait publier une image sur GHCR avec des tags propres (semver + sha + latest) via docker/metadata-action
  - sait s'authentifier à un registry en CI avec le moins de privilèges possible (GITHUB_TOKEN, permissions packages)
  - sait mettre en place une politique de rétention et comprend l'immutabilité des tags
  - connaît en survol la signature d'image (cosign keyless) et les attestations provenance/SBOM
prerequis: [Modules 00-04 du cours 15 (CI, GitHub Actions fondamentaux et avancé, tests en CI, conteneurisation en CI)]
next: 06-strategies-deploiement
libs: []
tribuzen: pipeline CI/CD de TribuZen — publication de l'image du backend TribuZen sur GHCR avec tags versionnés
last-reviewed: 2026-07
---

# Artefacts & registries de conteneurs

> **Outcomes — tu sauras FAIRE :** distinguer artefact de build et image publiée, pousser une image sur GHCR avec des tags propres, t'authentifier en CI avec le moins de privilèges, poser une politique de rétention, et lire une chaîne signature/provenance/SBOM.
> **Difficulté :** :star::star::star:
>
> **Portée :** on couvre le **stockage et la publication** des sorties de build. Le *build* de l'image (multi-stage, buildx, cache) est le **module 04**. Comment *déployer* cette image (rolling, blue-green, canary) est le **module 06**. L'OIDC vers un cloud sans secret long terme est survolé ici mais détaillé au **module 08**.

## 1. Cas concret d'abord

Le pipeline de TribuZen construit déjà l'image du backend (module 04). À la fin du job `build`, le collègue a écrit ceci :

```yaml
# .github/workflows/deploy.yml — AVANT (fragile)
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ghcr.io/smaurier/tribuzen-api:latest   # ← un seul tag, toujours "latest"
```

Trois problèmes concrets vont te tomber dessus en production :

1. **`latest` écrase `latest`.** Chaque merge sur `main` repousse `latest`. Impossible de savoir *quel commit* tourne en prod, ni de revenir à la version d'hier — le tag a été réécrit.
2. **Pas de traçabilité.** Un incident à 3h du matin : « quelle version est déployée ? ». `latest` ne répond pas. Il te faut un tag lié au commit (`sha-…`) et un tag de release lisible (`1.4.2`).
3. **Qui a le droit de pousser ?** Le workflow pousse avec quels identifiants ? S'il utilise un secret trop large, une action compromise peut publier n'importe quoi sous ton nom.

Ce module transforme ce `push` naïf en une publication traçable, versionnée, authentifiée au minimum de privilèges — et signable.

---

## 2. Théorie complète, concise

### 2.1 Artefact de build ≠ image de conteneur

Deux mécanismes de stockage différents, souvent confondus :

| | Artefact de build | Image de conteneur |
|---|---|---|
| Quoi | Fichiers bruts : `dist/`, rapport de couverture, binaire, SBOM | Image OCI exécutable (couches + manifeste) |
| Où | Stockage d'artefacts de l'exécution (`actions/upload-artifact`) | Registry de conteneurs (GHCR, Docker Hub, ECR…) |
| Durée de vie | Éphémère, lié au run (rétention en jours) | Persistant, versionné par tag et par digest |
| Usage | Passer des fichiers **entre jobs** d'un même workflow | Livrer un livrable **déployable** à d'autres systèmes |
| Adressage | Par `name` dans le run | Par `registry/owner/nom:tag` ou `@sha256:digest` |

Règle mentale : un **artefact** sert à *transporter* des fichiers dans le pipeline ; une **image** est le *produit fini* qu'on déploie.

### 2.2 Artefacts entre jobs — upload / download

Un job ne partage pas son système de fichiers avec les autres. Pour passer `dist/` de `build` à `deploy`, on upload puis on download.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist                 # identifiant logique dans ce run
          path: dist/
          retention-days: 7          # override la rétention par défaut (90 j)

  deploy:
    needs: build                     # attend que build soit fini
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/
      - run: ./deploy.sh dist/
```

Points clés : `retention-days` borne le coût de stockage ; un artefact n'est **pas** un livrable durable — pour ça, il faut une image dans un registry.

### 2.3 Registry de conteneurs — GHCR vs Docker Hub

Un **registry** stocke et sert des images. Deux cibles courantes :

- **GHCR** (`ghcr.io`) — GitHub Container Registry. Intégré au repo : le `GITHUB_TOKEN` du workflow peut y pousser sans créer de secret. Nom d'image : `ghcr.io/OWNER/IMAGE` (ex. `ghcr.io/smaurier/tribuzen-api`).
- **Docker Hub** (`docker.io`) — registre historique. Nom : `docker.io/USER/IMAGE`. Nécessite un compte + un **access token** (jamais le mot de passe) stocké en secret. Attention aux **limites de pull** (rate limit) sur les comptes gratuits, qui peuvent casser un CI qui pull beaucoup.

Par défaut sur GHCR, une image publiée est **privée**. Pour la rendre publique ou donner accès à d'autres repos, on passe par les *package settings*.

### 2.4 Tagging & versioning — semver, sha, latest

Un même digest d'image peut porter plusieurs tags. Les trois familles utiles :

- **Semver** — `1.4.2`, plus des tags flottants `1.4` et `1` qui suivent le dernier patch/minor. Lisible par un humain, aligné sur les releases.
- **SHA** — `sha-860c190`, dérivé du commit Git. **Immuable et traçable** : ce tag pointe toujours vers *ce* code. C'est le tag de référence pour un déploiement reproductible.
- **`latest`** — pointeur mouvant vers « la dernière ». Pratique pour tester, **dangereux en prod** : rien ne garantit ce qu'il contient à un instant T.

`docker/metadata-action` génère ces tags automatiquement depuis l'événement Git :

```yaml
- name: Métadonnées (tags + labels)
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/smaurier/tribuzen-api
    tags: |
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=sha
      type=raw,value=latest,enable={{is_default_branch}}
```

- sur un tag Git `v1.4.2` → produit `1.4.2`, `1.4`, `sha-<court>`, et `latest` ;
- sur un push `main` sans tag → produit `sha-<court>` et `latest` ;
- les sorties `steps.meta.outputs.tags` et `steps.meta.outputs.labels` se branchent directement sur `build-push-action`.

### 2.5 Immutabilité des tags — le piège central

Un tag est **un pointeur nommé**, pas une identité. Rien n'empêche de repousser `1.4.2` vers un *autre* digest : le tag est réécrit, silencieusement. Deux serveurs qui pull `1.4.2` à deux moments peuvent obtenir deux images différentes.

La seule référence **vraiment immuable** est le **digest** : `ghcr.io/smaurier/tribuzen-api@sha256:abc123…`. En prod, on déploie par digest (ou par tag `sha-…` qu'on ne réécrit jamais), pas par `latest`.

### 2.6 Login & push authentifié — moindre privilège

Pour pousser, il faut s'authentifier. En CI GitHub, le plus sobre est le `GITHUB_TOKEN` intégré, avec des permissions déclarées **au niveau du job** :

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read       # lire le repo
      packages: write      # écrire sur GHCR — le strict nécessaire
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}   # scope limité au repo, expire à la fin du run
```

Principe : **least privilege**. On ne donne que `packages: write`, pas un PAT (Personal Access Token) large réutilisable. Le `GITHUB_TOKEN` expire à la fin du run — surface d'attaque minimale.

En local (hors CI), on se logue avec un token classique passé par stdin, jamais en clair :

```bash
echo "$CR_PAT" | docker login ghcr.io -u smaurier --password-stdin
docker push ghcr.io/smaurier/tribuzen-api:1.4.2
```

Pour Docker Hub, même logique avec `docker/login-action` sans `registry` (défaut Docker Hub), `username`/`password` = access token en secret.

### 2.7 Rétention & nettoyage

Les images s'accumulent et coûtent. Deux leviers :

- **Artefacts** : `retention-days` sur `upload-artifact` (défaut 90 j, souvent trop long pour un `dist/`).
- **Versions d'images** : sur GHCR, on supprime les vieilles versions via les *package settings* ou une action de nettoyage planifiée (ex. `actions/delete-package-versions`, garder les N dernières). On ne supprime **jamais** un tag encore référencé en prod.

Politique saine : garder toutes les releases semver, purger les tags `sha-…` de branches mergées au-delà d'une fenêtre.

### 2.8 Signature, provenance & SBOM (survol)

Publier ne prouve pas *qui* a construit l'image ni *avec quoi*. Trois briques de supply chain, en survol :

- **Signature (cosign / Sigstore)** — signe l'image pour prouver son origine. Le mode **keyless** utilise l'OIDC de GitHub Actions : pas de clé privée à stocker. Signature :

  ```yaml
  - uses: sigstore/cosign-installer@v3
  - run: cosign sign --yes ghcr.io/smaurier/tribuzen-api@${{ steps.build.outputs.digest }}
  ```

  Vérification (côté consommateur) — on prouve l'identité qui a signé et l'émetteur OIDC :

  ```bash
  cosign verify \
    --certificate-identity-regexp "https://github.com/smaurier/tribuzen/.github/workflows/.*" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    ghcr.io/smaurier/tribuzen-api:1.4.2
  ```

- **SBOM** (*Software Bill of Materials*) — l'inventaire des dépendances de l'image. Répond à « suis-je affecté par la CVE de telle lib ? ». `docker/build-push-action` peut le générer :

  ```yaml
  - uses: docker/build-push-action@v6
    with:
      push: true
      sbom: true             # attache un SBOM à l'image
      provenance: mode=max   # attache la provenance (comment/où l'image a été buildée)
      tags: ${{ steps.meta.outputs.tags }}
  ```

- **Provenance (SLSA)** — atteste *comment* et *où* l'image a été construite (quel workflow, quel commit). `provenance: mode=max` sur un repo public.

Ces attestations exigent un **push direct** vers le registry (pas de chargement local). La sécurité applicative en profondeur est le **cours 14** ; ici on sait juste *câbler* ces briques.

---

## 3. Worked examples

### Exemple 1 — Publier l'image TribuZen sur GHCR avec des tags propres

On corrige le `push` naïf du §1. Un workflow qui, sur un tag `v*`, publie l'image avec semver + sha + latest, authentifié au minimum.

```yaml
# .github/workflows/publish-image.yml
name: Publier l'image API
on:
  push:
    tags: ['v*']          # déclenché par un tag de release, ex. v1.4.2
    branches: [main]      # + chaque main pour un tag sha + latest

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write      # least privilege : écrire sur GHCR, rien de plus
    steps:
      - uses: actions/checkout@v4

      # 1) Auth GHCR via le token du run (pas de secret à gérer)
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # 2) Générer les tags à partir de l'événement Git
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/tribuzen-api
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
            type=raw,value=latest,enable={{is_default_branch}}

      # 3) Build + push avec tous les tags calculés
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

**Ce que ça produit :**
- sur `git push origin v1.4.2` → `ghcr.io/smaurier/tribuzen-api:1.4.2`, `:1.4`, `:sha-<court>`, `:latest` ;
- sur un merge `main` → `:sha-<court>` + `:latest`, sans polluer les tags semver ;
- le `label org.opencontainers.image.source` (fourni par metadata-action) relie automatiquement l'image au repo dans l'onglet Packages.

### Exemple 2 — Passer un artefact `dist/` entre deux jobs, puis nettoyer

Ici pas d'image : on veut passer le build front d'un job de compilation à un job de déploiement statique, avec une rétention courte.

```yaml
name: Build & deploy front
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build      # produit dist/
      - uses: actions/upload-artifact@v4
        with:
          name: front-dist
          path: dist/
          retention-days: 3               # court : un dist/ ne vit pas longtemps

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: front-dist
          path: dist/
      - run: npx wrangler pages deploy dist/   # ou tout autre push statique
```

**Pourquoi c'est correct :** `deploy` a besoin de `dist/` mais ne recompile pas — il télécharge l'artefact produit par `build`. La `retention-days: 3` évite de payer 90 jours de stockage pour un livrable jetable. Ce `dist/` **n'est pas** une image : il n'est pas adressable en dehors de ce workflow.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Déployer par `latest` en production

```yaml
# ❌ Deux serveurs qui pull "latest" à 5 min d'écart peuvent avoir DEUX images différentes
image: ghcr.io/smaurier/tribuzen-api:latest
```

`latest` est un pointeur mouvant. En prod, déploie par **digest** ou par tag **immuable** :

```yaml
# ✅ digest = référence cryptographique, toujours la même image
image: ghcr.io/smaurier/tribuzen-api@sha256:abc123…
# ✅ ou un tag sha qu'on ne réécrit jamais
image: ghcr.io/smaurier/tribuzen-api:sha-860c190
```

### PIÈGE #2 — Croire qu'un tag est immuable

Repousser `1.4.2` vers un autre digest **réécrit** le tag sans erreur. Le tag n'est pas une identité, seul le `@sha256:…` l'est. Convention d'équipe : une fois une version semver publiée, on ne la repousse jamais — on incrémente.

### PIÈGE #3 — Confondre artefact et image

```yaml
# ❌ upload-artifact ne "publie" pas une image déployable
- uses: actions/upload-artifact@v4
  with: { name: image, path: image.tar }
```

Un artefact vit dans le run et expire. Pour un livrable durable, adressable et déployable, il faut **pousser une image dans un registry**. `upload-artifact` sert à transporter des fichiers *entre jobs*, pas à livrer.

### PIÈGE #4 — Donner `packages: write` (ou pire, un PAT large) partout

```yaml
# ❌ permissions trop larges au niveau workflow
permissions: write-all
```

Le moindre privilège se déclare **par job** et au strict nécessaire. Un job qui ne fait que tester n'a pas besoin de `packages: write`. Préfère toujours le `GITHUB_TOKEN` (éphémère, scoppé au repo) à un PAT réutilisable stocké en secret.

### PIÈGE #5 — Rétention infinie = facture qui explose

Ne rien configurer laisse les artefacts vivre 90 jours et les images s'empiler indéfiniment. Sans politique de nettoyage, le stockage GHCR gonfle en silence. Mets une `retention-days` courte sur les artefacts jetables et une purge planifiée des tags `sha-…` obsolètes — en gardant toujours les releases semver.

### PIÈGE #6 — Signer un tag mouvant plutôt que le digest

```bash
# ❌ signer "latest" ne prouve rien de durable : latest bougera
cosign sign --yes ghcr.io/smaurier/tribuzen-api:latest
```

Une signature n'a de sens que sur une **cible immuable**. On signe le **digest** produit par le build :

```bash
# ✅ cible cryptographiquement fixe
cosign sign --yes ghcr.io/smaurier/tribuzen-api@sha256:abc123…
```

---

## 5. Ancrage TribuZen

Dans le pipeline CI/CD de TribuZen, ce module est l'étape **« publier le livrable »**, entre le build (module 04) et le déploiement (module 06).

**Backend `tribuzen-api`** — chaque release taggée `v*` publie sur `ghcr.io/smaurier/tribuzen-api` avec `1.x.y` + `sha-…` + `latest`. Le déploiement (module 06) référencera le tag `sha-…` ou le digest, jamais `latest`, pour garantir un rollback fiable.

**Front `tribuzen-web`** — le `dist/` compilé passe en **artefact** entre le job build et le job deploy (Exemple 2), avec rétention courte. Le front statique n'a pas besoin d'image de conteneur.

**Supply chain** — sur la branche par défaut, le build attache un **SBOM** (`sbom: true`) et la **provenance** (`provenance: mode=max`), et une étape `cosign sign --yes …@<digest>` signe l'image en keyless via l'OIDC du workflow. En cas de CVE annoncée sur une dépendance, le SBOM de l'image en prod répond immédiatement à « est-on affecté ? ».

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  .github/
    workflows/
      publish-image.yml     ← Exemple 1 : build + push GHCR taggé + signé
      build-deploy-front.yml← Exemple 2 : artefact dist/ entre jobs
  Dockerfile                ← label org.opencontainers.image.source vers le repo
```

> Le **déploiement** de l'image publiée (rolling/blue-green/canary) est le **module 06**. L'**OIDC vers le cloud** (au-delà de la signature) est détaillé au **module 08**.

---

## 6. Points clés

1. Artefact de build = fichiers éphémères transportés entre jobs ; image = livrable durable, versionné, dans un registry.
2. `upload-artifact` / `download-artifact` passent `dist/` d'un job à l'autre ; borne le coût avec `retention-days`.
3. GHCR (`ghcr.io/OWNER/IMAGE`) s'authentifie avec le `GITHUB_TOKEN` du run ; Docker Hub demande un access token en secret.
4. Trois familles de tags : semver (lisible), sha (traçable/immuable), latest (mouvant, à éviter en prod).
5. Un tag est un pointeur réécrivable ; seule référence vraiment immuable = le digest `@sha256:…`.
6. `docker/metadata-action@v5` génère tags + labels automatiquement depuis l'événement Git.
7. Moindre privilège : `permissions: { contents: read, packages: write }` par job, jamais un PAT large.
8. Rétention : `retention-days` sur les artefacts + purge planifiée des vieux tags sha, en gardant les releases.
9. cosign keyless signe le **digest** via l'OIDC ; `sbom: true` + `provenance: mode=max` attachent l'inventaire et l'origine (survol — cours 14 pour le fond).

---

## 7. Seeds Anki

```
Quelle est la différence entre un artefact de build et une image de conteneur ?|L'artefact (upload-artifact) est éphémère et sert à transporter des fichiers entre jobs d'un run. L'image est un livrable durable, versionné par tag/digest, stocké dans un registry et déployable ailleurs.
Pourquoi ne jamais déployer par le tag latest en production ?|latest est un pointeur mouvant : deux pull à des moments différents peuvent donner deux images différentes. On déploie par digest @sha256:… ou par un tag sha-… immuable pour la traçabilité et le rollback.
Quelle est la seule référence vraiment immuable d'une image ?|Le digest @sha256:… — un tag (même semver) peut être repoussé vers un autre digest et donc réécrit silencieusement.
Comment s'authentifier à GHCR dans un workflow avec le moins de privilèges ?|docker/login-action@v3 avec registry ghcr.io, username github.actor, password secrets.GITHUB_TOKEN, et permissions du job limitées à contents:read + packages:write. Le GITHUB_TOKEN est éphémère et scoppé au repo.
À quoi sert docker/metadata-action ?|À générer automatiquement les tags (type=semver, type=sha, type=raw latest) et les labels OCI depuis l'événement Git, puis à les brancher sur build-push-action via steps.meta.outputs.tags/labels.
Que signifie signer une image en keyless avec cosign ?|cosign obtient un jeton OIDC (ex. celui de GitHub Actions), Fulcio émet un certificat X.509 court, et l'image est signée sans clé privée à stocker. On signe le digest, pas un tag mouvant.
Que contient un SBOM et à quoi répond-il ?|Software Bill of Materials = inventaire des dépendances de l'image. Il répond immédiatement à « suis-je affecté par cette CVE ? » sur l'image en production.
Comment maîtriser le coût de stockage des artefacts et images ?|retention-days court sur les artefacts jetables (dist/) + purge planifiée des vieux tags sha (garder les N dernières / toutes les releases semver). Ne jamais supprimer un tag encore référencé en prod.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-05-artefacts-registries/README.md`. Écrire de zéro le workflow qui publie l'image TribuZen sur GHCR avec tags propres (semver + sha + latest) et login au moindre privilège — corrigé commenté intégral, aucun harnais.
