# 19 — CI/CD & DevOps

> De `git push` à la production : pipelines d'intégration et de déploiement continus.

## Objectifs pédagogiques

- Maîtriser GitHub Actions (fondamentaux et avancé)
- Comprendre les principes CI/CD et les patterns de pipeline
- Implémenter des stratégies de déploiement (blue-green, canary, rolling)
- Sécuriser les pipelines et gérer les secrets
- Conteneuriser et publier des artefacts
- Mettre en place des preview environments

## Structure du cours

```
19-cicd-devops/
├── README.md
├── index.md
├── package.json
├── tsconfig.json
├── glossaire.md
├── modules/
│   ├── 00-introduction-cicd.md
│   ├── 01-github-actions-fondamentaux.md
│   ├── 02-github-actions-avance.md
│   ├── 03-testing-dans-ci.md
│   ├── 04-conteneurisation-ci.md
│   ├── 05-artefacts-registries.md
│   ├── 06-strategies-deploiement.md
│   ├── 07-preview-environments.md
│   ├── 08-securite-pipelines.md
│   ├── 09-iac-introduction.md
│   ├── 10-monitoring-pipelines.md
│   └── 11-projet-final.md
├── labs/
│   ├── test-utils.ts
│   ├── lab-01-github-actions/
│   ├── lab-02-actions-avance/
│   ├── lab-03-testing-ci/
│   ├── lab-04-docker-ci/
│   ├── lab-05-artefacts/
│   ├── lab-06-deploiement/
│   ├── lab-07-preview-envs/
│   ├── lab-08-securite-ci/
│   ├── lab-09-iac/
│   └── lab-10-projet-final/
└── quizzes/
    ├── quiz-00-introduction.html
    ... (12 quizzes)
    └── quiz-11-projet-final.html
```

## Prérequis

- **Git avancé** (module 17) : branches, merge, workflows
- **Testing** (module 06) : types de tests, automatisation
- **Docker** (modules 13-25/26/27) : conteneurisation de base
- **Sécurité** (module 18) : gestion des secrets, supply chain

## Parcours recommandé

### Phase 1 — Fondamentaux CI (modules 00–03)
Comprendre les principes CI/CD, maîtriser GitHub Actions, intégrer les tests.

### Phase 2 — Artefacts & Conteneurs (modules 04–05)
Docker dans le CI, publication d'images, gestion d'artefacts.

### Phase 3 — Déploiement & Environnements (modules 06–07)
Stratégies de déploiement, preview environments, feature flags.

### Phase 4 — Sécurité & Production (modules 08–11)
Sécurisation des pipelines, IaC, monitoring, projet intégrateur.

## Lancer le projet

```bash
# Installer les dépendances
pnpm install

# Lancer la documentation
pnpm docs:dev

# Exécuter un lab (exercice)
pnpm lab:01

# Exécuter une solution
pnpm solution:01
```

## Durée estimée

~60 heures (modules + labs + quizzes)
