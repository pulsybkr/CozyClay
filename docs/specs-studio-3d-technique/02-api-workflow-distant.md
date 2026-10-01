# 02 — API distante et nouveau workflow source

À transmettre au développeur de l’application qui écrit les scripts. Le contrat de ce document est complété par 08-adaptation-depot-distant.md : dépôt FastAPI inspecté, fichiers existants précis et nouveaux modules Python à créer. Les endpoints Studio sont proposés, pas actuellement disponibles.

## 1. Ce qui change dans le workflow distant

Le workflow distant doit produire une bible structurée et un découpage temporel avant ses éventuelles générations d’image/vidéo. Ajouter une branche d’export « Studio 3D » à cette étape ; elle ne requiert ni image générée ni vidéo IA pour être disponible.

Pipeline cible :

~~~text
Sujet / récit
  → script + narration horodatée
  → bible personnages + lieux + objets
  → scènes narratives + plans + actions
  → validation croisée des IDs et du temps
  → publication d’un snapshot Studio 3D
       ├─ API de consultation pour CozyClay
       └─ anciens workflows image/vidéo, optionnels et indépendants
~~~

Ne pas effacer les champs legacy. Un projet déjà existant doit être exportable avec ses textes originaux ; le studio peut les adapter localement. Un nouveau projet doit préférer le contrat structuré.

Le workflow doit distinguer trois niveaux : connu, estimé et à décider par le studio. Ne pas inventer des positions exactes parce qu’un ancien prompt parle de « screen-left ».

## 2. Routes publiques proposées

Base : /api/studio/v1. Authentification : Authorization: Bearer <clé de consultation>. La clé ne doit pouvoir lire que son périmètre de projets ; en mono-utilisateur, une clé serveur dédiée convient (voir 08). La clé reste dans le sidecar CozyClay.

| Route | Réponse | Usage |
| --- | --- | --- |
| GET /capabilities | 200 | Version du contrat et sections prises en charge |
| GET /projects/{projectId}/manifest | 200 | Dernière révision disponible et inventaire |
| GET /projects/{projectId}/revisions/{revision}/manifest | 200 | Manifest figé |
| GET /projects/{projectId}/revisions/{revision}/sections/{section}?cursor=…&limit=… | 200 | Une page d’une section figée |
| GET /projects/{projectId}/revisions/{revision}/snapshot | 200 | Export complet borné ; chemin simple de recette |
| GET /projects/{projectId}/revisions/{revision}/resources/{resourceId} | 200 | Ressource source optionnelle, autorisée et référencée |

projectId et revision sont des segments encodés. V1 : caractères A–Z/a–z/0–9/_/-, longueur 1–128. Une clé de projet n’est pas une autorisation. Refuser les ID invalides avant requête de base de données.

Sections : characters, sets, scenes, shots, actions, narration. Le manifest contient les IDs et nombres attendus ; les champs détaillés sont récupérés à la demande.

Révisions immuables. La dernière révision peut changer ; une section de r17 doit toujours rester une section de r17. Si une révision a expiré, renvoyer 410 REVISION_EXPIRED. Ne jamais substituer automatiquement r18.

## 3. Exemple de manifest

~~~json
{
  "schemaVersion": "cozy-story-v1",
  "projectId": "88LTeGwzPgE",
  "revision": "r17",
  "manifestHash": "sha256:<64-caracteres-hex>",
  "title": "La tasse du bureau",
  "updatedAt": "2026-10-01T08:00:00Z",
  "sourceMode": "structured",
  "project": {"fps": 24, "aspect": "9:16", "durationSeconds": 12},
  "sections": [
    {"name": "characters", "count": 2, "ids": ["CHAR_A","CHAR_B"], "hash": "sha256:<hash-section>"},
    {"name": "sets", "count": 1, "ids": ["ENV_OFFICE"], "hash": "sha256:<hash-section>"},
    {"name": "scenes", "count": 1, "ids": ["SCENE_01"], "hash": "sha256:<hash-section>"},
    {"name": "shots", "count": 3, "ids": ["SHOT_01","SHOT_02","SHOT_03"], "hash": "sha256:<hash-section>"},
    {"name": "actions", "count": 5, "ids": ["ACT_A_WALK","ACT_A_WAVE","ACT_B_REPLY","ACT_PICKUP","EXPR_A"], "hash": "sha256:<hash-section>"},
    {"name": "narration", "count": 0, "ids": [], "hash": "sha256:<hash-section-vide>"}
  ],
  "resources": [],
  "warnings": []
}
~~~

