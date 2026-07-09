# Lab 06 — Concevoir une stratégie de déploiement zero-downtime

> **Outcome :** à la fin, tu sais concevoir et écrire, pour TribuZen, un **déploiement canary à paliers avec rollback automatique**, un **endpoint readiness**, et un **plan de migration expand/contract** — sur un vrai workflow GitHub Actions.
> **Vrai outil :** GitHub Actions (YAML de workflow réel) + un endpoint HTTP `/health/ready` + du SQL de migration. Aucun harnais simulé.
> **Feedback :** le coach valide la conception en session (il joue le rôle de « prod » et te met en défaut sur les cas limites) — pas de test-runner auto-correcteur.

---

## Énoncé

Le job `deploy` de TribuZen est aujourd'hui un **recreate** qui coupe le service 40 s et casse l'ancienne version dès qu'une migration touche le schéma. Tu dois le **remplacer par un canary sûr** et rendre l'ensemble zero-downtime.

Cahier des charges **exact** :

1. **Canary à 3 paliers** — `5 %` → `25 %` → `100 %` de trafic sur la nouvelle image (<code v-pre>${{ github.sha }}</code>).
2. **Porte de décision** entre chaque palier : un step qui échoue si les métriques dérivent (`analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms`). Un échec doit **empêcher** la promotion au palier suivant.
3. **Rollback automatique** : si **n'importe quel** step précédent échoue, un dernier step ramène le trafic à `100 %` stable (`canary.sh set 0 <sha>`).
4. **Garde de branche + environnement** : ne déployer que sur `main`, derrière un `environment: production` (approbation).
5. **Readiness** : écris l'endpoint `/health/ready` qui renvoie `503` tant que la base ne répond pas, `200` sinon — c'est lui qui permet au LB de ne router que vers des instances prêtes.
6. **Plan de migration** : on doit renommer la colonne `member_name` en `display_name` **sans downtime ni casser le rollback**. Décris les déploiements A/B/C (expand → migrate → contract) et dis à quel moment le rollback devient impossible.

