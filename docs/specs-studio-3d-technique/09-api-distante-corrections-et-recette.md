# API distante — correctifs à implémenter et recette

Date : 1er octobre 2026. Dépôt examiné : C:/Users/pulsy/Videos/workflow_gen_short_with_ia.
Ce document décrit des modifications À FAIRE côté distant, pas des fonctionnalités déjà validées. Aucun fichier distant n'a été modifié. Il complète les documents 02 et 08 ; en cas de divergence sur les routes déjà implémentées, ce document prime. Le studio reste un client en lecture : publier appartient à l'application distante.

## 1. Ordre de travail et fichiers

| Lot | Fichiers existants à modifier | Livrable |
| --- | --- | --- |
| D1 — hashes et sections | app/schemas/studio_story.py ; app/services/studio_story_snapshots.py | Hash identique au JavaScript, extraction unique des six sections |
| D2 — révisions | app/api/studio_routes.py ; app/services/studio_story_snapshots.py ; app/db/models_studio.py | GET sans écriture, publication explicite et atomique |
| D3 — sécurité et pagination | app/core/studio_access.py ; app/api/studio_routes.py | Auth sans secret par défaut, erreurs et curseurs stricts |
| D4 — reproduction structurée | app/services/studio_story_adapter.py ; app/schemas/studio_story.py | Données exécutables sans inventer acteurs, actions ou placements |
| D5 — ressources | app/api/studio_routes.py ; nouveau app/services/studio_story_resources.py | Téléchargement binaire authentifié et vérifié |
| D6 — recette isolée | tests/conftest.py ; tests/test_studio_story_routes.py ; nouvelles suites ci-dessous | Aucun appel payant, aucun accès aux bases réelles |

Ajouter app/services/studio_story_validation.py pour les validations croisées, tests/test_studio_story_hashes.py, tests/test_studio_story_publication.py, tests/test_studio_story_resources.py et tests/fixtures/studio/hash-vectors.json. Ajouter scripts/migrate_studio_snapshot_revisions.py : migration idempotente et mode --dry-run, sans supprimer les données.

D1–D3 et D6 sont requis pour la connexion fiable. D4 est requis pour une scène fidèle au récit. D5 peut attendre uniquement si resources reste vide et si aucun champ ne référence de fichier. Les vrais avatars/motions et l'export multi-scène restent aussi des chantiers locaux : corriger l'API ne les active pas automatiquement.

## 2. D1 : corriger la sérialisation et les hashes

Constat : canonical_json retire actuellement les valeurs null dans les objets. Le studio les conserve. Python sérialise aussi 1.0 autrement que JSON.stringify(1). Conséquence : SOURCE_HASH_MISMATCH même si les objets semblent identiques.

Cible : canonical_hash = sha256: + SHA-256 UTF-8 de la sérialisation canonique, sans espaces, sans BOM. Prendre src/production/source-contract.js comme oracle de compatibilité. Utiliser un sérialiseur compatible ECMAScript/JCS, pas un simple json.dumps(sort_keys=True). Refuser NaN, Infinity, entiers non représentables sans perte dans un Number JS et caractères Unicode invalides. Ne pas normaliser les accents Unicode. Les clés sont triées selon les unités UTF-16, non selon les points de code Python. Conserver les null ; conserver l'ordre des tableaux ; convertir -0 et 1.0 comme JavaScript. Tester aussi les exposants.

Vecteurs minimaux de canonicalJson :

| Entrée JSON | Chaîne attendue |
| --- | --- |
| {"b":null,"a":1.0} | {"a":1,"b":null} |
| [-0.0,1.0,0.000001,1e-7] | [0,1,0.000001,1e-7] |
| {"z":"é","a":false} | {"a":false,"z":"é"} |
| [] | [] |

Ajouter vecteurs avec clés non-BMP et nombres aux bornes 1e21. Comparer les octets ET le hash Python aux sorties de computeCanonicalHash côté studio ; ne pas comparer seulement Python à lui-même.

Extraire une fonction section_items(snapshot, section), utilisée pour manifest, pagination et snapshot normalisé. Six sections, dans cet ordre : characters, sets, scenes, shots, actions, narration. Normaliser les expressions dans actions avec kind: expression. La liste expressions existante peut rester pour compatibilité de stockage, mais aucun doublon dans actions exporté. Les IDs d'actions et expressions doivent être uniques ensemble. Normaliser avant publication, jamais à la volée différemment selon une route.

