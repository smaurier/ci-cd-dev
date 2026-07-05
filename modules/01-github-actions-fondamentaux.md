---
titre: "GitHub Actions : fondamentaux"
cours: 15-cicd-devops
notions: [workflow YAML, "structure .github/workflows", "clé on:", "push, pull_request, workflow_dispatch", "jobs:", "steps:", runners et runs-on, "actions (uses/with)", run et shell, variables env, "secrets de base"]
outcomes:
  - sait écrire un workflow GitHub Actions valide dans .github/workflows
  - sait déclencher un workflow sur push, pull_request et manuellement (workflow_dispatch)
  - sait enchaîner des steps qui appellent une action (uses/with) ou lancent une commande (run)
  - sait injecter des variables d'environnement et lire un secret sans jamais l'exposer
prerequis: [00-introduction-cicd]
next: 02-github-actions-avance
libs: []
tribuzen: pipeline CI de TribuZen — premier workflow qui checkout, installe, lint et teste le monorepo à chaque push et pull request
last-reviewed: 2026-07
---

# GitHub Actions : fondamentaux

> **Outcomes — tu sauras FAIRE :** écrire un workflow valide dans `.github/workflows`, le déclencher sur `push` / `pull_request` / manuellement, enchaîner des steps (`uses` d'une action ou `run` d'une commande), injecter des variables d'env et lire un secret sans l'exposer.
> **Difficulté :** :star::star:
>
> **Portée :** ce module couvre le **socle** de GitHub Actions — un workflow, ses jobs, ses steps, ses déclencheurs, ses runners, l'appel d'action et les secrets de base. Ce qui accélère un pipeline (matrice de versions, cache de dépendances, artefacts, workflows réutilisables/composites, contexts avancés, `concurrency`) est disséqué au **module 02**. Lancer les tests en CE et gérer coverage / flaky tests est au **module 03**.

---

## 1. Cas concret d'abord

Le dépôt `smaurier/tribuzen` grossit. Hier, un collègue a poussé du code qui ne compilait pas : personne ne l'a vu avant que toi tu tires la branche le lendemain. Tu veux qu'à **chaque push et chaque pull request**, GitHub lance automatiquement l'install, le lint et les tests — et affiche une croix rouge sur la PR si quelque chose casse. C'est la **CI** vue au module 00, mais cette fois tu la construis.

Tu crées un fichier `.github/workflows/ci.yml`. Voici le squelette que tu dois savoir compléter à la fin de ce module :

```yaml
# .github/workflows/ci.yml — squelette à compléter
name: CI

on:
  # ??? déclencher sur push et pull_request vers main
  # ??? permettre aussi un lancement manuel

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      # ??? récupérer le code du dépôt
      # ??? installer Node.js
      # ??? installer les dépendances
      # ??? lancer le lint
      # ??? lancer les tests
```

Chaque `???` se résout avec une notion de ce module. À la fin, tu écris ce fichier de A à Z, sans copier-coller.

---

## 2. Théorie complète, concise

### 2.1 Où vivent les workflows : `.github/workflows/`

Un **workflow** est un fichier YAML placé dans le dossier `.github/workflows/` à la racine du dépôt. GitHub scanne ce dossier : **chaque fichier `.yml` ou `.yaml`** y est un workflow indépendant.

```
tribuzen/
  .github/
    workflows/
      ci.yml            ← workflow CI (lint + test)
      deploy.yml        ← workflow de déploiement (autre fichier = autre pipeline)
  src/
  package.json
```

Le nom du fichier n'a pas d'importance fonctionnelle ; c'est la clé `name:` **à l'intérieur** qui s'affiche dans l'onglet « Actions » de GitHub.

### 2.2 L'anatomie : workflow → jobs → steps

Trois niveaux emboîtés, du plus large au plus fin :

- **Workflow** : le fichier entier. Il répond à des événements.
- **Job** : une unité qui tourne sur **un runner** (une machine fraîche). Par défaut, les jobs d'un workflow tournent **en parallèle**.
- **Step** : une étape à l'intérieur d'un job. Les steps s'exécutent **séquentiellement**, de haut en bas, sur la même machine.

```yaml
name: CI                    # nom du workflow (affiché dans l'UI)

on: [push]                  # événement déclencheur

jobs:
  quality:                  # un job nommé "quality"
    runs-on: ubuntu-latest  # le runner
    steps:                  # les étapes, dans l'ordre
      - run: echo "étape 1"
      - run: echo "étape 2"
```

