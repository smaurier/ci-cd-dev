---
layout: doc
title: CI/CD & DevOps
---

# 19 — CI/CD & DevOps

> De `git push` à la production : pipelines d'intégration et de déploiement continus.

## Parcours

Ce cours couvre l'ensemble du cycle CI/CD, de l'écriture d'un workflow GitHub Actions simple au déploiement automatisé en production avec monitoring.

### Phase 1 — Fondamentaux CI
| Module | Sujet | Durée |
|--------|-------|-------|
| 00 | [Introduction au CI/CD](./modules/00-introduction-cicd.md) | 3h |
| 01 | [GitHub Actions — Fondamentaux](./modules/01-github-actions-fondamentaux.md) | 5h |
| 02 | [GitHub Actions — Avancé](./modules/02-github-actions-avance.md) | 5h |
| 03 | [Testing dans le CI](./modules/03-testing-dans-ci.md) | 5h |

### Phase 2 — Artefacts & Conteneurs
| Module | Sujet | Durée |
|--------|-------|-------|
| 04 | [Conteneurisation dans le CI](./modules/04-conteneurisation-ci.md) | 5h |
| 05 | [Artefacts & Registries](./modules/05-artefacts-registries.md) | 5h |

### Phase 3 — Déploiement & Environnements
| Module | Sujet | Durée |
|--------|-------|-------|
| 06 | [Stratégies de déploiement](./modules/06-strategies-deploiement.md) | 5h |
| 07 | [Preview Environments](./modules/07-preview-environments.md) | 5h |

### Phase 4 — Sécurité & Production
| Module | Sujet | Durée |
|--------|-------|-------|
| 08 | [Sécurité des pipelines](./modules/08-securite-pipelines.md) | 5h |
| 09 | [Introduction à l'IaC](./modules/09-iac-introduction.md) | 5h |
| 10 | [Monitoring des pipelines](./modules/10-monitoring-pipelines.md) | 5h |
| 11 | [Projet final](./modules/11-projet-final.md) | 7h |

## Labs pratiques

Chaque module est accompagné d'un lab TypeScript exécutable :

```bash
pnpm lab:01        # Exercice (stubs à implémenter)
pnpm solution:01   # Solution de référence
```

## Quizzes

12 quizzes interactifs (HTML standalone) pour valider les acquis après chaque module.
