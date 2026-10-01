# 10 — Préparation sémantique 3D par IA

Statut : SPEC À IMPLÉMENTER, pas code livré. Date : 1er octobre 2026.
Dépôt distant : C:/Users/pulsy/Videos/workflow_gen_short_with_ia. Prompts complets : [11 — Prompts](11-prompts-preparation-3d.md).
Cette spec complète 09. Elle ne demande ni nouvelle génération image/vidéo, ni paiement GPU, ni modification automatique du projet ouvert dans le studio.

## 1. Résultat et frontières

Sur reproduction, bouton « Préparer pour le Studio 3D ». L'utilisateur choisit le modèle configuré, vérifie les ressources et le budget, lance un job suivi, examine le candidat et ses hypothèses, puis applique au brouillon et publie séparément. Le studio récupère une révision publiée et installe les éléments via ses commandes production.* existantes.

Chaîne : source reproduction figée -> analyse sémantique -> bible spatiale -> découpage -> actions par acteur -> assemblage déterministe -> validation -> revue humaine -> brouillon -> publication -> import studio.

Le LLM invente uniquement les détails spatiaux nécessaires qui manquent, sous forme d'hypothèses déclarées. Le code garde l'autorité sur les IDs, timestamps, ressources, versions, checks physiques simples et capacités. Une validation JSON ne prouve ni géométrie parfaite, ni réussite de motion, ni lipsync.

Aucun GET n'appelle un LLM, ne crée un brouillon, ni ne publie. Les auto-publications actuelles dans get_latest_manifest et l'initialisation par GET /draft doivent être retirées. Une conversion legacy sans IA reste possible via POST explicite, avec sourceMode=legacy et avertissements ; jamais présentée comme une préparation structurée fidèle.

## 2. Fichiers et responsabilités

### Backend distant existant à modifier

| Fichier | Modification |
| --- | --- |
| app/api/studio_routes.py | Routes de jobs, résultat, application, décisions ; GET sans mutation ; routes publiées compatibles |
| app/db/models_studio.py | Tables job/étape/événement/consentement ; versions optimistes ; index et contraintes |
| app/schemas/studio_story.py | Extensions de contrat nécessaires ; conserver cozy-story-v1 pour champs compatibles |
| app/services/studio_story_adapter.py | Extraction legacy pure séparée du candidat IA ; pas de substitution d'un modèle imaginé |
| app/services/studio_story_snapshots.py | Publication conditionnée par version et revue ; aucune IA dans publication |
| app/services/studio_story_validation.py | Vérification avant/après génération, publication et application ciblée |
| app/services/llm_factory.py | Réutiliser get_llm_service(provider, model) ; pas de second système de fournisseurs |
| templates/reproduction.html | Inclure un panneau Studio 3D et initialiser avec le video_id réel |
| app/main.py | Monter les routes et le cycle de vie du worker durable ; arrêt propre |
| app/db/database.py | Enregistrement des modèles et migration réelle des tables existantes |

### Nouveaux fichiers distants

- app/schemas/studio_preparation.py : entrées API, sorties strictes de chaque étape, états, décisions et métadonnées.
- app/services/studio_source_bundle.py : lectures cohérentes Video/CharacterBible/ReproductionPlan/TTSAudio, provenance, registry d'IDs et fenêtres canoniques.
- app/services/studio_preparation_service.py : orchestration, checkpoints, reprise, budget et protections de version.
- app/services/studio_preparation_worker.py : prise en charge durable avec lease, annulation, renouvellement et récupération après crash.
- app/services/studio_preparation_llm.py : adaptateur fournisseur JSON, limites, validation de sortie, timeout ; aucun outil de filesystem/browser/shell accessible au modèle.
- app/services/studio_preparation_assembler.py : conversion IR -> CozyStory, assemblage de résultats par ID, temps local/global.
- app/services/studio_preparation_validation.py : invariants inter-étapes, continuité et capacités.
- app/prompts/studio3d/{common,extract,world,direction,actions,review,repair,regenerate}.txt : textes du document 11.
- app/config/studio_capabilities.json : profil versionné déclaré, validé contre les fixtures du studio.
- templates/components/reproduction/_studio3d_panel.html ; static/js/studio3d-preparation.js ; static/css/studio3d-preparation.css : interface, poll, éditeur de décisions et aperçu tabulaire. Vérifier le montage /static existant avant intégration ; ne pas dupliquer un bundle frontend déjà utilisé.
- scripts/migrate_studio_preparation.py : migration --dry-run, copie de base en recette, index sur tables existantes.
- tests/test_studio_preparation_{api,worker,prompts,validation,concurrency}.py et fixtures dédiées.