Point mental clé : **chaque job démarre sur une machine vierge**. Ce qu'un job installe ou télécharge n'existe pas pour les autres jobs, sauf mécanisme explicite (artefacts, vus au module 05).

### 2.3 Les déclencheurs : la clé `on:`

La clé `on:` définit **quels événements** lancent le workflow. Les trois de base :

```yaml
on:
  push:                     # à chaque push...
    branches: [main]        # ...mais seulement sur la branche main
  pull_request:             # à l'ouverture / mise à jour d'une PR...
    branches: [main]        # ...ciblant main
  workflow_dispatch:        # bouton "Run workflow" manuel dans l'UI
```

- **`push`** : se déclenche quand des commits arrivent sur le dépôt. `branches:` restreint aux branches listées.
- **`pull_request`** : se déclenche quand une PR est ouverte, mise à jour (nouveau commit) ou rouverte. C'est **le** déclencheur qui met la croix verte/rouge sur la PR.
- **`workflow_dispatch`** : ajoute un bouton pour lancer le workflow **à la main** depuis l'onglet Actions. Idéal pour un déclenchement ponctuel.

Forme courte quand on ne filtre rien : `on: [push, pull_request]` sur une seule ligne. Forme longue (avec `branches:`, `paths:`, `types:`…) dès qu'on veut préciser.

### 2.4 Les runners : la clé `runs-on`

Un **runner** est la machine qui exécute un job. `runs-on:` choisit son système. Les runners hébergés par GitHub les plus courants :

| Label | OS |
|---|---|
| `ubuntu-latest` | Linux (le défaut pour du Node/JS — le plus rapide et le moins cher) |
| `windows-latest` | Windows Server |
| `macos-latest` | macOS (nécessaire pour builder iOS) |

Pour un projet Node/TypeScript comme TribuZen, `ubuntu-latest` est le choix par défaut.

### 2.5 Les steps : `uses` (action) vs `run` (commande)

Un step fait **l'une de deux choses** :

**a) Appeler une action réutilisable avec `uses:`.** Une action est un bloc packagé publié (souvent sur le Marketplace). On l'épingle à une **version majeure** avec `@vN`.

```yaml
steps:
  # Action officielle : récupère le code du dépôt sur le runner
  - uses: actions/checkout@v7

  # Action officielle : installe Node.js (et active le cache npm)
  - uses: actions/setup-node@v6
    with:                     # "with" = les paramètres d'entrée de l'action
      node-version: '22'
      cache: 'npm'
```

`with:` passe les **entrées** attendues par l'action (ici la version de Node et le gestionnaire à cacher).

**b) Lancer une commande shell avec `run:`.**

```yaml
steps:
  - name: Install dependencies     # "name" = libellé lisible dans les logs
    run: npm ci

  - name: Run several commands      # commande multi-lignes avec le pipe |
    run: |
      npm run lint
      npm test
```

Détails utiles :
- `name:` est optionnel mais rend les logs lisibles.
- `actions/checkout` est **quasi toujours le premier step** : sans lui, le runner n'a pas ton code (juste une machine vide).
- Pour l'install, on préfère `npm ci` à `npm install` en CI : `ci` respecte strictement le `package-lock.json` (build reproductible).

### 2.6 Variables d'environnement : `env`

`env:` définit des variables d'environnement, à trois portées possibles — workflow, job, ou step. La plus fine gagne.

```yaml
env:
  NODE_ENV: test              # visible par tous les jobs

jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      CI: 'true'              # visible par tous les steps de ce job
    steps:
      - name: Build
        env:
          LOG_LEVEL: debug    # visible par ce seul step
        run: npm run build
```

Dans une commande `run:`, ces variables se lisent comme n'importe quelle variable shell (`$NODE_ENV` sous Linux).

### 2.7 Secrets : jamais en clair

Un mot de passe, un token de déploiement ou une clé d'API ne doit **jamais** être écrit dans le YAML : le fichier est versionné et public. On stocke la valeur dans **Settings → Secrets and variables → Actions** du dépôt, puis on la référence par son nom.

```yaml
steps:
  - name: Deploy
    env:
      # La valeur réelle vit dans les secrets du dépôt, jamais dans le fichier
      DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
    run: ./scripts/deploy.sh
```

Points essentiels :
- On lit un secret via l'expression `secrets.NOM` entre les délimiteurs `${{ }}`.
- GitHub **masque automatiquement** la valeur dans les logs (elle apparaît comme `***`).
- Un secret n'est **pas** exposé aux workflows déclenchés par une PR venant d'un fork — protection anti-vol. La gestion fine des secrets (environnements, OIDC sans secret long terme) est au module 08.

