---
titre: Infrastructure as Code — introduction (Terraform, state, plan/apply dans la CI)
cours: 15-cicd-devops
notions: ["déclaratif vs impératif", "Terraform HCL (provider, resource, variable, output)", "workflow init/plan/apply/destroy", "state file et son rôle", "state remote + locking (S3, HCP Terraform)", "drift et 'terraform plan' comme détecteur", "modules Terraform (réutilisation)", "OpenTofu (fork MPL de Terraform)", "Pulumi et CloudFormation en comparaison", "IaC dans le pipeline (plan sur PR, apply sur main)"]
outcomes:
  - sait expliquer la différence déclaratif vs impératif et pourquoi l'IaC est déclarative
  - sait écrire un module Terraform minimal (provider, resource, variable, output) en HCL
  - sait dérouler le workflow init/plan/apply/destroy et dire ce que fait chaque commande
  - sait expliquer le rôle du state, pourquoi il doit être remote et verrouillé en équipe, et ce qu'est le drift
  - sait intégrer Terraform dans un pipeline CI/CD (plan en PR, apply gardé sur main)
  - sait situer OpenTofu, Pulumi et CloudFormation par rapport à Terraform
prerequis: [notions des modules 00-08 (CI vs CD, workflow/jobs/steps, matrix/artefacts, environments et approvals, OIDC vers le cloud sans secret long terme)]
next: 10-monitoring-pipelines
libs: []
tribuzen: infrastructure de TribuZen provisionnée en IaC — le module Terraform tribuzen-infra (bucket statique du front, base managée) et son pipeline plan/apply dans .github/workflows/infra.yml
last-reviewed: 2026-07
---

# Infrastructure as Code — introduction

> **Outcomes — tu sauras FAIRE :** distinguer déclaratif et impératif, écrire un module Terraform minimal en HCL, dérouler le workflow `init/plan/apply/destroy`, expliquer le state (remote + locking) et le drift, et brancher un `plan` sur PR / `apply` sur `main` dans un pipeline.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module traite l'IaC **au niveau du pipeline CI/CD** — écrire un module simple et l'exécuter en CI. Le déploiement approfondi sur AWS (VPC, IAM fin, réseau, services managés) **et l'AWS CDK** sont le sujet du **cours 12 (cloud)** : on les défère. L'OIDC qui permet à Terraform de s'authentifier au cloud **sans secret long terme** a été vu au **module 08** — on le réutilise ici sans le réexpliquer. La sécurité applicative approfondie reste au **cours 14**.

## 1. Cas concret d'abord

L'infra de TribuZen a été montée « à la main » dans la console AWS : un collègue a cliqué pour créer le bucket S3 qui sert le front, la base de données managée, la distribution CDN. Ça marche. Puis, la semaine dernière, trois incidents en cascade :

```
Lundi    — On veut un environnement de staging identique à la prod.
           Personne ne se souvient de TOUS les clics faits en prod.
           Staging finit "presque pareil" → un bug n'apparaît qu'en prod.

Mercredi — Quelqu'un a changé à la main la politique du bucket pour "debug".
           Personne ne sait quoi exactement. Aucune trace, aucun diff.

Vendredi — La prod tombe. Il faut la recréer à l'identique en urgence.
           Combien de temps pour re-cliquer tout ça sans se tromper ? Inconnu.
```

Le problème commun : **l'infrastructure n'existe que dans la console**, pas dans un fichier versionné. Impossible de la reproduire, de la relire, de voir qui a changé quoi, de la recréer vite.

La réponse — l'**Infrastructure as Code (IaC)** — c'est décrire l'infra dans des fichiers texte versionnés dans Git, et laisser un outil la créer. Voici le bucket de TribuZen décrit en Terraform :

