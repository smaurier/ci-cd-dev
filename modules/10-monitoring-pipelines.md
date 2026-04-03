# Module 10 — Monitoring des Pipelines

## Objectifs pédagogiques

- Surveiller la santé et la performance des pipelines CI/CD
- Implémenter les métriques DORA dans le pipeline
- Configurer les notifications et alertes
- Analyser les tendances de build (temps, taux d'échec)
- Optimiser les pipelines lents

---

## 1. Métriques essentielles

### Métriques de pipeline

| Métrique | Description | Objectif |
|---|---|---|
| Build duration | Temps total du pipeline | < 10 min |
| Success rate | % de builds réussis | > 95% |
| Queue time | Temps d'attente avant exécution | < 1 min |
| Flaky rate | % de tests instables | < 1% |
| Recovery time | Temps pour corriger un build cassé | < 30 min |

### Métriques DORA automatisées

```yaml
- name: Track deployment frequency
  run: |
    echo "::notice::Deployment #$(git tag -l 'deploy-*' | wc -l)"

- name: Track lead time
  run: |
    FIRST_COMMIT=$(git log --format=%ct --reverse HEAD...$(git describe --tags --abbrev=0) | head -1)
    NOW=$(date +%s)
    LEAD_TIME=$(( (NOW - FIRST_COMMIT) / 3600 ))
    echo "::notice::Lead time: ${LEAD_TIME}h"
```

---

## 2. Notifications

### Slack

```yaml
- name: Notify Slack
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "❌ Build failed on ${{ github.ref }}",
        "blocks": [{
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "*${{ github.workflow }}* failed\n*Branch:* ${{ github.ref_name }}\n*Author:* ${{ github.actor }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Run>"
          }
        }]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### GitHub Status Checks

```yaml
- name: Update deployment status
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.repos.createDeploymentStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        deployment_id: ${{ steps.deploy.outputs.id }},
        state: 'success',
        environment_url: 'https://myapp.com'
      });
```

---

## 3. Optimisation des pipelines

### Identifier les goulots

```yaml
- name: Timing — Install
  run: |
    START=$(date +%s)
    npm ci
    echo "install_time=$(($(date +%s) - START))" >> $GITHUB_OUTPUT

- name: Timing — Build
  run: |
    START=$(date +%s)
    npm run build
    echo "build_time=$(($(date +%s) - START))" >> $GITHUB_OUTPUT

- name: Timing — Tests
  run: |
    START=$(date +%s)
    npm test
    echo "test_time=$(($(date +%s) - START))" >> $GITHUB_OUTPUT
```

### Techniques d'optimisation

| Technique | Gain typique |
|---|---|
| Cache npm/pnpm | 30–60s |
| Paralléliser lint + type-check + test | 40% |
| Build matrix avec fail-fast | Variable |
| Docker layer caching | 50–80% du build Docker |
| Test sharding | Linéaire avec le nombre de shards |
| Skip jobs conditionnels | Variable |

---

## 4. Dashboards

### GitHub Actions Insights

GitHub fournit des métriques natives :
- Durée des workflows par exécution
- Taux de succès/échec par workflow
- Utilisation des minutes par runner

### Custom dashboard

```typescript
// Agrégation des métriques de pipeline
interface PipelineMetrics {
  workflow: string;
  avgDuration: number;    // secondes
  successRate: number;     // pourcentage
  p95Duration: number;     // secondes
  deployFrequency: number; // par semaine
}
```

---

## Exercice pratique

Implémente un système de monitoring de pipeline :
1. Collecte des métriques (durée, résultat, étapes)
2. Calcul des tendances (moyenne mobile, percentiles)
3. Détection d'anomalies (dégradation soudaine)
4. Génération de rapports synthétiques

---

## Ressources

- [GitHub Actions Usage Metrics](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows)
- [DORA Metrics](https://dora.dev/guides/)
- [Four Keys Dashboard](https://github.com/dora-team/fourkeys)
