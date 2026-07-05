# Lab 00 — Introduction au CI/CD

> **Outcome :** à la fin, tu sais cartographier le pipeline CI/CD idéal d'un projet réel (TribuZen), nommer chaque étape (source, build, test, package, deploy) et **prioriser** les tâches manuelles à automatiser en premier.
> **Vrai outil :** aucun outil d'exécution ici — le livrable est un **document de cartographie** (Markdown + un diagramme ASCII ou schéma). C'est le seul lab conceptuel du cours ; tout le reste écrit du vrai code.
> **Feedback :** le coach valide en session la cohérence de la carte et de la priorisation — pas de test-runner.

---

## Énoncé

Tu es le seul à savoir déployer TribuZen, et ça te fait perdre tes vendredis soir. Avant d'écrire la moindre ligne de pipeline, tu dois **savoir où tu vas**. Ce lab produit la boussole du cours : la carte du pipeline cible et l'ordre dans lequel tu vas le construire.

Voici la **procédure de déploiement manuelle actuelle** de TribuZen (état réel, à automatiser) :

```bash
# Déploiement TribuZen — manuel, dans la tête de Sylvain
git pull origin main
pnpm install
pnpm build                                    # tests souvent oubliés avant
scp -r dist/ user@serveur:/var/www/tribuzen   # écrase l'ancienne version, pas de backup
ssh user@serveur "sudo systemctl restart tribuzen"
```

Contexte produit :
- Front **Vue 3 + Vite** (build statique dans `dist/`).
- Tests : **Vitest** (unit) + `vue-tsc` (types) — existent mais lancés à la main, quand on y pense.
- Un seul serveur de prod, accessible en SSH.
- Objectif à terme : déploiement **automatique et réversible** déclenché par un merge sur `main`.

**Livrable :** un fichier `pipeline-map.md` (tu le crées) contenant les 4 sections décrites dans les étapes ci-dessous. Pas de code de pipeline — c'est le rôle des modules suivants.

---

## Étapes (en friction)

Tu produis toi-même chaque section. Ne recopie pas le corrigé avant d'avoir tenté.

1. **Diagnostic de l'existant.** Pour chaque commande de la procédure manuelle, écris à quelle **étape canonique** elle correspond (Source / Build / Test / Package / Deploy) et **quel risque** elle porte. Repère au moins une étape *totalement absente*.

2. **Schéma du pipeline cible.** Dessine (ASCII ou schéma) le pipeline idéal, de l'événement déclencheur jusqu'à la production. Indique pour chaque étape : ce qu'elle fait et l'outil pressenti (checkout, `pnpm build`, Vitest, image Docker, déploiement).