Ne pas réutiliser app/api/jobs.py comme source de vérité : son JobStore est en mémoire, effacé au redémarrage. Il peut fournir des helpers UI, pas la durabilité requise.

### Studio local : périmètre minimal de compatibilité

Inspecter src/production/{source-contract,compiler,geometry,camera-planner}.js et installers. Ajouter les gardes de capabilities et l'affichage des métadonnées de préparation dans src/panels/ProductionPanel.jsx si elles ne sont pas déjà supportées. src/production/normalize.js conserve extensions.studioPreparation. N'exécuter aucun travail distant de préparation depuis Récupérer. Nouveau POST depuis le studio : hors V1, nécessite une commande explicite, confirmation de budget et routes sidecar dédiées.

## 3. Contrats : ne pas confondre source, candidat et snapshot

### SourceBundle v1, produit par le serveur

Champs exacts : bundleVersion=1, projectId, title, sourceFingerprint, sourceVersion, selectedTtsId (nullable), project {fps:24, aspect, durationSeconds}, sourceRecords, registry, canonicalTimeline, resourceCatalog, existingDraft, protectedFields, userInstructions.

sourceRecords contient uniquement les colonnes nécessaires de Video, bible analysis, reproduction plan, narration texte et métadonnées TTS. Chaque fragment dispose d'un sourceRef serveur (ex: bible/characters/0, plan/shots/2/action). Pas de tokens, chemins absolus, credentials ni métadonnées privées superflues.

registry fixe les IDs autorisés : characters, sets, props, scenes, shots, actionSlots. Le serveur génère des IDs canonisés avec mapping vers les IDs source. Le modèle peut demander un nouvel élément via requestedEntities [{temporaryKey,kind,reason,sourceRefs}] ; il ne fabrique pas d'ID définitif. Le serveur étend le registry, puis relance uniquement l'étape impactée. Une actionSlot lie un id, sceneId, characterId et une fenêtre ; si l'attribution est inconnue, ne pas allouer silencieusement au premier personnage.

canonicalTimeline est calculé par code depuis les timings choisis : scènes et plans avec startFrame/endFrameExclusive GLOBAL, narration avec horodatages existants et normalisation consignée. Si aucune segmentation scène fiable : étape direction propose des frontières sur cuts existants, puis le serveur crée les scènes et confirme les fenêtres avant actions. Les champs de timing restent gelés pendant world/actions. Les trous, overlaps et désaccords audio/durée créent une décision ; ne pas rallonger un plan de 4 s par défaut.

resourceCatalog décrit uniquement les vrais fichiers connus du serveur. Le LLM peut référencer resourceId mais jamais inventer SHA, taille, URL, fichier ni path. Bibliothèque : suggérer query uniquement ; résolution/téléchargement dans le studio ensuite. Avatar generate : produire description, pas faux VRM.

sourceFingerprint stable sur les données sources et choix utilisateur pertinents ; exclure revision publiée, jobId, dates de lecture. sourceVersion et draftVersion servent au compare-and-swap, fingerprint seul ne remplace pas un verrou de version.

### PrepareIR v1, interne au backend

Chaque réponse LLM utilise l'enveloppe stricte :

~~~json
{"irVersion":1,"stage":"world","data":{},"assumptions":[],"decisions":[],"unsupported":[],"evidence":[],"requestedEntities":[]}
~~~