Les hashes des exemples sont des placeholders, pas des valeurs valides. Pour la recette, les fixtures doivent produire les vrais SHA-256 de JSON canonique.

ETag du manifest figé : son hash. Le dernier manifest peut être demandé avec If-None-Match : 304 si identique. Une page de section possède son ETag de page ; son sectionHash reste celui de la section entière.

## 4. Exemple de page de section

~~~json
{
  "schemaVersion": "cozy-story-v1",
  "projectId": "88LTeGwzPgE",
  "revision": "r17",
  "section": "characters",
  "sectionHash": "sha256:<hash-section>",
  "items": [
    {
      "id": "CHAR_A",
      "name": "Alex",
      "appearance": "Jeune adulte, cheveux bruns courts, sweat bleu, jean gris.",
      "heightMeters": 1.78,
      "avatar": {"strategy": "generate", "referenceResourceId": null}
    },
    {
      "id": "CHAR_B",
      "name": "Marie",
      "appearance": "Adulte, cheveux noirs attachés, veste verte et pantalon noir.",
      "heightMeters": 1.7,
      "avatar": {"strategy": "generate", "referenceResourceId": null}
    }
  ],
  "nextCursor": null,
  "total": 2
}
~~~

limit : défaut 50, maximum 100 ; taille maximale par page 2 MiB UTF-8. Un item trop grand est refusé avec une erreur typée, pas découpé arbitrairement. Un curseur opaque doit être lié à projectId, revision et section ; un curseur d’une autre révision donne 409 CURSOR_REVISION_MISMATCH.

À la récupération complète, CozyClay vérifie total, IDs uniques et hash de section. Une page incomplète ne vaut pas section téléchargée.

## 5. Snapshot complet illustratif

Ce snapshot de 12 s permet de développer l’intégration sans dépendre des anciens liens temporaires. Le test peut utiliser deux avatars intégrés en remplaçant uniquement leur stratégie, sans changer les identités narratives.

