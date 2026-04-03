# Module 11 — Projet Final CI/CD

## Objectifs pédagogiques

- Synthétiser toutes les compétences CI/CD acquises
- Concevoir un pipeline complet end-to-end
- Implémenter un workflow multi-environnement
- Intégrer sécurité, monitoring et déploiement automatisé
- Documenter et présenter l'architecture CI/CD

---

## 1. Contexte du projet

Tu es le lead DevOps d'une startup qui lance une application web full-stack. L'équipe de 5 développeurs a besoin d'un pipeline CI/CD complet pour passer de `git push` à la production de manière fiable et sécurisée.

### Architecture de l'application

```
Frontend (React)  ←→  API (NestJS)  ←→  PostgreSQL
     ↓                     ↓
   CDN (S3)          Container (ECS)
```

---

## 2. Cahier des charges

### Pipeline CI

- [ ] Lint + type-check + tests unitaires (< 5 min)
- [ ] Tests d'intégration avec PostgreSQL en service
- [ ] Tests E2E shardés sur 4 instances
- [ ] Couverture de code > 80%
- [ ] Build Docker multi-stage optimisé
- [ ] Scan de vulnérabilités (Trivy + npm audit)
- [ ] Cache optimisé (npm, Docker layers)

### Pipeline CD

- [ ] Preview environment par PR (avec URL commentée)
- [ ] Déploiement staging automatique sur merge dans `main`
- [ ] Déploiement production avec approbation manuelle
- [ ] Stratégie canary (5% → 25% → 100%)
- [ ] Rollback automatique si error rate > 1%

### Sécurité

- [ ] OIDC pour l'authentification cloud
- [ ] Secrets gérés par environnement
- [ ] Actions épinglées par hash
- [ ] Permissions minimales
- [ ] Branch protection rules

### Monitoring

- [ ] Notifications Slack (succès/échec)
- [ ] Métriques DORA calculées automatiquement
- [ ] Dashboard de santé des pipelines
- [ ] Alertes si build time > seuil

---

## 3. Livrables attendus

1. **Workflows GitHub Actions** : CI, CD staging, CD production, preview, cleanup
2. **Dockerfile** : Multi-stage, optimisé, sécurisé
3. **Documentation** : README avec diagramme d'architecture
4. **Métriques** : Script de collecte des métriques DORA
5. **Post-mortem template** : Pour documenter les incidents de pipeline

---

## 4. Critères d'évaluation

| Critère | Points |
|---|---|
| Pipeline CI complet et fonctionnel | 25 |
| Stratégie de déploiement (canary/blue-green) | 20 |
| Sécurité du pipeline | 20 |
| Preview environments | 15 |
| Monitoring et notifications | 10 |
| Documentation et qualité du code | 10 |
| **Total** | **100** |

---

## 5. Conseils

- Commence par le pipeline CI le plus simple, puis itère
- Teste chaque étape individuellement avant d'assembler
- Utilise `act` pour tester les workflows localement
- Documente les décisions architecturales (ADR)
- Planifie les cas d'erreur et de rollback dès le début

---

## Ressources

- Tous les modules précédents (00–10)
- [act — Run GitHub Actions locally](https://github.com/nektos/act)
- [GitHub Actions best practices](https://docs.github.com/en/actions/using-workflows/best-practices)