sectionHash est le hash du tableau COMPLET exporté, pas de la page. sections[].ids et count décrivent exactement ce tableau dans le même ordre. Un tableau vide a un vrai hash.

Pour les nouvelles publications, définir manifestHash sur cet objet EXACT : schemaVersion, projectId, revision, title, sourceMode, project, sections, resources. Exclure manifestHash, updatedAt et warnings. Stocker cet objet et la version de calcul interne ; ce changement de périmètre n'exige pas une nouvelle route. Le client actuel vérifie surtout les hashes des sections : ne pas prétendre qu'il recalcule déjà le manifestHash. Inclure les ressources dans le nouveau hash permet néanmoins de détecter une modification de fichiers entre deux révisions.

updatedAt provient de la date de publication stockée, UTC avec Z ; ne plus appeler datetime.utcnow à chaque GET. Ne jamais recalculer un ancien manifest avec le nouvel algorithme sous la même révision : republier une nouvelle révision compatible, conserver l'ancienne historique.

## 3. D2 : publication explicite, lectures immuables

Constats : get_or_create_snapshot publie pendant un GET ; une révision inconnue est créée sous le nom demandé ; le dernier snapshot reste servi même quand le récit change ; aucune contrainte unique (video_id, revision).

Remplacer par get_published_snapshot et publish_snapshot. Les GET ne font ni db.add, ni commit, ni adaptation. GET d'un projet absent : 404 PROJECT_NOT_FOUND. Projet existant sans publication : 409 PROJECT_NOT_PUBLISHED. Révision inconnue : 404 REVISION_NOT_FOUND ; révision explicitement expirée : 410 REVISION_EXPIRED seulement si une politique d'expiration existe réellement.

Conserver les routes consommées actuellement :

- GET /api/studio/v1/capabilities
- GET /api/studio/v1/projects/{projectId}/manifest : dernière publication, pas brouillon.
- GET /api/studio/v1/projects/{projectId}/revisions/{revision}/manifest
- GET /api/studio/v1/projects/{projectId}/revisions/{revision}/sections/{section}
- GET /api/studio/v1/projects/{projectId}/revisions/{revision}/snapshot

Ajouter POST /api/studio/v1/projects/{projectId}/revisions, utilisé par la page reproduction ou une commande distante, pas par le bouton Récupérer du studio. Exemple de corps :

~~~json
{"mode":"structured","expectedSourceFingerprint":"sha256:<64 hex>","draftVersion":"draft_12"}
~~~

La page reproduction doit envoyer la version de brouillon réellement sauvegardée. expectedSourceFingerprint est facultatif lors d'une première publication, obligatoire si l'UI a déjà affiché un état à confirmer. Ne pas laisser le client choisir revision. Le serveur produit un identifiant sûr r_<uuidhex>. Header Idempotency-Key obligatoire, longueur bornée 1..128, portée projet + identité authentifiée. Ajouter un enregistrement d'idempotence persistant (nouvelle table StudioPublicationRequest dans models_studio.py) : clé, projet, hash du corps, révision, identité logique ; aucune clé API brute.

Réponse 201 : {projectId, revision, manifestHash, sourceFingerprint}. Replay même clé/corps : 200 et même résultat ; même clé/autre corps : 409 IDEMPOTENCY_CONFLICT. Empreinte attendue périmée : 409 SOURCE_CHANGED. Brouillon non exécutable : 422 STORY_NOT_EXECUTABLE avec chemins précis. Publication legacy explicite autorisée mais sourceMode legacy et avertissements persistés.

Transaction : lire la version cohérente du brouillon/source, vérifier fingerprint, adapter/valider, normaliser, calculer hashes, insérer snapshot et idempotence, commit ensemble. Une modification concurrente du brouillon doit invalider la publication via verrou/version optimiste, pas un simple second SELECT non protégé. Traiter proprement les conflits d'unicité et relire le résultat idempotent après rollback.

source_fingerprint existe déjà : le remplir à partir de la source normalisée pertinente (CharacterBible.analysis, ReproductionPlan.plan_data, choix TTS explicite, version de brouillon). Ne pas inclure updated_at de lecture ni chemins machine temporaires. Stocker selected_tts_audio_id ; ne plus choisir implicitement le dernier TTS à chaque export.