```hcl
# infra/main.tf — l'infra de TribuZen, versionnée dans Git
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "eu-west-3" # Paris
}

variable "environment" {
  type    = string
  default = "staging"
}

resource "aws_s3_bucket" "frontend" {
  bucket = "tribuzen-frontend-${var.environment}"
  tags = {
    Project     = "tribuzen"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

output "bucket_name" {
  value = aws_s3_bucket.frontend.bucket
}
```

Ce fichier **est** l'infra. On le relit en revue, on le versionne, on le rejoue pour créer staging **identique** à la prod, on voit dans `git log` qui a changé quoi. Les trois incidents ci-dessus deviennent : un diff, une PR, un `terraform apply`. Ce module te fait écrire ce fichier, comprendre le workflow qui le déploie, et le brancher dans un pipeline GitHub Actions.

---

## 2. Théorie complète, concise

### 2.1 Déclaratif vs impératif — le cœur de l'IaC

Deux façons de décrire une action sur l'infra :

- **Impératif** = tu écris les **étapes**. « Crée un bucket. Puis attache cette policy. Puis active le versioning. » C'est un script bash `aws s3api create-bucket ...`. Problème : si tu le relances, il **replante** (« le bucket existe déjà »). Tu dois gérer toi-même « et s'il existe déjà ? ».
- **Déclaratif** = tu décris l'**état désiré**. « Il DOIT exister un bucket nommé X avec ces tags. » L'outil compare cet état désiré à ce qui existe réellement et calcule tout seul les étapes à faire (créer, modifier, ou ne rien faire).

```hcl
# Déclaratif : je décris CE QUE JE VEUX, pas COMMENT le faire
resource "aws_s3_bucket" "frontend" {
  bucket = "tribuzen-frontend-staging"
}
# Terraform décide : le bucket existe déjà ? → rien à faire.
#                    absent ? → le créer. Différent ? → l'ajuster.
```

Conséquence directe : l'IaC déclarative est **idempotente**. Rejouer la même description produit le même résultat final, sans effet cumulatif. C'est ce qui rend l'infra reproductible. Terraform, Pulumi, CloudFormation sont tous déclaratifs.

### 2.2 Terraform et HCL — les briques

Terraform est l'outil IaC le plus répandu. On décrit l'infra en **HCL** (HashiCorp Configuration Language), un langage de configuration dédié. Quatre briques suffisent pour démarrer :

