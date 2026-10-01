# 04 — Orchestration, commandes et reprise

Statut : spécification à implémenter, pas description de fonctions déjà disponibles. Prérequis : 01–03. Les noms des nouvelles commandes ci-dessous constituent le contrat à développer.

## 1. API de commandes du studio

Enregistrer src/commands/production.js dans src/commands/index.js. Ajouter les schémas à l’index exposé par src/studio-agent-protocol.js et les résumés à src/studio-app-binding.js. Ne pas appeler directement les setters React depuis les outils agent.

| Commande | Entrée minimale | Effet et sortie |
| --- | --- | --- |
| production.connect | connectionId, projectId | Lie une source sans supprimer le projet ouvert ; retourne manifest |
| production.fetch | sections[], revision | Charge les pages demandées, valide, publie le snapshot local |
| production.prepare | scopeIds[] optionnel | Compile un brouillon et retourne problèmes + unités ; aucun appel payant |
| production.adapt | sourceIds[], expectedPlanRevision | Propose une adaptation texte legacy, avec autorisation dédiée ; brouillon seulement (05 §10) |
| production.read | scope, cursor, limit | Détails paginés source/plan/bindings/runs/errors |
| production.updateDraft | expectedPlanRevision, operations[] | Patches typés du brouillon ; recompilation des dépendances |
| production.acceptPlan | expectedPlanRevision | Fige le plan exécutable validé |
| production.runStage | stage, scopeIds[], expectedPlanRevision | Démarre les unités déjà autorisées et prêtes |
| production.runUnit | unitId, expectedInputHash | Exécute une seule unité autorisée |
| production.pause | runId | Interdit toute nouvelle soumission ; installation arrêtée à une frontière sûre |
| production.resume | runId | Réconcilie puis reprend les unités restantes autorisées |
| production.retry | unitId, expectedAttempt | Nouvelle tentative après classification de l’échec |
| production.verify | scopeIds[] | Vérifications structurelles puis visuelles disponibles |
| production.export | expectedPlanRevision, options | Exporte uniquement une production vérifiée |

Toutes les commandes ciblant une production incluent productionId, sauf connect qui crée le candidat à partir de connectionId/projectId. Les commandes de consultation sont query. Les patches et acceptations sont document, domaine production. Les exécutions sont job à retour initial rapide (runId/jobId), suivies par job.await ou le journal. Ne pas retenir un verrou documentaire pendant une attente réseau. Pause/reprise sont contrôles du runner ; elles ne réécrivent pas les scènes.

Limiter chaque résultat au budget de reçu du bus (8 192 octets), indépendamment du nombre d’items. Tronquer les descriptions avec indication explicite et curseur stable ; un détail individuel trop long se lit par pages. La production complète n’entre jamais dans le contexte système de l’agent.

## 2. Étapes et graphe de dépendances

Étapes affichées : source → adaptation → décors → personnages → plans → animations → interactions → vérification → export.

Une étape est un regroupement d’unités, pas une transaction monolithique. Dépendances : avatar → cast-instance ; structure/asset → scene-ready ; scene-ready + cast-instance → shot ; cast-instance + action validée → motion-clip ; clips d’un acteur → motion-compose ; motion-compose + prop → interaction ; toutes les unités visuelles → verify → export.

Exemple : A marche puis salue ; B répond. Créer trois unités de génération mono-acteur, deux unités de composition, et les unités caméra indépendantes. B ne dépend pas de la génération du salut de A sauf contrainte narrative explicite. Un échec de A laisse le résultat B disponible.

## 3. Autorisation des appels payants

Le bouton d’étape présente avant lancement : nombre d’avatars, nombre de clips, durée totale demandée, fournisseur, et coût uniquement si connu. Un coût inconnu reste « inconnu », jamais zéro.

Un consentement utilisateur crée un grant en mémoire associé à runId, planRevision, ensemble exact d’unités/inputHashes et limites de soumission. Aucun booléen force/authorized transmis par l’agent ne donne cette autorisation. Un changement de prompt, fournisseur ou durée invalide la partie concernée du grant.

