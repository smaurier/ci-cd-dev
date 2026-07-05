---
titre: Monitoring des pipelines — métriques DORA, observabilité du pipeline, alerting
cours: 15-cicd-devops
notions: ["4 métriques DORA (deploy frequency, lead time for changes, change failure rate, failed deployment recovery time / MTTR)", "niveaux de performance (elite/high/medium/low)", "observabilité du pipeline (durée, taux d'échec, queue time)", "flaky rate et son coût", "alerting sur échec de build/deploy", "boucle de feedback (MTTR du signal)", "coût CI (minutes runner, facturation)", "instrumenter un workflow (annotations, job summary, GITHUB_OUTPUT)", "dashboard de pipeline (Actions Insights, Four Keys)"]
outcomes:
  - sait définir et calculer les 4 métriques DORA à partir de données de pipeline
  - sait distinguer les métriques du PIPELINE (durée, taux d'échec, flaky) des métriques DORA de LIVRAISON
  - sait instrumenter un workflow GitHub Actions pour émettre durées et statut
  - sait alerter sur un échec de build ou de deploy sans noyer l'équipe de bruit
  - sait raisonner sur le coût CI (minutes runner) et sur la boucle de feedback
prerequis: [notions des modules 00-09 (CI/CD, workflows, jobs/steps, artefacts, stratégies de déploiement, IaC)]
next: 11-projet-final
libs: []
tribuzen: pipeline CI/CD de TribuZen — mesurer la santé du pipeline (DORA, durées, flaky rate) et alerter sur ci.yml / deploy.yml
last-reviewed: 2026-07
---

# Monitoring des pipelines

> **Outcomes — tu sauras FAIRE :** calculer les 4 métriques DORA, instrumenter un workflow pour émettre durées et statut, alerter sur un échec de build/deploy sans noyer l'équipe, et raisonner sur le coût CI et la boucle de feedback.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module mesure la santé du **pipeline** lui-même (durées, taux d'échec, flaky, fréquence de déploiement). L'observabilité **applicative** — surveiller l'app *en production* : APM, traces distribuées, métriques métier, SLO/SLI et error budgets — est le sujet du **cours 16**. Ici on instrumente `ci.yml` / `deploy.yml`, pas le runtime de TribuZen. Le *contenu* des tests flaky (comment stabiliser un test) relève du **module 03** ; on n'en mesure ici que le taux et le coût.

## 1. Cas concret d'abord

Le pipeline CI/CD de TribuZen tourne depuis des semaines (modules 00-09 : build, tests matriciels, image Docker, déploiement canary, OIDC). En rétro, l'équipe se dispute sur des impressions :

- « On déploie *souvent*, non ? » — personne n'a le chiffre.
- « La CI est *lente*. » — lente comment, où, depuis quand ?
- « Ce test **rouge**, il l'était déjà hier, relance juste. » — combien de re-runs « pour rien » par semaine ?
- « Le déploiement de mardi a cassé la prod pendant… un moment. » — combien de temps exactement ?

Aucune décision solide ne sort d'un ressenti. Regardons ce qu'un run réel raconte, brut :

```
Run #482  ci.yml   main   ✔ success   9m 41s   (queue 38s)
Run #481  ci.yml   pr/142 ✖ failure   4m 12s   step "test (node 20)" — 1 flaky, re-run ✔
Run #480  deploy.yml main  ✔ success   6m 03s   canary→full
Run #479  ci.yml   pr/141 ✔ success   11m 58s
```

Ces lignes contiennent déjà tout : une **fréquence de déploiement** (combien de `deploy.yml ✔` par jour), un **lead time** (temps commit → prod), un **taux d'échec de changement** (déploiements qui cassent), un **temps de récupération**, et — côté pipeline — des **durées**, un **queue time**, un **flaky** qui a coûté un re-run. Le problème n'est pas de collecter plus de données : c'est de les **nommer**, les **calculer**, et **alerter** quand ça compte.

Ce module transforme ces lignes en 4 chiffres qui pilotent une décision, instrumente le workflow pour les émettre automatiquement, et branche une alerte utile (pas un mur de notifications que tout le monde mute au bout de trois jours).

---

## 2. Théorie complète, concise

### 2.1 Deux familles de métriques — ne pas les confondre

