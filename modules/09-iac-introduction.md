# Module 9 — Introduction à l'Infrastructure as Code (IaC)

## Objectifs pédagogiques

- Comprendre les principes de l'Infrastructure as Code
- Connaître les outils majeurs (Terraform, Pulumi, CloudFormation)
- Provisionner des ressources cloud de façon déclarative
- Intégrer l'IaC dans les pipelines CI/CD
- Gérer les environnements avec l'IaC

---

## 1. Pourquoi l'IaC ?

### Le problème

```
Développeur : "Mon app fonctionne en local"
Ops : "J'ai configuré le serveur manuellement"
Production : "Ça ne marche pas, la config est différente 🤷"
```

### La solution

```
Infrastructure décrite dans des fichiers versionnés
→ Reproductible, auditable, testable, réversible
```

### Principes

| Principe | Description |
|---|---|
| Déclaratif | Décrire l'état désiré, pas les étapes |
| Versionné | L'infra est dans Git, avec historique |
| Idempotent | Réappliquer produit le même résultat |
| Immutable | Remplacer plutôt que modifier |

---

## 2. Terraform — Les bases

### Structure

```hcl
# main.tf
provider "aws" {
  region = "eu-west-1"
}

resource "aws_s3_bucket" "frontend" {
  bucket = "myapp-frontend-${var.environment}"
  
  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "S3Origin"
  }
  # ...
}
```

### Workflow

```bash
terraform init      # Initialiser les providers
terraform plan      # Prévisualiser les changements
terraform apply     # Appliquer les changements
terraform destroy   # Supprimer les ressources
```

---

## 3. IaC dans le CI/CD

### Pipeline Terraform

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
      - run: terraform plan -out=tfplan
      - uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: tfplan

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    environment: production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - uses: actions/download-artifact@v4
        with:
          name: tfplan
      - run: terraform init
      - run: terraform apply tfplan
```

---

## 4. Alternatives à Terraform

### Pulumi (TypeScript)

```typescript
import * as aws from '@pulumi/aws';

const bucket = new aws.s3.Bucket('frontend', {
  website: { indexDocument: 'index.html' },
  tags: { Environment: 'production' },
});

export const bucketUrl = bucket.websiteEndpoint;
```

### AWS CDK (TypeScript)

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id);
    new s3.Bucket(this, 'Frontend', {
      websiteIndexDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
```

---

## 5. Comparaison

| Critère | Terraform | Pulumi | AWS CDK |
|---|---|---|---|
| Langage | HCL | TypeScript, Python, Go | TypeScript, Python |
| Multi-cloud | ✅ | ✅ | ❌ (AWS only) |
| State | Remote (S3, Terraform Cloud) | Pulumi Cloud | CloudFormation |
| Courbe | Moyenne | Facile pour devs | Facile pour devs AWS |

---

## Exercice pratique

Modélise en TypeScript une infrastructure déclarative :
1. Parsing de fichiers de configuration IaC
2. Calcul du plan de changements (diff)
3. Résolution des dépendances entre ressources
4. Ordonnancement de la création/mise à jour/suppression

---

## Ressources

- [Terraform Documentation](https://developer.hashicorp.com/terraform/docs)
- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [AWS CDK Workshop](https://cdkworkshop.com/)
