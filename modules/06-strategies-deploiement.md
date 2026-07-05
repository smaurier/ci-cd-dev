---
titre: Stratégies de déploiement (rolling, blue-green, canary, feature flags, rollback)
cours: 15-cicd-devops
notions: ["zero-downtime deployment", "recreate (big bang)", "rolling update (maxSurge/maxUnavailable)", "blue-green (switch instantané)", "canary progressif + métriques", "feature flags (déploiement vs release)", "dark launch / shadow traffic", "rollback vs rollforward", "health checks (liveness/readiness/startup)", "migrations backward-compatible (expand/contract)"]
outcomes:
  - sait comparer recreate, rolling, blue-green et canary et choisir la stratégie selon le risque
  - sait rendre un déploiement zero-downtime avec health checks et migrations backward-compatible
  - sait concevoir un canary progressif piloté par des métriques avec rollback automatique
  - sait découpler déploiement et release avec des feature flags et un dark launch
  - sait distinguer rollback et rollforward et préparer un retour arrière sûr
prerequis: [notions des modules 00-05 (CI vs CD, workflows GitHub Actions, artefacts, images et registries)]
next: 07-preview-environments
libs: []
tribuzen: pipeline CI/CD de TribuZen — le job deploy de .github/workflows/ci.yml, déployer une nouvelle version sans couper la planification familiale en cours
last-reviewed: 2026-07
---

# Stratégies de déploiement

> **Outcomes — tu sauras FAIRE :** comparer recreate / rolling / blue-green / canary et choisir selon le risque, rendre un déploiement zero-downtime (health checks + migrations backward-compatible), piloter un canary par métriques avec rollback automatique, et découpler déploiement et release avec des feature flags.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module traite de la **manière de livrer** une version déjà buildée et publiée en image (modules 04-05). Il reste au niveau CI/CD et **conceptuel côté orchestrateur** : la config Kubernetes/cloud détaillée relève du **cours 12**, la sécurité du pipeline (OIDC, secrets) du **module 08** puis du **cours 14**, et l'observabilité applicative profonde (dashboards, tracing) du **cours 16**. Les environnements éphémères par PR sont le sujet du **module 07**.

## 1. Cas concret d'abord

Le pipeline TribuZen (modules 00-05) build une image, la pousse sur GHCR, puis un job `deploy` la met en prod. Ce job fait aujourd'hui le plus simple possible :

```yaml
# .github/workflows/ci.yml — job deploy "naïf" (recreate)
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/checkout@v7
      - name: Déployer (recreate)
        run: |
          ./scripts/stop.sh          # arrête l'ancienne version
          ./scripts/migrate.sh       # applique les migrations DB
          ./scripts/start.sh "${{ github.sha }}"  # démarre la nouvelle
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

**Deux douleurs vécues cette semaine sur TribuZen :**

1. **Coupure de 40 s.** Entre `stop.sh` et un `start.sh` sain, l'app renvoie 502. Un parent en train de valider les dates des vacances **perd son formulaire**. Pour un produit familial, une coupure à 20 h (pic d'usage) est inacceptable.
2. **Migration qui casse l'ancienne version.** Le dernier déploiement a renommé la colonne `member_name` en `display_name`. `migrate.sh` tourne pendant que quelques requêtes de l'ancienne version arrivent encore → elles cherchent `member_name` disparu → **500 en série**.

Ce module règle les deux : livrer **sans coupure** (zero-downtime), et pouvoir **revenir en arrière en secondes** si le nouveau code déraille. On ne va pas garder le `recreate` : on va choisir, selon le risque, entre **rolling**, **blue-green** et **canary**, et rendre le schéma DB tolérant aux **deux versions en vol**.

---

## 2. Théorie complète, concise

### 2.1 Le problème central : zero-downtime

**Zero-downtime deployment** = passer de la version N à N+1 sans qu'aucune requête utilisateur n'échoue. La clé : à tout instant, **au moins une instance saine** répond derrière le load balancer (LB), et le LB **ne route** que vers les instances déclarées prêtes.

Trois briques rendent ça possible, réutilisées par toutes les stratégies ci-dessous :

- un **load balancer** (ou un routeur/ingress) qui répartit le trafic sur N instances ;
- des **health checks** : chaque instance expose un endpoint qui dit « je suis prête » ; le LB retire les instances non prêtes (§2.7) ;
- des **migrations backward-compatible** : le schéma DB doit fonctionner avec l'ancienne **et** la nouvelle version en même temps, car elles coexistent pendant la bascule (§2.8).

Sans ces briques, aucune stratégie « progressive » n'est réellement sans coupure.

### 2.2 Recreate (big bang) — la baseline à dépasser

On arrête tout, puis on démarre la nouvelle version.

```
v1 ████████  →  (rien)  →  v2 ████████
                 ↑ downtime