Migration : inspecter doublons avant UniqueConstraint(video_id, revision). En présence de doublons, interrompre avec rapport d'IDs à arbitrer ; aucune suppression automatique. Sauvegarder la base avant migration. Ajouter tables/colonnes avec le mécanisme réel du dépôt ; create_all ne migre pas une table existante. Le script doit avoir --dry-run, transaction et seconde exécution sans changement. Publier une nouvelle révision pour chaque projet utilisant l'ancien hash ; ne pas modifier ses snapshots historiques.

## 4. D3 : pagination, authentification, erreurs

SectionPage doit conserver schemaVersion, projectId, revision, section, sectionHash, items, nextCursor, total. Ajouter manifestHash. Tous sont ceux de la révision demandée. limit par défaut 50, borné 1..100, dépassement 422. Pour compatibilité immédiate, un curseur décimal d'offset strict suffit : ASCII digits seulement, entier positif ou zéro, taille bornée, offset <= total ; invalidité -> 400 INVALID_CURSOR, jamais retour silencieux à zéro. nextCursor = offset + len(items), ou null en fin. Une page finale offset == total est vide ; section inconnue -> 404 SECTION_NOT_FOUND.

Une publication concurrente ne change pas les pages de l'ancienne révision. Ordre fixe depuis le snapshot, jamais requête live à la base de reproduction. Imposer 2 MiB/page et 8 MiB/snapshot, compatibles avec le sidecar. Refuser avant publication un item unique qui ne peut pas tenir dans une page ; ne pas tronquer silencieusement. Ajouter ETag basé sur les hashes ; le studio n'en dépend pas encore, ne pas exiger If-None-Match.

Dans studio_access.py supprimer le fallback DEFAULT_STUDIO_KEY en exécution normale. Si STUDIO_API_KEY absent, échec explicite de configuration (startup ou 503 STUDIO_NOT_CONFIGURED), jamais service public avec secret connu. Bearer absent/invalide : 401 avec WWW-Authenticate: Bearer. Garder compare_digest ; utiliser TLS pour exposition distante ; ne pas journaliser Authorization ou les clés. Si déploiement multi-utilisateur, autoriser explicitement l'accès au projectId ; une clé globale actuelle n'est pas une isolation multi-tenant.

Format d'erreur FastAPI compatible avec le client actuel :

~~~json
{"detail":{"code":"REVISION_NOT_FOUND","message":"Révision non publiée","projectId":"demo","revision":"r_missing"}}
~~~

Le sidecar local conserve le statut mais traduit actuellement certains codes génériquement : le code précis dans detail est utile au diagnostic, pas encore garanti comme code machine local. 429 : Retry-After en secondes ; 503 : panne temporaire ; ne pas renvoyer 200 avec error dans un payload normal.

## 5. D4 : produire un récit 3D exploitable depuis reproduction

Constat : l'adapter actuel crée un décor vide, place seulement le premier personnage, associe toutes les actions au premier acteur, invente un plan/action si rien n'existe et utilise parfois la durée par défaut 12 s. Cela aide une démo, pas une reproduction fidèle.

Séparer deux modes :

- legacy : conserver les prompts/textes et signaler précisément chaque information manquante ; ne pas classer mixed uniquement parce que raw_shots existe. Pas de réussite automatique de décor ou motion inventés.
- structured : lire un brouillon structuré validé (StudioStoryDraft.draft_data existe), avec personnages, décors géométriques, scènes, plans et actions ; interdire références cassées ou choix arbitraires.

Sur la page reproduction ajouter une préparation 3D distincte de la publication : sauvegarder les dimensions, placements, acteurs, cibles caméra, fenêtres d'action et choix de ressources. Préparer peut utiliser l'agent distant si souhaité, mais aucun GET studio ni publication ne déclenche un LLM/GPU. Exposer les ambiguïtés à confirmer dans l'UI distante avant mode structured. Les anciens prompts restent dans shot.legacy, pas interprétés comme des commandes 3D.

Exemple minimal de données à sauvegarder (fragment de snapshot, pas corps du POST publication) :

