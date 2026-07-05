# Lab 10 — Monitoring des pipelines : instrumenter et mesurer le pipeline TribuZen

> **Outcome :** à la fin, tu sais **calculer les 4 métriques DORA** d'un pipeline réel, **instrumenter** un workflow pour émettre durées + statut, **alerter** sur un échec de `main` sans noyer l'équipe, et **esquisser un dashboard** — le tout vérifié sur de vrais runs GitHub Actions.
> **Vrai outil :** un dépôt GitHub (public gratuit), l'onglet **Actions** (runs réels + page **Insights/Usage**), et un webhook Slack ou Discord (ou un placeholder si tu n'en as pas). Pas de simulateur, pas d'auto-correcteur.
> **Feedback :** le coach valide en session en lisant les Job Summaries, l'annotation de déploiement et le tableau DORA que tu produis. Pas de test-runner qui note à ta place.

---

## Prérequis matériels

- Un dépôt GitHub avec le pipeline des labs précédents (ou le starter minimal ci-dessous).
- Optionnel mais recommandé : une URL de **webhook entrant** Slack ou Discord, stockée en **secret** de dépôt sous `SLACK_WEBHOOK_URL` (Settings → Secrets and variables → Actions). Sans webhook, tu peux remplacer le step d'alerte par un `::warning` — l'important est la **condition de déclenchement**, pas le canal.

Starter minimal (si tu repars de zéro) :

```json
// package.json
{
  "name": "tribuzen-monitoring-lab",
  "version": "0.1.0",
  "scripts": {
    "lint": "echo 'lint ok'",
    "build": "mkdir -p dist && echo '<h1>TribuZen</h1>' > dist/index.html",
    "test": "echo 'tests ok'"
  }
}
```

Point de départ `.github/workflows/ci.yml` (non instrumenté) :

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - run: npm test
```

---

## Énoncé

Le pipeline tourne mais il est **muet** : aucune durée exploitable, aucune alerte, et personne ne sait quelles sont les métriques DORA de TribuZen. Ta mission — **4 livrables**, chacun vérifiable objectivement :

1. **Calcul DORA (papier/markdown)** — à partir de l'historique fourni ci-dessous, calcule les **4 métriques DORA** et classe la stabilité. Produis un petit tableau (dans le README du dépôt ou un fichier `DORA.md`).
2. **Instrumentation** — modifie `ci.yml` pour :
   - chronométrer `install` et `build` (via `$GITHUB_OUTPUT`) ;
   - afficher un **Job Summary** Markdown avec ces durées, en `if: always()` (visible même sur échec).
3. **Annotation de déploiement** — crée (ou complète) `deploy.yml` qui pose une annotation `::notice` **horodatée** à chaque déploiement de `main` : c'est la **source** de la deployment frequency et du lead time.
4. **Alerte ciblée** — ajoute à `ci.yml` un step qui alerte **uniquement si `main` casse** (`if: failure() && github.ref == 'refs/heads/main'`), webhook via **secret**, message avec run/auteur/lien.

**Historique fourni pour le livrable 1 (30 jours de TribuZen) :**

```
Déploiements réussis (deploy.yml ✔ sur main) : 45 sur 30 jours
Déploiements ayant cassé la prod (rollback/hotfix requis) : 6
Temps prod cassée → rétablie pour ces 6 : 12, 30, 18, 55, 22, 40 (minutes)
Lead time commit→prod observé (médiane) : 8 h
```

**Pas de gap-fill.** Tu écris les YAML entiers et le tableau DORA toi-même.

---

## Étapes (en friction)

1. **DORA d'abord (avant tout code)** — avec l'historique fourni, calcule à la main : deployment frequency (par jour), lead time (médiane), CFR (%), recovery time (médiane des 6 valeurs). Range-les dans un tableau et écris **une phrase** de décision (« on peut accélérer » / « il faut d'abord stabiliser »). Ne regarde le corrigé qu'après.
2. **Chronométrer** — dans `ci.yml`, donne un `id` aux steps install et build, entoure la commande de `START=$(date +%s)` … `echo "s=$(( $(date +%s) - START ))" >> "$GITHUB_OUTPUT"`. Push, ouvre le run, vérifie que les outputs existent (log du step).
3. **Job Summary** — ajoute un step `if: always()` qui écrit un tableau Markdown dans `$GITHUB_STEP_SUMMARY` avec les deux durées. Push, puis regarde le **haut de la page du run** : le tableau doit s'afficher. Casse volontairement `npm test` (ex. `exit 1`) et re-push : le summary doit **encore** s'afficher (c'est tout l'intérêt du `always()`).
4. **Annotation deploy** — crée `deploy.yml` (trigger `push` sur `main`) avec un step `echo "::notice title=Deploy::TribuZen prod $(date -u +%FT%TZ)"`. Push sur `main`, vérifie l'annotation dans le récap du run.
5. **Alerte ciblée** — ajoute le step d'alerte gardé `failure() && github.ref == 'refs/heads/main'`. Teste les **deux** cas : (a) une PR rouge → **pas** d'alerte ; (b) un push rouge sur `main` → alerte reçue (ou `::warning` si pas de webhook).
6. **Mini-dashboard (esquisse)** — ouvre **Actions → Insights** (ou Usage) : relève la durée médiane des runs et le taux de succès de la semaine. Note ces 2 chiffres à côté de ton tableau DORA. Tu as maintenant les **deux familles** de métriques côte à côte.

---

## Corrigé complet commenté

**Livrable 1 — le tableau DORA (`DORA.md`)**

```md
# Métriques DORA — TribuZen (30 derniers jours)

