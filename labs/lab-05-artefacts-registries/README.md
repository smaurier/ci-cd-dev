# Lab 05 — Artefacts & registries : publier l'image TribuZen sur GHCR

> **Outcome :** à la fin, tu sais écrire un workflow GitHub Actions qui build l'image du backend TribuZen et la pousse sur GHCR avec des tags propres (semver + sha + latest), authentifié au moindre privilège.
> **Vrai outil :** GitHub Actions + Docker Buildx + GHCR (`ghcr.io`). Actions réelles : `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7`.
> **Feedback :** le coach relit le workflow en session et vérifie les tags produits dans l'onglet Packages du repo — pas de test-runner auto-correcteur.

---

## Énoncé

Le backend TribuZen a un `Dockerfile` fonctionnel (module 04). Ta mission : écrire `.github/workflows/publish-image.yml` **de zéro** pour publier l'image sur GHCR.

Cahier des charges **exact** :

1. Déclenchement sur un **tag Git `v*`** (release) **et** sur push `main`.
2. Publier sous `ghcr.io/<owner>/tribuzen-api`.
3. Tags produits :
   - sur un tag `v1.4.2` → `1.4.2`, `1.4`, `sha-<court>`, `latest` ;
   - sur un push `main` (sans tag) → `sha-<court>` + `latest` uniquement (pas de semver).
4. Authentification GHCR via le **`GITHUB_TOKEN`** du run (aucun secret créé à la main).
5. Permissions du job réduites au **strict nécessaire** (`contents: read`, `packages: write`).
6. Tags et labels générés par `docker/metadata-action` — **pas** de liste de tags écrite à la main.

**Pas de gap-fill** — tu écris le fichier complet à partir du squelette minimal ci-dessous.

### Starter minimal

Crée `.github/workflows/publish-image.yml` :

```yaml
name: Publier l'image API
on:
  # À toi : déclencher sur tag v* ET sur main

jobs:
  publish:
    runs-on: ubuntu-latest
    # À toi : permissions minimales
    steps:
      - uses: actions/checkout@v7
      # À toi : login GHCR, metadata (tags), build-push
```

> Pré-requis pour tester en vrai : un repo GitHub avec le `Dockerfile` TribuZen à la racine. Après un `git tag v0.1.0 && git push origin v0.1.0`, vérifie l'onglet **Packages** du repo.

---

## Étapes (en friction)

1. **Déclencheurs** — bloc `on:` avec `push.tags: ['v*']` et `push.branches: [main]`.
2. **Permissions** — au niveau du job : `contents: read` + `packages: write`, rien d'autre.
3. **Login** — `docker/login-action@v4` sur `registry: ghcr.io`, `username: github.actor`, `password: secrets.GITHUB_TOKEN` (dans un bloc code YAML, avec la syntaxe `${{ … }}`).
4. **Métadonnées** — `docker/metadata-action@v6` avec `id: meta`, `images:` pointant sur `ghcr.io/<owner>/tribuzen-api`, et les 4 lignes `tags:` (2× semver, sha, raw latest conditionné à la branche par défaut).
5. **Build & push** — `docker/build-push-action@v7` avec `push: true`, `tags: ${{ steps.meta.outputs.tags }}`, `labels: ${{ steps.meta.outputs.labels }}`.
6. **Vérifier** — pousse un tag `v0.1.0`, puis dans Packages contrôle que `0.1.0`, `0.1`, `sha-…` et `latest` existent bien.
7. **Cas limite** — merge sur `main` **sans** tag : vérifie que seuls `sha-…` et `latest` apparaissent (aucun tag semver parasite).

---

## Corrigé complet commenté