Une demande explicite « génère les animations du plan 2 » peut autoriser ce périmètre selon la politique existante de l’application ; elle n’autorise pas les avatars ou les plans suivants. Un agent ne peut s’auto-octroyer un grant par production.runStage.

Adapter bin/agent/studio-tools.mjs et la couche de contrôle réellement utilisée après vérification du dépôt : remplacer pour le chemin production la règle « une génération par personnage par message » par validation d’unités autorisées, et non par suppression globale du garde-fou. Conserver la politique des commandes motion.generate hors production. Les métadonnées des commandes production doivent déclarer leurs effets payants ; ne pas cacher une génération derrière une commande présentée comme simple lecture.

Le runner UI et le runner agent partagent le même compteur et verrou de soumission. Concurrence initiale : un fournisseur motion à la fois, une installation de scène à la fois. Une ressource en cache avec hash identique ne consomme pas une nouvelle soumission.

## 4. Contrat du controller

Créer src/production/controller.js, run-store.js, reconcile.js. Interfaces internes :
~~~ts
prepare(snapshot, overrides): { plan, issues }
start({ planRevision, unitIds, grant }): { runId }
executeUnit(unit, attempt, { signal, emit, resources }): Promise<Result>
reconcile(document, journal, resources): RecoveryReport
~~~

Result sépare artifactRefs, nativeBindings et verification. Les producteurs réseau ne modifient pas une scène. Les installateurs se servent du bus et d’un contexte frais sur la scène ciblée.

Algorithme :
1. Persister l’intention de tentative avant soumission.
2. Vérifier inputHash, grant, dépendances, cache et contexte.
3. Soumettre ; persister immédiatement l’identifiant fournisseur lorsqu’il devient connu.
4. Stocker les octets et leur hash ; état artifact-ready.
5. Vérifier que la production et la scène cible sont toujours compatibles.
6. Installer dans une transaction courte native + binding ; contrôler le résultat.
7. État done seulement après vérification et écriture du checkpoint.

La sortie fournisseur réussie n’est pas une preuve d’installation réussie. Une fermeture entre 4 et 6 doit réinstaller depuis la ressource, sans repayer.

## 5. Machine d’état et idempotence

pending → ready → running → waiting-provider → artifact-ready → installing → verified → done.
blocked indique une dépendance ou décision manquante ; failed un échec connu ; uncertain une soumission dont l’état externe ne peut être prouvé ; stale un résultat devenu incompatible.

Clé locale d’idempotence : project UUID + planRevision + unitId + inputHash. Un mutex IndexedDB/onglet empêche deux exécutions concurrentes du même projet ; un second onglet est consultation seule, avec transfert explicite après expiration du bail.

Ne pas prétendre que cette clé empêche les doublons côté fournisseur si celui-ci ne la supporte pas. En cas de timeout après acceptation possible et sans endpoint de reprise : état uncertain, présenter l’identifiant connu et demander une décision avant nouvelle soumission. La reprise automatique ne lance jamais un second job ambigu.

Journal append-only : eventId, monotonic sequence, timestamp, runId, unitId, attempt, state, phase, message, progressKnown, resourceRefs, errorCode. Pas de clé, URL signée ou prompt sensible dans les logs serveur.

## 6. Modifications locales et annulation

Si l’utilisateur change de scène pendant un job, la génération peut terminer en ressource ; l’installation attend un contexte cible vérifié. Si le projet change, ne rien installer dans le nouveau projet. Un AbortSignal doit traverser le client et le serveur quand leur API le permet.

Une annulation locale ne garantit pas l’arrêt ni le remboursement d’un job externe. Afficher séparément stopRequested et providerCancelled. Une ressource tardive doit être stockée avec provenance ou rejetée explicitement, jamais associée à une nouvelle tentative.