```

| Avantage | Inconvénient |
|---|---|
| Trivial à écrire | **Downtime** garanti pendant la bascule |
| Une seule version en vol (pas de compat) | Rollback = redéployer, donc lent |
| Coût nul (pas d'instances en double) | Inacceptable pour un service public |

C'est ce que fait le `deploy` du §1. Utile en dev/staging ou pour un batch nocturne ; à bannir sur un front public comme TribuZen.

### 2.3 Rolling update — remplacer instance par instance

On remplace les instances **par vagues**, en gardant toujours assez d'instances saines pour servir le trafic. C'est la stratégie par défaut de la plupart des orchestrateurs.

Deux paramètres pilotent le rythme (vocabulaire Kubernetes, mais l'idée est universelle) :

- **`maxUnavailable`** : combien d'instances peuvent être **indisponibles** à un instant donné. `0` = on ne descend jamais sous la capacité nominale.
- **`maxSurge`** : combien d'instances **en plus** de la cible on autorise temporairement. `1` = on peut monter une instance neuve avant d'en retirer une vieille.

```yaml
# Kubernetes — illustration conceptuelle (détail cluster = cours 12)
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # +1 instance neuve avant d'en couper une
      maxUnavailable: 0    # jamais sous la capacité → zero-downtime
```

```
v1 v1 v1 v1
v1 v1 v1 v1 (v2)   ← surge : on monte une v2, on attend son health check
v1 v1 v1 v2        ← puis on retire une v1
...
v2 v2 v2 v2        ← après N vagues
```

Points clés :
- **Les deux versions coexistent** pendant tout le rollout → compat DB obligatoire (§2.8).
- Le rollout **s'arrête** si une nouvelle instance ne devient jamais « prête » (health check KO) : le trafic reste sur les v1 saines. C'est un garde-fou natif, mais le rollback n'est **pas instantané** (il faut re-rouler dans l'autre sens).
- Bon compromis par défaut : zero-downtime, pas de double coût, mais bascule progressive donc **lente à annuler**.

### 2.4 Blue-green — deux environnements complets, un switch

On maintient **deux environnements de prod identiques** : **blue** (actif) et **green** (au repos). On déploie N+1 sur green, on le teste à froid, puis on **bascule tout le trafic** d'un coup au niveau du LB.

```
        LB → BLUE (v1) actif        GREEN (v2) en préparation, testé à froid
        LB → GREEN (v2) actif       BLUE (v1) devient le filet de secours
```

- **Bascule instantanée** : le LB pointe de blue vers green en une opération. Pas de coexistence prolongée des deux versions **sur le trafic réel**.
- **Rollback instantané** : si green déraille, on re-pointe le LB sur blue (toujours chaud). C'est le gros avantage vs rolling.
- **Coût** : il faut **deux fois** la capacité pendant la bascule.
- **Piège DB** : les deux partagent en général la **même base**. La migration doit rester backward-compatible, sinon le filet blue ne fonctionne plus après un `contract` de schéma (§2.8).

```yaml
# GitHub Actions — orchestration blue-green (les scripts parlent au LB/cloud)
    steps:
      - name: Déployer sur green
        run: ./scripts/deploy.sh green "${{ github.sha }}"
      - name: Health check green (à froid, avant trafic)
        run: ./scripts/health.sh https://green.internal.tribuzen.fr/health
      - name: Basculer le trafic vers green
        run: ./scripts/switch-traffic.sh green
      - name: Vérifier la prod après bascule
        run: ./scripts/health.sh https://app.tribuzen.fr/health
```

### 2.5 Canary — exposer progressivement, piloté par métriques

On envoie N+1 à une **petite fraction** du trafic réel (le « canari »), on **observe des métriques**, et on **augmente par paliers** seulement si les signaux sont bons. Sinon on **rollback** avant que la majorité des utilisateurs soit touchée.

```
5 %  →  observe 10 min  →  25 %  →  observe  →  50 %  →  100 %
   \_ métriques mauvaises ? → rollback immédiat, 95 % des users jamais impactés