Tous les schémas ont extra=forbid, JSON fini uniquement, tableaux bornés. data dépend de stage (voir 11). Le JSON Schema complet est généré des modèles Pydantic, injecté à chaque appel dans OUTPUT_SCHEMA_JSON. Aucun texte du prompt ne remplace ce schéma.

Assumption : {key, entityId, fieldPath, proposedValue, reason, evidenceRefs, confidence:low|medium|high, requiresConfirmation:boolean}. fieldPath pointe vers le candidat final. Le serveur alloue l'id et l'état proposed/accepted/rejected après génération.
Decision : {key, entityIds, fieldPath, code, question, options:[{key,label,value}], recommendedOptionKey:null|string, severity:blocking|warning}. Deux options minimum lorsque le choix est réel ; pas de fausse certitude. Options typées selon fieldPath ; le serveur décide l'effet d'une sélection, jamais code exécuté depuis le LLM.
Unsupported : {entityId, capability, requestedIntent, proposedAlternative:null|string, severity:blocking|warning}. Evidence : {entityId, fieldPath, sourceRefs}. Vérifier chaque sourceRef dans le bundle.

### Candidat et brouillon

Le résultat de préparation : candidateId, candidateVersion, sourceFingerprint, baseDraftVersion, capabilitiesHash, promptPackVersion, status, draft (CozyStory sans revision publiée), review {assumptions,decisions,unsupported,validationErrors}, provenance {stageOutputsHash,provider,model,usage}.

Un candidat peut être incomplet et visible en needs-review. Il n'est pas appliqué automatiquement au brouillon. draft.extensions.studioPreparation stocke uniquement des métadonnées sûres et compactes : preparationId, sourceFingerprint, promptPackVersion, capabilitiesHash, assumption summaries, unresolved decision IDs, reviewState. Le journal brut reste côté backend, pas dans chaque page studio.

## 4. Capacités et adaptation honnête

Trois niveaux par capacité : executable, planned-only, unsupported. Les capacités varient selon le runtime : un handler non configuré n'est pas executable même si un fichier helper existe. Un profil signé/versionné par configuration locale, ou un fichier exporté/importé par l'utilisateur, suffit en V1 ; ne pas exposer automatiquement le studio privé au backend distant.

Profil conservateur initial : box pour structures, accessoires procedural cube ou library query ; avatars builtin pour preview, generate/reference seulement si producteur/ressource réel ; cadrages wide/medium/close-up, angle eye-level/high/low et caméra static/push-in sous réserve des tests du compiler ; actions décrites par acteur, mais génération motion planned-only si handler absent ; pickup/contact, composition audio/lipsync et export multi-scène unsupported tant que leur pipeline réel n'est pas vérifié.

Ne pas reprendre une liste de presets du helper comme preuve de support end-to-end. Chaque item executable a une fixture compilée/installée et un numéro de version de profil. Une action planned-only reste dans le candidat, mais readiness.executionReady=false et publication production bloquée ; publication preview explicite possible, signalée comme telle dans extensions.

PropAcquisition doit accepter procedural + kind et library + query/modelId lorsque supportés par le studio ; le backend observé enum library/generate/reference/builtin ne couvre pas le procedural local. Ajouter les champs explicitement et les tests croisés, pas extra=allow global. Les autres extensions doivent être testées avant de les demander au LLM. Pour builtin avatar, ne pas inventer le choix de modèle si le contrat ne le permet pas encore.

Readiness calculée par code : {dataValid, reviewComplete, previewReady, executionReady, blockingDecisionIds, unsupportedUnitIds}. Une publication preview peut permettre la construction du décor/cast/plans uniquement ; le studio doit afficher les limites et interdire les unités non exécutables et l'export final. Ne pas autoriser une publication preview à contourner un ID manquant, un temps invalide ou une géométrie dangereuse. Les brouillons intermédiaires incomplets restent candidats ; apply exige un draft structurellement valide.

## 5. Routes nouvelles et réponses

