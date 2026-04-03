# Glossaire — CI/CD & DevOps

## A

**Artefact (Artifact)** : Fichier produit par un pipeline CI/CD (binaire compilé, image Docker, rapport de tests, bundle JS). Stocké temporairement ou dans un registre.

## B

**Blue-Green Deployment** : Stratégie de déploiement utilisant deux environnements identiques (blue = actif, green = nouveau). Le trafic bascule instantanément de blue vers green après validation.

**Build Matrix** : Configuration GitHub Actions qui exécute un job sur plusieurs combinaisons (OS, versions Node, etc.) en parallèle.

## C

**Canary Deployment** : Stratégie déployant la nouvelle version sur un petit pourcentage de trafic (ex: 5%) avant de l'étendre progressivement.

**CD (Continuous Delivery)** : Pratique où chaque changement est automatiquement testé et prêt à être déployé en production (déploiement manuel).

**CD (Continuous Deployment)** : Extension de Continuous Delivery où le déploiement en production est aussi automatique (aucune intervention humaine).

**CI (Continuous Integration)** : Pratique de merger fréquemment le code dans la branche principale avec compilation et tests automatiques.

**Composite Action** : Action GitHub Actions réutilisable composée de plusieurs steps, définie dans un fichier `action.yml`.

## D

**DORA Metrics** : Quatre métriques clés de performance DevOps : Deployment Frequency, Lead Time for Changes, Change Failure Rate, Time to Restore Service.

## E

**Environment Protection Rules** : Règles GitHub qui exigent des approbations ou conditions avant le déploiement vers un environnement spécifique.

## F

**Feature Flag** : Toggle dans le code permettant d'activer/désactiver une fonctionnalité sans redéployer. Utile pour les canary releases.

## G

**GitHub Actions** : Plateforme CI/CD intégrée à GitHub, basée sur des workflows YAML déclenchés par des événements (push, PR, schedule, etc.).

## I

**IaC (Infrastructure as Code)** : Gestion de l'infrastructure via des fichiers de configuration versionnés (Terraform, Pulumi, CloudFormation).

**Image Registry** : Service de stockage et distribution d'images Docker (Docker Hub, GitHub Container Registry, AWS ECR).

## J

**Job** : Unité d'exécution dans un workflow GitHub Actions. Un job contient des steps et s'exécute sur un runner.

## M

**Matrix Strategy** : Configuration qui multiplie un job par plusieurs paramètres (ex: tester sur Node 18, 20, 22 ET Ubuntu, macOS).

## O

**OIDC (OpenID Connect)** : Protocole utilisé par GitHub Actions pour s'authentifier auprès des cloud providers sans stocker de credentials long-terme.

## P

**Pipeline** : Séquence automatisée d'étapes (build, test, deploy) déclenchée par un événement de code.

**Preview Environment** : Environnement éphémère déployé automatiquement pour chaque pull request, permettant de tester les changements in situ.

## R

**Rolling Update** : Stratégie de déploiement remplaçant les instances progressivement (une par une ou par lot), maintenant la disponibilité.

**Runner** : Machine (physique ou VM) qui exécute les jobs GitHub Actions. Peut être hébergé par GitHub ou self-hosted.

## S

**Self-hosted Runner** : Runner GitHub Actions géré par l'équipe, installé sur leur propre infrastructure, offrant plus de contrôle et de puissance.

**Step** : Plus petite unité d'exécution dans un job GitHub Actions. Peut être une commande shell ou une action.

## W

**Workflow** : Fichier YAML définissant un processus automatisé dans GitHub Actions (`.github/workflows/*.yml`).

**Workflow Dispatch** : Déclenchement manuel d'un workflow via l'interface GitHub ou l'API, avec des paramètres d'entrée optionnels.