```

Métriques de décision (comparées **canary vs stable**, pas dans l'absolu) :
- **taux d'erreurs** (5xx, exceptions) ;
- **latence** P95/P99 ;
- **métriques métier** (pour TribuZen : taux de création d'événement, échecs d'invitation).

```yaml
# GitHub Actions — canary progressif avec porte de décision
    steps:
      - name: Canary 5 %
        run: ./scripts/canary.sh set 5 "${{ github.sha }}"
      - name: Analyser (erreurs + latence canary vs stable)
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms
      - name: Promouvoir à 25 %
        run: ./scripts/canary.sh set 25 "${{ github.sha }}"
      - name: Analyser
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms
      - name: Rollout complet
        run: ./scripts/canary.sh set 100 "${{ github.sha }}"
      - name: Rollback si une étape échoue
        if: failure()
        run: ./scripts/canary.sh set 0 "${{ github.sha }}"   # retour 100 % stable
```

C'est la stratégie **la plus sûre** pour un changement risqué : le rayon d'impact d'un bug est plafonné au pourcentage courant. Coût : outillage de métriques + décision (souvent automatisé par des outils type Argo Rollouts / Flagger — hors périmètre ici, cours 12/16).

### 2.6 Feature flags — découpler déploiement et release

**Déploiement** = mettre le code en prod. **Release** = le rendre visible aux utilisateurs. Un **feature flag** (interrupteur lu à l'exécution) sépare les deux : on **déploie** du code inactif, on l'**active** plus tard, sans redéployer.

```ts
// Le code de la nouvelle planif est DÉPLOYÉ, mais caché derrière un flag
if (flags.isEnabled('new-scheduler', { userId, familyId })) {
  return renderNewScheduler()
}
return renderLegacyScheduler()
```

Ce que ça débloque :
- **activer/désactiver sans déploiement** → rollback d'une feature en une bascule de flag (bien plus rapide qu'un rollback d'artefact) ;
- **rollout par segment** : 5 % des familles, puis les beta-testeurs, puis tous — un canary **au niveau feature**, pas au niveau infrastructure ;
- **A/B testing** et **kill switch** d'urgence.

Coût / discipline : chaque flag est une **branche de code** à maintenir ; il faut les **retirer** une fois la feature stabilisée, sinon la dette de flags explose.

**Dark launch (shadow traffic)** : cas particulier où on exécute le nouveau chemin **sans exposer son résultat** à l'utilisateur — par exemple appeler le nouveau moteur de recommandation en parallèle de l'ancien, comparer/mesurer, mais ne renvoyer que la réponse de l'ancien. On teste la **charge et la justesse** en conditions réelles avant d'exposer quoi que ce soit.

### 2.7 Health checks — liveness, readiness, startup

Le LB et l'orchestrateur ont besoin de savoir, par instance, « prête ? » et « vivante ? ». Trois sondes distinctes, souvent confondues :

| Sonde | Question | Échec → action |
|---|---|---|
| **liveness** | Le process est-il vivant (pas deadlock) ? | **Redémarrer** l'instance |
| **readiness** | Peut-elle recevoir du trafic **maintenant** (DB connectée, cache chaud) ? | **La retirer du LB** (sans la tuer) |
| **startup** | Le démarrage lent est-il terminé ? | Attendre avant de lancer liveness/readiness |

La **readiness** est le pivot du zero-downtime : une instance neuve n'entre dans le LB que quand elle se déclare prête, et une instance qu'on va arrêter se déclare **non prête** d'abord (drain), le temps de finir ses requêtes en cours.

```ts
// TribuZen — endpoint readiness : prêt seulement si les dépendances répondent
app.get('/health/ready', async (_req, res) => {
  const dbOk = await db.ping().then(() => true).catch(() => false)
  if (!dbOk) return res.status(503).json({ status: 'not-ready' })
  return res.status(200).json({ status: 'ready' })
})
```

> Distinction fréquente à rater : **liveness KO → on tue et relance** ; **readiness KO → on retire du trafic mais on laisse vivre** (l'instance peut redevenir prête). Confondre les deux fait redémarrer en boucle une instance simplement occupée.

### 2.8 Rollback, rollforward et migrations backward-compatible

Quand N+1 est mauvais, deux réactions :

- **Rollback** : revenir à N (l'artefact précédent, déjà buildé et connu bon). Rapide et sûr — c'est le réflexe par défaut. Blue-green et canary rendent le rollback quasi instantané.
- **Rollforward** : corriger en avant, déployer N+2. Choisi quand **on ne peut pas** revenir en arrière — typiquement après une **migration destructive** de la base (une colonne supprimée ne se « dé-supprime » pas). Plus lent, plus risqué.

Le facteur qui décide lequel est possible, c'est le **schéma DB**. La règle d'or **expand/contract** (aussi dit *parallel change*) rend toute migration compatible avec deux versions en vol :

1. **Expand** — déployer un changement **additif** : ajouter la nouvelle colonne `display_name`, garder l'ancienne `member_name`. Les deux versions fonctionnent.
2. **Migrate** — le code N+1 écrit dans les deux (ou une backfill copie les données), le code lit encore l'ancienne au besoin.
3. **Contract** — **seulement quand plus aucune** instance de l'ancienne version ne tourne, on retire `member_name`, dans un déploiement **ultérieur**.

L'erreur du §1 était de faire `expand` **et** `contract` dans le même déploiement (renommer = supprimer + ajouter d'un coup). En découpant, l'ancienne version survit pendant tout le rollout, et **le rollback reste possible** jusqu'à l'étape `contract`.

---

## 3. Worked examples

### Exemple 1 — canary TribuZen à 3 paliers avec rollback automatique

Objectif : livrer la nouvelle planification (risquée) à 5 %, 25 %, puis 100 % des familles, en annulant si les erreurs ou la latence dérivent.

```yaml
# .github/workflows/ci.yml — job deploy en canary
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: production            # protégé par un reviewer requis (approbation avant prod)
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/checkout@v7

      # Palier 1 : 5 % du trafic sur la nouvelle image
      - name: Canary 5 %
        run: ./scripts/canary.sh set 5 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

      # Porte de décision : compare canary vs stable sur 10 min
      # (le script sort en erreur si un seuil est dépassé → stoppe le job)
      - name: Analyse 5 %
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms

      - name: Canary 25 %
        run: ./scripts/canary.sh set 25 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - name: Analyse 25 %
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms

      # Rollout complet : 100 % basculé sur la nouvelle version
      - name: Rollout 100 %
        run: ./scripts/canary.sh set 100 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

      # Filet : si N'IMPORTE quelle étape précédente a échoué, on remet 100 % stable
      - name: Rollback automatique
        if: failure()
        run: ./scripts/canary.sh set 0 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

