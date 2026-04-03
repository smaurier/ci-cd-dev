# Module 0 — Introduction au CI/CD

## Objectifs pédagogiques

- Comprendre les principes d'intégration continue et de déploiement continu
- Différencier CI, Continuous Delivery et Continuous Deployment
- Connaître l'historique et l'évolution des pratiques DevOps
- Identifier les métriques DORA de performance
- Comprendre le rôle d'un pipeline dans le cycle de développement

---

## 1. Qu'est-ce que le CI/CD ?

### Définitions

**Continuous Integration (CI)** : Pratique de merger fréquemment le code de chaque développeur dans une branche partagée, avec compilation et tests automatiques à chaque changement.

**Continuous Delivery (CD)** : Extension de la CI où chaque changement qui passe les tests est automatiquement prêt à être déployé en production. Le déploiement reste une décision humaine.

**Continuous Deployment (CD)** : Extension de Continuous Delivery où le déploiement en production est également automatique. Aucune intervention humaine entre le push et la production.

```
Code → Push → Build → Test → [Manual Gate?] → Deploy
  CI ─────────────────────┘        │              │
  Continuous Delivery ─────────────┘              │
  Continuous Deployment ──────────────────────────┘
```

### Le problème résolu

Sans CI/CD :
- Intégrations rares et douloureuses ("merge hell")
- Bugs découverts tard dans le cycle
- Déploiements manuels, risqués et stressants
- "Works on my machine" syndrome

Avec CI/CD :
- Feedback rapide sur chaque changement (< 10 minutes)
- Bugs détectés immédiatement
- Déploiements fréquents, petits et réversibles
- Environnements reproductibles

---

## 2. Historique et évolution

### Chronologie

| Époque | Pratique | Outil emblématique |
|---|---|---|
| 2000s | Build automatisé | CruiseControl, Ant |
| 2005 | Intégration continue | Hudson → Jenkins |
| 2010 | Configuration as Code | Jenkins Pipeline, Travis CI |
| 2015 | Conteneurisation | Docker, Kubernetes |
| 2018 | CI/CD cloud-native | GitHub Actions, GitLab CI |
| 2020+ | GitOps, Platform Engineering | ArgoCD, Backstage |

### Du script bash au pipeline déclaratif

```bash
# 2005 : script bash exécuté manuellement
./build.sh && ./test.sh && ./deploy.sh
```

```yaml
# 2024 : pipeline déclaratif avec GitHub Actions
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

---

## 3. Les métriques DORA

Les quatre métriques clés du DevOps Research and Assessment (DORA) :

### Deployment Frequency
À quelle fréquence déployez-vous en production ?

| Niveau | Fréquence |
|---|---|
| Elite | Plusieurs fois par jour |
| High | Une fois par jour à une fois par semaine |
| Medium | Une fois par semaine à une fois par mois |
| Low | Moins d'une fois par mois |

### Lead Time for Changes
Combien de temps entre le commit et le déploiement en production ?

### Change Failure Rate
Quel pourcentage de déploiements cause un incident ?

### Time to Restore Service
Combien de temps pour restaurer le service après un incident ?

> **Objectif** : Les organisations "Elite" selon DORA déploient des centaines de fois par jour avec un taux d'échec < 5% et un temps de restauration < 1h.

---

## 4. Anatomy d'un pipeline

### Étapes classiques

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Source   │──▶│  Build   │──▶│   Test   │──▶│  Stage   │──▶│  Deploy  │
│  (Git)    │   │(Compile) │   │(Unit/E2E)│   │(Preview) │   │  (Prod)  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

1. **Source** : Déclenchement par un événement Git (push, PR, tag)
2. **Build** : Compilation, transpilation, bundling
3. **Test** : Tests unitaires, intégration, e2e, linting, type-checking
4. **Stage** : Déploiement temporaire pour review/validation
5. **Deploy** : Déploiement en production (avec ou sans gate manuelle)

### Principes fondamentaux

- **Idempotence** : Relancer le pipeline produit le même résultat
- **Isolation** : Chaque exécution est indépendante
- **Reproductibilité** : Le même code produit le même artefact
- **Rapidité** : Objectif < 10 minutes pour le feedback

---

## 5. Outils du marché

### Comparaison rapide

| Outil | Hébergement | Langage config | Points forts |
|---|---|---|---|
| GitHub Actions | Cloud | YAML | Intégration GitHub native, marketplace |
| GitLab CI | Cloud/Self | YAML | All-in-one, DAG pipelines |
| Jenkins | Self-hosted | Groovy | Flexible, plugins massifs |
| CircleCI | Cloud | YAML | Performance, orbes réutilisables |
| Azure Pipelines | Cloud | YAML | Intégration Azure/Microsoft |

> **Dans ce cours**, nous nous concentrons sur **GitHub Actions** car c'est la plateforme CI/CD la plus utilisée dans l'écosystème JavaScript/TypeScript et elle est intégrée directement à GitHub.

---

## Exercice de réflexion

1. Identifie le niveau DORA de ton équipe actuelle (ou d'une équipe fictive)
2. Quels sont les goulots d'étranglement dans ton workflow actuel ?
3. Quels bénéfices concrets un pipeline CI/CD apporterait-il ?

---

## Ressources

- [DORA State of DevOps Report](https://dora.dev)
- [Continuous Delivery — Jez Humble & David Farley](https://continuousdelivery.com/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