~~~json
{
  "schemaVersion": "cozy-story-v1",
  "projectId": "88LTeGwzPgE",
  "revision": "r17",
  "title": "La tasse du bureau",
  "project": {"fps":24,"aspect":"9:16","durationSeconds":12},
  "characters": [
    {"id":"CHAR_A","name":"Alex","appearance":"Cheveux bruns, sweat bleu.","heightMeters":1.78,"avatar":{"strategy":"generate","referenceResourceId":null}},
    {"id":"CHAR_B","name":"Marie","appearance":"Cheveux noirs, veste verte.","heightMeters":1.7,"avatar":{"strategy":"generate","referenceResourceId":null}}
  ],
  "sets": [{
    "id":"ENV_OFFICE","name":"Bureau","description":"Petite pièce lumineuse.",
    "structure":[
      {"id":"WALL_BACK","shape":"box","dimensionsMeters":{"x":4,"y":2.8,"z":0.12},"positionMeters":{"x":0,"y":0,"z":-2},"yawDegrees":0,"color":"#b7e3cf"}
    ],
    "props":[
      {"id":"DESK","name":"Bureau","acquisition":{"strategy":"library","query":"office desk"},"heightMeters":0.75,"positionMeters":{"x":0,"y":0,"z":0},"yawDegrees":0},
      {"id":"CUP","name":"Tasse","acquisition":{"strategy":"library","query":"coffee cup"},"heightMeters":0.12,"support":{"objectId":"DESK","placement":"top","offsetMeters":{"x":0.2,"y":0,"z":0}}}
    ],
    "lighting":{"keyIntensity":1.2,"ambientIntensity":0.5}
  }],
  "scenes": [{
    "id":"SCENE_01","setId":"ENV_OFFICE","globalStartSeconds":0,"globalEndSeconds":12,
    "transitionIn":{"kind":"start"},
    "cast":[
      {"characterId":"CHAR_A","positionMeters":{"x":-1,"y":0,"z":1},"yawDegrees":0},
      {"characterId":"CHAR_B","positionMeters":{"x":1,"y":0,"z":1},"yawDegrees":-90}
    ]
  }],
  "shots":[
    {"id":"SHOT_01","sceneId":"SCENE_01","startSeconds":0,"endSeconds":4,"camera":{"size":"wide","angle":"eye-level","move":{"kind":"push-in","distanceMeters":0.3},"targets":["CHAR_A","CHAR_B"]}},
    {"id":"SHOT_02","sceneId":"SCENE_01","startSeconds":4,"endSeconds":8,"camera":{"size":"medium","angle":"eye-level","move":{"kind":"static"},"targets":["CHAR_A","CHAR_B"]}},
    {"id":"SHOT_03","sceneId":"SCENE_01","startSeconds":8,"endSeconds":12,"camera":{"size":"close","angle":"high","move":{"kind":"static"},"targets":["CHAR_A","CUP"]}}
  ],
  "actions":[
    {"id":"ACT_A_WALK","kind":"body","sceneId":"SCENE_01","characterId":"CHAR_A","startSeconds":0,"endSeconds":4,"description":"Alex marche vers le bureau.","trajectory":[{"timeSeconds":0,"positionMeters":{"x":-1,"y":0,"z":1}},{"timeSeconds":3.9,"positionMeters":{"x":-0.5,"y":0,"z":0.5}}]},
    {"id":"ACT_A_WAVE","kind":"body","sceneId":"SCENE_01","characterId":"CHAR_A","startSeconds":4,"endSeconds":8,"description":"Alex salue de la main droite sans marcher."},
    {"id":"ACT_B_REPLY","kind":"body","sceneId":"SCENE_01","characterId":"CHAR_B","startSeconds":4,"endSeconds":8,"description":"Marie répond par un signe de tête."},
    {"id":"ACT_PICKUP","kind":"interaction","sceneId":"SCENE_01","characterId":"CHAR_A","objectId":"CUP","startSeconds":8,"endSeconds":12,"interaction":{"kind":"pick-up","hand":"right","contactSeconds":10,"releaseSeconds":null}}
  ],
  "expressions":[
    {"id":"EXPR_A","sceneId":"SCENE_01","characterId":"CHAR_A","intent":"happy","binding":{"kind":"scene"},"keys":[{"timeSeconds":4,"weight":0},{"timeSeconds":4.5,"weight":0.6},{"timeSeconds":8,"weight":0}]}
  ],
  "narration": [],
  "resources": [],
  "extensions": {}
}
~~~

Les expressions sont transportées comme items kind: "expression" dans la section actions. Le snapshot complet les sépare dans expressions. L’adaptateur commun réalise cette séparation sans perte. Le manifest actions compte body + interaction + expression et inclut tous leurs IDs.

Les temps de scènes sont globaux ; ceux de shots/actions/expressions sont locaux à leur scène. Les ressources ont un rôle déclaré : avatar-vrm, motion-npz, narration-audio ou reference-image. Une ressource image n’est pas un asset 3D à installer.

## 6. Champs structurés et legacy

| Donnée actuelle | Export Studio 3D |
| --- | --- |
| Bible CHAR_* | characters : ID, apparence, taille éventuelle |
| Prompt ENV_* | sets.description ; structure/props si connus |
| Première image d’un plan | legacy.imagePrompt conservé comme intention |
| Prompt vidéo du plan | legacy.videoPrompt ; actions séparées si extraction déjà faite |
| Cadrage et déplacement caméra | shots.camera |
| Sous-titres/TTS/STT | narration : texte et bornes validées |
| Référence Picture N | lien narratif explicite ou referenceResourceId |
| Suffixe style visuel | legacy.styleHint ; aucun effet sur les temps/actions |