Lecture : chaque `analyze.sh` est une **porte**. S'il dépasse un seuil, il renvoie un code d'erreur, le step échoue, les steps de promotion suivants sont **sautés**, et le step `if: failure()` ramène le trafic à 100 % stable. Au pire, seuls 5 % (ou 25 %) des utilisateurs auront vu le bug, quelques minutes. Le `environment: production` ajoute une **approbation humaine** avant même le palier 5 % (module 02).

### Exemple 2 — renommer une colonne sans casser (expand/contract)

Le bug du §1 : renommer `member_name` → `display_name` en un déploiement fait tomber l'ancienne version encore en vol. On le découpe en **trois déploiements** backward-compatible.

```sql
-- Déploiement A — EXPAND (purement additif, aucune version ne casse)
ALTER TABLE members ADD COLUMN display_name TEXT;
UPDATE members SET display_name = member_name;   -- backfill des lignes existantes
```

```ts
// Déploiement A (code) — écrit dans les DEUX colonnes, lit encore l'ancienne
async function renameMember(id: string, name: string) {
  await db.members.update(id, { member_name: name, display_name: name })
}
function getName(m: Member) {
  return m.display_name ?? m.member_name   // tolère les lignes pas encore backfillées
}
```

```ts
// Déploiement B — le code ne lit/écrit plus QUE display_name.
// member_name existe toujours en base : rollback vers A reste possible.
async function renameMember(id: string, name: string) {
  await db.members.update(id, { display_name: name })
}
function getName(m: Member) {
  return m.display_name
}
```

```sql
-- Déploiement C — CONTRACT : seulement une fois que plus AUCUNE instance
-- n'utilise member_name (déploiement B stabilisé). Destructif => plus de rollback au-delà.
ALTER TABLE members DROP COLUMN member_name;
```

À aucun moment deux versions coexistantes ne se contredisent : A et B tolèrent tous les deux les deux colonnes. Le seul point de non-retour est C, exécuté **après** avoir confirmé que B est sain.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « rolling update » suffit à être zero-downtime