À la reprise, vérifier bindings, hashes de projections natives, ressources, dépendances et révisions. Une modification manuelle crée override/conflict ; elle n’est pas effacée par un second clic.

## 7. Tests de livraison

Créer test/verify-production-controller.mjs, test/verify-production-recovery.mjs et test/bus/verify-production-commands.mjs ; enregistrer dans tools/run-tests.mjs. Cas requis : double clic ; deux onglets ; trois clips pour deux acteurs ; retour tardif après changement de projet ; pause entre génération et installation ; crash après octets reçus ; crash pendant commit ; ressource manquante ; timeout ambigu sans retry payant ; budget atteint ; hash changé ; résultat dépassant 8 KiB.

Test navigateur : lancer uniquement les décors, fermer/recharger, reprendre, puis générer un clip sélectionné. Les autres étapes restent non lancées et le journal permet d’expliquer chaque état.

## 8. Exemples de contrat commande et reçu

Les envelopes ci-dessous sont des exemples sémantiques ; utiliser l’envelope réelle du bus pour transport. Les objets args sont les payloads exacts à valider. Chaque schéma est additionalProperties:false ; IDs/hash/revisions obligatoires sur toute mutation ciblée.

~~~json
{
  "action": "production.fetch",
  "args": {
    "productionId": "13e7da1d-9487-4d78-8aee-a6f9311ba088",
    "revision": "r17",
    "sections": ["characters", "sets"]
  }
}
~~~

~~~json
{
  "action": "production.runStage",
  "args": {
    "productionId": "13e7da1d-9487-4d78-8aee-a6f9311ba088",
    "stage": "animations",
    "scopeIds": ["SCENE_01"],
    "expectedPlanRevision": 3
  }
}
~~~

~~~json
{
  "status": "accepted",
  "productionId": "13e7da1d-9487-4d78-8aee-a6f9311ba088",
  "runId": "run_01",
  "jobId": "local_job_01",
  "counts": {"ready": 3, "blocked": 0, "cached": 0},
  "nextRead": {"scope": "run", "runId": "run_01", "afterSequence": 0}
}
~~~

~~~json
{
  "action": "production.updateDraft",
  "args": {
    "productionId": "13e7da1d-9487-4d78-8aee-a6f9311ba088",
    "expectedPlanRevision": 3,
    "operations": [
      {"op": "set-prop-height", "sourceId": "CUP", "heightMeters": 0.15},
      {"op": "assign-action-actor", "sourceId": "ACT_A_WAVE", "characterId": "CHAR_A"}
    ]
  }
}
~~~

Pas de patch JSON arbitraire vers toute la scène native. Définir une whitelist d’opérations : set-prop-height, set-placement, assign-action-actor, set-action-window, choose-resource, set-camera-intent, resolve-decision. Limites : 100 opérations par appel, valeurs métriques/temps bornés et références valides. Garder les opérations et source paths pour fusion à trois voies.

production.read accepte scope = summary | source | units | unit | run | errors | bindings, avec selectors dédiés unitId/runId/section, cursor et limit ≤ 100. Les sélecteurs incompatibles donnent INVALID_ARGUMENT. Une commande ciblée sur un autre productionId donne TARGET_NOT_READY.

Codes métier à figer : SOURCE_AUTH_REQUIRED, SOURCE_VERSION_UNSUPPORTED, SOURCE_REVISION_EXPIRED, SOURCE_HASH_MISMATCH, PLAN_NEEDS_DECISION, PLAN_REVISION_CONFLICT, UNIT_INPUT_CHANGED, GRANT_REQUIRED, BUDGET_EXHAUSTED, PROVIDER_STATE_UNCERTAIN, ARTIFACT_MISSING, NATIVE_CONFLICT, UNSUPPORTED_INTERACTION, EXPORT_NOT_VERIFIED. Chaque erreur contient phase et unitId si disponibles, jamais un faux succès avec seulement warning.

Le jobId local est celui du bus ; externalJobId est celui du fournisseur. Ne pas les échanger dans job.await ou importVrmJob.