Préfixe existant /api/studio/v1/projects/{projectId}. Auth : même autorisation projet que reproduction. Le navigateur ne reçoit pas STUDIO_API_KEY : prévoir session same-origin + CSRF et proxy interne pour ces actions, ou token scoped séparé déjà pris en charge ; ne pas injecter la clé serveur dans HTML/localStorage. Bearer reste pour la connexion sidecar du studio.

- POST /preparations : lancement explicite, Idempotency-Key requis ; 202 avec preparationId/status/statusUrl.
- GET /preparations/{id} : état, étape, progression, événements paginés par afterEventId, usage et candidateVersion. Projet/inconnu -> 404 sans fuite.
- GET /preparations/{id}/result : 200 si candidat disponible ; 409 RESULT_NOT_READY sinon.
- POST /preparations/{id}/cancel : idempotent, demande d'arrêt durable.
- POST /preparations/{id}/resume : reprendre étapes valides, même bundle ; nouveau consentement budget si plafond changé.
- POST /preparations/{id}/regenerate : cible bornée, commentaire et expectedCandidateVersion ; 202 nouveau job enfant, candidat parent intact.
- PUT /preparations/{id}/decisions/{decisionId} : choix explicite, expectedCandidateVersion ; validation/recalcul des dépendances.
- POST /preparations/{id}/apply : compare-and-swap candidat/brouillon/source, appliquer sans publication.
- GET /draft existant : aucune création ; 404 DRAFT_NOT_FOUND si absent.
- PUT /draft existant : expectedDraftVersion requis pour update ; création explicite avec expectedDraftVersion=null uniquement si absent, contrainte unique ; validator distingue brouillon incomplet et publication.
- POST /revisions existant : conserve idempotence ; contrôle le brouillon approuvé et la source avant publication ; aucun LLM.

Exemple POST /preparations :

~~~json
{"provider":"configured-provider","model":"configured-model","expectedSourceFingerprint":"sha256:<hash>","expectedDraftVersion":null,"scope":{"kind":"project","ids":[]},"mode":"preview","selectedTtsId":null,"capabilitiesProfileId":"studio-preview-v1","instructions":"Préserver les différences d'âge et les proportions.","budget":{"maxCalls":12,"maxTotalOutputTokens":24000,"maxCostMicros":null},"costConsent":true}
~~~

provider/model validés contre catalogue configuré ; jamais commande shell arbitraire. Les valeurs sont des choix d'exemple, pas une recommandation de modèle. Absence de coût connu : afficher estimation indisponible, plafonner appels/tokens et exiger consentement ; pas promettre un budget monétaire strict impossible à mesurer.

scope kinds project/set/character/scene/shot/action. scope.ids obligatoire pour non-project. La première préparation complète exige project ; ciblage seulement si parentCandidateId existe. Limites serveur : 1200 s, 32 personnages/décors/scènes, 256 plans ; requests user text <= 4000 caractères ; taille JSON <= 8 MiB.

Exemple apply : {expectedCandidateVersion:3, expectedDraftVersion:null, expectedSourceFingerprint:"sha256:<hash>", mode:"preview"}. En mode production : aucune décision bloquante ni hypothèse critique non acceptée, toutes capacités requises executable. Preview : conserver les blocages d'exécution visibles ; aucune installation automatique. Si source/brouillon ont changé : 409 SOURCE_CHANGED/DRAFT_VERSION_CONFLICT, candidat reste accessible.

## 6. Algorithme de préparation et budget

0. Transaction courte : autorisation, source bundle figé, réservation budget, enregistrement job + outbox. Ne pas garder une transaction DB ouverte pendant l'appel IA.
1. extract : réconcilier noms/acteurs/décors/actions avec leurs sources, résoudre ambiguïtés ou créer décisions. Aucun placement ici.
2. world : personnages et bible spatiale commune ; produire dimensions/proportions, structures/accessoires, stratégies compatibles. Geler après revue/validation.
3. direction : un appel par scène ou bloc <= 12 plans/60 secondes ; produire placements, caméras et attribution des actionSlots, sans modifier narration ni cuts gelés.
4. actions : un appel par personnage/scène ou groupe <= 12 slots ; produire actions et intentions avec plages fixées. Vérifier coordination via le contrôleur, pas motion multi-personnages dans une requête.
5. assembler : jointures par registry, temps locaux = (globalFrame - scene.globalStartFrame)/24, ressources serveur, extensions. Détecter trous/doublons ; ne pas concaténer aveuglément.
6. Validation déterministe puis review IA indépendante, limitée à des issues. Le review ne modifie pas le récit. Les contraintes deterministes ne peuvent pas être désactivées par son avis.
7. repair : maximum deux essais sur l'étape concernée, uniquement paths autorisés ; revalider entièrement. Au-delà needs-review ou failed, pas boucle infinie.
8. Résultat persisté -> revue -> apply -> publish distincts.

