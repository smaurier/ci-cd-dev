# Module 8 — Sécurité des Pipelines

## Objectifs pédagogiques

- Sécuriser les secrets et credentials dans les pipelines
- Comprendre et utiliser OIDC pour l'authentification cloud
- Sécuriser les workflows contre les injections de scripts
- Auditer les permissions et les actions tierces
- Mettre en place des protection rules sur les environnements

---

## 1. Gestion des secrets

### Niveaux de secrets GitHub

| Niveau | Portée | Usage |
|---|---|---|
| Organization | Tous les repos de l'org | Tokens cloud partagés |
| Repository | Un seul repo | API keys spécifiques |
| Environment | Un environnement spécifique | Credentials de production |

### Bonnes pratiques

```yaml
# ✅ Bon : utiliser les secrets GitHub
env:
  API_KEY: ${{ secrets.API_KEY }}

# ❌ Mauvais : hardcoder des secrets
env:
  API_KEY: "sk-1234567890abcdef"

# ❌ Mauvais : exposer dans les logs
- run: echo ${{ secrets.API_KEY }}  # Sera masqué, mais éviter
```

---

## 2. OIDC — Authentification sans secrets

```yaml
permissions:
  id-token: write  # Nécessaire pour OIDC
  contents: read

steps:
  - name: Configure AWS credentials (OIDC)
    uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789:role/github-actions
      aws-region: eu-west-1
      # Pas de access key / secret key !
```

### Avantages de l'OIDC

- Pas de credentials long-terme à gérer
- Token éphémère (15 min par défaut)
- Périmètre limité (repo, branche, environnement)
- Rotation automatique

---

## 3. Sécurisation des workflows

### Injection de scripts

```yaml
# ❌ Vulnérable à l'injection via le titre de la PR
- run: echo "${{ github.event.pull_request.title }}"

# ✅ Sécurisé : passer par une variable d'environnement
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "$PR_TITLE"
```

### Permissions minimales

```yaml
# Toujours définir les permissions explicitement
permissions:
  contents: read    # Lecture du code
  packages: write   # Push d'images
  pull-requests: write  # Commenter les PR
  # Tout le reste est implicitement refusé
```

### Épinglage des actions

```yaml
# ❌ Risque : le tag peut être écrasé
- uses: actions/checkout@v4

# ✅ Sécurisé : hash du commit exact
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
```

---

## 4. Branch Protection Rules

```
✅ Require pull request before merging
✅ Require status checks to pass (CI pipeline)
✅ Require review from Code Owners
✅ Require signed commits
✅ Do not allow bypassing the above settings
```

### Environment Protection Rules

```yaml
# Dans les settings du repo :
# Environment: production
# - Required reviewers: @team-lead, @devops
# - Wait timer: 30 minutes
# - Branch restrictions: main only
```

---

## 5. Scan de sécurité dans le pipeline

```yaml
- name: SAST - CodeQL
  uses: github/codeql-action/analyze@v3

- name: SCA - Dependency check
  run: npm audit --audit-level=high

- name: Secret scanning
  uses: trufflesecurity/trufflehog@main
  with:
    path: .
    extra_args: --only-verified
```

---

## Exercice pratique

Implémente les contrôles de sécurité d'un pipeline :
1. Validation de la configuration des secrets
2. Audit des permissions d'un workflow
3. Détection des patterns d'injection dans les workflows
4. Vérification de l'épinglage des actions

---

## Ressources

- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [OIDC with cloud providers](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments)
- [StepSecurity — Harden Runner](https://github.com/step-security/harden-runner)