Pour un projet legacy, sourceMode = legacy ou mixed. Un shot peut exposer legacy.imagePrompt et legacy.videoPrompt avec needsAdaptation: true. Le studio doit montrer une étape « Adapter en 3D » avant de construire ce plan. Ne pas tenter de présenter un prompt d’image comme un objet de géométrie validé.

Conserver les noms de personnages explicitement cités. Si l’extraction ne permet pas de choisir entre deux personnages, publier une ambiguïté avec candidat IDs et un champ needsDecision. Pas de CHAR_02 implicite absent de la distribution.

## 7. Validation distante

Valider avant publication du snapshot :

- IDs uniques par collection et références existantes ; namespace global recommandé pour faciliter les diagnostics.
- Intervalles strictement positifs, finis et à l’intérieur de la scène.
- Un seul plan visible à chaque instant en V1 ; aucun trou sauf plan hold explicitement ajouté.
- Scènes globales ordonnées, sans chevauchement en V1 ; ellipses autorisées mais montage continu.
- Les actions body concurrentes pour un même acteur doivent être résolues ou marquées needsDecision. Une expression peut chevaucher un mouvement.
- Durées narration et projet compatibles ; indiquer timingStatus: final ou estimated si la narration est présente.
- Pas de code, HTML exécutable, commandes shell ou instructions de gestion de clés dans les champs structurés.

CozyClay refait cette validation après téléchargement. La validation distante ne remplace pas la validation locale.

## 8. Versions et erreurs

~~~json
{
  "error": {
    "code": "SOURCE_REFERENCE_MISSING",
    "message": "Le plan SHOT_03 cite CHAR_C, absent de la distribution.",
    "retryable": false,
    "details": [{"path":"/shots/2/camera/targets/1","targetId":"CHAR_C"}]
  },
  "requestId": "req_01"
}
~~~

Statuts : 401 clé absente/invalide, 403 accès projet refusé, 404 projet inconnu, 409 conflit de révision/curseur, 410 snapshot expiré, 422 source invalide, 429 quota avec Retry-After, 503 export temporairement indisponible.

Un export en préparation peut répondre 202 avec status: preparing et retryAfterSeconds ; la consultation seule ne doit pas lancer d’appels payants à un LLM. Le backend peut construire son snapshot à partir de ses données par sérialisation pure ou d’une tâche déjà planifiée.

Conserver chaque snapshot au moins 30 jours pour les productions actives. Le client local reste autonome après téléchargement, même si le snapshot distant expire.

## 9. Modules à développer côté distant

Adapter les noms au framework, garder leurs responsabilités :

- studio-export/schema : validateurs cozy-story-v1 et erreurs par chemin.
- studio-export/extract : mapping du modèle de base de données existant vers contrat canonique.
- studio-export/snapshots : stockage immuable par projectId + revision ; hashes et rétention.
- studio-export/controller : routes GET de capabilities/manifest/sections/snapshot/resources.
- studio-export/access : réutilisation du contrôle de propriété du projet et clé de consultation.
- studio-export/tests : legacy, structured, pagination, immutabilité et séparation des comptes.

Fournir un fichier OpenAPI 3.1 documentant ces routes et les schémas. Ajouter deux fixtures : le bureau de 12 s ci-dessus et un récit de 30 s avec deux décors. Les fixtures complètes doivent être validées automatiquement ; les exemples abrégés de documentation ne sont pas des réponses de test.

## 10. Contrat de livraison du backend distant

Le développeur doit livrer l’OpenAPI, les fixtures et un moyen de tester une clé de consultation sur un ID de projet. Le studio ne doit pas dépendre du HTML de la page reproduction ni d’un scraping navigateur.

La mise en service de cette API ne nécessite pas de refaire tous les anciens projets. L’adaptateur legacy doit permettre de commencer avec leurs descriptions, puis d’améliorer progressivement les sorties structurées du workflow.
