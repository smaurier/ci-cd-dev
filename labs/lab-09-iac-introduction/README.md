# Lab 09 — Infrastructure as Code (Terraform + CI)

> **Outcome :** à la fin, tu sais écrire un module Terraform minimal (provider, resource, variable, output) et l'intégrer dans un workflow GitHub Actions qui fait `plan` sur les Pull Requests et `apply` sur `main`.
> **Vrai outil :** Terraform (HCL réel) + GitHub Actions (YAML réel). Aucun harnais simulé.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur. L'oracle réel est `terraform validate` / `terraform plan` sur ton poste.

---

## Énoncé

Tu provisionnes le début de l'infra de TribuZen **en code** au lieu de la console. Objectif : un module Terraform qui crée le bucket S3 servant le front, paramétré par environnement, avec son state partagé et verrouillé, puis un pipeline qui le déploie proprement.

Cahier des charges **exact** :

1. Écrire `infra/main.tf` avec :
   - un bloc `terraform { required_providers { aws = ... } }` ;
   - un `provider "aws"` en région `eu-west-3` ;
   - une `variable "environment"` (type `string`, **sans default** — on veut forcer le choix) ;
   - une `resource "aws_s3_bucket" "frontend"` nommée `tribuzen-frontend-<environment>`, avec des `tags` (`Project`, `Environment`, `ManagedBy = "terraform"`) ;
   - un `output "bucket_name"` exposant le nom du bucket créé.