En cas de besoin de décisions, terminer le sous-travail et passer needs-review ; ne pas appeler les étapes dépendantes avec une hypothèse critique dissimulée. Les infos purement techniques (ID, arrondi à la frame, conversion radians) sont code, pas des appels IA.

Call budget dépend du nombre de scènes/acteurs ; estimer avant lancement, bloquer avant chaque appel si plafond atteint. Exemple 12 s, une scène, deux acteurs : extract + world + direction + deux actions + review = 6 appels, plus <=2 repairs par étape dans le plafond global. Ne pas lancer d'avance tous les appels pour dépasser maxCalls.

Utiliser get_llm_service ; ajouter une méthode publique generate_studio_json plutôt que coupler l'orchestrateur directement à _post_generate. Le wrapper peut employer _post_generate en interne avec model/system/prompt/format=json si le fournisseur actuel le supporte. Schéma natif quand disponible, sinon JSON + validation stricte. temperature basse si supportée, sans promesse de déterminisme.

Timeout configurable par fournisseur, annulation propagée. Les retries HTTP/CLI et réparations internes du fournisseur comptent dans maxCalls/maxOutputTokens. Si le provider masque ces appels, ajouter instrumentation avant activation : aucun budget déclaré fiable sans usage observé. Stocker usage inconnue comme inconnue, pas zéro. Erreur réseau après soumission -> uncertain ; ne pas resoumettre aveuglément une opération coûteuse.

## 7. Jobs, concurrence et reprise

StudioPreparationJob : id, projectId, parentJobId, sourceBundle JSON, sourceFingerprint, baseDraftVersion, candidateVersion, status, stage, scope JSON, promptPackVersion, provider/model, capabilitiesHash, config JSON, usage JSON, cancelRequested, leaseOwner/leaseExpiresAt, created/updatedAt.
StudioPreparationCandidate : id, jobId, version, draft JSON, review JSON, provenance JSON, readiness JSON, sourceFingerprint, baseDraftVersion, createdAt ; unique(jobId,version). Les résultats assemblés sont stockés ici, pas uniquement dans les sorties des étapes.
StudioPreparationRequest : identité logique, projectId, idempotencyKey, requestHash, jobId ; contrainte unique identité/projet/clé.
StudioPreparationStep : jobId, stage, targetId, inputHash, status, attemptCount, output JSON, errors JSON, usage JSON ; unique(jobId,stage,targetId,inputHash).
StudioPreparationEvent : eventId monotone, jobId, type, message sûr, targetId, createdAt ; pagination bornée.
Idempotence job : identité autorisée + projet + clé + hash request ; pas token ni préfixe token. Consentement budget durable, audit des décisions sans secrets.

États : queued, running, needs-review, succeeded, failed, cancelled, stale, uncertain. Succeeded signifie candidat validé/obtenu, pas vidéo produite. progression = étapes terminées / étapes prévues, recalcul signalé si registry évolue ; ne pas figer 99% arbitrairement.

Worker réclame le job via update atomique avec lease. Renouvellement et check cancel entre appels ; sans queue externe, boucle DB contrôlée par lifespan, pas BackgroundTasks seule. Après crash, reprendre sorties dont inputHash inclut source/registry/profile/prompts/modèle/instructions. Une étape uncertain exige reconciliation ou relance consentie. Le worker n'utilise pas un AsyncSession de route après réponse.