3. **Choix du niveau CD visé.** Décide si TribuZen doit viser **continuous delivery** (bouton manuel avant prod) ou **continuous deployment** (100 % auto) *pour commencer*. Justifie en une phrase (indice : niveau de confiance dans les tests aujourd'hui).

4. **Backlog priorisé.** Liste les tâches d'automatisation **dans l'ordre où tu les ferais**, avec une justification « valeur / effort » pour la première. Le but : identifier le premier pas à plus fort ROI.

**Contrainte de friction :** rédige la section 4 **avant** de regarder le corrigé, et impose-toi de justifier *pourquoi* telle tâche passe avant telle autre.

---

## Corrigé complet commenté

Voici une cartographie de référence. La tienne peut différer sur les détails — ce qui compte, c'est la cohérence du raisonnement et la priorisation.

### 1. Diagnostic de l'existant

| Commande | Étape canonique | Risque porté |
|----------|-----------------|--------------|
| `git pull origin main` | **Source** | Dépend de l'état local de ta machine, pas d'un environnement propre → « ça marche chez moi » |
| `pnpm install` | **Build** (deps) | Sans lockfile figé + machine propre, versions non reproductibles |
| `pnpm build` | **Build** | OK, mais dépend de variables d'env locales absentes du serveur |
| *(rien)* | **Test** ❌ | **Étape totalement absente** — aucun garde-fou avant la prod |
| `scp -r dist/ …` | **Package + Deploy** (fusionnés) | Copie **destructive** : écrase l'ancienne version, **aucun artefact versionné**, **rollback impossible** |
| `ssh … restart` | **Deploy** (activation) | Manuel, bus factor = 1 |

Diagnostic clé : l'étape **Test** est absente et **Package/Deploy** sont fusionnés sans artefact. Ce sont les deux plus gros trous.

### 2. Schéma du pipeline cible

```
  push / merge sur main
          │
          ▼
   ┌─────────────┐
   │  1. SOURCE   │  checkout du commit exact (actions/checkout)
   └─────────────┘  environnement propre, pas "ta machine"
          │
          ▼
   ┌─────────────┐
   │  2. BUILD    │  pnpm install (lockfile figé) + pnpm build → dist/
   └─────────────┘
          │
          ▼
   ┌─────────────┐
   │  3. TEST     │  vitest (unit) + vue-tsc (types) + lint
   └─────────────┘  ❗ bloque le pipeline si rouge — le garde-fou manquant
          │  (vert)
          ▼
   ┌─────────────┐
   │  4. PACKAGE  │  image Docker versionnée : tribuzen:<sha>
   └─────────────┘  artefact figé et réutilisable → rollback possible
          │
          ▼
   ┌─────────────┐
   │  5. DEPLOY   │  mise en service de l'artefact sur le serveur
   └─────────────┘  (delivery = clic humain, ou deployment = auto)
          │
          ▼
     production observée
```

### 3. Choix du niveau CD visé

**Continuous delivery pour commencer** (bouton manuel avant la prod).

Justification : la couverture de tests de TribuZen n'est pas encore assez mûre pour faire confiance à une mise en prod 100 % automatique. On produit un artefact déployable à chaque merge, mais un humain garde la main sur le « go prod ». On passera au déploiement continu (module 06) une fois la CI et les tests solides.

### 4. Backlog priorisé

1. **CI = build + test à chaque push** *(à faire en premier)*.
   *Valeur/effort :* effort faible (un seul fichier `ci.yml`), valeur énorme — supprime d'un coup les **deux plus gros risques** (tests oubliés + « ça marche chez moi », car build sur machine propre). C'est le premier pas non négociable. → modules 01-03.
2. **Produire un artefact versionné** (image Docker `tribuzen:<sha>`) pour rendre le **rollback** possible. → modules 04-05.
3. **Automatiser le déploiement** en continuous delivery (bouton). → module 06.
4. **Environnements de preview par PR** pour tester avant merge. → module 07.
5. **Sécuriser** (OIDC, pas de secrets long terme) et **observer** (métriques DORA). → modules 08, 10.

**Pourquoi la CI d'abord :** c'est le maillon avec le meilleur rapport valeur/effort. Sans elle, automatiser le déploiement ne ferait que **livrer plus vite des bugs non testés**. On sécurise l'intégration avant d'accélérer la livraison.

**Grille d'auto-évaluation (coche — seuil de réussite en bas) :**

| Critère | OK ? |
|---|---|
| Chaque commande manuelle est rattachée à une étape canonique (Source / Build / Test / Package / Deploy) | ☐ |
| L'étape **Test absente** est explicitement repérée | ☐ |
| Le risque du `scp` destructif (écrasement, aucun artefact, rollback impossible) est nommé | ☐ |
| Le schéma cible ordonne les 5 étapes avec l'outil pressenti pour chacune | ☐ |
| Le niveau CD (delivery vs deployment) est choisi **et** justifié par la maturité des tests | ☐ |
| Le backlog est **ordonné** et la 1re tâche justifiée en valeur/effort | ☐ |
| La priorisation place la **CI d'abord**, pas le déploiement | ☐ |

**Seuil :** 6/7 cochés, dont **obligatoirement** « Test absente repérée » et « CI d'abord » — ce sont les deux acquis non négociables de ce lab.

**Coach — conduite de session (relances + pièges) :**
- Relance si silence : « Sur les 5 commandes, laquelle ne correspond à **aucune** étape canonique ? Qu'est-ce que ce trou révèle ? »
- « Tu as mis le déploiement auto en tâche 1 : qu'automatises-tu au juste si les tests ne tournent toujours pas ? »
- « Delivery ou deployment — ta décision repose sur une intuition, ou sur la couverture de tests réelle d'aujourd'hui ? »
- Piège à débusquer : l'apprenant qui laisse Package et Deploy fusionnés sans artefact versionné → lui demander « comment reviens-tu à la version d'hier à 2h du matin ? ».
- Piège : priorisation par « ce qui est facile » plutôt que par ROI → recentrer sur le rapport valeur/effort.

---

## Variante J+30 (fading)

Refais la cartographie **de mémoire, en 20 minutes**, mais pour un **projet différent** : un **backend NestJS + PostgreSQL** dont le déploiement manuel actuel est :

```bash
git pull
npm run build
npx prisma migrate deploy    # ← nouvelle étape : migration de base de données
pm2 restart api
```

Contraintes ajoutées :
1. Intègre l'étape **migration de base de données** dans ton schéma de pipeline — où la places-tu par rapport au deploy, et quel risque spécifique porte-t-elle (migration non réversible sur données réelles) ?
2. Décide si tu vises delivery ou deployment, sachant qu'une migration ratée peut corrompre des données de prod.
3. **Sans rouvrir ce corrigé.**

**Critère de réussite :** ton schéma place la migration au bon endroit (avant l'activation du nouveau code, avec une stratégie de sécurité) et ta priorisation reste « CI d'abord ».

---

## Application TribuZen

Le livrable de ce lab n'est pas jetable : c'est la **feuille de route** du cours 15. Range-le dans le repo `smaurier/tribuzen` comme document d'architecture :

```
tribuzen/
  docs/
    devops/
      pipeline-map.md      ← la cartographie produite dans ce lab
```

**Ce que tu porteras dans le vrai produit au fil du cours :**
- `pipeline-map.md` devient le README de suivi : tu coches chaque étape à mesure que tu l'automatises (module 01 → `ci.yml`, module 05 → `Dockerfile`, etc.).
- Chaque case cochée correspond à un vrai commit sur `smaurier/tribuzen`.

**Commit cible :**
```
docs(devops): cartographie du pipeline CI/CD cible + backlog priorisé
```