~~~json
{
  "characters":[{"id":"alice","name":"Alice","heightMeters":1.7,"avatar":{"strategy":"builtin"}}],
  "sets":[{"id":"office","name":"Bureau","structure":[{"id":"floor","shape":"box","dimensionsMeters":{"x":5,"y":0.1,"z":4},"positionMeters":{"x":0,"y":-0.05,"z":0},"yawDegrees":0}],"props":[]}],
  "scenes":[{"id":"s1","setId":"office","globalStartSeconds":0,"globalEndSeconds":12,"cast":[{"characterId":"alice","positionMeters":{"x":0,"y":0,"z":0},"yawDegrees":0}]}],
  "shots":[{"id":"p1","sceneId":"s1","startSeconds":0,"endSeconds":4,"camera":{"size":"medium","angle":"eye-level","targets":["alice"]}}],
  "actions":[{"id":"a1","kind":"body","sceneId":"s1","characterId":"alice","startSeconds":0,"endSeconds":4,"description":"Alice fait un signe de la main"}]
}
~~~

Cet exemple ne couvre pas les 12 secondes avec ses plans : ajouter des plans pour [4,12) avant une recette sans trou. Une description d'action n'est pas une preuve de motion générée.

Validation croisée dans studio_story_validation.py : IDs [A-Za-z0-9_-]{1,128}, uniques ; setId et sceneId existants ; personnage d'action/cible présent dans cast de sa scène ; références resources existantes ; valeurs finies ; dimensions et hauteurs strictement positives. Ajouter aux modèles Prop les dimensions et données réellement supportées par le contrat local (voir compiler.js/geometry.js), ou refuser un champ inconnu : ne pas laisser Pydantic supprimer silencieusement une dimension fournie. acquisition.strategy énuméré ; query obligatoire pour library, pas pour les stratégies qui n'en ont pas besoin. Mettre une liste explicite de champs permis/extra forbid pour les objets structurés, extensions pour les ajouts documentés.

Temps : fps 24 pour l'intégration actuelle, mètres, axe Y vertical, angles degrés. globalStart/End sont globaux ; shot/action/narration attachés à une scène sont locaux, [start,end). Durées >0 ; fenêtres dans la durée de scène ; scènes dans project.durationSeconds. L'adapter actuel n'a qu'une scène à t=0 : une future séparation ne doit pas réutiliser directement les temps globaux TTS comme temps locaux. Pour narration globale sans sceneId, définir les temps globaux explicitement. Tolérance de quantification <= 1/24 s, pas une correction silencieuse de 4 secondes.

Plusieurs acteurs : une action body par acteur et par fenêtre, deux actions coordonnées pour un échange. Interaction : characterId + objectId existant + contact/release dans la fenêtre, coordonnées et intention explicites. Publier ces données ne garantit pas que l'installateur local supporte le geste : les fonctionnalités non prises en charge doivent rester bloquées et visibles. Ne pas transformer tous les cadrages inconnus en medium ; demander une décision.

## 6. D5 : rendre les ressources réelles accessibles

Ajouter GET /api/studio/v1/projects/{projectId}/revisions/{revision}/resources/{resourceId}. C'est déjà l'URL appelée par bin/agent/source-client.mjs. Réponse binaire, Content-Type exact, Content-Length, ETag basé sur SHA-256, authentification identique. Ne pas renvoyer un objet JSON ou un chemin Windows. ResourceRef.sha256 : 64 caractères hex minuscules de SHA-256 des octets (sans préfixe sha256: des hashes documentaires) ; byteSize exact. Aligner ce format avec docs 02/OpenAPI avant fusion si ces documents diffèrent.

Registry serveur : associer un resourceId à un fichier immuable et une révision, jamais interpréter resourceId comme chemin. Résoudre sous un répertoire d'assets autorisé, vérifier les liens symboliques et le chemin résolu, refuser traversal. N'accepter aucune URL externe arbitraire. Si stockage distant, téléchargement proxy ou URL signée selon contrat dédié ; pas de redirection qui fuit le Bearer. Une ressource d'un autre projet/révision -> 404 RESOURCE_NOT_FOUND.

À publication : vérifier présence, type, taille et hash ; copier/adresser les octets de façon immuable. Si le fichier disparaît ensuite, erreur explicite (410 RESOURCE_EXPIRED si expiration prévue, sinon 503 RESOURCE_UNAVAILABLE), jamais remplacer par un cube/avatar de démo. resources=[] tant qu'aucun fichier réel n'est disponible. Le TTS retenu doit fournir audioResourceId et ResourceRef associés, pas seulement du transcript. Le MP4 final/muxage audio n'est pas fourni par cette route.

