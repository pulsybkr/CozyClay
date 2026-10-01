# 08 — Adaptation précise du dépôt distant « reproduction »

Dépôt inspecté en lecture : C:/Users/pulsy/Videos/workflow_gen_short_with_ia.
Cette spécification complète 02 et remplace ses noms de modules génériques. Aucun fichier distant n’a été modifié.

## 1. Ce qui existe réellement

Application Python/FastAPI, SQLAlchemy asynchrone, templates Jinja avec état client dans templates/reproduction.html.

| Fichier existant | Rôle observé et adaptation |
| --- | --- |
| app/main.py | Monte reproduction_router sous /api ; page /video/{video_id}/reproduction. Monter le nouveau router studio |
| app/api/reproduction_routes.py | GET /api/reproduction/{video_id}/data retourne plan, bible, prerequis TTS et modes flow/agnes ; ne pas réutiliser cette route comme export immuable |
| app/db/models_reproduction.py | ReproductionPlan.plan_data et CharacterBible.analysis alimentent ce parcours. Ajouter modèles export séparés |
| app/db/database.py | Importe les modèles, initialise le schéma et migrations SQLite ; intégrer tables StudioStoryDraft/StudioStorySnapshot |
| app/services/alignment_service.py | Produit shots.order, tts_start, tts_end, edit_duration, generation_duration, narration_chunk. Garder TTS comme référence |
| app/services/character_service.py | Bible characters/environments, description et proposed_adaptation ; extraire ces données sans génération d’image |
| app/services/clip_prompt_service.py | Produit keyframe_shots et prompt vidéo ; sous-plans cadrage/action/caméra descriptifs, sans bornes temporelles structurées complètes |
| templates/reproduction.html | UI flow/agnes, génération images/vidéos et leurs prerequisites ; ajouter parcours Studio 3D indépendant |
| app/db/models.py | Video.video_id comme ID saisi, TTSAudio pour audio et transcription |
| .env.example | Ajouter configuration de consultation Studio sans valeur secrète réelle |

Attention : ReproductionProject/ReproductionShot existent aussi comme pipeline distinct. Ne pas les choisir comme seule source parce que leurs colonnes sont plus structurées : la page reproduction inspectée utilise le JSON ReproductionPlan et CharacterBible. Un adaptateur alternatif pour l’ancien pipeline peut être ajouté plus tard explicitement.

GET /reproduction/{id}/data fait aussi des réparations de médias et consulte la liste des modèles. Il n’est ni une lecture pure ni une révision figée ; le nouveau service lit directement les tables sources, sans appeler ce handler.

## 2. Nouveaux fichiers et responsabilités

- app/schemas/studio_story.py : Pydantic des contrats 02, version, références, erreurs de validation par JSON pointer.
- app/db/models_studio.py : drafts modifiables et snapshots immuables avec video_id, revision, payload JSON, content_hash, source_fingerprint, selected_tts_audio_id, created_at.
- app/services/studio_story_adapter.py : adaptation pure des lignes existantes vers source legacy/mixed ; zéro appel LLM.
- app/services/studio_story_prepare.py : adaptation narrative en structure 3D via fournisseur texte existant, sur demande explicite seulement ; validation de sortie et décisions non résolues.
- app/services/studio_story_snapshots.py : publication transactionnelle, fingerprint, pagination stable, hashes, rétention.
- app/api/studio_routes.py : routes de consultation de 02, dépendance d’auth lecture, ressources autorisées.
- app/api/studio_prepare_routes.py : préparation/publication authentifiées pour la page reproduction, pas accessibles avec clé lecture.
- app/core/studio_access.py : Bearer lecture serveur, comparaison constante, scopes projets et séparation lecture/écriture.
- docs/studio-export.openapi.json : OpenAPI des routes.
- tests/test_studio_story_adapter.py, test_studio_story_snapshots.py, test_studio_story_routes.py, test_studio_3d_mode.py : contrat et absence de génération image/vidéo.

