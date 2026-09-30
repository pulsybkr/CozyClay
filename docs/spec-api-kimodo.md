# Évolution de l’API Kimodo pour le studio vidéo CozyClay

Date : 30 septembre 2026. Statut : spécification proposée, avant implémentation.

## 1. Objectif et périmètre

Permettre à CozyClay de demander des animations du corps par HTTP, de contrôler leur trajectoire et certaines poses, puis de récupérer des mouvements exploitables sur ses avatars VRM.

Une requête génère un mouvement pour un personnage. CozyClay gère le placement dans la scène, les autres personnages, les expressions faciales, les décors, les caméras et le rendu vidéo. Les formats vidéo 16:9 et 9:16 ne nécessitent aucun changement dans Kimodo.

Ce document distingue les capacités de Kimodo, les fonctions exposées par votre API et les adaptations à développer. Tous les nouveaux noms de champs et endpoints ci-dessous sont des propositions de contrat.

## 2. État constaté de l’API actuelle

Contrat consulté : [OpenAPI de votre API](https://pulsy26--kimodo-motion-web.modal.run/openapi.json).

Endpoints présents :

| Endpoint | Fonction annoncée |
|---|---|
| `GET /health` et `/healthz` | État du service |
| `GET /api/model/ping` | Vérification du modèle |
| `POST /api/jobs` | Création d’un job, réponse HTTP 202 |
| `GET /api/jobs/{job_id}` | Consultation d’un job |
| `GET /api/jobs/{job_id}/npz` | Téléchargement NPZ |
| `GET /api/jobs/{job_id}/bvh` | Téléchargement BVH |

Les routes `/api/*` déclarent une authentification Bearer. Le modèle annoncé est `Kimodo-SOMA-RP-v1.1` sur GPU L40S.

Champs actuels : `prompt`, `duration`, `diffusion_steps`, `seed`, `cfg_weight`, `no_postprocess`. Le schéma accepte une durée de 1 à 30 secondes et un prompt de 1 à 1000 caractères.

Les schémas de succès des jobs et téléchargements sont vides dans OpenAPI. Le contrat ne décrit ni les états des jobs ni le contenu des fichiers. Aucun mouvement réel n’a été téléchargé pour cet audit. L’absence d’une fonction dans OpenAPI ne prouve pas son absence dans l’implémentation interne.

## 3. Priorités

| Priorité | Travail à réaliser | Résultat attendu |
|---|---|---|
| P0 — branchement initial | Décrire et stabiliser les réponses des jobs | CozyClay peut suivre une génération |
| P0 | Fixer le contrat NPZ et les métadonnées | Le mouvement peut être converti vers les VRM |
| P0 | Clarifier la durée et le post-traitement | Aucun comportement implicite sur ces paramètres |
| P0 | Publier les capacités et limites | Le studio sait ce qu’il peut demander |
| P0 | Gérer les erreurs, délais et stockage des résultats | Une génération ne disparaît pas silencieusement |
| P1 — contrôle des mouvements | Exposer les contraintes de trajectoire et d’orientation | Déplacements contrôlés |
| P1 | Exposer les poses et contraintes mains/pieds | Gestes et contacts mieux contrôlés |
| P1 | Ajouter les séquences de prompts | Plusieurs actions dans un mouvement continu |
| P1 | Ajouter annulation et idempotence | Arrêt des jobs et prévention des doublons |
| P2 — amélioration | Édition partielle et conservation d’un mouvement | Corriger une portion sans tout refaire |
| P2 | Mesures de qualité et diagnostic | Identifier les contraintes mal respectées |

Une première intégration peut fonctionner après P0. P1 est nécessaire pour l’objectif de mouvements précis exprimé pour le studio.

## 4. Versionnement et compatibilité

Créer le contrat explicite `/api/v2/...`. Conserver les routes actuelles pendant la migration et documenter leurs différences. Fournir des modèles Pydantic pour chaque entrée, réponse et erreur ; OpenAPI doit décrire les fichiers binaires avec leur vrai type de contenu.

Ne pas convertir silencieusement une ancienne requête de 30 secondes en une action de 10 secondes. Ne pas ignorer les champs inconnus : les refuser avec une erreur explicite dans la nouvelle version.

Les exemples du document sont illustratifs ; ils ne décrivent pas des jobs réellement exécutés.

## 5. Contrat de création proposé

### `POST /api/v2/jobs`

Accepter exactement un de ces modes :

- Mode simple : `prompt` et `duration`.
- Mode séquence : `segments`, tableau ordonné de `{prompt, duration}`. Les champs racine `prompt` et `duration` sont alors interdits pour éviter une ambiguïté.

Champs communs :

| Champ | Règle proposée |
|---|---|
| `client_request_id` | Identifiant facultatif fourni par CozyClay, renvoyé sans modification |
| `character_id` | Identifiant facultatif de corrélation ; ne modifie pas la génération |
| `seed` | Entier dans la plage annoncée par les capacités ; si absent, tirer une graine et renvoyer sa valeur effective |
| `diffusion_steps` | Conserver la plage actuelle 10–250 et le défaut 100, sous réserve de validation du backend |
| `postprocess` | Booléen positif, défaut `true` |
| `first_heading_angle` | Direction initiale, radians, défaut 0 |
| `constraints` | Tableau de contraintes défini en section 7, défaut vide |
| `guidance` | Configuration décrite ci-dessous |

Conserver la limite actuelle de 1000 caractères par prompt. Rejeter un prompt constitué uniquement d’espaces.

### Guidance

Au départ, conserver un réglage régulier équivalent au `cfg_weight` actuel. Lors de l’ajout des contraintes, exposer :

```json
{
  "guidance": {
    "type": "separated",
    "text_weight": 2.0,
    "constraint_weight": 2.0
  }
}
```

L’API traduit ce contrat vers les paramètres de la version Kimodo installée. Annoncer les modes et plages réellement acceptés dans les capacités. Refuser un mode non disponible ; ne pas accepter un champ sans l’utiliser. Kimodo documente une guidance séparée pour le texte et les contraintes. [Paramètres NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/configuration.html)

### Exemple simple avec une trajectoire

```json
{
  "client_request_id": "scene-dialogue-char-a-take-01",
  "character_id": "char-a",
  "prompt": "A person walks forward slowly and comes to a stop.",
  "duration": 6.0,
  "seed": 42,
  "diffusion_steps": 100,
  "postprocess": true,
  "first_heading_angle": 0.0,
  "constraints": [
    {
      "type": "root2d",
      "frame_indices": [0, 90, 179],
      "smooth_root_2d": [[0.0, 0.0], [0.0, 0.8], [0.0, 1.0]],
      "global_root_heading": [[1.0, 0.0], [1.0, 0.0], [1.0, 0.0]]
    }
  ]
}
```

Cet exemple suppose explicitement 30 fps de génération et 180 frames. Si le backend annonce une autre fréquence, le client doit recalculer les indices.

## 6. Durée et séquences

NVIDIA documente une limite de 10 secondes par prompt. Pour la nouvelle version, proposer des segments de 1 à 10 secondes, au maximum 8 segments et 30 secondes au total. Les limites 1 seconde, 8 segments et 30 secondes sont des choix de cette API, à valider puis publier ; elles ne sont pas des limites universelles de Kimodo. [Limites NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/limitations.html)

Pour le mode simple, refuser une durée supérieure à 10 secondes avec `DURATION_REQUIRES_SEGMENTS`. Pour une séquence :

```json
{
  "segments": [
    {"prompt": "A person stands and gestures with their right hand.", "duration": 4.0},
    {"prompt": "A person lowers their right hand and stands still.", "duration": 3.0}
  ],
  "seed": 42,
  "postprocess": true
}
```

Exigences :

- Générer les segments avec continuité du mouvement ; une concaténation indépendante ne suffit pas.
- Employer l’interface structurée Python si possible. Si le CLI est utilisé, traiter explicitement sa segmentation par ponctuation afin qu’une phrase ne devienne pas un segment supplémentaire.
- Renvoyer pour chaque segment `start_frame`, `end_frame_exclusive`, durée demandée et durée effective.
- Documenter la règle de quantification durée → nombre de frames. Publier le nombre obtenu, sans supposer que la durée demandée est exactement représentable.
- La transition appartient au début du segment suivant ; ne pas ajouter des frames cachées à la timeline.
- Valider la correspondance entre contraintes du clip complet et contraintes locales de chaque segment. Tester particulièrement les positions aux raccords.
- Signaler toute modification des contraintes ou des durées ; aucune correction silencieuse.

## 7. Contraintes à exposer

### Convention commune

Utiliser le format natif Kimodo pour éviter une deuxième représentation ambiguë. La conversion des coordonnées de scène et des poses VRM est réalisée par l’adaptateur CozyClay.

- Espace canonique Kimodo, unités mètres, axe vertical +Y, sol XZ.
- Indices à partir de zéro sur la fréquence de génération annoncée, pas sur la timeline CozyClay de 24 fps.
- Origine XZ du personnage au départ : `(0,0)`. La hauteur des hanches reste une hauteur au-dessus du sol.
- `first_heading_angle` est en radians. Les directions dans `global_root_heading` sont des paires cosinus/sinus.
- L’adaptateur CozyClay applique la translation et la rotation entre cet espace et la scène. Le serveur ne rajoute pas un deuxième placement global.

Référence pour ces conventions et les champs : [format JSON des contraintes NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/constraints.html).

### A. Trajectoire et orientation — P1 prioritaire

Type `root2d` :

| Champ | Forme |
|---|---|
| `frame_indices` | `[K]`, entiers croissants uniques |
| `smooth_root_2d` | `[K,2]`, positions XZ |
| `global_root_heading` | Facultatif, `[K,2]`, directions normalisées |

Accepter des points espacés et un chemin dense. Pour un chemin dense, publier et valider la couverture attendue du clip. Refuser une direction de longueur nulle ou une paire mal dimensionnée.

### B. Poses du corps — P1

Type `fullbody` : `frame_indices`, `local_joints_rot` de forme `[K,J,3]` et `root_positions` de forme `[K,3]`. `smooth_root_2d` est facultatif. Fixer `J=77` pour le contrat SOMA77 proposé.

Les rotations sont locales, encodées en vecteurs axis-angle en radians. Les contraintes de pose ciblent les positions issues de la cinématique du squelette ; elles ne garantissent pas chaque rotation locale de tous les os.

### C. Mains et pieds — P1

Exposer `left-hand`, `right-hand`, `left-foot`, `right-foot` avec les mêmes champs de pose que `fullbody`. Le backend applique le sous-ensemble correspondant et les contraintes de racine associées. Ne pas présenter une contrainte de main comme indépendante de toute contrainte sur les hanches.

Pour obtenir une main à une coordonnée cible, CozyClay doit construire une pose cohérente par IK, la convertir vers SOMA puis l’envoyer. Un simple `{hand: [x,y,z]}` n’est pas directement le format natif proposé ici.

Le type générique `end-effector` peut venir ensuite, après vérification de ses noms d’articulations et de son traitement par le post-traitement de la version installée.

Kimodo documente les poses, les trajectoires et les extrémités, mais pas l’exposition actuelle des contraintes de labels de contact des pieds dans son API Python. Ne pas annoncer cette dernière comme disponible sans implémentation vérifiée. [Capacités des contraintes](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/constraints.html)

### Validation et limites

- Refuser types inconnus, champs inconnus, nombres non finis et tableaux de dimensions incorrectes.
- Vérifier `0 <= frame < frame_count`, avec des indices strictement croissants.
- Vérifier la cohérence entre le nombre de clés et les tableaux de valeurs.
- Détecter des contraintes incompatibles pour une même cible/frame ; retourner une erreur ou un avertissement explicite selon le conflit.
- Pour les poses et extrémités, publier une limite initiale de 19 frames contraintes distinctes par type. C’est une politique conservatrice alignée sur les recommandations NVIDIA, pas une garantie de réussite.
- Fixer et annoncer séparément une limite de taille pour les chemins denses et pour le corps HTTP.
- Rejeter les coordonnées manifestement impossibles si la règle est vérifiable. Signaler les autres contradictions détectées ; ne pas promettre un mouvement physiquement correct pour toute demande.

## 8. Post-traitement : correction nécessaire

La description actuelle de `no_postprocess` indique que le désactiver évite le glissement des pieds. Cette formulation doit être corrigée : le post-traitement est recommandé lorsque la précision des contacts et contraintes est importante. [Bonnes pratiques NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/limitations.html)

Dans v2, utiliser `postprocess: true` par défaut. Dans la route historique, garder `no_postprocess` avec une description correcte et traduire `postprocess = !no_postprocess`. Refuser les deux champs dans une même requête plutôt que choisir arbitrairement.

Renvoyer le réglage effectivement appliqué. Si le post-traitement demandé échoue, échouer le job ou publier clairement un résultat dégradé avec avertissement selon une politique documentée. Ne pas déclarer la précision assurée après le retargeting VRM : la différence de proportions peut nécessiter une correction côté studio.

## 9. Réponses et cycle de vie des jobs — P0

### Réponse de création

HTTP 202 avec `Location: /api/v2/jobs/{job_id}` et une réponse typée :

```json
{
  "api_version": "2",
  "job_id": "job_example_01",
  "client_request_id": "scene-dialogue-char-a-take-01",
  "character_id": "char-a",
  "status": "queued",
  "stage": "waiting_for_worker",
  "created_at": "2026-09-30T12:00:00Z",
  "updated_at": "2026-09-30T12:00:00Z",
  "poll_after_ms": 1500,
  "effective_seed": 42,
  "warnings": [],
  "error": null,
  "result": null
}
```

### `GET /api/v2/jobs/{job_id}`

Même enveloppe, avec `started_at`, `finished_at`, `expires_at`, paramètres effectifs et métadonnées du résultat lorsqu’ils existent.

États proposés : `queued`, `running`, `cancelling`, `succeeded`, `failed`, `cancelled`. Les trois derniers sont terminaux. `stage` détaille l’attente GPU, le chargement, la génération, le post-traitement ou l’export. Un job ne doit jamais redevenir `running` après un état terminal.

La progression numérique est facultative et doit être `null` si elle n’est pas mesurable. Renvoyer un délai de polling conseillé ; ne pas inventer un pourcentage. Le client applique un recul progressif en cas d’erreur transitoire, sans recréer le job.

Le succès implique que les fichiers sont écrits, vérifiés et téléchargeables. Exposer les erreurs de chargement du modèle, de génération et de conversion. Définir des délais maximum d’attente en file et d’exécution ; un job abandonné par un worker doit finir en erreur explicite.

### Annulation — P1

Ajouter `POST /api/v2/jobs/{job_id}/cancel`, idempotent. Un job en attente est annulé avant allocation GPU. Pour un job actif, documenter si l’exécution GPU peut être interrompue ; si ce n’est pas possible, la réponse précise que l’arrêt concerne la publication du résultat. Ne pas promettre que le coût GPU cesse immédiatement.

### Idempotence — P1

Accepter `Idempotency-Key` sur la création. Pour la même identité et la même clé, une requête identique retrouve le job initial ; un corps différent retourne 409. L’enregistrement doit être atomique et persistant, avec une durée de validité annoncée. Un timeout HTTP ne doit pas entraîner plusieurs générations facturées lors d’un retry.

## 10. Résultats et compatibilité avec CozyClay — P0

### NPZ : format principal

Servir le NPZ natif SOMA77. CozyClay possède déjà le lecteur `tools/kimodo/read-npz.mjs`, le convertisseur `tools/kimodo/soma77-to-cskel27.mjs` et un adaptateur VRM. La compatibilité finale doit être validée avec un fichier produit par votre serveur.

Champs minimum demandés par ce contrat :

| Membre NPZ | Forme | Règle |
|---|---|---|
| `posed_joints` | `[F,77,3]` | Positions globales, mètres |
| `global_rot_mats` | `[F,77,3,3]` | Rotations globales valides |
| `fps` | Scalaire entier | Fréquence effective explicitement ajoutée si l’exporteur natif l’omet |

Conserver également les membres natifs disponibles, notamment `local_rot_mats`, `root_positions`, `smooth_root_pos`, `global_root_heading` et `foot_contacts`. Ne pas supprimer de données utiles pour les futures corrections.

Utiliser des tableaux numériques little-endian, sans tableaux objets ni dépendance à pickle. Vérifier dimensions, finitude, rotations et cohérence des frames avant de publier le fichier. Les sorties doivent correspondre à la pose de repos SOMA standard T-pose.

Le format natif Kimodo SOMA est documenté avec 77 articulations en export, même si le modèle travaille sur une représentation réduite. [Formats NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/output_formats.html)

### Métadonnées obligatoires

Publier dans `result` et via `GET /api/v2/jobs/{job_id}/metadata` :

- `motion_format_version`, `skeleton_id`, `joint_count`, liste ordonnée `joint_names` et indices `parents`.
- `fps`, `frame_count`, `sample_interval_s` et `duration_s` définie comme `frame_count / fps` ; la dernière frame se situe à `(frame_count - 1) / fps`.
- Unités, axes, convention de direction et pose de repos, explicitement propres à chaque format.
- Identifiant et révision du modèle, version du code Kimodo, graine effective, paramètres appliqués.
- Découpage des segments et leurs intervalles de frames, s’il y en a.
- Formats disponibles, chemins de téléchargement, taille en octets et SHA-256 par fichier.
- Horodatage d’expiration et avertissements éventuels.

Ne pas fournir un squelette SOMA30 ou SMPL-X sous un identifiant SOMA77. En cas de changement de squelette, annoncer une nouvelle capacité/version et adapter le convertisseur.

### Téléchargements

`GET /api/v2/jobs/{job_id}/npz` et `/bvh` renvoient des octets, avec `Content-Type`, `Content-Disposition`, taille et checksum documentés. Pour NPZ, utiliser `application/octet-stream` ; pour BVH, un type texte cohérent, documenté dans OpenAPI.

Politique proposée : 409 si le job n’a pas réussi, 404 s’il n’existe pas ou n’est pas accessible à cette identité, 410 si le résultat a expiré. Un téléchargement interrompu peut être recommencé ; il ne relance jamais le modèle.

BVH reste un format secondaire. Documenter sa pose de repos et ses unités : l’export natif peut utiliser des centimètres et une pose différente du NPZ. Ne pas annoncer la même convention pour les deux fichiers sans vérification. [Export BVH NVIDIA](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/output_formats.html)

Ne pas imposer 24 fps au serveur : publier la fréquence native, puis laisser CozyClay adapter le mouvement à sa timeline. Un export 24 fps pourra être ajouté ensuite comme format distinct avec ses propres métadonnées.

## 11. Capacités et santé du service — P0

Ajouter `GET /api/v2/capabilities`, protégé par Bearer. Publier : versions API/modèle, fréquence native, squelette exporté, modes de guidance, types de contraintes réellement opérationnels, limites de durée/segments/taille et présence de l’annulation, des séquences et de l’édition partielle.

La réponse distingue `supported`, `enabled` et les fonctions encore expérimentales. Une fonctionnalité ne doit pas être annoncée active avant que son entrée soit transmise au modèle et testée.

`/healthz` vérifie la vie du service sans démarrer une génération ni réserver un GPU. Documenter si `/api/model/ping` charge le modèle ou démarre un worker, ainsi que son coût et ses délais. Séparer disponibilité de l’API, disponibilité du worker et disponibilité des poids.

## 12. Erreurs, authentification et exploitation

Enveloppe commune :

```json
{
  "error": {
    "code": "INVALID_CONSTRAINT",
    "message": "A constraint frame is outside the generated clip.",
    "field": "constraints[0].frame_indices[2]",
    "retryable": false,
    "request_id": "request_example_01"
  }
}
```

Codes minimum : `INVALID_REQUEST`, `INVALID_CONSTRAINT`, `DURATION_REQUIRES_SEGMENTS`, `UNSUPPORTED_FEATURE`, `UNAUTHORIZED`, `RATE_LIMITED`, `QUEUE_FULL`, `MODEL_UNAVAILABLE`, `GENERATION_FAILED`, `POSTPROCESS_FAILED`, `EXPORT_FAILED`, `JOB_TIMEOUT`, `RESULT_EXPIRED`.

- Employer des HTTP 401/403, 409, 410, 422, 429 et 503 cohérents ; fournir `Retry-After` lorsque pertinent.
- Conserver le Bearer sur tous les accès aux jobs et fichiers. Associer les jobs à l’identité authentifiée ; un identifiant deviné ne donne aucun accès.
- Le token Kimodo est conservé dans le service serveur/local de CozyClay, hors du bundle navigateur et des projets sauvegardés. Une configuration CORS n’est nécessaire que si un accès direct navigateur est volontairement retenu ; préférer le proxy de CozyClay.
- Conserver jobs et fichiers dans un stockage durable partagé entre instances Modal. Tester leur récupération après arrêt ou redémarrage d’un worker.
- Fixer et annoncer la rétention des fichiers. Proposition initiale : 24 heures ; CozyClay télécharge et embarque le mouvement dans le projet avant expiration.
- Limiter les jobs simultanés, la file et la taille des requêtes ; rejeter avant calcul GPU si la demande est invalide.
- Journaliser identifiant du job, étapes, durées et erreurs sans token. Ne pas exécuter un prompt comme une commande shell.
- Une erreur HTTP ou un redémarrage du client ne doit pas supprimer un résultat déjà généré.

## 13. Améliorations P2

### Édition partielle

Prévoir un contrat distinct pour référencer un mouvement source déjà enregistré, une plage de frames à régénérer et les parties à conserver. Vérifier le support de l’inpainting/preservation dans la version Kimodo réellement déployée avant de l’annoncer. Utiliser des références de fichiers appartenant à l’utilisateur ; ne pas demander un chemin de fichier arbitraire sur le serveur.

### Mesures et diagnostics

Renvoyer les écarts aux points de trajectoire, aux cibles de mains/pieds et aux raccords de segments lorsque ces mesures sont implémentées. Préciser unité, frames, méthode et seuil. Un diagnostic non calculé est `null`, pas zéro. Proposer des avertissements structurés plutôt qu’un score général présenté comme une garantie de qualité.

### Plusieurs personnages

L’API peut ensuite proposer un batch de jobs indépendants, avec identifiants par personnage. Cela optimise l’orchestration mais ne crée pas une génération conjointe ni une gestion automatique des collisions. Les contacts entre deux personnages exigent des cibles coordonnées et une validation côté studio après retargeting.

## 14. Livrables et critères d’acceptation

### Livraison P0

- OpenAPI complet, avec exemples des jobs en attente, réussis et échoués ; aucune réponse importante laissée à `schema: {}`.
- Un job simple de 6 secondes, un fichier NPZ, son BVH si disponible et ses métadonnées.
- Vérification que le NPZ réel passe le lecteur et le convertisseur SOMA77 de CozyClay, puis se lit sur les deux VRM fournis.
- Tests des mauvais paramètres, de l’authentification, du suivi, des téléchargements et de l’expiration.
- Job et résultat encore consultables après redémarrage du service/worker.
- Cas de durée supérieure à 10 secondes traité explicitement.
- Valeur effective de la graine, du post-traitement et de la fréquence disponible dans le résultat.

### Livraison P1

- Trajectoire de trois points et changement d’orientation transmis et mesurés.
- Pose imposée et contrainte de main/pied testées avec post-traitement.
- Séquence de deux segments testée : durée finale, continuité, placement des contraintes et absence de double translation au raccord.
- Annulation testée avant et pendant l’exécution, avec limites documentées.
- Même clé d’idempotence : un seul job ; corps différent : conflit.
- Aucun type ou paramètre accepté puis ignoré.
- Test intégré sur avatars VRM : mouvement fini, proportions cohérentes, placement correct, lecture déterministe et expressions faciales préservées.

### Informations à transmettre pour le branchement

Fournir l’URL, la version du contrat, les exemples JSON de création/suivi/erreur, le contrat des contraintes, un NPZ réel et ses métadonnées. Le token doit être configuré localement dans le service CozyClay, sans l’ajouter à cette documentation.

## 15. Ordre de développement recommandé

1. Typage des réponses et erreurs, métadonnées NPZ, clarification durée/post-traitement.
2. Capacités, persistance et validation du fichier réel avec CozyClay.
3. Branchement HTTP initial côté CozyClay.
4. Trajectoires et orientations.
5. Poses et mains/pieds.
6. Séquences, annulation et idempotence.
7. Édition partielle et diagnostics.

Les modifications du studio et du serveur API doivent partager ces mêmes conventions, mais aucun avatar VRM, décor, expression faciale ou rendu vidéo n’a besoin d’être envoyé au serveur GPU pour cette première version.