Tu disposes des scripts (fournis par l'équipe infra, tu ne les écris pas) :
`canary.sh set <pct> <sha>` et `analyze.sh --window=... --max-error-rate=... --max-p95=...`.

**Pas de gap-fill** — tu écris le workflow complet à partir du starter ci-dessous.

### Starter minimal

```yaml
# .github/workflows/ci.yml — extrait, à compléter
  deploy:
    needs: build
    # 1. garde de branche à ajouter
    runs-on: ubuntu-latest
    # 2. environment production à ajouter
    steps:
      - uses: actions/checkout@v7
      # 3. paliers canary 5 / 25 / 100 avec portes analyze.sh entre eux
      # 4. rollback automatique en fin de job
```

---

## Étapes (en friction)

1. **Garde + environnement** — ajoute `if: github.ref == 'refs/heads/main'` et un bloc `environment: { name: production, url: ... }`.
2. **Palier 5 %** — un step `canary.sh set 5 "<sha>"`, avec le `DEPLOY_TOKEN` passé en `env` depuis les secrets.
3. **Porte 5 %** — un step `analyze.sh` ; réfléchis à ce qui se passe s'il sort en code d'erreur (les steps suivants sont-ils exécutés ?).
4. **Paliers 25 % puis 100 %** — répète promotion + porte ; note qu'après 100 % il n'y a plus de porte.
5. **Rollback** — un dernier step avec la bonne condition pour ne se déclencher **que** si un step précédent a échoué (indice : fonction de statut vue au module 02).
6. **Readiness** — écris `/health/ready` : ping DB → `503`/`200`. Demande-toi pourquoi on ne redémarre PAS l'instance sur un readiness KO.
7. **Migration** — écris les 3 étapes A/B/C et **justifie** : à partir de quel déploiement le rollback est-il perdu, et pourquoi ?
8. **Cas limites à défendre devant le coach** : (a) `analyze.sh` échoue au palier 25 % — qui voit le bug, combien de temps, quel état final ? (b) la migration fait expand+contract d'un coup — que se passe-t-il pendant le rollout ?

---

## Corrigé complet commenté

```yaml
# .github/workflows/ci.yml — job deploy en canary avec rollback
  deploy:
    needs: build
    # Garde de branche : jamais de déploiement depuis une PR, uniquement main
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    # Environnement protégé : un reviewer requis met le job en pause AVANT le palier 5 %
    # (règle "required reviewers" configurée dans Settings → Environments, pas dans le YAML)
    environment:
      name: production
      url: https://app.tribuzen.fr
    steps:
      - uses: actions/checkout@v7

      # --- Palier 1 : 5 % du trafic sur la nouvelle image ---
      - name: Canary 5 %
        run: ./scripts/canary.sh set 5 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

      # Porte : compare canary vs stable sur 10 min. Le script sort en code d'erreur
      # si un seuil est dépassé → le step ÉCHOUE → les steps de promotion suivants
      # sont SAUTÉS (comportement par défaut), et seul le rollback (if: failure) tournera.
      - name: Analyse 5 %
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms

      # --- Palier 2 : 25 % ---
      - name: Canary 25 %
        run: ./scripts/canary.sh set 25 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - name: Analyse 25 %
        run: ./scripts/analyze.sh --window=10m --max-error-rate=1% --max-p95=400ms

      # --- Rollout complet : 100 %, plus de porte après ---
      - name: Rollout 100 %
        run: ./scripts/canary.sh set 100 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

      # --- Filet : ne se déclenche QUE si un step précédent a échoué ---
      # failure() = vrai dès qu'un step antérieur du job a échoué. set 0 = 100 % stable.
      - name: Rollback automatique
        if: failure()
        run: ./scripts/canary.sh set 0 "${{ github.sha }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

```ts
// src/routes/health.ts — readiness
// 200 seulement si la dépendance critique (DB) répond. Sinon 503 :
// le load balancer RETIRE l'instance du trafic sans la tuer (contrairement à liveness).
app.get('/health/ready', async (_req, res) => {
  const dbOk = await db.ping().then(() => true).catch(() => false)
  if (!dbOk) return res.status(503).json({ status: 'not-ready' })
  return res.status(200).json({ status: 'ready' })
})

// Liveness séparé : le process tourne-t-il ? KO → l'orchestrateur REDÉMARRE l'instance.
// On ne met PAS le ping DB ici : une DB lente ne doit pas provoquer un crash-loop.
app.get('/health/live', (_req, res) => res.status(200).json({ status: 'alive' }))
```

```sql
-- Migration member_name → display_name, en 3 déploiements backward-compatible.

-- Déploiement A — EXPAND : purement additif, aucune version ne casse.
ALTER TABLE members ADD COLUMN display_name TEXT;
UPDATE members SET display_name = member_name;   -- backfill des lignes existantes
-- Code A : écrit member_name ET display_name ; lit display_name ?? member_name.

-- Déploiement B — le code ne lit/écrit plus QUE display_name.
-- member_name existe toujours en base → rollback vers A encore possible.

-- Déploiement C — CONTRACT : SEULEMENT quand plus aucune instance n'utilise member_name.
ALTER TABLE members DROP COLUMN member_name;   -- destructif : rollback perdu au-delà de C.
```

**Pourquoi ce corrigé est correct :**
- Le comportement « un step échoue → les suivants sont sautés » transforme chaque `analyze.sh` en **porte** : un mauvais palier n'est jamais promu.
- `if: failure()` isole le rollback : il ne tourne **que** sur incident, et remet 100 % stable. Au pire, seuls 5 % (ou 25 %) des familles auront vu le bug quelques minutes — c'est tout l'intérêt du canary vs un big-bang.
- La readiness (`503`/`200`) est ce qui permet le zero-downtime : le LB n'envoie du trafic qu'aux instances prêtes, et une instance qu'on arrête se déclare non prête d'abord (drain).
- La migration ne fait jamais expand **et** contract dans le même déploiement : l'ancienne version survit tout le rollout, et le rollback reste possible **jusqu'à C** (le seul point de non-retour, car destructif).

**Réponses aux cas limites :** (a) porte 25 % KO → ~25 % des familles ont pu voir le bug ~10 min, le rollback ramène 100 % stable, état final = ancienne version, aucune perte durable. (b) expand+contract d'un coup → pendant le rollout, l'ancienne version cherche `member_name` supprimé → 500 en série : exactement le bug qu'on élimine.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées** — reproduis la conception **de mémoire, en 30 minutes, sans rouvrir ce corrigé ni le module** :

1. Remplace le canary par un **blue-green** : déploie sur `green`, health-check à froid, bascule le LB, vérifie la prod. Ajoute un rollback qui re-pointe sur `blue`.
2. Ajoute une **contrainte piège** : la migration de cette release **supprime** une table (destructive). Explique au coach pourquoi le rollback blue-green « instantané » **ne fonctionne plus** ici, et quelle stratégie (rollforward) tu choisis à la place.

**Critère de réussite :** le workflow blue-green est cohérent (bascule + rollback au LB) et tu sais expliquer, sans notes, pourquoi une migration destructive casse le filet blue-green et impose un rollforward.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces fichiers vivent ici :

```
tribuzen/
  .github/workflows/ci.yml     ← job deploy en canary + rollback
  src/routes/health.ts         ← /health/ready + /health/live
  prisma/migrations/           ← migrations expand/contract
  scripts/canary.sh            ← fourni par l'infra
  scripts/analyze.sh           ← fourni par l'infra
```

**Différences par rapport au lab :**
- Les seuils de `analyze.sh` seront alimentés par les métriques réelles (cours 16) ; ici on les passe en dur en argument.
- La bascule de trafic parlera au LB/orchestrateur réel (cours 12) ; dans le lab, `canary.sh` l'abstrait.
- Les migrations passeront par `prisma migrate` avec la discipline expand/contract, revue en PR.

**Commit cible :**
```
feat(deploy): canary 5/25/100 + rollback auto, readiness, migration expand/contract
```
