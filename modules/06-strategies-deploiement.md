# Module 6 — Stratégies de déploiement

## Objectifs pédagogiques

- Comprendre et comparer les stratégies de déploiement principales
- Implémenter un déploiement blue-green
- Configurer un canary deployment progressif
- Maîtriser le rolling update et ses paramètres
- Intégrer les feature flags dans la stratégie de release

---

## 1. Vue d'ensemble des stratégies

```
Recreate         ████████░░░░░░░░  Downtime, simple
                 ░░░░░░░░████████

Rolling          ████████████████  Zero-downtime, progressif
                 ░░██████████████
                 ░░░░████████████
                 ░░░░░░░░████████

Blue-Green       ████████████████  Zero-downtime, instantané
                 ████████████████  (switch)
                 
Canary           ████████████████  Zero-downtime, graduel
                 █░██████████████  5% new
                 ███░████████████  25% new
                 ████████████████  100% new
```

---

## 2. Recreate (Big Bang)

La stratégie la plus simple : arrêter l'ancienne version, démarrer la nouvelle.

```yaml
# Kubernetes
spec:
  strategy:
    type: Recreate
```

| Avantage | Inconvénient |
|---|---|
| Simple à implémenter | Downtime pendant le déploiement |
| Pas de compatibilité nécessaire | Rollback lent |
| Pas de coût supplémentaire | Risqué pour les gros changements |

---

## 3. Rolling Update

Remplacement progressif des instances, une par une.

```yaml
# Kubernetes
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 1 instance en plus temporairement
      maxUnavailable: 0   # Toujours au moins N instances actives
```

### Points d'attention

- Les deux versions cohabitent temporairement
- Les migrations de DB doivent être **backward-compatible**
- Health checks indispensables pour valider chaque instance

---

## 4. Blue-Green Deployment

```
               Load Balancer
              ┌──────┴──────┐
              │              │
         ┌────▼────┐   ┌────▼────┐
         │  BLUE   │   │  GREEN  │
         │ (v1.0)  │   │ (v1.1)  │
         │ ACTIVE  │   │ STANDBY │
         └─────────┘   └─────────┘
              │
     Switch instantané →
              │
         ┌─────────┐   ┌─────────┐
         │  BLUE   │   │  GREEN  │
         │ (v1.0)  │   │ (v1.1)  │
         │ STANDBY │   │ ACTIVE  │
         └─────────┘   └─────────┘
```

### Implémentation avec GitHub Actions

```yaml
jobs:
  deploy-green:
    steps:
      - name: Deploy to green
        run: ./deploy.sh green ${{ github.sha }}
      - name: Health check green
        run: curl -f https://green.myapp.com/health
      - name: Switch traffic
        run: ./switch-traffic.sh green
      - name: Health check production
        run: curl -f https://myapp.com/health
```

---

## 5. Canary Deployment

```yaml
jobs:
  canary:
    steps:
      - name: Deploy canary (5%)
        run: ./deploy-canary.sh 5
      - name: Monitor for 10 minutes
        run: ./monitor.sh --duration=600 --error-threshold=1%
      - name: Promote to 25%
        run: ./deploy-canary.sh 25
      - name: Monitor for 10 minutes
        run: ./monitor.sh --duration=600 --error-threshold=1%
      - name: Full rollout
        run: ./deploy-canary.sh 100
```

### Métriques de décision

- **Error rate** : taux d'erreurs 5xx sur le canary vs stable
- **Latency** : P95/P99 du canary vs stable
- **Business metrics** : taux de conversion, satisfaction utilisateur

---

## 6. Feature Flags

Les feature flags découplent le **déploiement** de la **release**.

```typescript
// Code déployé mais fonctionnalité cachée
if (featureFlags.isEnabled('new-checkout', { userId })) {
  return renderNewCheckout();
} else {
  return renderOldCheckout();
}
```

### Avantages

- Déployer du code sans l'activer
- Activer progressivement par segment d'utilisateurs
- Rollback instantané (désactiver le flag)
- A/B testing intégré

---

## Exercice pratique

Implémente en TypeScript la logique d'un déploiement canary :
1. Calcul du pourcentage de trafic
2. Analyse des métriques de santé
3. Décision de promotion ou rollback
4. Gestion des feature flags

---

## Ressources

- [Kubernetes Deployment Strategies](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Martin Fowler — Blue Green Deployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [LaunchDarkly Feature Flags](https://launchdarkly.com/docs/)