Avant choix de Pydantic syntaxe/version, lire requirements.txt et les conventions locales. Ne pas ajouter Alembic si le dépôt utilise ses migrations SQLite maison : étendre le mécanisme existant avec tests sur une base temporaire, jamais sur nouveau.db/tiktok.db/youtube_analyzer.db utilisateur.

## 3. Mapping précis et pièges temporels

| Source page reproduction | Sortie canonique |
| --- | --- |
| Video.video_id | projectId, par exemple 88LTeGwzPgE ; pas l’ID SQL numérique |
| CharacterBible.analysis.characters[].id | characters[].id inchangé |
| description/proposed_adaptation | apparence canonique/adaptation, choix éditorial explicite |
| analysis.environments[].id/description | sets[].id/description |
| plan_data.shots[].order | identifiant legacy conservé ; ne pas en faire l’unique ID durable |
| tts_start/tts_end | intervalle global réel du segment narratif |
| edit_duration | contrôle de cohérence tts_end - tts_start |
| duration/generation_duration | legacy seulement ; pas durée du montage 3D |
| keyframe_shots[].character_ids/environment_id | références des sous-plans, validées contre bible |
| framing/camera_motion/camera_position | intentions caméra, pas coordonnées exécutables |
| characters/screen_axis/subject_scale/depth_layers | contraintes de composition à adapter |
| action | action instantanée legacy, pas motion prompt individuel déjà temporel |
| agnes_image_prompt/video_prompt/references | legacy avec mapping des balises Picture vers IDs |
| TTSAudio audio/transcript | narration et ressource audio contrôlée ; même audio que le plan |

La sélection TTSAudio du nouvel export doit privilégier ReproductionPlan.tts_audio_id ; si absent, demander/consigner le choix. Ne pas prendre automatiquement le dernier TTS si le plan a été aligné sur une autre version.

Exemple : segment tts_start=3,2 ; tts_end=7,9 ; generation_duration=6. Le studio doit produire 4,7 s de montage, pas 6 s. Trois keyframe_shots ne donnent pas trois vidéos de 6 s : ils doivent partager ces 4,7 s après adaptation du timing.

## 4. Identifiants et occurrences de lieux

Créer des UUID source durables pour scènes, plans et actions au premier draft ; conserver un legacyLocator {order, shot_index} pour diagnostic. Réordonner les plans ne change pas leur identité. Une régénération qui n’établit plus une correspondance sûre demande décision plutôt qu’un appariement silencieux par index.

Un set ENV_01 est réutilisable. Une scène est une occurrence continue d’un lieu dans le récit ; plusieurs sous-plans peuvent partager cette occurrence. Un retour au même lieu après ellipse devient une nouvelle scène si la continuité le nécessite. Une keyframe sans environment_id ne doit pas automatiquement fabriquer un set différent : conserver l’ambiguïté et permettre « même décor que précédent ».

Le mode flow n’a pas nécessairement keyframe_shots. Il reste importable en legacy au niveau des segments TTS, puis une préparation 3D propose les sous-plans. Le mode agnes apporte des intentions plus fines, pas un contrat directement exécutable.

## 5. Nouveau parcours distant, sans casser flow/agnes

Ne pas ajouter directement studio3d au Literal flow/agnes utilisé actuellement : plusieurs handlers normalisent tout autre mode vers agnes. Garder pipeline_mode pour le legacy ; ajouter un champ indépendant production_target = legacy | studio3d sur le draft/parcours UI.

Dans reproduction.html, si production_target=studio3d :
1. Sélectionner/versionner narration et bible.
2. Réutiliser l’alignement TTS existant.
3. « Préparer pour Studio 3D » : proposer décors, scènes, sous-plans horodatés, actions attribuées individuellement, expressions et interactions.
4. Afficher et corriger les hypothèses avec validation.
5. « Publier la révision Studio » : produire snapshot immuable.
6. Afficher projectId, revision, URL serveur et état « prêt à récupérer » ; jamais la clé dans un lien.

