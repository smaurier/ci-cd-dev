# Module 7 — Preview Environments

## Objectifs pédagogiques

- Comprendre le concept de preview environments (PR environments)
- Configurer le déploiement automatique d'un environnement par PR
- Gérer le cycle de vie des environnements éphémères
- Intégrer les previews dans le workflow de code review
- Optimiser les coûts avec le nettoyage automatique

---

## 1. Concept

Un **preview environment** est un environnement éphémère déployé automatiquement pour chaque pull request, permettant de tester les changements dans un contexte réel.

```
PR #42 opened → Deploy https://pr-42.preview.myapp.com
PR #42 updated → Redeploy with changes
PR #42 merged → Destroy environment
```

### Avantages

- Review visuelle avant merge (pas uniquement le code)
- Tests d'acceptation par les stakeholders
- Tests E2E sur un environnement isolé
- Réduction des bugs en production

---

## 2. Implémentation avec GitHub Actions

### Déploiement

```yaml
name: Preview Deploy
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    environment:
      name: preview-${{ github.event.number }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build

      - name: Deploy preview
        id: deploy
        run: |
          URL=$(./deploy-preview.sh pr-${{ github.event.number }})
          echo "url=$URL" >> $GITHUB_OUTPUT

      - name: Comment PR with URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `🚀 Preview deployed: ${{ steps.deploy.outputs.url }}`
            });
```

### Nettoyage

```yaml
name: Preview Cleanup
on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Destroy preview
        run: ./destroy-preview.sh pr-${{ github.event.number }}
```

---

## 3. Base de données pour les previews

### Stratégies

| Stratégie | Avantage | Inconvénient |
|---|---|---|
| DB partagée avec schema isolé | Économique | Risque de collision |
| DB éphémère par PR | Isolation complète | Coûteux |
| SQLite en mémoire | Rapide, pas de setup | Pas réaliste |
| Snapshot de production anonymisé | Données réalistes | Complexe, RGPD |

---

## 4. Outils populaires

| Outil | Type | Points forts |
|---|---|---|
| Vercel | PaaS | Preview par défaut pour chaque PR |
| Netlify | PaaS | Deploy Previews natifs |
| Railway | PaaS | PR environments avec DB |
| Kubernetes + ArgoCD | IaC | Namespaces éphémères |

---

## Exercice pratique

Implémente la logique de gestion de preview environments :
1. Génération d'URL unique par PR
2. Tracking des environnements actifs
3. Nettoyage automatique
4. Estimation des coûts

---

## Ressources

- [Vercel Preview Deployments](https://vercel.com/docs/deployments/preview-deployments)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments)
