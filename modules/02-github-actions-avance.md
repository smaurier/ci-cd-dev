# Module 2 — GitHub Actions : Avancé

## Objectifs pédagogiques

- Maîtriser le build matrix pour tester sur plusieurs environnements
- Créer des actions réutilisables (composite, JavaScript, Docker)
- Gérer les dépendances entre jobs et le partage de données
- Optimiser les temps de build avec le caching avancé
- Utiliser les workflow reusables et les workflow_call

---

## 1. Build Matrix

### Matrice simple

```yaml
jobs:
  test:
    strategy:
      matrix:
        node-version: [20, 22]  # Node 18 EOL depuis avril 2024
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

Ce job s'exécute **4 fois** (2 versions × 2 OS).

### Include et Exclude

```yaml
strategy:
  matrix:
    node: [20, 22]
    os: [ubuntu-latest, windows-latest]
    exclude:
      - node: 20
        os: windows-latest  # Node 20 non testé sur Windows (optionnel)
    include:
      - node: 22
        os: macos-latest    # Test supplémentaire Node 22 sur macOS
        experimental: true
  fail-fast: false  # Ne pas annuler les autres si un échoue
```

---

## 2. Dépendances entre Jobs

### Outputs de job

```yaml
jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.get_version.outputs.version }}
    steps:
      - id: get_version
        run: echo "version=$(node -p 'require(\"./package.json\").version')" >> $GITHUB_OUTPUT

  deploy:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying version ${{ needs.version.outputs.version }}"
```

### Conditions avancées

```yaml
jobs:
  deploy:
    needs: [build, test]
    if: |
      always() &&
      needs.build.result == 'success' &&
      needs.test.result == 'success' &&
      github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying..."
```

---

## 3. Actions réutilisables

### Composite Action

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Install dependencies and build'
inputs:
  node-version:
    description: 'Node.js version'
    default: '20'
runs:
  using: 'composite'
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    - run: npm ci
      shell: bash
    - run: npm run build
      shell: bash
```

Utilisation :

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-project
    with:
      node-version: '22'
```

### Reusable Workflows

```yaml
# .github/workflows/reusable-test.yml
name: Reusable Test Workflow
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: '20'
    secrets:
      NPM_TOKEN:
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci
      - run: npm test
```

Appel :

```yaml
# .github/workflows/ci.yml
jobs:
  call-tests:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '22'
    secrets: inherit
```

---

## 4. Caching avancé

### Cache avec restore-keys

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

### Cache de Docker layers

```yaml
- uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: myapp:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

---

## 5. Concurrency et annulation

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # Annule les runs précédents de la même branche
```

---

## 6. Environnements et approbations

```yaml
jobs:
  deploy-staging:
    environment: staging
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploy to staging"

  deploy-production:
    needs: deploy-staging
    environment:
      name: production
      url: https://myapp.example.com
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploy to production"
```

---

## Exercice pratique

Crée un workflow qui :
1. Utilise un build matrix (Node 20+22 sur Ubuntu + Windows)
2. Définit une composite action pour setup + build
3. A un job de déploiement conditionnel (uniquement sur `main`)
4. Utilise la concurrency pour annuler les runs obsolètes

---

## Ressources

- [Reusing workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [Creating composite actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [Caching dependencies](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