| Métrique | Valeur | Calcul |
|---|---|---|
| Deployment Frequency | 1,5 / jour | 45 déploiements ÷ 30 jours |
| Lead Time for Changes | ~8 h (médiane) | commit poussé → déployé en prod |
| Change Failure Rate | 13,3 % | 6 déploiements cassés ÷ 45 × 100 |
| Failed Deployment Recovery Time | 26 min (médiane) | médiane(12,18,22,30,40,55) = (22+30)/2 |

**Décision :** CFR à 13 % est le point sensible (au-dessus, on casse la prod
> 1 déploiement sur 8). Avant d'augmenter la fréquence, renforcer les tests / la
phase canary. La récupération (26 min) est correcte.
```

> Détail du calcul de la médiane des 6 temps de récupération : valeurs triées = 12, 18, 22, 30, 40, 55 ; nombre pair → moyenne des deux du milieu = (22 + 30) / 2 = **26 min**. On utilise la **médiane** (pas la moyenne 29,5) pour ne pas laisser le 55 tirer le chiffre — cf. piège #5 du module.

**Livrable 2 + 4 — `ci.yml` instrumenté et alerté :**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
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

      # Livrable 2 : mini-rapport de timing, TOUJOURS affiché (succès comme échec)
      - name: Résumé pipeline
        if: always()
        run: |
          {
            echo "### Timing du run #${{ github.run_number }}"
            echo ""
            echo "| Étape | Durée |"
            echo "|---|---|"
            echo "| Install | ${{ steps.install.outputs.s }}s |"
            echo "| Build | ${{ steps.build.outputs.s }}s |"
          } >> "$GITHUB_STEP_SUMMARY"

      # Livrable 4 : alerte SEULEMENT si main casse (jamais les PR)
      - name: Alerte équipe si main rouge
        if: failure() && github.ref == 'refs/heads/main'
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "CI ROUGE sur main — run #${{ github.run_number }} par ${{ github.actor }} — ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
            }
```

**Livrable 3 — `deploy.yml` avec annotation source des DORA :**

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/checkout@v7
      - run: ./scripts/deploy.sh          # (factice dans le lab)
      # Annotation horodatée = point de mesure de la deployment frequency + lead time
      - name: Marquer le déploiement
        run: echo "::notice title=Deploy::TribuZen déployé en prod à $(date -u +%FT%TZ) — sha ${{ github.sha }}"
