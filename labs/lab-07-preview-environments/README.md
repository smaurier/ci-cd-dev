# Lab 07 — Preview Environments

> **Outcome :** à la fin, tu sais concevoir les workflows GitHub Actions qui déploient une preview éphémère à l'ouverture d'une PR, commentent son URL, et la détruisent à la fermeture — cycle de vie complet, coût maîtrisé.
> **Vrai outil :** GitHub Actions sur un vrai dépôt (`.github/workflows/`), déclenché par de vraies pull requests. Le déploiement lui-même est délégué à un script (`deploy-preview.sh`) que tu invoques — tu écris **l'orchestration**, pas l'infra.
> **Feedback :** le coach relit tes workflows en session — pas de test-runner auto-correcteur.

---

## Énoncé

Tu ajoutes les **preview environments** au pipeline de TribuZen. Objectif : chaque PR obtient une instance jetable sur `https://pr-<n>.preview.tribuzen.app`, et rien ne survit à la fermeture de la PR.

Tu disposes déjà (fournis, tu ne les écris pas) de trois scripts idempotents dans `scripts/` :

- `deploy-preview.sh <slug>` — provisionne le stack, **écrit l'URL sur stdout**.
- `seed-preview.sh <slug>` — insère des données de démo **synthétiques**.
- `destroy-preview.sh <slug>` — détruit l'environnement, **succès même s'il n'existe plus**.

Le `<slug>` est de la forme `pr-42`. À toi d'écrire **les workflows** qui les orchestrent.

### Cahier des charges exact