Un rolling update qui remplace les instances **sans readiness check** route du trafic vers une instance pas encore prête → 502 pendant son démarrage. Le zero-downtime vient du **couple** rolling + readiness (§2.7), pas du rolling seul. `maxUnavailable: 0` sans readiness fiable est une fausse sécurité.

### PIÈGE #2 — Faire expand ET contract dans le même déploiement

Renommer/supprimer une colonne d'un coup casse l'ancienne version tant qu'elle tourne (le cas du §1). Toute migration doit être **backward-compatible** ; le `contract` (suppression) vient dans un déploiement **ultérieur**, une fois l'ancienne version totalement retirée (§2.8).

### PIÈGE #3 — Confondre déploiement et release

« C'est déployé donc c'est sorti » est faux dès qu'il y a des feature flags. On peut **déployer** du code inactif et **releaser** plus tard en basculant un flag. Confondre les deux fait paniquer sur un rollback d'artefact alors qu'un simple `flag off` suffisait.

### PIÈGE #4 — Confondre liveness et readiness

**liveness KO → on tue et relance** l'instance ; **readiness KO → on la retire du trafic mais on la laisse vivre**. Brancher un redémarrage sur un readiness qui tombe (ex. DB momentanément lente) fait entrer l'instance en **crash-loop** au lieu de juste la sortir du LB le temps que ça revienne.

### PIÈGE #5 — Blue-green sans compat DB

On croit le rollback blue-green « gratuit » car blue reste chaud. Mais si la migration a fait un `contract` sur la base **partagée**, revenir sur blue (ancien code) le fait planter sur un schéma qu'il ne connaît plus. Le rollback instantané n'existe que si le **schéma** est compatible avec les deux versions.

### PIÈGE #6 — Canary jugé dans l'absolu, pas contre le stable

Regarder « le canary a 0,5 % d'erreurs, c'est bon » sans comparer au stable masque une régression si le stable était à 0,1 %. Une porte de canary compare **canary vs stable** sur la même fenêtre, pas à un seuil fixe sorti du chapeau.

### PIÈGE #7 — Oublier de retirer les feature flags