> Les délimiteurs `${{ ... }}` encadrent une **expression** GitHub Actions (secrets, contexts, conditions). Retiens la forme ici ; les contexts complets sont détaillés au module 02.

---

## 3. Worked examples

### Exemple 1 — le workflow CI TribuZen (résolution du cas concret)

On complète le squelette de la section 1 : à chaque push et PR vers `main`, plus à la demande, on récupère le code, on installe Node, on installe les dépendances, on lint et on teste.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:          # permet aussi le lancement manuel

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      # 1. Récupérer le code — sans ça, le runner est vide
      - uses: actions/checkout@v7

      # 2. Installer Node.js 22 + activer le cache du gestionnaire npm
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'

      # 3. Installer les dépendances de façon reproductible
      - name: Install dependencies
        run: npm ci

      # 4. Lint puis tests — deux commandes, deux steps pour des logs clairs
      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test
```

**Pourquoi c'est correct :**
- `checkout` est premier : les steps suivants n'ont du code à installer/tester que grâce à lui.
- `setup-node` précède `npm ci` : sans Node installé, `npm` n'existe pas sur le runner.
- `npm ci` (et non `install`) garantit un build identique au `package-lock.json`.
- Lint et test sont deux steps séparés : si le lint échoue, on le voit immédiatement dans les logs, sans confusion avec les tests.

### Exemple 2 — un workflow manuel avec une entrée

`workflow_dispatch` peut demander une **entrée** à l'utilisateur au moment du lancement — utile pour un script ponctuel (ex. : régénérer des données de démo TribuZen).

```yaml
# .github/workflows/seed-demo.yml
name: Seed demo data

on:
  workflow_dispatch:
    inputs:
      familySize:
        description: 'Nombre de membres à générer'
        required: true
        default: '5'

jobs:
  seed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
      - name: Run seed script
        env:
          # L'entrée saisie est lue via le context "inputs"
          FAMILY_SIZE: ${{ inputs.familySize }}
        run: node scripts/seed.js
```

**À noter :** l'entrée saisie dans l'UI arrive dans le script via une variable d'environnement (`FAMILY_SIZE`). On ne l'écrit jamais en dur : le workflow reste générique et réutilisable.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Oublier `actions/checkout`

```yaml
# ❌ Le job démarre sur une machine vierge : il n'y a PAS ton code
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci        # échoue : pas de package.json sur le runner
```

Le runner est une machine fraîche sans ton dépôt. `actions/checkout` est **presque toujours le premier step**. Sans lui, `npm ci`, `npm test`, tout casse avec un « file not found ».

### PIÈGE #2 — Croire que les jobs partagent leur état

```yaml
# ❌ install et test sont deux jobs → deux machines différentes
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci        # installe sur la machine du job "install"
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test      # machine DIFFÉRENTE : node_modules n'existe pas ici
```

Chaque **job** a son propre runner. `node_modules` installé dans `install` n'existe pas dans `test`. Deux solutions : soit tout mettre dans le **même job** (steps séquentiels, même machine — le cas le plus courant), soit passer des données entre jobs via des artefacts (module 05).

### PIÈGE #3 — `npm install` au lieu de `npm ci` en CI

`npm install` peut **modifier** le `package-lock.json` (mise à jour de versions permissives) et rendre le build non reproductible. En CI, on veut l'inverse : `npm ci` échoue si le lockfile et le `package.json` divergent, et installe exactement les versions verrouillées. Toujours `npm ci` dans un pipeline.

### PIÈGE #4 — Écrire un secret en clair dans le YAML

```yaml
# ❌ JAMAIS : le fichier est versionné, le token fuite dans l'historique Git
- run: ./deploy.sh --token "sk_prod_ne_faites_jamais_ca"
```

```yaml
# ✅ La valeur vit dans les secrets du dépôt, référencée par son nom
- run: ./deploy.sh
  env:
    DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

Un secret committé reste dans l'historique Git même après suppression. GitHub masque les secrets **référencés** dans les logs, mais ne peut rien pour une valeur écrite en dur.

### PIÈGE #5 — Épingler une action à une branche mouvante

```yaml
# ⚠️ "@main" suit la branche par défaut de l'action : elle peut casser sans prévenir
- uses: actions/checkout@main

# ✅ Épingler à une version majeure stable
- uses: actions/checkout@v7
```

On épingle au minimum à la **version majeure** (`@v7`). Pour un pipeline sensible à la sécurité, on épingle au SHA de commit exact — sujet approfondi au module 08.

---

## 5. Ancrage TribuZen