Regen ciblée : nouvelle branche de candidat, IDs protégés, locked fields conservés ; recalculer le graphe de dépendances (décor -> placements/caméras ; acteur -> proportions/caméras ; action -> continuité). Afficher diff et unités locales potentiellement stale ; ne pas changer une revision déjà publiée ni le projet studio actif.

## 8. UI reproduction

Panneau affichant état de source, dernière publication, brouillon et candidat (ne pas confondre). Contrôles : Préparer, Annuler, Reprendre, Voir résultat, Régénérer la sélection, Appliquer au brouillon, Publier.

Avant lancement : provider/model configurés, profil preview/production, TTS choisi, budget, information sur les appels payants, confirmation. Pendant : étape actuelle et cible, événements, compteur d'appels/tokens et estimation coût fiable ou inconnue. Poll 1 s quand running, 5 s quand queued, arrêt terminal ; reprendre affichage après reload via jobId serveur. Pas d'HTML non échappé issu d'un modèle.

Après : onglets personnages/décors/scènes/plans/actions, dimensions et temps affichés ; badge source/inféré/hypothèse ; tableau des décisions et capabilities non disponibles ; diff avec brouillon. Exemple mère/fils : âge et taille différents si source fiable, sinon hypothèse à confirmer, jamais deux valeurs 1.70 invisibles. Distinguer generation strategy=generate de personnage déjà généré.

L'aperçu est sémantique/tableau ; une vignette ne prouve pas la 3D. Le viewport studio reste la validation visuelle. Publier désactivé si source stale, candidat non appliqué ou mode incompatible ; Preview autorise seulement le périmètre clairement annoncé. Le mode source structured signifie données structurées, pas executionReady.

## 9. Validation et recette

Fixtures sans appels réels pour CI ; faux provider injectable, sortie fixe par étape. Tests : schémas stricts et placeholders prompts résolus ; ambiguïtés mère/fils ; deux acteurs actions séparées ; scènes et temps locaux ; dimensions valides, objets supportés et distances/reach plausibles ; capacités unsupported -> blocage ; prompts injectés dans source non exécutés ; resources jamais inventées ; erreurs JSON et repair limité ; appels provider internes comptés ; budget ; cancel ; crash/reprise ; stale source ; CAS draft simultané ; idempotence ; regeneration respecte lockedFields ; GET sans écriture ; publication jamais appelle IA.

Contrat croisé : exporter fixture final via six sections, vérifier hashes JS et validateSnapshot + compileProductionSnapshot réels (utiliser le nom exporté courant de compiler.js, pas stub). S'assurer que chaque champ utilisé arrive jusqu'au compiler/installateur ; tester procedural enum et dimensions d'accessoire. Les tests d'intégration sur base temporaire ne doivent pas exécuter lifespan production, toucher assets réels ou faire du réseau.

Recette IA réelle opt-in sur projet fixture : une scène 12 s, deux acteurs, trois plans, sol/table ; relire sourceRefs/hypothèses, appliquer/publier, importer studio, construire et inspecter. Aucun paiement de génération motion/avatar requis pour la première recette. Puis actions réelles uniquement avec producteur configuré. Exiger capture viewport, journal de préparation, manifest/snapshot anonymisés, rapport tests et liste des limites. La qualité de motion, collisions complexes, lipsync et MP4 sont recettes distinctes.

## 10. Lots livrables et définition de terminé

P1 : schemas + source bundle + profil + fixtures ; aucun LLM réel. P2 : wrapper IA + prompts + parse/repair + orchestration fake provider. P3 : worker durable/API/CAS/budget. P4 : UI reproduction, revue/regen/apply/publish. P5 : contrat JS et recette locale puis réelle opt-in.

Terminé quand : préparation explicite produit un candidat traçable, les hypothèses sont visibles, reprises et conflits sont testés, aucune lecture déclenche une dépense/publication, le studio accepte le snapshot et construit la scène prévue. Ne pas déclarer terminé uniquement sur JSON valide ou test de disponibilité HTTP.
