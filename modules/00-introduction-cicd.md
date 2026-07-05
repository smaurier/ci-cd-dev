---
titre: Introduction au CI/CD
cours: 15-cicd-devops
notions: ["CI (intégration continue)", "CD (continuous delivery)", "déploiement continu (continuous deployment)", "boucle de feedback", "anatomie d'un pipeline", "culture DevOps", "coût du déploiement manuel"]
outcomes:
  - sait distinguer CI, continuous delivery et continuous deployment sans les confondre
  - sait expliquer pourquoi automatiser (boucle de feedback, coût d'un déploiement manuel)
  - sait décrire l'anatomie d'un pipeline (source, build, test, package, deploy)
  - sait cartographier les étapes manuelles d'un projet et lesquelles automatiser en premier
prerequis: []
next: 01-github-actions-fondamentaux
libs: []
tribuzen: pipeline CI/CD de TribuZen — le déploiement manuel qui casse en production, point de départ du fil-rouge DevOps
last-reviewed: 2026-07
---

# Introduction au CI/CD

> **Outcomes — tu sauras FAIRE :** distinguer CI / continuous delivery / continuous deployment, expliquer pourquoi automatiser, décrire l'anatomie d'un pipeline, cartographier les étapes manuelles à automatiser.
> **Difficulté :** :star:
>
> **Portée :** ce module est **conceptuel**. On pose le vocabulaire et la carte mentale du CI/CD. L'écriture concrète de workflows GitHub Actions commence au **module 01**. Les stratégies de déploiement (blue-green, canary) sont au **module 06**, les métriques DORA détaillées au **module 10**.

## 1. Cas concret d'abord

Vendredi 17h. TribuZen est en production depuis trois semaines. Tu as corrigé un bug d'affichage sur `FamilyCard.vue` et tu veux le mettre en ligne. Voici ta procédure actuelle, celle que tu fais **à la main** :

```bash
# Le déploiement manuel de TribuZen — tel qu'il existe aujourd'hui
git pull origin main
pnpm install
pnpm build                      # tu OUBLIES de lancer les tests avant
scp -r dist/ user@serveur:/var/www/tribuzen   # copie manuelle
ssh user@serveur "sudo systemctl restart tribuzen"
```

Sauf que ce vendredi :
- Tu as oublié de lancer `pnpm test`. Un test cassé serait passé inaperçu.
- `pnpm build` a produit un bundle, mais tu avais une variable d'environnement manquante en local — le build "marche chez toi".
- Le `scp` a copié `dist/` **par-dessus** l'ancienne version : pas de retour arrière possible si ça casse.
- À 17h05, un utilisateur signale que la page famille est **blanche**. Tu es seul à savoir déployer. Le rollback consiste à retrouver l'ancien `dist/` que… tu n'as pas gardé.

**Chaque problème ici a un nom et une solution automatisable :**

1. Tests oubliés → un **pipeline** les lance systématiquement, à chaque push.
2. « Ça marche chez moi » → un **build reproductible** sur une machine propre (le runner CI).
3. Copie destructive sans retour arrière → un **artefact versionné** + une stratégie de déploiement réversible.
4. Une seule personne sait déployer → le déploiement devient **du code**, lisible et rejouable par tout le monde.

Ce module te donne le vocabulaire pour nommer chacun de ces besoins. Tout le cours 15 consiste ensuite à automatiser ce déploiement manuel de TribuZen, étape par étape.

---

## 2. Théorie complète, concise

### 2.1 Le problème : le coût du déploiement manuel

Un déploiement manuel n'est pas seulement lent, il est **non fiable** et **non répétable**. Trois coûts cachés :

- **Coût cognitif** : tu dois te souvenir de l'ordre des étapes. Une étape oubliée = un incident.
- **Coût du bus factor** : si une seule personne sait déployer, l'équipe est bloquée dès qu'elle est absente.
- **Coût du feedback tardif** : sans automatisation, un bug introduit lundi peut n'être découvert qu'au déploiement du vendredi. Plus la découverte est tardive, plus la correction est chère.

L'automatisation transforme un processus tribal (« demande à Sylvain, il sait ») en un processus **écrit, versionné, exécutable par une machine**.

### 2.2 CI — Intégration continue (Continuous Integration)

La **CI** est la pratique d'**intégrer fréquemment** le travail de chaque développeur dans une branche partagée, avec une **vérification automatique à chaque intégration** : build + tests + lint.

L'idée fondatrice : plutôt que de laisser diverger des branches pendant des semaines (« merge hell »), on merge souvent (idéalement plusieurs fois par jour) et une machine vérifie **immédiatement** que l'ensemble tient encore debout.

La CI répond à la question : **« est-ce que le code, une fois intégré, est encore sain ? »** Elle s'arrête à la validation. Elle ne déploie rien.

### 2.3 CD #1 — Livraison continue (Continuous Delivery)

La **continuous delivery** prolonge la CI : après validation, chaque changement est **automatiquement rendu déployable**. Un artefact prêt pour la production est produit et stocké. Mais la **mise en production reste déclenchée par un humain** — un clic sur un bouton « Deploy ».

Formule clé : *toujours dans un état déployable, déployé sur décision humaine.*

### 2.4 CD #2 — Déploiement continu (Continuous Deployment)

Le **déploiement continu** va un cran plus loin : **il n'y a plus de bouton**. Tout changement qui passe la CI part **automatiquement en production**, sans intervention humaine.

C'est le même sigle « CD » que continuous delivery, d'où la confusion permanente. La différence tient en **une seule question** : *y a-t-il une porte manuelle avant la production ?*
- Continuous **delivery** → oui, un humain approuve.
- Continuous **deployment** → non, tout est automatique.

Le déploiement continu exige une confiance très élevée dans les tests, car plus rien ne rattrape une erreur avant l'utilisateur.

### 2.5 La boucle de feedback

Le fil conducteur de tout le CI/CD est la **boucle de feedback** : le temps entre « j'écris un changement » et « je sais s'il est bon ».

```
écrire → intégrer → vérifier (build/test) → livrer → observer → écrire…
   ▲                                                              │
   └──────────────── plus la boucle est courte, ─────────────────┘
                       moins un bug coûte cher
```

Un bug détecté **10 secondes après le commit** (échec CI) coûte une correction triviale : le contexte est frais, le changement est petit. Le même bug détecté **trois semaines plus tard en production** coûte : investigation, reproduction, hotfix, communication, parfois rollback. **Automatiser, c'est raccourcir cette boucle.**

### 2.6 Anatomie d'un pipeline

Un **pipeline** est la suite d'étapes automatiques déclenchées par un événement (typiquement un `push` ou une pull request). Les étapes canoniques :

| Étape | Rôle | Exemple TribuZen |
|-------|------|------------------|
| **Source** | Récupérer le code au bon commit | checkout de `main` |
| **Build** | Compiler / bundler sur machine propre | `pnpm build` du front Vue |
| **Test** | Vérifier (unit, lint, types) | `pnpm test`, `vue-tsc` |
| **Package** | Produire un artefact figé et versionné | image Docker `tribuzen:sha` |
| **Deploy** | Mettre l'artefact en service | push vers le serveur / cloud |

Un pipeline minimal en GitHub Actions ressemble à ceci (détaillé au module 01) :

```yaml
name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6   # étape Source
      - run: pnpm install           # dépendances
      - run: pnpm build             # étape Build
      - run: pnpm test              # étape Test
```

Trois propriétés rendent un pipeline fiable :
- **Reproductibilité** : le même commit produit le même artefact (machine propre, dépendances figées via lockfile).
- **Isolation** : chaque exécution part d'un environnement neuf, indépendant de « ta machine ».
- **Idempotence du déploiement** : rejouer le déploiement d'un artefact donné ne change pas le résultat.

### 2.7 La culture DevOps

« DevOps » n'est pas un outil, c'est une **culture** : casser le mur entre ceux qui écrivent le code (Dev) et ceux qui l'exploitent (Ops). Le CI/CD en est le bras armé technique.

Trois principes portants :
- **« You build it, you run it »** : l'équipe qui écrit une fonctionnalité est responsable de son bon fonctionnement en production.
- **Tout est du code** : pipeline, infrastructure (module 09), configuration — versionnés dans Git, revus en pull request.
- **Culture sans blâme** (blameless) : un incident interroge le **processus** (« pourquoi le pipeline ne l'a pas attrapé ? »), pas la personne. C'est ce qui permet de déployer souvent sans peur.

---

## 3. Worked examples

### Exemple 1 — Ranger un déploiement manuel dans l'anatomie du pipeline

Reprenons la procédure manuelle de TribuZen du §1 et étiquetons chaque commande avec son étape de pipeline. C'est l'exercice mental qui précède toute automatisation.

```bash
git pull origin main                        # → SOURCE  (récupérer le bon commit)
pnpm install                                # → BUILD   (dépendances)
pnpm build                                  # → BUILD   (bundler)
# (rien ici)                                # → TEST    ❌ ÉTAPE MANQUANTE
scp -r dist/ user@serveur:/var/www/tribuzen # → PACKAGE + DEPLOY confondus, destructif
ssh user@serveur "systemctl restart …"      # → DEPLOY  (activation)
```

**Lecture du diagnostic :**
- L'étape **Test** est purement absente → première chose à automatiser, elle a le meilleur rapport valeur/effort.
- **Package** et **Deploy** sont fusionnés dans un `scp` destructif → il n'existe aucun artefact versionné qu'on pourrait redéployer. Introduire un artefact (module 05) rend le rollback possible.
- La **Source** dépend de l'état local de ta machine (`git pull`), pas d'un environnement propre → « ça marche chez moi » latent.

Conclusion : on n'automatise pas tout d'un coup. On commence par **la CI (build + test sur machine propre)**, qui supprime déjà les deux plus gros risques.

### Exemple 2 — Classer trois scénarios : CI, delivery ou deployment ?

Pour chaque équipe, identifie le niveau d'automatisation. La question discriminante est toujours : *jusqu'où l'automatisation va-t-elle ?*

**Équipe A** — « À chaque PR, un robot lance les tests et le lint. Si c'est vert, on peut merger. Le déploiement, c'est Sarah qui le fait à la main le jeudi. »
→ **CI seulement.** L'automatisation s'arrête à la validation ; le déploiement reste 100 % manuel.

**Équipe B** — « Chaque merge sur `main` construit une image Docker prête pour la prod et la stocke. Un lead clique sur "Promote to production" quand il le décide. »
→ **Continuous delivery.** L'artefact déployable est produit automatiquement, mais un humain déclenche la mise en production.

**Équipe C** — « Chaque merge sur `main` qui passe les tests part directement en production, sans que personne ne clique. »
→ **Continuous deployment.** Aucune porte manuelle entre le merge et la production.

Note que A, B et C forment une **échelle de maturité** : on ne saute pas à C sans avoir d'abord une CI solide (A) et une chaîne de livraison fiable (B).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « CD » désigne une seule chose

Le sigle **CD** recouvre **deux** pratiques distinctes : continuous **delivery** (bouton manuel avant la prod) et continuous **deployment** (aucun bouton). Les confondre fausse toute discussion d'équipe. Le test qui tranche : **« y a-t-il une approbation humaine avant la production ? »** Oui = delivery, non = deployment.

### PIÈGE #2 — « CI/CD = déployer en production automatiquement »

Beaucoup pensent que faire de la CI implique de déployer automatiquement. Faux : la **CI seule ne déploie rien**. Elle valide l'intégration (build + test). Le déploiement est une brique **au-dessus** de la CI. Une équipe peut avoir une excellente CI et déployer entièrement à la main — c'est même une étape normale de la progression.

### PIÈGE #3 — Confondre CI/CD (la pratique) et GitHub Actions (l'outil)

GitHub Actions, GitLab CI, Jenkins ou CircleCI sont des **exécuteurs de pipelines**. Le CI/CD est la **pratique** qu'ils outillent. On peut faire du CI/CD avec n'importe lequel, et changer d'outil sans changer de pratique. Ce cours utilise GitHub Actions comme support concret, mais les concepts sont transférables.

### PIÈGE #4 — « Automatiser, c'est écrire un script bash de déploiement »

Un `deploy.sh` lancé à la main n'est pas du CI/CD : il n'est ni **déclenché par un événement**, ni exécuté dans un **environnement isolé et reproductible**, ni **observable** par l'équipe. Le CI/CD, c'est l'automatisation *déclenchée, isolée, versionnée et visible* — pas juste « un script qui existe quelque part ».

### PIÈGE #5 — Croire que « DevOps » est un poste ou un outil

« On a embauché un DevOps » ou « on a acheté un outil DevOps » ratent le point. DevOps est une **culture** de responsabilité partagée entre Dev et Ops, dont le CI/CD est l'instrument. Un outil ne crée pas la culture ; il la rend possible.

---

## 5. Ancrage TribuZen

Le fil-rouge de tout le cours 15 est **l'automatisation du déploiement de TribuZen**, en partant exactement de la procédure manuelle du §1.

État de départ (aujourd'hui) :
```
Déploiement TribuZen = procédure manuelle dans la tête de Sylvain
  git pull → pnpm build → scp dist/ → ssh restart
  ❌ pas de tests automatiques   ❌ pas d'artefact   ❌ pas de rollback   ❌ bus factor = 1
```

Ce que le cours construira, module après module, dans `smaurier/tribuzen` :
```
tribuzen/
  .github/
    workflows/
      ci.yml          ← module 01-03 : build + test à chaque push (la CI)
      deploy.yml      ← module 06 : déploiement (delivery, puis deployment)
      preview.yml     ← module 07 : environnement éphémère par PR
  Dockerfile          ← module 04-05 : artefact versionné (image tribuzen:sha)
  infra/              ← module 09 : infrastructure as code
```

Dans ce module, on ne code encore rien : on **cartographie**. Le lab associé te fait dessiner le pipeline CI/CD idéal de TribuZen et lister, dans l'ordre de priorité, les étapes manuelles à automatiser. C'est la carte que tout le cours va suivre.

> La première brique concrète (un workflow GitHub Actions qui lance build + test) est écrite au **module 01**. Ici, tu poses la destination.

---

## 6. Points clés

1. Un déploiement manuel coûte cher en fiabilité, en bus factor et en feedback tardif — l'automatisation le transforme en code versionné.
2. **CI** = intégrer souvent + vérifier automatiquement (build/test/lint). Elle ne déploie rien.
3. **Continuous delivery** = artefact toujours déployable, mise en production sur **décision humaine**.
4. **Continuous deployment** = mise en production **automatique**, sans bouton. La question qui tranche entre les deux : « y a-t-il une approbation humaine ? »
5. La **boucle de feedback** est le fil conducteur : plus elle est courte, moins un bug coûte cher.
6. Un **pipeline** enchaîne source → build → test → package → deploy, avec reproductibilité, isolation et idempotence.
7. **DevOps** est une culture (responsabilité partagée, tout-est-du-code, sans blâme), pas un outil ni un poste.
8. CI, delivery et deployment forment une **échelle de maturité** : on ne saute pas au bout sans les fondations.

---

## 7. Seeds Anki

```
Quelle est la différence entre continuous delivery et continuous deployment ?|Delivery : l'artefact est toujours déployable mais la mise en production est déclenchée par un humain (bouton). Deployment : la mise en production est automatique, sans intervention humaine. Question qui tranche : y a-t-il une approbation manuelle avant la prod ?
Que vérifie la CI (intégration continue) et que ne fait-elle PAS ?|La CI vérifie automatiquement chaque intégration (build + test + lint) à chaque push. Elle ne déploie rien — le déploiement est une brique au-dessus.
Pourquoi raccourcir la boucle de feedback réduit-il le coût des bugs ?|Un bug attrapé 10 s après le commit se corrige trivialement (contexte frais, petit changement). Le même bug découvert 3 semaines plus tard en prod coûte investigation, reproduction, hotfix, communication, rollback.
Quelles sont les étapes canoniques d'un pipeline ?|Source (checkout) → Build (compiler/bundler) → Test (unit/lint/types) → Package (artefact versionné) → Deploy (mise en service).
Pourquoi un deploy.sh lancé à la main n'est-il pas du CI/CD ?|Il n'est ni déclenché par un événement, ni exécuté dans un environnement isolé/reproductible, ni observable par l'équipe. Le CI/CD est une automatisation déclenchée, isolée, versionnée et visible.
Qu'est-ce que la culture DevOps ?|Une culture de responsabilité partagée entre Dev et Ops : « you build it, you run it », tout-est-du-code (versionné en Git), culture sans blâme. Le CI/CD en est l'instrument technique — ce n'est ni un outil ni un poste.
Quelles 3 propriétés rendent un pipeline fiable ?|Reproductibilité (même commit → même artefact), isolation (environnement neuf à chaque run), idempotence du déploiement (rejouer ne change pas le résultat).
Par quelle étape commencer pour automatiser un déploiement manuel, et pourquoi ?|Par la CI (build + test sur machine propre) : meilleur rapport valeur/effort, elle supprime les deux plus gros risques (tests oubliés, « ça marche chez moi ») avant même de toucher au déploiement.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-00-introduction-cicd/README.md`. Exercice de cartographie : dessiner le pipeline CI/CD idéal de TribuZen et prioriser les étapes manuelles à automatiser. Zéro code, 100 % carte mentale — la boussole du cours.