Un flag laissé en place après stabilisation devient une branche morte, un chemin non testé et une source de bugs (« pourquoi ce code ne s'exécute jamais ? »). Un flag a un **cycle de vie** : créer → rollout → 100 % → **retirer le flag et le code mort**.

---

## 5. Ancrage TribuZen

Le fil-rouge du cours est le **pipeline CI/CD de TribuZen**. Ce module transforme le job `deploy` (recreate, §1) en déploiement sans coupure :

- **`.github/workflows/ci.yml`** — le job `deploy` passe en **canary** à 3 paliers avec porte de métriques et `if: failure()` de rollback (Exemple 1), derrière l'`environment: production` (approbation, module 02).
- **`src/routes/health.ts`** — endpoints `/health/live` et `/health/ready` (§2.7) ; le LB ne route que vers les instances `ready`, condition du zero-downtime.
- **Migrations Prisma** — toute évolution de schéma suit **expand → migrate → contract** (Exemple 2) pour garder le rollback possible et ne jamais casser une version en vol.
- **Feature flags** — la refonte de la planification familiale est **déployée cachée**, puis activée par vague (beta-familles → tous), et coupée par kill switch en cas d'incident (§2.6).

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  .github/workflows/ci.yml     ← job deploy en canary + rollback
  src/routes/health.ts         ← liveness / readiness
  prisma/migrations/           ← migrations expand/contract
  scripts/
    canary.sh                  ← set <pct> <sha>
    analyze.sh                 ← porte métriques canary vs stable
```

> La config précise de l'orchestrateur (Kubernetes, LB cloud) est le **cours 12** ; les dashboards de métriques qui alimentent `analyze.sh`, le **cours 16** ; l'OIDC pour déployer sans secret long terme, le **module 08**. Ici, on choisit la **stratégie** et on la câble dans le pipeline.

---

## 6. Points clés

1. **Zero-downtime** = à tout instant une instance saine dans le LB + health checks + migrations backward-compatible. Aucune stratégie progressive n'est sans coupure sans ces trois briques.
2. **Recreate** : simple mais downtime garanti et rollback lent — réservé au dev/batch, jamais un front public.
3. **Rolling update** : remplace par vagues (`maxSurge`/`maxUnavailable`), zero-downtime sans double coût, mais **lent à annuler** et impose la coexistence des deux versions.
4. **Blue-green** : deux environnements complets, **switch et rollback instantanés** au LB, coût x2, et rollback réel seulement si la DB reste compatible.
5. **Canary** : exposition progressive pilotée par **métriques canary vs stable**, rollback avant que la majorité soit touchée — le plus sûr pour un changement risqué.
6. **Feature flags** découplent **déploiement** (code en prod) et **release** (visible) : rollout par segment, kill switch, mais discipline de retrait des flags. **Dark launch** = exécuter le nouveau chemin sans exposer son résultat.
7. **Health checks** : liveness (vivant → **relancer**), readiness (prêt au trafic → **retirer du LB**), startup (démarrage lent). Readiness est le pivot du zero-downtime.
8. **Rollback** (revenir à N, réflexe par défaut) vs **rollforward** (corriger en avant, imposé après migration destructive). L'**expand/contract** garde le rollback possible.

---

## 7. Seeds Anki

```
Qu'est-ce qu'un déploiement zero-downtime et de quoi dépend-il ?|Passer de N à N+1 sans qu'aucune requête n'échoue. Repose sur 3 briques : un LB avec au moins une instance saine à tout instant, des health checks (readiness) qui filtrent le trafic, et des migrations DB backward-compatible (les deux versions coexistent).
Rolling update : que contrôlent maxSurge et maxUnavailable ?|maxSurge = combien d'instances EN PLUS de la cible sont autorisées temporairement (permet de monter une neuve avant de couper une vieille). maxUnavailable = combien peuvent être indisponibles à la fois ; 0 = jamais sous la capacité nominale → zero-downtime.
Différence de rollback entre rolling update et blue-green ?|Rolling : rollback lent, il faut re-rouler la bascule dans l'autre sens. Blue-green : rollback quasi instantané, on re-pointe le LB sur l'environnement précédent (blue) resté chaud — à condition que le schéma DB soit resté compatible.
Comment un canary décide-t-il de promouvoir ou rollback ?|Il compare des métriques du canary VS le stable (taux d'erreurs, latence P95/P99, métriques métier) sur une fenêtre. Si un seuil est dépassé, rollback avant d'augmenter le % ; sinon on promeut au palier suivant (5 % → 25 % → 100 %).
Feature flag : quelle distinction fondamentale permet-il ?|Découpler déploiement (mettre le code en prod) et release (le rendre visible). On déploie du code inactif et on l'active plus tard via un interrupteur runtime — rollout par segment, kill switch, rollback d'une feature sans redéployer.
Qu'est-ce qu'un dark launch (shadow traffic) ?|Exécuter le nouveau chemin de code en conditions réelles SANS exposer son résultat à l'utilisateur (on garde la réponse de l'ancien). Sert à mesurer charge et justesse du nouveau code avant de l'exposer.
Liveness vs readiness : quelle action sur échec ?|Liveness KO → le process est bloqué, on TUE et relance l'instance. Readiness KO → l'instance n'est pas prête (ex. DB lente), on la RETIRE du load balancer sans la tuer ; elle peut redevenir prête. Les confondre provoque des crash-loops.
Rollback vs rollforward : quand choisir chacun ?|Rollback = revenir à N (artefact précédent connu bon), réflexe rapide par défaut. Rollforward = corriger en avant vers N+2, imposé quand on ne PEUT pas revenir (ex. migration destructive : une colonne supprimée ne revient pas).
En quoi consiste la règle expand/contract pour les migrations ?|Découper une migration en étapes backward-compatible : EXPAND (ajout additif, ex. nouvelle colonne, les 2 versions marchent) → MIGRATE (le code bascule progressivement) → CONTRACT (suppression de l'ancien, seulement quand plus aucune ancienne version ne tourne). Garde le rollback possible.
Pourquoi renommer une colonne en un seul déploiement casse la prod ?|Renommer = supprimer + ajouter d'un coup (expand ET contract ensemble). Pendant le rollout, l'ancienne version encore en vol cherche la colonne disparue → erreurs 500. Il faut découper en expand/contract sur plusieurs déploiements.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-06-strategies-deploiement/README.md`. Concevoir la stratégie de déploiement zero-downtime de TribuZen (canary à paliers + rollback automatique + health checks + plan de migration expand/contract) — corrigé commenté, feedback coach en session.
