# Module 3 — Testing dans le CI

## Objectifs pédagogiques

- Intégrer différents niveaux de tests dans un pipeline CI
- Configurer le parallélisme et le sharding de tests
- Générer et exploiter les rapports de couverture
- Implémenter la qualité gate (seuils de qualité)
- Gérer les tests flaky et les retries

---

## 1. La pyramide des tests dans le CI

```
        ╱╲         E2E (Playwright, Cypress)
       ╱  ╲        → Lents, coûteux, fiables
      ╱────╲
     ╱      ╲      Intégration (Supertest, testcontainers)
    ╱        ╲     → Moyens, API / DB
   ╱──────────╲
  ╱            ╲   Unitaires (Vitest, Jest)
 ╱              ╲  → Rapides, nombreux, isolés
╱────────────────╲
```

### Pipeline type

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:unit -- --coverage

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:integration

  e2e-tests:
    needs: [unit-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```

---

## 2. Parallélisme et Sharding

### Sharding des tests E2E

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright test --shard=${{ matrix.shard }}/4
```

### Vitest avec reporter CI

```yaml
- name: Run tests
  run: npx vitest --reporter=junit --outputFile=test-results.xml

- uses: actions/upload-artifact@v4
  if: always()  # Upload même si les tests échouent
  with:
    name: test-results
    path: test-results.xml
```

---

## 3. Couverture de code

### Configuration

```yaml
- name: Run tests with coverage
  run: npx vitest --coverage --coverage.reporter=lcov

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    file: ./coverage/lcov.info
    token: ${{ secrets.CODECOV_TOKEN }}
```

### Quality Gate

```yaml
- name: Check coverage threshold
  run: |
    COVERAGE=$(npx vitest --coverage --coverage.reporter=json-summary 2>/dev/null | jq '.total.lines.pct')
    echo "Coverage: ${COVERAGE}%"
    if (( $(echo "$COVERAGE < 80" | bc -l) )); then
      echo "❌ Coverage below 80%"
      exit 1
    fi
```

---

## 4. Tests flaky

### Stratégie de retry

```yaml
- name: Run tests with retry
  uses: nick-fields/retry@v3
  with:
    timeout_minutes: 10
    max_attempts: 3
    command: npm run test:e2e
```

### Détection des flaky tests

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    retry: 2,  // Retry tests qui échouent
    reporters: ['default', 'json'],
  }
});
```

---

## 5. Services et dépendances

### PostgreSQL en CI

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: testdb
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

### Redis en CI

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    options: >-
      --health-cmd "redis-cli ping"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

---

## Exercice pratique

Configure un pipeline CI avec :
1. Tests unitaires avec couverture (seuil 80%)
2. Tests d'intégration avec PostgreSQL en service
3. Tests E2E shardés sur 4 instances parallèles
4. Upload des rapports de tests comme artefacts

---

## Ressources

- [GitHub Actions Services](https://docs.github.com/en/actions/using-containerized-services)
- [Vitest CI Configuration](https://vitest.dev/guide/ci.html)
- [Playwright CI](https://playwright.dev/docs/ci-intro)