Ce parcours ne requiert ni allClipped ni characterPromptsReady au sens « images créées ». Une bible narrative validée suffit. La préparation ne doit pas appeler la fonction qui génère les images clés, personnages images, Flow ou Agnes video. Les références source vidéo peuvent aider l’adaptation existante, mais ne deviennent pas une obligation de produire des images IA.

Routes d’écriture proposées, distinctes de l’API read-only :
POST /api/reproduction/{video_id}/studio/prepare avec sourceFingerprint attendu et sélection TTS ;
GET /api/reproduction/{video_id}/studio/draft ;
PATCH /api/reproduction/{video_id}/studio/draft avec version attendue et patches typés ;
POST /api/reproduction/{video_id}/studio/publish avec version attendue.
409 si données source/draft modifiées ; 422 si références/temps invalides. La publication est sérialisation/validation, aucun job IA.

Le service prepare réutilise le fournisseur texte existant via une interface injectée. Ne pas coder un nom de modèle présumé disponible. Lui imposer une sortie JSON structurée et une seule action corporelle par acteur/intervalle ; validation stricte, nombre de réparations borné, prompts et coûts traçables. Toute résolution incertaine reste needsDecision. L’interprétation exacte peut aussi être faite localement dans le studio, mais on doit choisir un owner du draft : distant en priorité si le draft y est préparé, local pour les overrides seulement.

## 6. Publication et hashes

Construire source_fingerprint à partir des données narratives utiles et de l’audio sélectionné, sans statuts de jobs image/vidéo ou _operation. Une progression d’image ne doit pas créer une nouvelle révision Studio.

Canonicalisation versionnée : clés d’objets triées récursivement, listes d’entités triées par ID pour hash de collection, listes temporelles conservées dans leur ordre, nombres finis, UTF-8, pas d’espaces. Définir et tester les mêmes vecteurs JSON en Python et JavaScript, notamment unicode, floats et -0 ; normaliser ces cas dans le contrat avant hash. Révision opaque unique ; hash SHA-256 du payload canonique. Ne pas utiliser updated_at seul comme preuve d’identité.

Stocker toutes les sections d’une révision dans une transaction. Aucun endpoint de lecture ne lit une moitié de nouveau plan et une moitié d’ancienne bible. Les snapshots antérieurs restent consultables pendant la rétention prévue par 02.

## 7. Sécurité et ressources

Le code inspecté ne permet pas de supposer une gestion multi-utilisateur existante. En mono-utilisateur, une clé dédiée lecture serveur configurée par environnement convient ; ne pas inventer un système de comptes fonctionnel. Si multi-compte ajouté, contrôler la propriété à chaque projet et ressource.

Autoriser uniquement les resourceIds enregistrés dans le snapshot, pas un paramètre path libre. Résoudre le chemin sous les racines media autorisées, vérifier realpath et absence de traversée/symlink sortant, type et taille. Ne pas exporter video_local_path, chemins disque, credentials, modèle internal config ou contenu .env.

Le studio ne doit jamais demander downloads arbitraire ni télécharger les MP4 générés pour prétendre à une réalisation 3D native.

## 8. Tests indispensables

- Deux fixtures des deux styles de données (flow sans sous-plans, agnes avec sous-plans), importables sans assets IA.
- tts_audio_id ancien mais toujours choisi ; génération_duration ≠ edit_duration ; multi-personnages dans un prompt séparés en actions ou ambiguïté signalée.
- Ordre modifié, IDs préservés ; lieu réutilisé ; référence Picture incorrecte.
- Publication durant changement du plan : 409, aucune révision partielle.
- Changement _operation seul : hash narratif inchangé.
- Clé lecture : GET accepté, préparation/publication refusées ; chemin resource sortant refusé.
- Mocks spies de tous les générateurs image/vidéo : aucun appel pendant fetch, publish ou parcours production_target=studio3d.
- Schéma OpenAPI et fixtures consommés par les tests locaux de CozyClay.

Livrer le contrat et les fixtures dans les deux dépôts avant de développer le connecteur réel. Le studio peut commencer par un serveur fixture, mais la recette finale utilise cette API FastAPI, pas le HTML reproduction.

