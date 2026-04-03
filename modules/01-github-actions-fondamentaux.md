# Module 1 — GitHub Actions : Fondamentaux

## Objectifs pédagogiques

- Comprendre la structure d'un workflow GitHub Actions
- Maîtriser les concepts de workflows, jobs, steps et runners
- Configurer les déclencheurs (triggers) d'un workflow
- Utiliser les actions de la marketplace
- Gérer les variables d'environnement et les secrets

---

## 1. Structure d'un workflow

### Fichier YAML

Les workflows sont définis dans `.github/workflows/*.yml` :

```yaml
name: CI Pipeline           # Nom affiché dans l'interface

on:                          # Déclencheurs
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:                        # Jobs à exécuter
  build:                     # Nom du job
    runs-on: ubuntu-latest   # Runner
    steps:                   # Étapes séquentielles
      - uses: actions/checkout@v4
      - name: Install deps
        run: npm ci
      - name: Run tests
        run: npm test
```

### Hiérarchie

```
Workflow (fichier YAML)
  └── Event (trigger)
  └── Job 1 (s'exécute sur un runner)
  │     └── Step 1 (action ou commande)
  │     └── Step 2
  │     └── Step 3
  └── Job 2 (parallèle par défaut)
        └── Step 1
        └── Step 2
```

---

## 2. Déclencheurs (Triggers)

### Événements Git

```yaml
on:
  push:
    branches: [main, develop]
    paths:
      - 'src/**'
      - 'package.json'
    tags:
      - 'v*'
  pull_request:
    types: [opened, synchronize, reopened]
```

### Événements planifiés

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'  # Tous les lundis à 6h UTC
```

### Déclenchement manuel

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options: [staging, production]
```

---

## 3. Jobs et Steps

### Jobs parallèles et séquentiels

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  deploy:
    needs: [lint, test]  # Attend les deux jobs
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying..."
```

### Steps : Actions vs commandes

```yaml
steps:
  # Utiliser une action de la marketplace
  - uses: actions/checkout@v4

  # Exécuter une commande shell
  - name: Install dependencies
    run: npm ci

  # Commande multi-lignes
  - name: Build and test
    run: |
      npm run build
      npm test

  # Action avec paramètres
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      cache: 'npm'
```

---

## 4. Variables et Secrets

### Variables d'environnement

```yaml
env:
  NODE_ENV: production  # Niveau workflow

jobs:
  build:
    env:
      CI: true  # Niveau job
    steps:
      - name: Build
        env:
          API_URL: https://api.example.com  # Niveau step
        run: npm run build
```

### Secrets GitHub

```yaml
steps:
  - name: Deploy
    env:
      DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
    run: ./deploy.sh
```

### Contextes et expressions

```yaml
steps:
  - name: Conditional step
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    run: echo "On main branch push"

  - name: Use context
    run: |
      echo "Repository: ${{ github.repository }}"
      echo "Actor: ${{ github.actor }}"
      echo "SHA: ${{ github.sha }}"
      echo "Run ID: ${{ github.run_id }}"
```

---

## 5. Actions de la Marketplace

### Actions essentielles

| Action | Usage |
|---|---|
| `actions/checkout@v4` | Clone le dépôt |
| `actions/setup-node@v4` | Installe Node.js avec cache |
| `actions/cache@v4` | Cache de fichiers (node_modules) |
| `actions/upload-artifact@v4` | Upload d'artefacts |
| `actions/download-artifact@v4` | Download d'artefacts |

### Exemple complet avec cache

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run build
      - run: npm test

      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/
          retention-days: 7
```

---

## 6. Runners

### GitHub-hosted runners

| Runner | OS | vCPU | RAM |
|---|---|---|---|
| `ubuntu-latest` | Ubuntu 22.04 | 4 | 16 GB |
| `windows-latest` | Windows Server 2022 | 4 | 16 GB |
| `macos-latest` | macOS 14 | 3 | 14 GB |

### Self-hosted runners

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64]
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

Avantages :
- Plus de puissance (GPU, machines spéciales)
- Accès au réseau interne
- Pas de limites de minutes

Inconvénients :
- Maintenance à votre charge
- Sécurité du runner à gérer
- Pas d'isolation entre les jobs (sauf Docker)

---

## Exercice pratique

Crée un workflow `.github/workflows/ci.yml` qui :
1. Se déclenche sur `push` et `pull_request` vers `main`
2. Installe Node.js 20 avec cache npm
3. Installe les dépendances
4. Exécute le linting, le build et les tests
5. Upload le dossier `dist/` comme artefact

---

## Ressources

- [GitHub Actions Quickstart](https://docs.github.com/en/actions/quickstart)
- [Workflow syntax reference](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [GitHub Actions Marketplace](https://github.com/marketplace?type=actions)