| Famille | Mesure quoi | Exemples | D'où viennent les données |
|---|---|---|---|
| **Métriques de livraison (DORA)** | la **performance de l'organisation** à livrer | deploy frequency, lead time, CFR, recovery time | historique des déploiements + incidents |
| **Métriques du pipeline (observabilité)** | la **santé mécanique** de la CI | durée d'un run, taux d'échec des builds, queue time, flaky rate, coût runner | logs & timings de chaque run |

Un pipeline **rapide et vert** (bonnes métriques pipeline) peut quand même livrer **rarement** (mauvaise deploy frequency) — parce qu'on n'ose pas déployer. Inversement, on peut déployer 20 fois par jour avec une CI qui rame. Les deux familles se lisent **ensemble** mais ne se remplacent pas.

### 2.2 Les 4 métriques DORA

DORA (*DevOps Research and Assessment*, programme de recherche à l'origine du livre *Accelerate* et des rapports *State of DevOps*) a isolé **quatre indicateurs** qui corrèlent avec la performance de livraison. Deux mesurent le **débit** (*throughput*), deux la **stabilité**.

**Débit :**

1. **Deployment Frequency** — à quelle fréquence tu déploies en production. Compté sur une période (par jour / semaine / mois). Proxy concret : nombre de runs `deploy.yml ✔ success` sur `main` par jour.
2. **Lead Time for Changes** (change lead time) — temps entre *commit poussé en version control* et *ce commit déployé en prod*. Mesure la réactivité de toute la chaîne (revue + CI + déploiement), pas juste la durée du build.

**Stabilité :**

3. **Change Failure Rate (CFR)** — **pourcentage** des déploiements qui provoquent une défaillance en prod (nécessitant rollback, hotfix, patch). `CFR = déploiements échoués / total déploiements × 100`. ⚠️ C'est un ratio de *déploiements*, pas de *builds* : un build rouge en CI **n'est pas** un change failure (le changement n'est jamais parti en prod — au contraire, la CI a fait son travail).
4. **Failed Deployment Recovery Time** — temps pour **rétablir le service** après un déploiement qui casse la prod. C'est l'ancien **MTTR** (*Mean Time To Recovery* / time to restore service), **renommé** par DORA en 2024 pour préciser qu'il s'agit de récupérer d'un *déploiement raté*, pas de n'importe quel incident.

> **Note de vocabulaire.** Beaucoup d'outils et d'articles écrivent encore « MTTR ». Depuis 2024, DORA parle de *failed deployment recovery time* et a ajouté un 5ᵉ indicateur, le *deployment rework rate* (part de déploiements non planifiés déclenchés par un incident). Le cœur du modèle reste les **quatre** ci-dessus.

### 2.3 Niveaux de performance

DORA classe les équipes en paliers — **elite / high / medium / low** — selon ces quatre métriques (un cluster elite déploie à la demande, lead time < 1 jour, CFR bas, récupération en minutes/heures ; un cluster low déploie mensuellement, lead time en mois, récupération en jours). Les **seuils chiffrés bougent chaque année** dans le rapport *State of DevOps* : ne code jamais un seuil « elite » en dur dans un dashboard sans le dater. Ce qui compte pour une équipe, c'est la **tendance** de ses propres chiffres, pas la comparaison à un palier figé.

<!-- FLAG-DOC: les seuils chiffrés par palier (ex. "elite = lead time < 1h") varient d'un rapport annuel State of DevOps à l'autre ; la page dora.dev/guides ne les fige pas. Ne pas inscrire de valeur numérique de seuil sans citer l'année du rapport. -->

### 2.4 Observabilité du pipeline — les métriques mécaniques

Ce sont les chiffres qu'on lit directement sur les runs :

| Métrique pipeline | Définition | Pourquoi on la suit |
|---|---|---|
| **Durée du run** (wall-clock) | du démarrage à la fin du workflow | boucle de feedback : un dev attend ce temps avant de savoir |
| **Durée par job / step** | timing fin par étape | localiser le goulot (install ? build ? tests ?) |
| **Queue time** | attente avant qu'un runner prenne le job | signale une pénurie de runners |
| **Taux d'échec des builds** | % de runs rouges sur une période | santé de la CI ; à ventiler « vrai échec » vs « flaky » |
| **Flaky rate** | % de runs qui passent après un simple re-run, sans changement de code | mine le signal : un rouge ne veut plus rien dire |
| **Coût CI** | minutes-runner consommées (× tarif) | le budget réel de la CI (§2.7) |

Le **flaky rate** mérite une insistance : un test flaky ne coûte pas qu'un re-run. Il **détruit la valeur du signal rouge**. Si l'équipe a appris que « rouge = relance », elle relancera aussi le jour où le rouge est un vrai bug. Mesurer le flaky rate, c'est protéger la crédibilité de toute la CI. (Comment *stabiliser* un test flaky : module 03.)

### 2.5 Instrumenter un workflow GitHub Actions

GitHub fournit déjà, sans rien coder, une page **Actions → Insights / Usage** : durée des workflows, taux de succès/échec, minutes consommées par runner. C'est le premier réflexe avant de construire quoi que ce soit.

Pour aller plus loin, on **émet** des données depuis le workflow. Trois mécanismes natifs :

**Annotations** (`::notice`, `::warning`, `::error`) — messages remontés dans l'UI du run :

```yaml
      - name: Marquer un déploiement
        run: echo "::notice title=Deploy::TribuZen déployé sur prod à $(date -u +%FT%TZ)"
```

**Job Summary** (`$GITHUB_STEP_SUMMARY`) — un bloc Markdown affiché en haut du run, parfait pour un mini-rapport de métriques :

```yaml
      - name: Résumé de timing
        run: |
          echo "### Timing du run" >> "$GITHUB_STEP_SUMMARY"
          echo "| Étape | Durée |" >> "$GITHUB_STEP_SUMMARY"
          echo "|---|---|" >> "$GITHUB_STEP_SUMMARY"
          echo "| Install | ${INSTALL_S}s |" >> "$GITHUB_STEP_SUMMARY"
          echo "| Build | ${BUILD_S}s |" >> "$GITHUB_STEP_SUMMARY"
```

**Outputs / mesure de durée par step** — chronométrer une étape et exposer la valeur :

```yaml
      - name: Build (chronométré)
        id: build
        run: |
          START=$(date +%s)
          npm run build
          echo "duration_s=$(( $(date +%s) - START ))" >> "$GITHUB_OUTPUT"
      - name: Publier la durée
        run: echo "::notice::build=${{ steps.build.outputs.duration_s }}s"
```

Pour un **historique** (tendance sur des semaines), ces timings s'exportent : soit vers un dashboard maison, soit — approche outillée — vers le projet open-source **Four Keys** (*fourkeys*, dora-team) qui ingère les événements de déploiement/incident et calcule les 4 métriques DORA automatiquement. Une annotation ou un `$GITHUB_STEP_SUMMARY` renseigne un run *isolé* ; un dashboard agrège la **série temporelle**.

### 2.6 Alerting sur échec — utile, pas bruyant

Alerter sur **chaque** run rouge = spam garanti (les PR échouent en boucle, c'est normal). Deux règles :

1. **Qui** doit être alerté : l'auteur du push (déjà notifié par GitHub par mail), pas tout le canal d'équipe.
2. **Quoi** mérite une alerte poussée (Slack/Teams/PagerDuty) : un échec sur une **branche protégée** (`main`) ou un **échec de déploiement** — pas un rouge de PR en cours d'itération.

```yaml
      - name: Alerter l'équipe si main casse
        if: failure() && github.ref == 'refs/heads/main'
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "CI rouge sur main — run #${{ github.run_number }} par ${{ github.actor }}"
            }
```

La condition `if: failure() && github.ref == 'refs/heads/main'` est le cœur du filtrage : la fonction de statut `failure()` (module 02) + la garde de branche évitent le mur de bruit. Le webhook est référencé via un **secret** (`secrets.SLACK_WEBHOOK_URL` entre délimiteurs d'expression, cf. bloc ci-dessus) — jamais une URL en clair dans le YAML.

> **Boucle de feedback = MTTR du *signal*.** Il ne suffit pas de détecter l'échec ; il faut que la bonne personne le sache **vite** et sache **quoi** faire. Une alerte qui arrive 30 min après, ou qui ne dit pas quel run/step/commit, rallonge la boucle. Une bonne alerte porte : quoi a cassé, où (run/step), qui (auteur), et un lien direct.

### 2.7 Coût CI

Les minutes de runner se **facturent** (au-delà d'un quota gratuit, et selon le type de runner — Linux, Windows plus cher, macOS beaucoup plus cher). Le coût CI n'est pas un détail comptable : c'est un **arbitrage**. Une matrix `os × node` de 12 combinaisons multiplie les minutes par 12. Les leviers vus dans le cours réduisent ce coût **et** la durée (donc la boucle de feedback) en même temps :

- **cache** des dépendances (module 02) — moins de minutes d'install ;
- **jobs conditionnels** / `paths` filters — ne pas tout relancer pour un changement de README ;
- **`fail-fast`** et **concurrency** `cancel-in-progress` (module 02) — tuer les runs obsolètes ;
- **runners bien dimensionnés** — pas de macOS si Linux suffit.

Suivre les minutes consommées (page Usage) referme la boucle : on voit l'effet d'une optimisation sur la facture, pas seulement sur le chrono.

---

## 3. Worked examples

### Exemple 1 — Calculer les 4 DORA depuis un mois de runs

On dispose de l'historique des déploiements de TribuZen sur 30 jours :

```
Déploiements réussis (deploy.yml ✔ sur main) : 60 sur 30 jours
Déploiements ayant cassé la prod (rollback/hotfix requis) : 3
Pour ces 3 incidents, temps prod cassée → rétablie : 25 min, 40 min, 15 min
Lead time (commit poussé → déployé), médiane observée : 5 h
```

On dérive :

1. **Deployment Frequency** = 60 / 30 = **2 déploiements / jour**. (On regarde souvent la médiane par jour ouvré, mais 2/j donne l'ordre de grandeur.)
2. **Lead Time for Changes** = **~5 h** (médiane, pas moyenne — une PR bloquée une semaine ne doit pas fausser la tendance).
3. **Change Failure Rate** = 3 / 60 × 100 = **5 %**. (Dénominateur = **déploiements**, pas builds CI.)
4. **Failed Deployment Recovery Time** = médiane(25, 40, 15) = **25 min**.

Ce que ça pilote : CFR 5 % + récupération 25 min = la stabilité est saine, on peut **augmenter** la fréquence sans peur. Si le CFR montait à 25 %, la conversation deviendrait « on déploie trop vite / il manque des tests / le canary est trop court » — pas « ajoutons des alertes ».

### Exemple 2 — Instrumenter `ci.yml` : timing + summary + alerte main

On ajoute au pipeline de quoi mesurer et signaler, sans changer sa logique.

```yaml
# .github/workflows/ci.yml — extrait instrumenté
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }

      - name: Install (chronométré)
        id: install
        run: |
          START=$(date +%s)
          npm ci
          echo "s=$(( $(date +%s) - START ))" >> "$GITHUB_OUTPUT"

      - name: Build (chronométré)
        id: build
        run: |
          START=$(date +%s)
          npm run build
          echo "s=$(( $(date +%s) - START ))" >> "$GITHUB_OUTPUT"

      - run: npm test

      # Mini-rapport de métriques, toujours affiché (succès comme échec)
      - name: Résumé pipeline
        if: always()
        run: |
          {
            echo "### Timing du run #${{ github.run_number }}"
            echo "| Étape | Durée |"
            echo "|---|---|"
            echo "| Install | ${{ steps.install.outputs.s }}s |"
            echo "| Build | ${{ steps.build.outputs.s }}s |"
          } >> "$GITHUB_STEP_SUMMARY"

      # Alerte ciblée : seulement si main casse (pas les PR)
      - name: Alerte équipe si main rouge
        if: failure() && github.ref == 'refs/heads/main'
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "CI ROUGE sur main — run #${{ github.run_number }} (${{ github.actor }}) — ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
            }
```

Points clés du corrigé : le step `Résumé pipeline` est en `if: always()` pour s'afficher **même quand un test échoue** (sinon on perd le timing des échecs, justement ceux qui intéressent) ; l'alerte est doublement gardée (`failure()` **et** branche `main`) ; le webhook passe par un secret. Aucune valeur « elite » codée en dur : on émet des faits, l'agrégation et les seuils vivent dans le dashboard.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Compter un build CI rouge comme un « change failure »

Le CFR mesure les **déploiements** qui cassent la **prod**. Un build rouge en CI est le *contraire* d'un change failure : la CI a **empêché** le changement de partir. Mélanger les deux gonfle artificiellement le CFR et pousse à « désactiver les tests pour améliorer la métrique » — exactement l'inverse du but.

### PIÈGE #2 — Confondre monitoring du pipeline et observabilité applicative

Mesurer la durée d'un run ≠ surveiller la latence de l'API TribuZen en prod. Le premier (ce module) instrumente le **workflow** ; le second (APM, traces, SLO — **cours 16**) instrumente le **runtime**. Une CI verte ne dit **rien** sur la santé de l'app une fois déployée.

### PIÈGE #3 — Alerter sur tout

Notifier le canal d'équipe à chaque run rouge = tout le monde mute le canal en trois jours, y compris le jour où `main` casse vraiment. Filtrer par branche protégée + type d'événement (deploy) n'est pas un luxe, c'est ce qui garde l'alerte **crédible**.

### PIÈGE #4 — Ignorer le flaky rate

« Relance, c'était juste flaky » traité comme normal est une dette silencieuse. Un flaky rate non mesuré finit par rendre le rouge **insignifiant** : quand un vrai bug apparaît, personne n'y croit. Mesurer le taux, c'est décider quand il faut *stabiliser* (module 03) plutôt que re-run.

### PIÈGE #5 — Moyenne au lieu de médiane / percentile

Sur le lead time ou la durée de run, la **moyenne** est écrasée par les valeurs extrêmes (une PR oubliée une semaine, un run bloqué par une panne). La **médiane** (ou un p50/p95) décrit ce que vit *vraiment* l'équipe. DORA raisonne en médianes.

### PIÈGE #6 — Graver un seuil « elite » en dur

Les seuils par palier changent chaque année (rapport State of DevOps). Un dashboard qui affiche « objectif : lead time < X » avec X figé devient faux au prochain rapport et fait courir après une cible arbitraire. Suis **ta tendance**, date tout seuil externe.

### PIÈGE #7 — Optimiser la durée sans regarder le coût (ou l'inverse)

Ajouter des runners en parallèle raccourcit le wall-clock **mais** multiplie les minutes facturées. Réduire une matrix baisse le coût **mais** peut réduire la couverture. Durée (boucle de feedback) et coût sont un **arbitrage** à tenir ensemble, pas deux objectifs indépendants.

---

## 5. Ancrage TribuZen

Le fil-rouge du cours est le **pipeline CI/CD de TribuZen**. Ce module lui ajoute sa **couche de mesure** — sans toucher au runtime de l'app (ça, c'est le cours 16).

- **`.github/workflows/ci.yml`** — instrumenté (Exemple 2) : chaque run émet un Job Summary de timing (install/build), et un échec sur `main` alerte l'équipe sur Slack via le secret `SLACK_WEBHOOK_URL`.
- **`.github/workflows/deploy.yml`** — chaque déploiement réussi pose une annotation `::notice` horodatée : c'est la **source** de la deployment frequency et du lead time (commit → notice de deploy).
- **Tableau de bord DORA** — les 4 métriques de TribuZen se calculent depuis l'historique des runs `deploy.yml` + le registre d'incidents, agrégées dans un dashboard (Actions Insights pour le pipeline ; Four Keys ou une feuille maison pour les 4 DORA).
- **Suivi flaky & coût** — le taux de re-run et les minutes-runner consommées se lisent sur la page Usage ; ils arbitrent les optimisations (cache, concurrency) vues au module 02.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  .github/
    workflows/
      ci.yml        ← timing (Job Summary) + alerte main (Slack, secret)
      deploy.yml    ← ::notice horodaté par déploiement (source deploy freq / lead time)
```

> Ce qui reste **hors** de ce module : surveiller TribuZen *en production* (latence API, taux d'erreur runtime, traces, SLO/error budget) = **cours 16**. Ici, on mesure la **fabrique**, pas le **produit livré**.

---

## 6. Points clés

1. Deux familles à ne pas confondre : **DORA** (performance de livraison de l'organisation) vs **observabilité du pipeline** (santé mécanique de la CI). On les lit ensemble, jamais l'une pour l'autre.
2. Les **4 DORA** : deployment frequency + lead time (débit), change failure rate + failed deployment recovery time / MTTR (stabilité). Le CFR est un ratio de **déploiements**, pas de builds.
3. En 2024 DORA a **renommé** MTTR en *failed deployment recovery time* et ajouté un 5ᵉ indicateur (*deployment rework rate*) ; le cœur reste les quatre.
4. Les paliers **elite/high/medium/low** existent mais leurs **seuils chiffrés bougent chaque année** — suivre sa **tendance**, pas un seuil figé.
5. Métriques pipeline clés : durée (run/job/step), queue time, taux d'échec, **flaky rate** (qui détruit la valeur du signal rouge), coût runner.
6. Instrumenter un workflow : `::notice`/`::warning`, **Job Summary** (`$GITHUB_STEP_SUMMARY`), durée par step via `$GITHUB_OUTPUT` ; historique → dashboard (Actions Insights, Four Keys).
7. Alerter **utile** : `if: failure() && github.ref == 'refs/heads/main'`, webhook via **secret**, message qui dit quoi/où/qui/lien — sinon l'équipe mute le canal.
8. **Coût CI** (minutes-runner) et durée (boucle de feedback) sont un **arbitrage** : cache, jobs conditionnels, concurrency, runners dimensionnés agissent sur les deux.

---

## 7. Seeds Anki

```
Quelles sont les 4 métriques DORA et leurs deux familles ?|Débit : Deployment Frequency (fréquence de déploiement) + Lead Time for Changes (commit → prod). Stabilité : Change Failure Rate (% déploiements qui cassent la prod) + Failed Deployment Recovery Time / MTTR (temps de rétablissement après un deploy raté).
Un build rouge en CI compte-t-il dans le Change Failure Rate ?|Non. Le CFR mesure les DÉPLOIEMENTS qui cassent la PROD (rollback/hotfix). Un build rouge est le contraire d'un change failure : la CI a empêché le changement de partir. Le CFR se calcule sur des déploiements, pas des builds.
Qu'est devenu le MTTR dans le vocabulaire DORA 2024 ?|Renommé « Failed Deployment Recovery Time » pour préciser qu'il s'agit de récupérer d'un déploiement raté (pas d'un incident quelconque). DORA a aussi ajouté un 5e indicateur : le Deployment Rework Rate. Le cœur reste les 4 métriques.
Pourquoi ne pas coder en dur un seuil « elite » dans un dashboard DORA ?|Les seuils chiffrés par palier (elite/high/medium/low) changent chaque année dans le rapport State of DevOps. Un seuil figé devient faux. On suit la TENDANCE de ses propres chiffres, en médiane, et on date tout seuil externe.
Qu'est-ce que le flaky rate et pourquoi le mesurer ?|% de runs qui passent après un simple re-run, sans changement de code. À mesurer car un test flaky détruit la valeur du signal rouge : si « rouge = relance » devient un réflexe, l'équipe relancera aussi un vrai bug. Stabiliser le test = module 03.
Comment émettre des métriques de timing depuis un workflow GitHub Actions ?|Annotations ::notice/::warning ; Job Summary via $GITHUB_STEP_SUMMARY (bloc Markdown) ; durée par step en chronométrant (date +%s) et en écrivant dans $GITHUB_OUTPUT. Pour l'historique/tendance : exporter vers un dashboard (Actions Insights, Four Keys).
Comment alerter sur un échec sans noyer l'équipe de bruit ?|Filtrer : if: failure() && github.ref == 'refs/heads/main' (ou échec de deploy), webhook via secret, message avec quoi/où/qui/lien. Ne PAS alerter le canal sur chaque PR rouge, sinon tout le monde mute — y compris le jour où main casse vraiment.
Monitoring du pipeline vs observabilité applicative : la frontière ?|Pipeline (ce module) = santé de la CI : durées, taux d'échec, flaky, DORA — on instrumente le workflow. Applicatif (cours 16) = santé de l'app en prod : APM, traces, métriques métier, SLO/error budget — on instrumente le runtime. Une CI verte ne dit rien sur l'app déployée.
Pourquoi médiane plutôt que moyenne pour le lead time / la durée ?|La moyenne est écrasée par les extrêmes (PR oubliée une semaine, run bloqué). La médiane (ou p50/p95) décrit ce que vit réellement l'équipe. DORA raisonne en médianes.
Durée de run et coût CI : quel rapport ?|C'est un arbitrage. Paralléliser raccourcit le wall-clock mais multiplie les minutes facturées ; réduire une matrix baisse le coût mais la couverture. Cache, jobs conditionnels, concurrency (cancel-in-progress) et runners bien dimensionnés améliorent souvent les deux à la fois.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-10-monitoring-pipelines/README.md`. Instrumenter le pipeline TribuZen sur un vrai dépôt : calculer les 4 DORA depuis l'historique, émettre timing (Job Summary) + annotation de déploiement, brancher une alerte ciblée sur `main`, et esquisser un mini-dashboard. Feedback coach en session (pas d'auto-correcteur).