```yaml
# .github/workflows/publish-image.yml — corrigé
name: Publier l'image API

on:
  push:
    tags: ['v*']         # release lisible : v1.4.2 -> tags semver
    branches: [main]     # chaque main -> tag sha + latest (traçabilité continue)

jobs:
  publish:
    runs-on: ubuntu-latest

    # LEAST PRIVILEGE : le job n'a besoin QUE de lire le repo et d'écrire sur GHCR.
    # Pas de write-all, pas de PAT réutilisable.
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v7

      # 1) Auth GHCR avec le token éphémère du run.
      #    github.actor = l'utilisateur qui a déclenché ; GITHUB_TOKEN expire à la fin du run.
      - name: Login GHCR
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # 2) Générer tags + labels depuis l'événement Git — jamais écrits à la main.
      - name: Métadonnées (tags + labels)
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository_owner }}/tribuzen-api
          tags: |
            type=semver,pattern={{version}}          # v1.4.2 -> 1.4.2
            type=semver,pattern={{major}}.{{minor}}  # v1.4.2 -> 1.4 (suit les patchs)
            type=sha                                 # -> sha-<court> (immuable, traçable)
            type=raw,value=latest,enable={{is_default_branch}}  # latest SEULEMENT sur la branche par défaut

      # 3) Build multi-stage (Dockerfile du module 04) + push de TOUS les tags calculés.
      - name: Build & push
        id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}      # sortie multi-lignes de metadata-action
          labels: ${{ steps.meta.outputs.labels }}  # inclut org.opencontainers.image.source
```

**Pourquoi ce corrigé est correct :**
- Le bloc `permissions` est au niveau **job** et minimal : une action compromise ne peut pas faire plus qu'écrire un package. C'est le principe de moindre privilège du §2.6 du module.
- `enable={{is_default_branch}}` sur `latest` empêche qu'une branche de feature repousse `latest` — seul `main` le déplace.
- Sur un push `main` sans tag Git, les patterns `type=semver` ne matchent rien : aucun tag semver n'est produit, seulement `sha-…` et `latest`. Le cas limite de l'étape 7 est géré **par la config**, pas par un `if`.
- On ne liste jamais les tags à la main : `steps.meta.outputs.tags` est la source unique, donc build et push restent cohérents.
- Le label `org.opencontainers.image.source` (fourni par metadata-action) relie l'image au repo dans l'onglet Packages — traçabilité gratuite.

**Grille de validation (le coach coche) :**

| Critère | OK ? |
|---|---|
| Déclenché sur `v*` **et** `main` | ☐ |
| `permissions` limité à `contents: read` + `packages: write` | ☐ |
| Login via `GITHUB_TOKEN` (aucun secret créé à la main) | ☐ |
| Tags générés par `metadata-action`, pas en dur | ☐ |
| `v1.4.2` produit bien `1.4.2` + `1.4` + `sha-…` + `latest` | ☐ |
| Un push `main` ne produit **pas** de tag semver parasite | ☐ |
| `latest` conditionné à la branche par défaut | ☐ |

**Coach — questions à poser en session :**
- « Montre-moi dans Packages le digest `@sha256:…` — lequel de tes tags déploierais-tu en prod, et pourquoi pas `latest` ? »
- « Si demain tu repousses `v1.4.2` vers un autre build, que se passe-t-il pour un serveur qui a déjà pull `1.4.2` ? »
- « Ton workflow a `packages: write`. Un job de tests en aurait-il besoin ? Où mettrais-tu la frontière ? »
- Piège à débusquer : l'apprenant qui écrit `tags: ghcr.io/.../tribuzen-api:latest` en dur dans `build-push-action` → lui faire dériver via `metadata-action`.

---

## Variante J+30 (fading)

**Même workflow, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. Ajoute un **tag `sha`** signé : après le push, une étape `sigstore/cosign-installer@v4` puis `cosign sign --yes ghcr.io/<owner>/tribuzen-api@${{ steps.build.outputs.digest }}` (keyless via l'OIDC — pense à ajouter `id-token: write` aux permissions).
2. Active les attestations : `sbom: true` et `provenance: mode=max` sur `build-push-action`.
3. Fais tout ça **en 25 minutes**, de mémoire.

**Critère de réussite :** le workflow publie l'image, l'onglet Packages montre les tags attendus + l'image porte une signature vérifiable par `cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com …`.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce workflow vit ici :

```
tribuzen/
  .github/
    workflows/
      publish-image.yml     ← ce lab
  Dockerfile                ← image backend (module 04), label source vers le repo
```

**Différences par rapport au lab :**
- Le `Dockerfile` est le vrai multi-stage du backend TribuZen (module 04), pas un placeholder.
- Le tag déployé par le pipeline de **déploiement** (module 06) sera le `sha-…` ou le digest — jamais `latest`.
- La signature cosign + SBOM (variante J+30) deviennent une exigence de la branche `main`, branchées sur l'étape de sécurité du pipeline (module 08 pour l'OIDC cloud).

**Commit cible :**

```
ci(images): publier tribuzen-api sur GHCR — tags semver+sha+latest, login GITHUB_TOKEN
```