1. **`preview.yml`** — sur ouverture, mise à jour et réouverture d'une PR :
   - build de l'app (Node 22, cache npm) ;
   - appelle `deploy-preview.sh pr-<number>` et **récupère l'URL** dans un output de step ;
   - appelle `seed-preview.sh pr-<number>` ;
   - **commente l'URL** sur la PR ;
   - lie le job à un `environment` nommé `pr-<number>` avec l'URL (bouton *View deployment*) ;
   - `concurrency` par PR avec annulation de l'obsolète ;
   - `permissions` minimales (dont l'écriture PR pour commenter).
2. **`preview-teardown.yml`** — sur **fermeture** de la PR (mergée **ou** abandonnée) : appelle `destroy-preview.sh pr-<number>`.
3. **Bonus** — `preview-reaper.yml` : un cron nocturne qui détruit les previews des PR déjà fermées (filet de sécurité contre les teardown ratés).

**Contraintes :**
- Tout <code v-pre>${{ ... }}</code> reste dans le YAML (jamais en prose) ; aucun vrai secret.
- Le teardown doit se déclencher sur `closed` **sans** filtrer par `merged` (on détruit dans les deux cas).
- Pas de gap-fill : tu écris les fichiers complets à partir du squelette ci-dessous.

### Squelette de départ

```yaml
# .github/workflows/preview.yml — À COMPLÉTER
name: Preview deploy
on:
  pull_request:
    types: [ ]          # ← quels types ?

# concurrency ? permissions ?

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    # environment: name / url ?
    steps:
      - uses: actions/checkout@v7
      # setup-node + npm ci + build ?
      # deploy (récupérer l'URL en output) ?
      # seed ?
      # commenter l'URL ?
```

```yaml
# .github/workflows/preview-teardown.yml — À COMPLÉTER
name: Preview teardown
on:
  pull_request:
    types: [ ]          # ← lequel ?
jobs:
  destroy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # destroy ?
```

Teste sur un vrai dépôt : ouvre une PR bidon, vérifie le commentaire + le bouton *View deployment*, pousse un commit (redeploy), ferme la PR (teardown).

---

## Étapes (en friction)

1. **Choisis les `types` de deploy** — quels activity types de `pull_request` couvrent « ouverte », « mise à jour », « rouverte » ? Écris-les.
2. **Isole par PR** — quelle expression donne le numéro de PR ? Construis le slug `pr-<number>` et réutilise-le partout.
3. **Capture l'URL** — `deploy-preview.sh` l'écrit sur stdout ; renvoie-la dans un output de step (`>> "$GITHUB_OUTPUT"`) et lis-la ailleurs via `steps.<id>.outputs.url`.
4. **Commente** — avec `actions/github-script@v7`, `issues.createComment`. Réfléchis : `issue_number` vient d'où pour une PR ?
5. **Déclare l'`environment`** — `name` + `url` pour le bouton *View deployment*.
6. **Ajoute `concurrency`** par PR + `cancel-in-progress`.
7. **Restreins `permissions`** — quel scope faut-il pour commenter une PR ?
8. **Écris le teardown** — quel `type` déclenche « PR fermée quelle qu'en soit l'issue » ? Vérifie qu'aucun filtre `merged` ne bloque le cas « abandonnée ».
9. **Bonus reaper** — `schedule: cron`, liste les PR ouvertes, détruis le reste.

---

## Corrigé complet commenté

```yaml
# .github/workflows/preview.yml — deploy à l'ouverture / mise à jour / réouverture
name: Preview deploy
on:
  pull_request:
    # opened = PR créée ; synchronize = nouveaux commits poussés ; reopened = PR rouverte.
    # PAS besoin de "closed" ici — c'est le rôle du workflow de teardown.
    types: [opened, synchronize, reopened]

# Une seule preview vivante par PR : un nouveau push annule le déploiement en cours
# (sinon 5 pushes rapides = 5 déploiements concurrents qui se marchent dessus).
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

# Principe du moindre privilège : lecture du code + écriture PR pour poster le commentaire.
permissions:
  contents: read
  pull-requests: write

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    # Un environment GitHub par PR → l'onglet Environments et la PR affichent
    # un bouton "View deployment" pointant sur url.
    environment:
      name: pr-${{ github.event.pull_request.number }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v7

      # Build de l'app (identique à la CI ; cache npm pour la vitesse)
      - uses: actions/setup-node@v6
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build

      # deploy-preview.sh écrit l'URL sur stdout → on la capture dans un output de step.
      # $GITHUB_OUTPUT est le fichier où GitHub lit les outputs (clé=valeur).
      - name: Déployer la preview
        id: deploy
        run: |
          URL=$(./scripts/deploy-preview.sh "pr-${{ github.event.pull_request.number }}")
          echo "url=$URL" >> "$GITHUB_OUTPUT"

      # Données de démo SYNTHÉTIQUES (jamais de vraies PII : RGPD).
      - name: Seeder les données
        run: ./scripts/seed-preview.sh "pr-${{ github.event.pull_request.number }}"

      # Rend l'URL cliquable dans la PR.
      # Une PR est une "issue" pour l'API des commentaires → issues.createComment,
      # et son numéro se lit via context.issue.number.
      - name: Commenter l'URL sur la PR
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `Preview prête : ${{ steps.deploy.outputs.url }}`
            })
```

```yaml
# .github/workflows/preview-teardown.yml — destruction à la fermeture
name: Preview teardown
on:
  pull_request:
    # closed couvre les DEUX cas : mergée ET abandonnée. On détruit dans tous les cas,
    # donc AUCUN filtre "merged" ici (ce serait le piège qui laisse fuir les PR abandonnées).
    types: [closed]

permissions:
  contents: read

jobs:
  destroy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # destroy-preview.sh est idempotent : succès même si l'environnement n'existe plus
      # (double closed, ou déjà nettoyé par le reaper).
      - name: Détruire la preview
        run: ./scripts/destroy-preview.sh "pr-${{ github.event.pull_request.number }}"
```

```yaml
# .github/workflows/preview-reaper.yml — BONUS : filet de sécurité
name: Preview reaper
on:
  schedule:
    - cron: '0 3 * * *'      # 03:00 UTC chaque nuit
  workflow_dispatch: {}      # déclenchable manuellement

permissions:
  contents: read
  pull-requests: read

jobs:
  reap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/github-script@v7
        id: open-prs
        with:
          # Liste les slugs des PR ENCORE ouvertes → tout le reste est orphelin.
          script: |
            const prs = await github.paginate(github.rest.pulls.list, {
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              per_page: 100,
            })
            return prs.map(pr => `pr-${pr.number}`).join(' ')
          result-encoding: string
      # Le script détruit les previews provisionnées dont le slug n'est PAS dans la liste.
      - name: Détruire les previews sans PR ouverte
        run: ./scripts/reap-stale-previews.sh "${{ steps.open-prs.outputs.result }}"
```

**Pourquoi ce corrigé est correct :**
- Le deploy écoute `opened/synchronize/reopened` — les trois moments où la branche de PR doit (re)partir. Le teardown écoute `closed` seul, qui recouvre merge **et** abandon.
- L'isolation tient au numéro de PR répété partout (`pr-<number>`) : URL, environment, base, slug de destruction.
- L'URL transite par un **output de step** (`$GITHUB_OUTPUT`) : `deploy-preview.sh` la produit, le commentaire et l'`environment.url` la consomment.
- `concurrency` par PR + `cancel-in-progress` évite les déploiements empilés ; `permissions` minimales respectent le moindre privilège.
- Le teardown n'a **aucun** filtre `merged` — sinon une PR fermée sans merge laisserait une preview orpheline qui facture. Le reaper rattrape les teardown ratés.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 25 minutes, sans rouvrir ce corrigé ni le module :**

1. **Un seul commentaire, mis à jour** — au lieu de `createComment` à chaque `synchronize` (qui empile les commentaires), fais en sorte que le workflow **retrouve** un commentaire existant portant un marqueur (ex. `<!-- preview-bot -->` dans son `body`) et l'**update** (`issues.updateComment`), ou le crée s'il n'existe pas.
2. **Skip pour les PR de dépendabot** — n'exécute pas le deploy si l'auteur de la PR est `dependabot[bot]` (garde sur `github.event.pull_request.user.login`).
3. **TTL affiché** — ajoute dans le commentaire la phrase « expire automatiquement 7 jours après le dernier push ».

**Critère de réussite :** ouvrir une PR, pousser deux commits → un **seul** commentaire, mis à jour ; une PR de dependabot ne déploie rien ; la fermeture détruit l'environnement.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces workflows vivent ici :

```
tribuzen/
  .github/
    workflows/
      preview.yml            ← deploy on open/synchronize/reopened
      preview-teardown.yml   ← destroy on closed
      preview-reaper.yml     ← cron cleanup (bonus)
  scripts/
    deploy-preview.sh
    seed-preview.sh
    destroy-preview.sh
    reap-stale-previews.sh
```

**Différences par rapport au lab :**
- `deploy-preview.sh` provisionnera réellement un **namespace k8s `pr-<n>`** (API + Postgres + Redis) via Helm — le squelette du lab masque cette complexité derrière le script.
- L'authentification au cluster passera par **OIDC** (module 08), pas par un token en secret.
- Le provisioning de la DB éphémère relèvera de l'**IaC** (module 09).
- Le seed insérera le jeu de démo TribuZen : 1 famille, 4 membres (dont 1 admin), quelques events — **synthétique**, jamais un dump de prod.

**Commit cible :**
```
ci(preview): environnements éphémères par PR — deploy on open, comment URL, teardown on close
```