```

**Pourquoi ce corrigé est correct :**

- Chronométrer via `START=$(date +%s)` puis un `echo ... >> "$GITHUB_OUTPUT"` est le pattern natif : la durée devient un **output de step** (`steps.install.outputs.s`) réutilisable ailleurs dans le job.
- Le step `Résumé pipeline` est en **`if: always()`** : sans lui, un `npm test` rouge sauterait le summary — or c'est justement sur les échecs qu'on veut voir où le temps est parti.
- L'alerte est **doublement gardée** : `failure()` (statut) **et** `github.ref == 'refs/heads/main'` (branche). Une PR rouge ne déclenche **rien** → pas de mur de bruit (piège #3 du module).
- Le webhook n'apparaît **jamais en clair** : il passe par le secret `SLACK_WEBHOOK_URL` (référencé entre délimiteurs d'expression dans le bloc ci-dessus). Le message porte run/auteur/lien pour raccourcir la boucle de feedback (le lecteur sait immédiatement quoi ouvrir).
- L'annotation `::notice` de `deploy.yml` est **horodatée** : en agrégeant ces notices, on obtient la deployment frequency (combien par jour) et, croisée avec le sha, le lead time (commit → cette notice).

---

## Grille d'auto-évaluation

| # | Critère | Vérif objective |
|---|---------|-----------------|
| 1 | DORA calculées | Tableau avec 4 valeurs + 1 phrase de décision (CFR = 13,3 %, recovery = 26 min) |
| 2 | CFR bien fondé | Dénominateur = **déploiements** (45), pas builds CI |
| 3 | Médiane utilisée | Recovery = 26 min (médiane), **pas** 29,5 (moyenne) |
| 4 | Timing émis | Logs des steps `install`/`build` montrent un output `s=…` |
| 5 | Job Summary visible | Haut de la page du run affiche le tableau de durées |
| 6 | Summary sur échec | Après un `npm test` rouge, le summary **s'affiche quand même** |
| 7 | Annotation deploy | Run de `deploy.yml` montre le `::notice` horodaté |
| 8 | Alerte ciblée | PR rouge → **aucune** alerte ; push rouge sur main → alerte reçue |
| 9 | Secret respecté | Aucune URL de webhook en clair dans le YAML |
| 10 | Dashboard esquissé | Durée médiane + taux de succès relevés sur Actions → Insights |

**Seuil de réussite :** 1-9 verts. Le 10 (dashboard) est l'ouverture vers la suite.

---

## Coach — points de contrôle en session

- **« Un build rouge de PR, ça compte dans ton CFR ? »** — Attendu : **non**, le CFR est un ratio de *déploiements* qui cassent la prod ; un build rouge est l'inverse (la CI a bloqué le changement). Signal d'alarme si l'apprenant met 45+builds au dénominateur.
- **« Pourquoi la médiane et pas la moyenne pour le recovery time ? »** — Attendu : la moyenne est tirée par le 55 min ; la médiane (26) décrit ce que vit l'équipe. Renvoyer au piège #5 du module si flou.
- **« Enlève le `if: always()` du summary — que perds-tu ? »** — Attendu : le résumé de timing disparaît sur les runs échoués, précisément ceux qu'on veut diagnostiquer.
- **« Pourquoi ne pas alerter sur chaque PR rouge ? »** — Attendu : bruit → mute du canal → l'alerte devient inutile le jour où main casse. La garde de branche protège la crédibilité.
- **Signal d'alarme** : URL de webhook collée en dur dans le YAML → rappeler push protection + rotation impossible. Toujours un secret.
- **Piège fréquent** : confondre ce lab (monitoring du **pipeline**) avec surveiller l'app en prod (APM/SLO = cours 16). Si l'apprenant veut ajouter des traces applicatives, le rediriger : hors périmètre ici.

---

## Variante J+30 (fading)

**Reproduire de mémoire, en 30 minutes, avec deux contraintes ajoutées — sans rouvrir ce corrigé ni le module :**

1. **Flaky rate maison** : ajoute au pipeline un job qui échoue ~1 fois sur 3 (ex. `if [ $((RANDOM % 3)) -eq 0 ]; then exit 1; fi`), configure un **re-run automatique** limité (ou documente la procédure de re-run), et tiens un compteur manuel : sur 6 runs, combien ont eu besoin d'un re-run ? → c'est ton flaky rate. Écris-le dans `DORA.md`.
2. **Alerte enrichie** : le message d'alerte doit maintenant inclure la **durée du run** (récupère `github.event.repository` n'est pas nécessaire — utilise le timing que tu émets déjà) et distinguer un échec **CI** d'un échec **deploy** dans le texte.

**Critère de réussite :** le pipeline tourne sur un vrai dépôt, le flaky rate est chiffré à partir de runs réels, et l'alerte enrichie ne se déclenche toujours **que** sur `main`. De mémoire, page blanche.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces fichiers vivent ici :

```
tribuzen/
  .github/
    workflows/
      ci.yml        ← timing (Job Summary) + alerte main (Slack via secret)
      deploy.yml    ← ::notice horodaté (source deployment frequency / lead time)
  DORA.md           ← tableau des 4 métriques, mis à jour chaque rétro
```

**Différences par rapport au lab :**

- Les scripts `lint`/`build`/`test` seront les **vrais** (Vite, ESLint, Vitest), donc les durées mesurées seront réelles — c'est là que le timing par step sert vraiment à trouver le goulot.
- Le calcul DORA ne se fera plus à la main : l'historique des runs `deploy.yml` + le registre d'incidents alimenteront un dashboard (Actions Insights pour le pipeline ; **Four Keys** ou une feuille agrégée pour les 4 DORA).
- Le webhook pointera sur le vrai canal `#tribuzen-ci`, et l'alerte deploy vers `#tribuzen-incidents`.
- **Frontière à tenir :** surveiller TribuZen *en production* (latence, erreurs runtime, SLO) est le **cours 16** — ce lab s'arrête à la santé de la **fabrique**.

**Commit cible :**

```
ci(observability): instrumente le pipeline — timing job summary, ::notice deploy, alerte main ciblée + tableau DORA
```
