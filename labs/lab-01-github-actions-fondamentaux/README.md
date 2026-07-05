# Lab 01 — GitHub Actions : premier workflow CI

> **Outcome :** à la fin, tu sais écrire de zéro un workflow GitHub Actions qui, à chaque push et pull request, récupère le code, installe Node.js, installe les dépendances, lint et teste — et fait apparaître une pastille verte ou rouge sur la PR.
> **Vrai outil :** GitHub Actions sur un vrai dépôt GitHub (l'onglet « Actions » exécute réellement ton workflow — pas de simulateur).
> **Feedback :** le coach valide en session le fichier YAML et le run réel dans l'UI GitHub — pas de test-runner auto-correcteur.

---

## Énoncé

Tu mets en place la **CI du projet TribuZen**. Objectif : plus jamais de « ça compilait chez moi ». Tu écris `.github/workflows/ci.yml` qui, **à chaque push et à chaque pull request vers `main`** (plus un déclenchement manuel possible), exécute la chaîne qualité.

Cahier des charges **exact** :

1. Le workflow s'appelle `CI` (clé `name:`).
2. Déclencheurs : `push` vers `main`, `pull_request` vers `main`, et `workflow_dispatch` (lancement manuel).
3. Un seul job `quality` sur `ubuntu-latest`.
4. Steps, dans l'ordre :
   - récupérer le code du dépôt ;
   - installer **Node.js 22** avec le cache `npm` activé ;
   - installer les dépendances de façon reproductible ;
   - lancer le lint (`npm run lint`) ;
   - lancer les tests (`npm test`).
5. Chaque commande a un `name:` lisible dans les logs.

**Pas de copier-coller depuis le module.** Tu écris le fichier à partir du starter minimal ci-dessous.

### Pré-requis de projet

Un dépôt GitHub avec un `package.json` qui expose au moins les scripts `lint` et `test`. Le plus simple : un projet Vite/TS déjà commité (ou le repo `tribuzen`). Vérifie que `package.json` contient par exemple :

```json
{
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run"
  }
}
```

### Starter minimal

Crée le fichier `.github/workflows/ci.yml` à la racine du dépôt :

```yaml
# .github/workflows/ci.yml — starter
name: CI

on:
  # À toi : push sur main, pull_request sur main, workflow_dispatch

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      # À toi : checkout, setup-node (v22 + cache npm), install, lint, test
```

Commite, pousse sur une branche, ouvre une PR, et va voir l'onglet **Actions** de ton dépôt.

---

## Étapes (en friction)

1. **Écris le bloc `on:`** — trois déclencheurs : `push` (`branches: [main]`), `pull_request` (`branches: [main]`), `workflow_dispatch`.
2. **Ajoute le step checkout** en premier — sans lui, le runner est vide.
3. **Ajoute le step setup-node** — version `22`, `cache: 'npm'`.
4. **Ajoute le step d'install** — `npm ci` (pas `npm install`), avec un `name:`.
5. **Ajoute deux steps séparés** — un pour `npm run lint`, un pour `npm test`. Deux steps distincts = logs lisibles.
6. **Pousse et ouvre une PR** — vérifie dans l'onglet Actions que le run démarre et passe au vert.
7. **Casse volontairement le lint** (ajoute une variable inutilisée), pousse : vérifie que la PR **passe au rouge** et que le step Lint est marqué en échec. Puis corrige.
8. **Déclenche le workflow à la main** depuis l'UI (bouton « Run workflow ») pour vérifier que `workflow_dispatch` fonctionne.

---

## Corrigé complet commenté

```yaml
# .github/workflows/ci.yml — corrigé
name: CI

# Trois déclencheurs :
# - push sur main : contrôle le code déjà mergé
# - pull_request sur main : LE déclencheur qui met la pastille verte/rouge sur la PR
# - workflow_dispatch : ajoute un bouton "Run workflow" manuel dans l'onglet Actions
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  quality:
    # Runner Linux : le défaut le plus rapide et le moins cher pour du Node/TS
    runs-on: ubuntu-latest
    steps:
      # 1. Récupère le code du dépôt sur le runner.
      #    PREMIER step : sans lui, la machine est vierge et tout casse ensuite.
      - uses: actions/checkout@v7

      # 2. Installe Node.js 22 et active le cache du gestionnaire npm.
      #    "with:" passe les entrées de l'action (version + gestionnaire à cacher).
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'

      # 3. Installe les dépendances de façon reproductible.
      #    npm ci (pas npm install) : respecte strictement package-lock.json
      #    et échoue si le lockfile diverge du package.json.
      - name: Install dependencies
        run: npm ci

      # 4. Lint et tests en DEUX steps distincts.
      #    Si le lint échoue, on le voit immédiatement, sans le confondre avec les tests.
      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test
```

**Pourquoi ce corrigé est correct :**
- `actions/checkout@v7` est le premier step : les steps suivants n'ont du code à installer/tester que grâce à lui.
- `setup-node` précède `npm ci` : sans Node installé, `npm` n'existe pas sur le runner. `cache: 'npm'` accélère les runs suivants en réutilisant le cache des dépendances.
- `npm ci` garantit un build identique au lockfile — c'est l'install de CI, pas `npm install`.
- Lint et test sont deux steps : un échec de lint est isolé dans son propre step, logs clairs.
- Les actions sont épinglées à leur **version majeure** (`@v7`, `@v6`), jamais à `@main`.

> Versions vérifiées le 2026-07 : `actions/checkout@v7`, `actions/setup-node@v6` sont les majeures stables courantes. Adapte si une majeure plus récente est publiée — épingle toujours à une majeure, jamais à une branche.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées. Sans rouvrir le corrigé ni le module, en 20 minutes :**

1. Écris `ci.yml` de mémoire.
2. Ajoute un step **`Type check`** (`npm run typecheck`) placé **avant** le lint.
3. Ajoute un **job séparé** `build` qui dépend de `quality` (indice : la clé `needs:`) et lance `npm run build`. Fais checkout + setup-node dans ce job aussi — souviens-toi qu'un job démarre sur une machine vierge.
4. Restreins le workflow pour qu'il **ignore les push qui ne touchent que la doc** (indice : `paths-ignore:` sous `push`).

**Critère de réussite :** le run apparaît dans l'onglet Actions, `build` ne démarre qu'après le succès de `quality`, et un push modifiant uniquement un `.md` ne déclenche rien.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce workflow est le tout premier maillon du pipeline CI/CD :

```
tribuzen/
  .github/
    workflows/
      ci.yml            ← ce lab
```

**Différences par rapport au lab :**
- Le monorepo TribuZen aura plusieurs packages (front Vue, API NestJS) : le job `quality` filtrera peut-être par `paths:` ou tournera par workspace — affiné au module 02.
- La matrice de versions (Node 20 + 22) et le cache fin arrivent au module 02 ; ici on reste sur un seul Node 22.
- Le token de déploiement (`${{ secrets.DEPLOY_TOKEN }}`) n'apparaît qu'au workflow `deploy.yml` des modules 06-07 — `ci.yml` n'a besoin d'aucun secret.

**Commit cible :**
```
ci(tribuzen): premier workflow CI — checkout, setup-node, install, lint, test sur push/PR
```
