# Module 5 — Artefacts & Registries

## Objectifs pédagogiques

- Comprendre le cycle de vie des artefacts dans un pipeline
- Publier des packages npm (npm registry, GitHub Packages)
- Gérer les versions sémantiques automatiquement
- Configurer des registres privés pour les dépendances internes
- Stocker et partager des artefacts entre jobs

---

## 1. Types d'artefacts

| Type | Exemples | Stockage |
|---|---|---|
| Build output | `dist/`, bundles JS | Upload artifact |
| Images Docker | `myapp:v1.2.3` | Container registry |
| Packages npm | `@company/utils` | npm registry |
| Rapports | Coverage, tests, SARIF | Upload artifact |
| Binaires | CLI tools, executables | GitHub Releases |

---

## 2. GitHub Actions Artifacts

### Upload

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: build-${{ github.sha }}
    path: |
      dist/
      !dist/**/*.map
    retention-days: 30
    compression-level: 6
```

### Download dans un autre job

```yaml
deploy:
  needs: build
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: build-${{ github.sha }}
        path: dist/
    - run: ./deploy.sh dist/
```

---

## 3. Publication npm

### Automated release

```yaml
jobs:
  publish:
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Semantic versioning automatique

```yaml
- name: Determine version bump
  id: version
  run: |
    COMMITS=$(git log --oneline $(git describe --tags --abbrev=0)..HEAD)
    if echo "$COMMITS" | grep -q "BREAKING CHANGE\|feat!:"; then
      echo "bump=major" >> $GITHUB_OUTPUT
    elif echo "$COMMITS" | grep -q "feat:"; then
      echo "bump=minor" >> $GITHUB_OUTPUT
    else
      echo "bump=patch" >> $GITHUB_OUTPUT
    fi

- name: Bump version
  run: npm version ${{ steps.version.outputs.bump }} --no-git-tag-version
```

---

## 4. GitHub Releases

```yaml
- name: Create Release
  uses: softprops/action-gh-release@v2
  if: startsWith(github.ref, 'refs/tags/')
  with:
    generate_release_notes: true
    files: |
      dist/*.tar.gz
      CHANGELOG.md
```

---

## 5. Registres privés

### npm avec scope

```yaml
# .npmrc
@company:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

### Docker avec GHCR

```yaml
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

---

## Exercice pratique

Crée un pipeline qui :
1. Build le projet et upload l'artefact
2. Sur un tag `v*`, publie automatiquement le package npm
3. Crée une GitHub Release avec le changelog auto-généré

---

## Ressources

- [Publishing npm packages](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)
- [GitHub Packages](https://docs.github.com/en/packages)
- [Semantic Versioning](https://semver.org/)