2. Écrire `infra/backend.tf` : state dans un backend **S3** (`bucket = "tribuzen-tfstate"`, `key = "front/terraform.tfstate"`, `region = "eu-west-3"`) avec **verrou natif** `use_lockfile = true`.
3. Écrire `.github/workflows/infra.yml` :
   - `plan` sur **chaque PR** touchant `infra/**` (rien n'est appliqué) ;
   - `apply` sur **`main`** uniquement, derrière un `environment: production`, auth par **OIDC** (pas de clé AWS long terme).

> **⚠️ Tu ne déploies rien pour de vrai** (pas de compte AWS requis). L'objectif est d'écrire du HCL et du YAML corrects et de les faire passer `terraform init -backend=false` + `terraform validate`. Si tu as un compte AWS de test, tu peux aller jusqu'au `plan`.

**Pas de gap-fill** — tu écris les trois fichiers à partir du starter minimal ci-dessous.

### Starter minimal

```
infra/
  main.tf        # à écrire
  backend.tf     # à écrire
.github/
  workflows/
    infra.yml    # à écrire
```

```hcl
# infra/main.tf — starter
terraform {
  required_providers {
    # à compléter : source hashicorp/aws, version ~> 5.0
  }
}

# provider, variable, resource, output : à toi de les écrire
```

Vérifie localement avec :

```bash
cd infra
terraform init -backend=false   # -backend=false : pas besoin d'un vrai bucket S3 pour valider
terraform validate              # doit répondre "Success! The configuration is valid."
terraform fmt -check            # style HCL canonique
```

---

## Étapes (en friction)

1. **Déclare le provider** — bloc `terraform { required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } } }`, puis `provider "aws" { region = "eu-west-3" }`.
2. **Déclare la variable** — `variable "environment"` de type `string`, sans `default`, avec une `description`.
3. **Écris la resource** — `aws_s3_bucket` nommée avec `"tribuzen-frontend-${var.environment}"` (interpolation), plus le bloc `tags`.
4. **Expose l'output** — `output "bucket_name"` qui pointe sur `aws_s3_bucket.frontend.bucket`.
5. **Configure le backend** — `backend.tf` avec `backend "s3"` et `use_lockfile = true` (pas de DynamoDB : c'est déprécié en 2026).
6. **Valide le HCL** — `terraform init -backend=false && terraform validate && terraform fmt -check`. Corrige jusqu'au vert.
7. **Écris le workflow** — deux jobs : `plan` (sur `pull_request` + `push` main) et `apply` (gardé par `if: github.ref == 'refs/heads/main'`, `environment: production`, `needs: plan`).
8. **Vérifie les gardes** — relis : le job `apply` ne peut **jamais** partir depuis une PR ; les `permissions: id-token: write` sont présentes pour l'OIDC.

---

## Corrigé complet commenté

**`infra/main.tf`**

```hcl
terraform {
  required_version = ">= 1.11"           # use_lockfile est stable depuis 1.11
  required_providers {
    aws = {
      source  = "hashicorp/aws"          # provider officiel AWS
      version = "~> 5.0"                  # ~> 5.0 = >= 5.0 et < 6.0 (pinning souple)
    }
  }
}

provider "aws" {
  region = "eu-west-3"                    # Paris
}

# Entrée paramétrable, SANS default : Terraform exigera -var="environment=..."
# → impossible de créer un bucket "sans environnement" par erreur.
variable "environment" {
  type        = string
  description = "Nom de l'environnement (staging, prod)"
}

# La ressource gérée : un bucket S3. Type = aws_s3_bucket, nom local = frontend.
# On le référence ailleurs par aws_s3_bucket.frontend.<attribut>.
resource "aws_s3_bucket" "frontend" {
  # Interpolation ${...} : le nom dépend de la variable → un bucket par env.
  bucket = "tribuzen-frontend-${var.environment}"

  tags = {
    Project     = "tribuzen"
    Environment = var.environment
    ManagedBy   = "terraform"            # signale : ne PAS modifier à la main
  }
}

# Sortie affichée après apply et réutilisable par un autre module/pipeline.
output "bucket_name" {
  value = aws_s3_bucket.frontend.bucket
}
```

**`infra/backend.tf`**

```hcl
terraform {
  # State partagé dans S3 : la CI et l'équipe lisent/écrivent le MÊME state.
  backend "s3" {
    bucket       = "tribuzen-tfstate"
    key          = "front/terraform.tfstate"  # chemin du state dans le bucket
    region       = "eu-west-3"
    use_lockfile = true                        # verrou NATIF S3 (stable depuis TF 1.11)
    # ⚠️ Pas de dynamodb_table : le lock DynamoDB est déprécié en 2026.
  }
}
```

**`.github/workflows/infra.yml`**

```yaml
name: Infra
on:
  pull_request:
    paths: ['infra/**']        # ne se déclenche que si l'infra change
  push:
    branches: [main]
    paths: ['infra/**']

# Permissions minimales requises :
permissions:
  id-token: write              # OIDC : obtenir un token pour assumer un rôle AWS
  contents: read               # checkout du code
  pull-requests: write         # (option) poster le plan en commentaire de PR

jobs:
  # Job 1 — PLAN : tourne sur PR ET sur main. Ne change RIEN (diff seulement).
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra   # toutes les commandes tournent dans infra/
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.AWS_TF_ROLE }}  # rôle assumé via OIDC, pas de clé statique
          aws-region: eu-west-3
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
      - run: terraform plan -var="environment=prod" -out=tfplan

  # Job 2 — APPLY : UNIQUEMENT sur main, après plan, derrière une approbation.
  apply:
    needs: plan                                    # attend que plan réussisse
    if: github.ref == 'refs/heads/main'            # jamais depuis une PR
    runs-on: ubuntu-latest
    environment: production                        # met le job en pause → approbation humaine (module 08)
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.AWS_TF_ROLE }}
          aws-region: eu-west-3
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
      - run: terraform apply -auto-approve -var="environment=prod"
```

**Pourquoi ce corrigé est correct :**
- La `variable "environment"` **sans default** force un choix explicite → pas de bucket créé « par accident » avec un nom vide.
- Le state est en **S3 + `use_lockfile`** : partagé et verrouillé, sans la table DynamoDB (dépréciée en 2026). Aucun `.tfstate` n'est commité.
- Le job `apply` a **trois gardes** cumulées : `needs: plan` (plan doit passer), `if: github.ref == 'refs/heads/main'` (jamais depuis une PR), `environment: production` (approbation humaine). C'est le point de contrôle du Continuous Delivery.
- L'auth passe par **OIDC** (`id-token: write` + `configure-aws-credentials` avec `role-to-assume`) : aucune clé AWS long terme en secret (module 08).
- `plan` tourne sur PR **et** main, mais ne modifie rien → on lit le diff d'infra avant tout `apply`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées :**

Reproduis les trois fichiers **de mémoire, en 30 minutes**, sans rouvrir ce corrigé ni le module 09, avec ces modifications :

1. **Extrais un module** `infra/modules/static-site/` (avec la resource `aws_s3_bucket` + sa variable + son output) et **appelle-le deux fois** depuis `infra/main.tf` : une fois `environment = "staging"`, une fois `environment = "prod"`.
2. Ajoute un **second output** au niveau racine : `staging_bucket` et `prod_bucket`, chacun pointant sur l'output du module correspondant.
3. **Critère de réussite :** `terraform init -backend=false && terraform validate` répond « valid », et `terraform fmt -check` ne signale rien.

**Piège à éviter de mémoire :** un module s'appelle avec un bloc `module "..." { source = "./modules/static-site" ... }`, et on lit sa sortie via `module.front_staging.bucket_name` (pas `aws_s3_bucket...` — la ressource est encapsulée).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, l'infra vit ici :

```
tribuzen/
  infra/
    main.tf
    backend.tf
    modules/
      static-site/          ← module réutilisé staging/prod (variante J+30)
  .github/
    workflows/
      infra.yml
```

**Différences par rapport au lab :**

- Le bucket `tribuzen-tfstate` et le rôle IAM OIDC (`AWS_TF_ROLE`) existent réellement — provisionnés une seule fois (bootstrap), en dehors de ce module (le state ne peut pas se stocker dans un bucket qu'il gère lui-même).
- La resource `aws_s3_bucket` s'accompagnera en vrai d'un `aws_s3_bucket_policy`, du `versioning`, et de la distribution CDN — **détail AWS = cours 12**. Ici on tient la mécanique Terraform.
- Le job `plan` postera le diff en **commentaire de PR** (action dédiée) pour que la revue d'infra soit visible sans ouvrir les logs.

**Commit cible :**
```
feat(infra): module Terraform bucket front + pipeline plan(PR)/apply(main) OIDC
```