## 7. D6 : tests sans toucher la production

Constat : tests/conftest.py remplace get_db, mais TestClient(app) lance le lifespan de app/main.py : init_db réel et tâches services réseau. Le remplacement de get_db ne protège pas ce chemin.

Correctif immédiat : fixture FastAPI de test dédiée montant studio_routes.router, base SQLite temporaire/in-memory isolée, override get_db sur CETTE app, STUDIO_API_KEY injectée par monkeypatch. Ne pas importer l'app production pour les tests unitaires studio. Nettoyer overrides et engine après chaque suite. Tester aussi le vrai montage avec une factory create_app permettant d'injecter lifespan et services ; aucune variable test ne doit ouvrir l'auth en production. Interdire les appels réseau inattendus dans les tests. Les imports ne doivent pas initialiser la base réelle.

Modifier les tests existants : publier avant GET, abandonner l'hypothèse GET crée r01 et le header fondé sur DEFAULT_STUDIO_KEY. Fixtures : données de test uniquement, aucune API key réelle ni chemin de base réelle.

Tests obligatoires :

1. Vecteurs Python/JS identiques : null, float, -0, exposants, Unicode, tableau vide ; valeur interdite rejetée.
2. GET inconnu n'insère rien ; projet non publié distinct de projet absent ; révision inconnue n'est pas créée.
3. Publication idempotente, conflit de corps, source modifiée, deux publications concurrentes ; contrainte unique et transaction sans snapshot partiel.
4. Manifest identique entre deux GET ; old revision identique après publication suivante ; hash change si action/ressource change.
5. Pagination limit=1,50,100 : concaténation mêmes IDs/hash que snapshot ; expressions incluses une fois ; curseur abc/-1/énorme/hors borne rejeté ; aucune boucle.
6. Clé manquante/invalide, serveur sans configuration, ressource protégée ; aucun secret dans logs/JSON.
7. Ressource connue : octets, taille et hash ; ID voisin, traversal, symlink hors racine, fichier manquant rejetés.
8. Deux acteurs/deux scènes : fenêtres locales, acteurs corrects ; référence inconnue et dimension négative -> 422 avec chemin.
9. Toutes les routes restent dans les limites de payload du sidecar ; impossible de publier un objet trop grand.
10. Aucune création/modification de la base utilisateur, aucun appel LLM/GPU/TTS/Poly Pizza lors de la suite et des GET.

Depuis le dépôt distant, avec son Python venv : python -m pytest tests/test_studio_story_routes.py tests/test_studio_story_hashes.py tests/test_studio_story_publication.py tests/test_studio_story_resources.py. Ces nouveaux fichiers sont à créer ; cette commande n'est pas une preuve qu'ils passent aujourd'hui.

## 8. Recette manuelle croisée et preuves à fournir

1. Migrer une COPIE de base et publier un projet fixture mono-scène 12 s, fps 24, deux acteurs builtin, décor mesuré, trois plans, deux actions séparées. Pas de service payant.
2. Configurer URL de l'API et Bearer dans Production du studio. Tester connexion, saisir l'ID, récupérer : titre/révision/six sections corrects, aucun job déclenché.
3. Préparer, inspecter décisions, construire décor, personnages et plans séparément. Vérifier placements/cadrages dans viewport ; ne pas exiger animation réelle si producteur local absent.
4. Fermer/réouvrir le projet local : source/révision et suivi conservés ; aucune nouvelle publication distante par simple récupération.
5. Modifier le brouillon distant et publier une nouvelle révision. L'ancien import reste stable ; récupérer le nouveau manifeste montre la nouvelle révision. La synchronisation destructive ou reconstruction automatique n'est pas autorisée.
6. Vérifier mauvaise clé et révision absente : erreur visible, pas de contenu partiel ni décor de remplacement.
7. Fournir rapport pytest, manifest+snapshot anonymisés, traces des statuts HTTP, capture du viewport et liste des décisions restantes. Ne pas fournir le token.

Gate avant vague 5 : D1–D6 validés selon périmètre ressources, puis recette locale des vrais producteurs motion/avatars, interactions supportées et MP4 réel. Le succès de l'API seule et des tests unitaires n'est pas une validation visuelle complète des vagues 3–4. Voir ../audit-studio-3d/06-corrections-locales-et-recette.md pour les limites locales restantes.
