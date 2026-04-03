# Module 4 — Conteneurisation dans le CI

## Objectifs pédagogiques

- Construire des images Docker dans un pipeline CI
- Optimiser les builds Docker avec le multi-stage et le caching
- Publier des images vers des registres (GHCR, Docker Hub, ECR)
- Scanner les images pour détecter les vulnérabilités
- Maîtriser Docker Buildx pour les builds multi-architecture

---

## 1. Docker dans GitHub Actions

### Build simple

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: myapp:${{ github.sha }}
```

### Login et push

```yaml
steps:
  - uses: docker/login-action@v3
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}

  - uses: docker/build-push-action@v5
    with:
      context: .
      push: true
      tags: |
        ghcr.io/${{ github.repository }}:${{ github.sha }}
        ghcr.io/${{ github.repository }}:latest
```

---

## 2. Optimisation du build

### Dockerfile optimisé

```dockerfile
# Stage 1 : build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /prod_modules
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 : production
FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /prod_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Cache des layers

```yaml
- uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ghcr.io/${{ github.repository }}:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

---

## 3. Scan de vulnérabilités

### Trivy

```yaml
- name: Scan image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: myapp:${{ github.sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'

- name: Upload scan results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

---

## 4. Builds multi-architecture

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    context: .
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/${{ github.repository }}:latest
```

---

## 5. Tagging strategy

```yaml
- uses: docker/metadata-action@v5
  id: meta
  with:
    images: ghcr.io/${{ github.repository }}
    tags: |
      type=sha
      type=ref,event=branch
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
```

---

## Exercice pratique

Crée un pipeline qui :
1. Build une image multi-stage optimisée
2. Scanner l'image avec Trivy (fail si vulnérabilités critiques)
3. Push vers GHCR avec tags sémantiques
4. Utilise le cache GitHub Actions pour accélérer le build

---

## Ressources

- [docker/build-push-action](https://github.com/docker/build-push-action)
- [Trivy GitHub Action](https://github.com/aquasecurity/trivy-action)
- [Docker Buildx](https://docs.docker.com/buildx/working-with-buildx/)