Le tout premier maillon du pipeline CI/CD de TribuZen est le workflow `ci.yml` de l'exemple 1. Il vit ici :

```
tribuzen/
  .github/
    workflows/
      ci.yml            ← push + pull_request vers main : checkout → setup-node → npm ci → lint → test
      seed-demo.yml     ← workflow_dispatch : génération manuelle de données de démo
  src/
  package.json
```

Concrètement, dès que Sylvain pousse une branche et ouvre une PR sur `smaurier/tribuzen`, GitHub lance `ci.yml` : la PR affiche une pastille verte si lint + tests passent, rouge sinon. C'est le garde-fou qui empêche de merger du code cassé — le problème du « ça compilait chez moi » disparaît.

Ce module pose les fondations. Les modules suivants enrichissent **ce même fichier** : matrice Node 20/22 et cache fin (module 02), coverage gate (module 03), build d'image Docker (module 04), déploiement et environnements de preview (modules 06-07). `ci.yml` est le fil rouge de tout le cours.

---

## 6. Points clés

1. Un workflow est un fichier YAML dans `.github/workflows/` ; chaque `.yml` y est un pipeline indépendant, et la clé `name:` est ce qui s'affiche dans l'UI.
2. Hiérarchie : **workflow → jobs → steps**. Les jobs tournent en parallèle sur des machines séparées ; les steps d'un job tournent en séquence sur la même machine.
3. `on:` déclare les déclencheurs : `push` et `pull_request` (avec `branches:`) pour la CI automatique, `workflow_dispatch` pour un lancement manuel.
4. `runs-on:` choisit le runner ; `ubuntu-latest` est le défaut pour un projet Node/TypeScript.
5. Un step fait soit `uses:` (appeler une action, paramétrée par `with:`), soit `run:` (lancer une commande shell).
6. `actions/checkout` est presque toujours le premier step — sinon le runner n'a pas ton code.
7. En CI, on installe avec `npm ci` (reproductible), pas `npm install`.
8. `env:` définit des variables d'env aux portées workflow / job / step (la plus fine gagne).
9. Un secret se lit via `secrets.NOM` entre `${{ }}` ; il est masqué dans les logs et jamais écrit en clair dans le fichier.
10. On épingle une action à une version majeure (`@v7`) au minimum, jamais à une branche mouvante.

---

## 7. Seeds Anki

```
Où doit-on placer un fichier de workflow GitHub Actions ?|Dans le dossier .github/workflows/ à la racine du dépôt. Chaque fichier .yml ou .yaml y est un workflow indépendant.
Quelle est la hiérarchie d'un workflow GitHub Actions ?|workflow → jobs → steps. Les jobs tournent en parallèle sur des runners séparés ; les steps d'un même job tournent en séquence sur la même machine.
Quels sont les trois déclencheurs de base sous la clé on: ?|push (commits poussés), pull_request (PR ouverte/mise à jour — met la croix verte ou rouge sur la PR), workflow_dispatch (bouton de lancement manuel dans l'UI).
Quelle est la différence entre un step "uses" et un step "run" ?|uses appelle une action réutilisable (paramétrée par with:). run exécute une commande shell directement sur le runner.
Pourquoi actions/checkout est-il presque toujours le premier step ?|Le runner démarre sur une machine vierge sans le code du dépôt. checkout récupère le code sur le runner ; sans lui, npm ci, npm test, etc. échouent avec un fichier introuvable.
Pourquoi préférer npm ci à npm install en CI ?|npm ci installe exactement les versions du package-lock.json (build reproductible) et échoue si le lockfile diverge du package.json. npm install peut modifier le lockfile et casser la reproductibilité.
Comment lire un secret dans un workflow sans l'exposer ?|On stocke la valeur dans les secrets du dépôt (Settings > Secrets), puis on la référence par son nom via secrets.NOM entre les délimiteurs d'expression. GitHub masque la valeur dans les logs.
Deux jobs d'un même workflow partagent-ils leur node_modules ?|Non. Chaque job a son propre runner (machine séparée). Un install fait dans un job n'existe pas dans un autre. Il faut soit tout mettre dans le même job, soit passer par des artefacts.
À quoi sert la clé env: dans un workflow ?|Elle définit des variables d'environnement à trois portées : workflow (tous les jobs), job (tous ses steps) ou step (un seul). La portée la plus fine l'emporte.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-01-github-actions-fondamentaux/README.md`. Écrire de zéro le workflow CI de TribuZen (`ci.yml`) — checkout, setup-node, install, lint, test — sans copier-coller, avec corrigé commenté et variante J+30.