| Bloc | Rôle |
|---|---|
| `provider` | le « plugin » qui parle à une plateforme (AWS, GCP, Cloudflare, GitHub…). Un provider = un catalogue de ressources. |
| `resource` | un objet d'infra à gérer (un bucket, une base, un DNS…). C'est la brique centrale. |
| `variable` | une entrée paramétrable (l'environnement, une région) → réutiliser le même code pour staging et prod. |
| `output` | une valeur exposée après l'apply (le nom du bucket créé, une URL) → à afficher ou à passer à un autre module. |

```hcl
provider "aws" {
  region = "eu-west-3"
}

resource "aws_db_instance" "main" {
  identifier     = "tribuzen-db-${var.environment}"
  engine         = "postgres"
  instance_class = "db.t3.micro"
  # ...
}
```

Une **resource** a un type (`aws_db_instance`) et un nom local (`main`). On la référence ailleurs par `aws_db_instance.main.endpoint`. Ces références créent un **graphe de dépendances** : Terraform sait qu'il faut créer la base avant ce qui la référence. (Le détail des ressources AWS elles-mêmes = cours 12 ; ici, la mécanique Terraform.)

### 2.3 Le workflow `init / plan / apply / destroy`

Le cœur du travail Terraform tient en quatre commandes, dans cet ordre :

```bash
terraform init      # 1. télécharge les providers, prépare le dossier. Une fois au début.
terraform plan      # 2. calcule le DIFF entre l'état désiré (code) et le réel. Ne change RIEN.
terraform apply     # 3. applique le diff après confirmation. C'est la seule qui modifie l'infra.
terraform destroy   # 4. supprime tout ce que ce code gère. À manier avec précaution.
```

Le workflow officiel se résume à **write → plan → apply**, en boucle :

- `terraform plan` est ton filet de sécurité : il affiche `+ create`, `~ update`, `- destroy` **avant** de toucher quoi que ce soit. On le lit comme une revue de diff.
- `terraform apply` re-montre ce plan et demande `yes` avant d'agir. En CI, on l'auto-approuve avec `-auto-approve` (ou en appliquant un plan pré-calculé, §3).
- C'est une **boucle** : à chaque changement de code, on refait plan → apply.

```
Édite le .tf → terraform plan (lis le diff) → terraform apply (yes) → recommence
```

### 2.4 Le state — la mémoire de Terraform

Comment Terraform sait-il que le bucket existe déjà, pour ne pas le recréer ? Grâce au **state** : un fichier (`terraform.tfstate`, du JSON) qui **mappe** chaque `resource` du code à l'objet réel dans le cloud (son ID, ses attributs).

```
Code (.tf)  →   State (tfstate)   →   Réel (cloud)
"je veux         "aws_s3_bucket.frontend     bucket
 un bucket"       = bucket réel #abc123"      #abc123
```

À chaque `plan`, Terraform lit le state pour savoir ce qu'il gère déjà, puis compare aux trois : code désiré, state connu, réel observé. **Sans le state, Terraform ne saurait pas quelles ressources lui appartiennent** et recréerait tout.

Le state contient parfois des **valeurs sensibles** (mots de passe de base générés, clés). C'est un fichier à **protéger** et à **ne jamais commiter** dans Git.

### 2.5 State remote + locking — obligatoire en équipe et en CI

Par défaut, le state est **local** (`terraform.tfstate` sur ta machine). En équipe, c'est intenable : chacun a sa copie, elles divergent, deux `apply` simultanés se corrompent mutuellement.

Solution : le **state remote (backend)**. Le state vit dans un stockage partagé — **S3**, **HCP Terraform** (offre HashiCorp), Azure Blob, GCS. Tout le monde (et la CI) lit/écrit le **même** state.

```hcl
# backend.tf — le state vit dans S3, partagé par l'équipe et la CI
terraform {
  backend "s3" {
    bucket       = "tribuzen-tfstate"
    key          = "prod/terraform.tfstate"
    region       = "eu-west-3"
    use_lockfile = true   # verrou natif S3 (voir ci-dessous)
  }
}
```

Deuxième problème : deux `apply` en parallèle (deux devs, ou deux runs CI) sur le même state = corruption. D'où le **state locking** : avant d'écrire, Terraform pose un **verrou** ; un second run attend ou échoue proprement au lieu d'écraser.

> **⚠️ À jour 2026 (vérifié docs) :** le backend S3 gère désormais le verrou **nativement** via `use_lockfile = true` (lock natif S3 disponible depuis Terraform 1.10 ; l'ancienne table **DynamoDB** dédiée au lock est **dépréciée depuis 1.11**). HCP Terraform, lui, verrouille et met les runs en file d'attente automatiquement. Si tu lis un vieux tuto qui impose une table DynamoDB pour le lock, il est daté.

### 2.6 Le drift — quand le réel diverge du code

Le **drift** = l'infra réelle a changé **en dehors** de Terraform (un collègue a cliqué dans la console, un incident a modifié une règle). Le réel ne correspond plus ni au code ni au state.

`terraform plan` **est** le détecteur de drift : il compare le réel au désiré et te montre ce qui a bougé. Deux réactions possibles :

- **ré-appliquer** (`apply`) pour ramener le réel à ce que dit le code — le code fait autorité ;
- ou mettre à jour le code si le changement manuel était voulu.

Morale opérationnelle : dès qu'on adopte l'IaC, on arrête de cliquer dans la console. Toute modif passe par le code. Le drift signale une entorse à cette règle.

### 2.7 Modules — réutiliser un morceau d'infra

Un **module** Terraform est un dossier de `.tf` réutilisable et paramétré, appelé depuis un autre code. Même idée qu'une fonction : des `variable` en entrée, des `output` en sortie, la logique cachée dedans.

```hcl
# On appelle un module "static-site" deux fois, avec des paramètres différents
module "front_staging" {
  source      = "./modules/static-site"
  environment = "staging"
}

module "front_prod" {
  source      = "./modules/static-site"
  environment = "prod"
}
```

Le même module décrit staging **et** prod → ils sont garantis identiques, seuls les paramètres changent. C'est la réponse directe à l'incident du lundi (§1). Tout dossier Terraform est déjà un module (le « root module ») ; on en extrait des sous-modules quand un pattern se répète.

### 2.8 IaC dans le pipeline CI/CD — `plan` sur PR, `apply` sur `main`

L'IaC déploie tout son intérêt en CI : l'infra suit le **même flux que le code applicatif** (PR → revue → merge → déploiement). Le pattern standard :

- **Sur une Pull Request** : lancer `terraform plan` et **poster le diff** (create/update/destroy) comme feedback. On **relit l'infra comme du code**, avant tout changement. Aucun `apply`.
- **Sur `main` (après merge)** : lancer `terraform apply` pour matérialiser les changements validés, derrière un `environment` protégé (approbation — module 08).
- **Auth** : la CI s'authentifie au cloud via **OIDC** (module 08), pas de clé AWS long terme en secret.

```yaml
# .github/workflows/infra.yml — squelette (détaillé au §3)
on:
  pull_request:      # → plan seulement, on lit le diff
  push:
    branches: [main] # → apply, l'infra validée est appliquée
```

C'est exactement la même philosophie que le pipeline applicatif du cours : automatiser, tracer, garder un point de contrôle humain sur la prod.

### 2.9 Le paysage — OpenTofu, Pulumi, CloudFormation

Terraform n'est pas seul. Trois voisins à savoir situer (vérifié web 2026) :

| Outil | Langage | Portée | À retenir |
|---|---|---|---|
| **Terraform** | HCL | multi-cloud | le standard de fait. Licence **BSL** depuis août 2023 ; HashiCorp racheté par IBM en 2025. |
| **OpenTofu** | HCL (identique) | multi-cloud | **fork open source (MPL) de Terraform** né du changement de licence. Drop-in replacement : mêmes `.tf`, CLI `tofu`. En 2026, largement adopté, quelques features en propre (chiffrement du state, `for_each` sur provider). |
| **Pulumi** | TS / Python / Go / C#… | multi-cloud | IaC dans un **vrai langage** de prog (boucles, types, IDE). Séduisant pour des devs ; state géré par Pulumi Cloud ou backend au choix. |
| **CloudFormation** | YAML / JSON | **AWS only** | service **managé par AWS**, rollback automatique en cas d'échec. Pas de multi-cloud. L'AWS CDK (TypeScript) génère du CloudFormation → **cours 12**. |

> **⚠️ OpenTofu — l'état à connaître (vérifié 2026) :** suite au passage de Terraform sous licence **BSL** (2023), la communauté a forké Terraform en **OpenTofu**, sous licence open source **MPL 2.0**, gouverné par la Linux Foundation. Les fichiers `.tf` sont compatibles ; on remplace la commande `terraform` par `tofu`. Pour un choix neuf en 2026, OpenTofu est souvent le défaut « bas risque » côté licence, mais **tout ce que tu apprends ici (HCL, workflow, state, plan/apply) vaut à l'identique pour les deux**.

Pour ce cours, on reste sur **Terraform/HCL** : le workflow et les concepts sont transférables partout.

---

## 3. Worked examples

### Exemple 1 — un module Terraform minimal, de `init` à `destroy`

On écrit le bucket front de TribuZen, paramétré par environnement, avec un state remote verrouillé.

```hcl
# infra/main.tf
terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # State partagé + verrou natif S3 (plus besoin de DynamoDB)
  backend "s3" {
    bucket       = "tribuzen-tfstate"
    key          = "front/terraform.tfstate"
    region       = "eu-west-3"
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-west-3"
}

# Entrée paramétrable : le même code sert staging ET prod
variable "environment" {
  type        = string
  description = "Nom de l'environnement (staging, prod)"
}

# La ressource : le bucket qui sert le front
resource "aws_s3_bucket" "frontend" {
  bucket = "tribuzen-frontend-${var.environment}"
  tags = {
    Project     = "tribuzen"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Sortie exposée après apply : le nom réel du bucket créé
output "bucket_name" {
  value = aws_s3_bucket.frontend.bucket
}
```

Déroulé des commandes :

```bash
terraform init
#   télécharge le provider aws, configure le backend S3. À faire une fois.

terraform plan -var="environment=staging"
#   affiche le diff SANS rien changer :
#   Plan: 1 to add, 0 to change, 0 to destroy.
#     + aws_s3_bucket.frontend
#         bucket = "tribuzen-frontend-staging"

terraform apply -var="environment=staging"
#   re-montre le plan, demande "yes", puis crée réellement le bucket.
#   Outputs:  bucket_name = "tribuzen-frontend-staging"

# Plus tard, pour démonter l'environnement de staging :
terraform destroy -var="environment=staging"
#   Plan: 0 to add, 0 to change, 1 to destroy.  → "yes" supprime le bucket.
```

Points clés du déroulé : `init` une fois ; `plan` autant de fois qu'on veut (lecture seule) ; `apply` seul modifie ; `destroy` nettoie. Le state dans S3 fait que la CI, elle aussi, « voit » ce bucket comme déjà créé au run suivant.

### Exemple 2 — brancher Terraform dans le pipeline (plan sur PR, apply sur main)

On applique le pattern §2.8. `plan` en PR (diff en feedback), `apply` sur `main` derrière un environment protégé, auth par OIDC (module 08).

```yaml
# .github/workflows/infra.yml
name: Infra
on:
  pull_request:
    paths: ['infra/**']       # ne tourne que si l'infra change
  push:
    branches: [main]
    paths: ['infra/**']

permissions:
  id-token: write             # requis pour l'OIDC vers AWS (module 08)
  contents: read
  pull-requests: write        # pour poster le plan en commentaire de PR

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.AWS_TF_ROLE }}   # rôle assumé via OIDC, pas de clé long terme
          aws-region: eu-west-3
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
      - run: terraform plan -var="environment=prod" -out=tfplan
      # (option : poster le diff en commentaire de PR via une action dédiée)

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'   # apply UNIQUEMENT après merge sur main
    runs-on: ubuntu-latest
    environment: production                # approbation humaine (module 08)
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

Ce que ce pipeline garantit : sur une PR, on voit le **diff d'infra** sans rien changer ; le merge sur `main` déclenche l'`apply`, mais seulement après l'approbation de l'`environment` `production` ; aucune clé AWS statique ne traîne (OIDC). Le state S3 verrouillé empêche deux runs concurrents de se corrompre.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre `plan` et `apply`

`terraform plan` ne change **rien** : c'est une simulation, un diff. Seul `terraform apply` modifie l'infra. Croire que `plan` a déjà déployé (ou avoir peur de lancer `plan`) est l'erreur de départ. En CI, on met `plan` sur les PR **justement parce qu'il est inoffensif**.

### PIÈGE #2 — Commiter le `terraform.tfstate` dans Git

Le state est **local par défaut**, et beaucoup le committent « pour le partager ». Deux problèmes : (1) il contient des **secrets** (mots de passe générés) en clair ; (2) deux personnes qui pushent leur state s'écrasent → conflits ingérables. Le state se met dans un **backend remote** (S3, HCP), jamais dans Git. On `.gitignore` `*.tfstate`.

```
# ❌ dans le repo :  terraform.tfstate  (secrets exposés, conflits garantis)
# ✅ backend "s3" { ... use_lockfile = true }  → state partagé et verrouillé
```

### PIÈGE #3 — Croire que Terraform « scanne » le cloud

Terraform ne découvre pas l'infra existante : il ne connaît **que ce qui est dans son state**. Un bucket créé à la main dans la console lui est **invisible** — il tentera de créer un bucket du même nom et échouera (ou faudra un `terraform import`). D'où la règle : une fois en IaC, on ne clique plus dans la console.

### PIÈGE #4 — Ignorer le drift

Modifier une ressource « juste pour tester » dans la console crée du **drift** : le réel diverge du code. Au prochain `apply` de quelqu'un d'autre, Terraform **annule** ta modif (le code fait autorité) — surprise garantie. Le `plan` régulier en CI sert justement à détecter le drift tôt.

### PIÈGE #5 — Confondre déclaratif (Terraform) et impératif (script)

Un script bash `aws s3 mb ...` est **impératif** : relancé, il replante (« existe déjà »). Terraform est **déclaratif/idempotent** : relancé sur un état déjà atteint, il dit « rien à faire ». Écrire du Terraform comme une suite d'étapes à exécuter dans l'ordre, c'est passer à côté du modèle.

### PIÈGE #6 — Oublier le state locking et corrompre le state

Deux `apply` simultanés sur le **même** state sans verrou = state corrompu, ressources dupliquées ou orphelines. En équipe/CI, le **locking** (natif S3 via `use_lockfile`, ou HCP) est non négociable. Sans lui, ça marche à un seul utilisateur puis casse dès qu'on est deux.

### PIÈGE #7 — Croire qu'OpenTofu est un outil « différent » à réapprendre

OpenTofu est un **fork** de Terraform : même HCL, même workflow, même notion de state. On remplace `terraform` par `tofu`, c'est tout pour l'essentiel. Le débat Terraform/OpenTofu est un choix de **licence et gouvernance**, pas un changement de compétence. Ce que tu apprends ici vaut pour les deux.

---

## 5. Ancrage TribuZen

Le fil-rouge du cours est le **pipeline CI/CD de TribuZen**. Ce module ajoute la couche **infrastructure** : au lieu de cliquer dans la console, l'infra de TribuZen est décrite en Terraform et déployée par le pipeline.

- **`infra/main.tf`** — le module racine : bucket S3 du front (`tribuzen-frontend-<env>`), paramétré par `variable "environment"`, `output "bucket_name"` (Exemple 1). Un jour, la base Postgres managée s'y ajoutera (détail cloud = cours 12).
- **`infra/backend.tf`** — state dans S3 (`tribuzen-tfstate`) avec `use_lockfile = true` : la CI et l'équipe partagent le même state verrouillé.
- **`.github/workflows/infra.yml`** — `plan` sur chaque PR touchant `infra/**` (diff en revue), `apply` sur `main` derrière l'`environment` `production`, auth OIDC vers AWS (module 08) — aucune clé long terme (Exemple 2).

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  infra/
    main.tf              ← Exemple 1 (provider, resource, variable, output)
    backend.tf           ← state S3 + use_lockfile
    modules/
      static-site/       ← module réutilisé pour staging ET prod (§2.7)
  .github/
    workflows/
      infra.yml          ← Exemple 2 (plan PR / apply main, OIDC)
```

> Le **détail des ressources AWS** (VPC, IAM, RDS finement configuré) et l'**AWS CDK** relèvent du **cours 12 (cloud)**. Ici, on tient la mécanique Terraform + son intégration CI/CD. Le prochain module (10) mesure la **santé du pipeline** lui-même (métriques DORA, alerting sur échec).

---

## 6. Points clés

1. **Déclaratif** = décrire l'état désiré (idempotent), pas les étapes (impératif). L'IaC déclarative rend l'infra reproductible, versionnée, relisible.
2. **HCL/Terraform** repose sur `provider` (accès à une plateforme), `resource` (objet géré), `variable` (entrée), `output` (sortie).
3. **Workflow** : `init` (une fois) → `plan` (diff, ne change rien) → `apply` (seul à modifier) → `destroy` (supprime). Boucle write → plan → apply.
4. Le **state** mappe code ↔ réel ; sans lui Terraform ne sait pas ce qu'il gère. Il contient des secrets → jamais dans Git.
5. **State remote + locking** (S3 avec `use_lockfile`, ou HCP Terraform) est obligatoire en équipe et en CI ; DynamoDB pour le lock est déprécié (2026).
6. **Drift** = le réel a divergé du code (clic manuel) ; `terraform plan` le détecte ; le code fait autorité.
7. Un **module** = dossier `.tf` paramétré et réutilisable → staging et prod garantis identiques.
8. **En CI** : `plan` sur PR (diff en feedback), `apply` sur `main` derrière un environment protégé, auth OIDC (pas de clé long terme).
9. **Voisins** : OpenTofu (fork MPL, HCL identique, CLI `tofu`), Pulumi (vrai langage, multi-cloud), CloudFormation (AWS only, managé). L'AWS CDK → cours 12.

---

## 7. Seeds Anki

```
Déclaratif vs impératif en IaC ?|Impératif = on écrit les étapes (crée, puis attache…) et un rerun replante. Déclaratif = on décrit l'état désiré ; l'outil calcule le diff et n'agit que si nécessaire (idempotent). Terraform est déclaratif.
Que font terraform init / plan / apply / destroy ?|init : télécharge providers + configure le backend (une fois). plan : calcule le diff sans rien changer. apply : applique le diff (seule commande qui modifie). destroy : supprime les ressources gérées.
À quoi sert le state Terraform ?|Il mappe chaque resource du code à l'objet réel dans le cloud (ID, attributs). Sans state, Terraform ne sait pas ce qu'il gère et recréerait tout. Il contient des secrets → jamais commité dans Git.
Pourquoi un state remote + locking en équipe/CI ?|Remote (S3, HCP) = un seul state partagé au lieu de copies locales qui divergent. Locking = un verrou empêche deux apply simultanés de corrompre le state. En 2026 : use_lockfile natif S3 ; DynamoDB pour le lock est déprécié.
Qu'est-ce que le drift et comment le détecter ?|Le drift = l'infra réelle a changé hors Terraform (clic dans la console). terraform plan le détecte en comparant réel vs code. Le code fait autorité : un apply ré-aligne le réel.
Comment intègre-t-on Terraform dans un pipeline CI/CD ?|plan sur les Pull Requests (on lit le diff, rien n'est changé) ; apply sur main après merge, derrière un environment protégé (approbation) ; auth au cloud par OIDC (pas de clé long terme).
Qu'est-ce qu'un module Terraform ?|Un dossier de .tf paramétré (variables en entrée, outputs en sortie) et réutilisable, appelé via un bloc module. Permet de décrire staging et prod avec le même code → environnements garantis identiques.
Terraform vs OpenTofu ?|OpenTofu est un fork open source (MPL 2.0) de Terraform, né du passage de Terraform sous licence BSL en 2023. Même HCL, même workflow, même state ; on remplace la CLI terraform par tofu. Choix de licence/gouvernance, pas de compétence.
Terraform vs Pulumi vs CloudFormation ?|Terraform : HCL, multi-cloud, standard. Pulumi : vrai langage (TS/Python/Go), multi-cloud. CloudFormation : YAML/JSON, AWS only, service managé avec rollback auto. L'AWS CDK génère du CloudFormation (cours 12).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-09-iac-introduction/README.md`. Écrire un module Terraform minimal (provider, resource, variable, output) puis l'intégrer dans un workflow GitHub Actions (`plan` sur PR, `apply` sur `main`) — vrai HCL + vrai YAML, corrigé commenté intégral, feedback coach en session.
