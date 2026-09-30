# Spécifications — Studio vidéo personnel CozyClay

Version : 0.1 — 30 septembre 2026.

Statut : cadrage fonctionnel et technique avant implémentation. Les décisions utilisateur ci-dessous sont retenues ; le contrat HTTP est une proposition à figer avec le développeur de l’API avant intégration. Aucune fonctionnalité décrite comme « à développer » n’est considérée comme déjà disponible.

## 1. Objectif et décisions retenues

Transformer CozyClay en studio personnel de création de vidéos 3D colorées à partir d’instructions détaillées. Le rendu 3D du studio constitue la vidéo finale.

Le parcours principal est : instructions → plan de scène → personnages et décor → animations corporelles et expressions → prévisualisation et corrections → export MP4.

Décisions utilisateur :

- Formats de livraison : 16:9 et 9:16.
- Scènes simples, avec plusieurs personnages et quelques éléments de décor.
- Personnages importés au format VRM.
- Animations corporelles générées par Kimodo sur un serveur GPU accessible par API.
- Expressions faciales générées par un LLM, en reprenant les mécanismes pertinents de `text-to-vrma`.
- Voix et synchronisation labiale reportées à une version ultérieure.
- Conservation des fonctionnalités IA utiles à la construction et à la correction des scènes.
- L’utilisateur développe l’API Kimodo en parallèle du studio, à partir du contrat défini ici.

## 2. Périmètre de la première version

### Fonctionnalités obligatoires

| ID | Fonctionnalité | Résultat attendu |
| --- | --- | --- |
| F01 | Projet vidéo | Nom, format, durée, scènes et sauvegarde |
| F02 | Formats | Paysage 1920 × 1080 ou portrait 1080 × 1920, à 24 images/s |
| F03 | Import VRM | Import local, identification et réutilisation des avatars |
| F04 | Plusieurs personnages | Au moins deux avatars indépendants dans une scène |
| F05 | Décor coloré | Objets, murs, sols, couleurs et éclairage modifiables |
| F06 | Direction par IA | Traduction des instructions en plan structuré et actions du studio |
| F07 | Corps via Kimodo | Génération distante, récupération, adaptation et lecture des mouvements |
| F08 | Visage via LLM | Expressions datées, clignements et transitions par personnage |
| F09 | Timeline | Placement temporel des animations, expressions et plans caméra |
| F10 | Corrections | Modifier placement, trajectoire, cadrage et expressions sans tout régénérer |
| F11 | Prévisualisation | Lecture, pause et déplacement libre dans la timeline |
| F12 | Export final | MP4 de la séquence active et de la timeline complète |
| F13 | Persistance | Réouverture avec avatars, animations et expressions conservés |
| F14 | Historique | Annuler/rétablir les changements manuels et les résultats IA appliqués |

La première validation doit fonctionner sans API GPU réelle, avec des animations de référence et un serveur simulé.

### Hors périmètre initial

- Synthèse vocale, import/montage audio et synchronisation labiale.
- Génération du rendu final par un modèle de vidéo IA.
- Génération automatique de modèles 3D ou de textures.
- Simulation automatique de contacts complexes entre personnages.
- Animation détaillée des doigts à partir de la sortie corporelle actuelle.
- Collaboration multiutilisateur, comptes et publication en ligne.
- Refonte complète des outils avancés de pose et d’IK avant validation VRM.

Une scène décrite comme « deux personnages discutent » signifie d’abord des gestes, regards et expressions cohérents, sans parole audible.

## 3. Parcours utilisateur

1. Créer ou ouvrir un projet ; choisir 16:9 ou 9:16.
2. Importer les avatars VRM et les nommer pour que l’IA puisse les identifier.
3. Décrire le décor, les personnages, les actions, les émotions, la durée et la caméra.
4. Consulter un résumé du plan proposé et ses hypothèses ; répondre uniquement aux informations réellement bloquantes.
5. Construire la scène et générer les mouvements et expressions.
6. Prévisualiser ; demander une correction ciblée ou modifier manuellement.
7. Sauvegarder et exporter la vidéo.

Exemple : « Vidéo verticale de 10 secondes. Alice et Bob se font face devant un mur bleu. Une table est à leur droite. Alice est contrariée au début puis sourit ; Bob lève le bras droit en répondant. Caméra fixe, les deux personnages restent visibles. »

Les changements coûteux ou touchant des éléments non demandés doivent être exposés avant génération. Une correction d’expression ne doit pas déclencher un nouvel appel Kimodo.

## 4. Base existante et adaptations

Constats issus du code local :

- `src/app-stage.jsx` contient les formats 16:9 et 9:16 et le composant `Character`, actuellement basé sur `useFBX`, une échelle centimétrique et des matériaux uniformes.
- `src/scenes.js` limite actuellement les modèles de personnages aux deux bots intégrés.
- `src/domains/cast.js` possède un modèle de distribution avec plusieurs personnages.
- `src/ardy/playback.js` effectue une adaptation corporelle spécifique aux os Mixamo et au squelette cskel27.
- `src/ardy/npz.js` valide et lit les animations cskel27.
- `tools/kimodo/soma77-to-cskel27.mjs` convertit la sortie Kimodo en animation compatible avec le lecteur actuel.
- `tools/ardy/bridge.mjs` et les runners gèrent actuellement la génération, notamment distante via SSH.
- `src/project.js`, les domaines et l’historique fournissent une base de sauvegarde et d’édition.
- Les chemins d’export actuels devront être vérifiés et adaptés au cycle de mise à jour VRM.

Référence externe à examiner et réutiliser de manière ciblée :

- [text-to-vrma : viewer.js](https://github.com/pulsy-cb/text-to-vrma/blob/master/src/viewer.js) : chargement VRM, normalisation VRM0, lecture VRMA.
- [vrmaBuilder.js](https://github.com/pulsy-cb/text-to-vrma/blob/master/src/vrmaBuilder.js) : sérialisation des os et expressions.
- [autoExpressions.js](https://github.com/pulsy-cb/text-to-vrma/blob/master/src/autoExpressions.js) : expressions temporelles et clignements.

Ces modules constituent des références d’implémentation, pas une garantie de compatibilité immédiate. Vérifier leurs licences et préserver les notices requises avant reprise de code.

## 5. Personnages VRM

### Import et stockage

- Prendre en charge VRM 1.0 en priorité, puis VRM 0.x normalisé.
- Conserver textures, matériaux MToon, transparence et couleurs de l’avatar.
- Ne pas appliquer le matériau uniforme des bots aux avatars importés.
- Stocker chaque fichier comme ressource du projet, avec identifiant stable fondé sur son contenu.
- Référencer cette ressource depuis chaque personnage ; ne pas sauvegarder les URL temporaires `blob:`.
- Conserver nom, position, orientation, taille et association aux pistes de chaque personnage.
- Permettre plusieurs instances du même avatar sans partage accidentel du squelette, des expressions ou des états de lecture.
- Afficher une erreur utile si les os humanoïdes requis ou le fichier sont invalides.

### Adaptation des mouvements

Créer un adaptateur humanoïde VRM autour du contrat d’animation interne. Il doit gérer les os normalisés, les différences de pose de repos, les proportions, l’orientation et le déplacement racine.

La conversion cskel27 → VRM ne doit pas reposer uniquement sur le nom des os. Les segments de colonne ne correspondent pas directement ; la composition des rotations doit préserver la pose globale.

Le personnage reste placé dans la scène par une transformation extérieure. Le clip porte son déplacement local. Éviter de compter deux fois le déplacement ou l’orientation.

Les trajectoires sont exprimées dans le repère canonique du mouvement ; l’adaptateur les rapporte aux proportions de l’avatar. Le studio doit mesurer le déplacement réel dans la scène après adaptation. Une conversion de mètres qui change avec la taille du personnage doit être explicite, jamais implicite.

### Fonctionnalités à vérifier avant de les exposer

- Manipulation des poses et poignées d’os.
- Corrections IK, pieds au sol et collisions.
- Calcul des dimensions pour placer les personnages et cadrer.
- Miniatures et captures.
- Cheveux/vêtements avec spring bones.

Masquer un outil incompatible en donnant sa raison ; ne pas laisser un contrôle agir sur des os inexistants.

## 6. Expressions faciales générées par LLM

Le LLM produit des données structurées validées ; il ne produit ni code exécutable ni transformations arbitraires de scène.

Entrées : instructions, personnage cible, durée, phases d’action, expressions disponibles sur l’avatar et pistes existantes à conserver.

Sortie proposée :

```json
{
  "schemaVersion": "cozy-expressions-v1",
  "characterId": "alice",
  "durationS": 10,
  "tracks": [
    {"expression": "angry", "keys": [{"t": 0, "weight": 0.5}, {"t": 4, "weight": 0.5}, {"t": 5, "weight": 0}]},
    {"expression": "happy", "keys": [{"t": 4, "weight": 0}, {"t": 6, "weight": 0.7}, {"t": 10, "weight": 0.7}]}
  ]
}
```

Règles :

- Temps locaux au clip, triés, uniques, compris entre 0 et sa durée ; poids entre 0 et 1, tous finis.
- Interpolation linéaire en V1 ; une piste absente vaut zéro.
- Seules les expressions déclarées par l’avatar sont acceptées. Une expression manquante est signalée, sans prétendre l’avoir appliquée.
- Les clignements peuvent être proposés par le LLM ou construits par une routine à graine fixe ; ils sont enregistrés comme clés explicites.
- Respecter les règles VRM de combinaison et d’expressions binaires. Définir une priorité explicite entre clignement, émotion et future parole.
- Les expressions ne doivent pas modifier la piste corporelle ; les rotations tête/cou restent sous une autorité unique.
- Le regard est une piste distincte si ajouté : cible explicite et rotation limitée, sans concurrence avec le clip corporel.
- Permettre modification manuelle, suppression et régénération d’un intervalle.
- Réinitialiser les poids lors d’un changement de scène ou de clip, afin d’éviter les expressions résiduelles.

VRMA pourra servir à l’échange/import d’animations. Il n’est pas imposé comme format de réponse de l’API Kimodo ; les pistes faciales restent éditables dans le projet.

## 7. Direction de scène par IA

L’agent existant est adapté pour produire un plan validable : personnages, ressources, décor, placement, plans caméra et phases temporelles.

Le plan doit distinguer faits demandés, hypothèses et contraintes non prises en charge. Il ne doit pas inventer de voix ou remplacer un avatar fourni.

Pour chaque action : identifiant du personnage, début, durée, description corporelle, position/orientation de départ, éventuelle trajectoire, émotions et éléments à préserver.

Les instructions longues restent disponibles dans le projet. Le système les découpe en demandes corporelles compatibles avec les limites annoncées par l’API ; il ne tronque pas silencieusement le texte. La limite actuelle de 500 caractères du bridge n’est pas une limite du brief utilisateur.

Les générations sont préparées hors transaction. À l’application, vérifier que le personnage et la révision du document correspondent encore à la demande. Un résultat devenu obsolète est proposé comme variante et ne remplace pas silencieusement le travail récent.

Une vérification suit la construction : positions, recouvrements, personnages hors cadre, contraintes temporelles et disponibilité des animations. Une capture aide l’agent à corriger le cadrage ; des mesures vérifient les contraintes géométriques.

Interactions V1 : se faire face, regarder un interlocuteur, gesticuler, marcher et s’arrêter. Donner un objet, se toucher ou se serrer la main nécessitent une phase ultérieure de contacts coordonnés.

## 8. Contrat proposé pour l’API Kimodo

### Architecture

Navigateur → service local CozyClay → API GPU Kimodo.

Le service local conserve le jeton API, valide les demandes et récupère les fichiers. Le navigateur ne reçoit pas le secret. La voie SSH existante peut rester un adaptateur avancé pendant la migration ; HTTP devient la voie principale de ce studio.

Le serveur GPU ne reçoit normalement ni avatar VRM, ni textures, ni décor complet. Il reçoit les demandes corporelles canoniques et uniquement les contraintes prises en charge. Les contraintes de scène complexes sont vérifiées côté studio.

### Endpoints V1

| Méthode et route | Fonction |
| --- | --- |
| `GET /v1/capabilities` | Version, backend, formats, fréquences, limites et contraintes disponibles |
| `POST /v1/motion-jobs` | Créer une génération ; réponse HTTP 202 avec identifiant |
| `GET /v1/motion-jobs/{jobId}` | Consulter état, progression éventuelle et résultat |
| `POST /v1/motion-jobs/{jobId}/cancel` | Demander l’annulation |
| `GET /v1/motion-jobs/{jobId}/artifact` | Télécharger le NPZ terminé |

Authentification proposée : `Authorization: Bearer <token>` sur les routes privées, téléchargement compris. Les téléchargements passent par le service local. Si une URL externe est utilisée, l’origine doit être autorisée et son expiration annoncée.

États : `queued`, `running`, `succeeded`, `failed`, `cancelled`. L’annulation concurrente avec une fin de génération doit renvoyer l’état réel ; aucun état terminal ne revient à `running`.

### Exemple de demande

```json
{
  "schemaVersion": "cozy-motion-v1",
  "requestId": "unique-request-id",
  "prompt": "Walk forward, stop, then raise the right arm in greeting.",
  "durationS": 6,
  "fps": 24,
  "seed": 1234,
  "output": {"format": "cskel27-npz", "skeletonVersion": "cozy-cskel27-v1"},
  "constraints": {
    "rootWaypoints": [
      {"t": 0, "positionM": [0, 0, 0], "yawDeg": 0},
      {"t": 3, "positionM": [0, 0, 1.5], "yawDeg": 0},
      {"t": 6, "positionM": [0, 0, 1.5], "yawDeg": 0}
    ]
  }
}
```

Les points représentent la trajectoire au sol de la racine projetée, pas la hauteur anatomique des hanches. Le `y` reste zéro en V1. Le déplacement vertical corporel est porté par le résultat.

Repère : mètres, +Y vers le haut, +Z vers l’avant ; yaw 0 vers +Z, yaw positif vers +X, exprimé en degrés. Les temps sont locaux au clip et exprimés en secondes. La conversion vers les conventions natives Kimodo appartient au serveur.

Les contraintes non implémentées doivent produire `UNSUPPORTED_CONSTRAINT` avant calcul, jamais être ignorées. Pose initiale, pose finale, édition d’un passage et préservation seront ajoutées comme capacités versionnées après validation du chemin principal.

### Exemple de résultat

```json
{
  "schemaVersion": "cozy-motion-v1",
  "jobId": "job-123",
  "requestId": "unique-request-id",
  "status": "succeeded",
  "result": {
    "format": "cskel27-npz",
    "skeletonVersion": "cozy-cskel27-v1",
    "fps": 24,
    "frames": 144,
    "durationS": 6,
    "artifactPath": "/v1/motion-jobs/job-123/artifact",
    "sha256": "<empreinte SHA-256 réelle du fichier>",
    "sizeBytes": 123456,
    "backend": "kimodo",
    "backendVersion": "<version ou commit réel>",
    "seed": 1234,
    "expiresAt": "<date ISO-8601 réelle>",
    "warnings": []
  }
}
```

Une durée correspond à `frames / fps` ; l’échantillon final est à `(frames - 1) / fps`. Pour la timeline, les plages sont `[début, fin)` ; convertir explicitement aux plages inclusives attendues par certains exports existants.

### Fichier d’animation attendu

Pour réduire le travail d’intégration, la V1 normalise côté serveur la sortie SOMA77 de Kimodo en NPZ cskel27, en s’appuyant sur le convertisseur existant après validation. Ce choix conserve le lecteur d’archives actuel ; il ne résout pas à lui seul l’adaptation VRM.

| Membre NPZ | Type et dimensions |
| --- | --- |
| `local_rot_mats` | float32, `(F, 27, 3, 3)` ; rotations locales, matrices orthonormales |
| `root_positions` | float32, `(F, 3)` ; positions corporelles de la racine, en mètres |
| `posed_joints` | float32, `(F, 27, 3)` ; positions des articulations dans le même repère |
| `fps` | entier scalaire |

L’ordre des articulations, leur hiérarchie et la pose de référence sont ceux de `src/ardy/cskel27.js` et des références canoniques utilisées par le convertisseur. Figer ces données dans un fichier de contrat partagé avec l’API ; ne pas reconstruire l’ordre à partir des noms retournés par le modèle.

Les rotations, positions et pose de référence doivent être cohérentes entre elles. Le convertisseur conserve le déplacement vertical utile au clip et l’ancrage au sol ; le studio effectue ensuite l’adaptation aux proportions VRM.

Les archives peuvent être STORED ou DEFLATE, sans Zip64, avec tableaux contigus C-order et valeurs finies. Les membres optionnels `person_scale` et `bone_scale` sont omis en V1 sauf convention explicitement validée.

Le lecteur actuel plafonne à 24 000 images et 192 Mio par archive. `capabilities` doit publier des limites égales ou plus restrictives et le client valide avant envoi. Les limites de durée du backend réel restent à confirmer ; les 1 200 secondes du bridge actuel ne constituent pas une garantie de génération utile.

### Fiabilité et erreurs

- `requestId` sert de clé d’idempotence : même demande → même job ; même clé avec contenu différent → conflit.
- Timeout réseau et timeout de calcul distincts ; une coupure de polling ne recrée pas le job.
- Progression numérique facultative ; afficher un état indéterminé si elle n’est pas mesurable.
- Vérifier taille, empreinte, structure NPZ et métadonnées avant application.
- Erreurs structurées : `{ "error": { "code": "…", "message": "…", "retryable": false } }`.
- Codes minimum : `INVALID_REQUEST`, `UNAUTHORIZED`, `UNSUPPORTED_CONSTRAINT`, `UNSUPPORTED_OUTPUT`, `LIMIT_EXCEEDED`, `GPU_UNAVAILABLE`, `GENERATION_FAILED`, `JOB_NOT_FOUND`, `ARTIFACT_EXPIRED`.
- Une contrainte acceptée reste potentiellement approximative : mesurer le résultat. Les seuils de conformité doivent être publiés ou évalués côté studio, sans promettre une précision absolue.
- Ne pas remplacer l’animation active par un résultat invalide ou une génération échouée.

### Livrables à partager avec le développeur API

Avant codage de l’intégration : OpenAPI ou JSON Schemas, fichier de squelette canonique, un exemple de demande, un résultat, une archive valide de 6 secondes, une archive invalide et exemples d’erreurs. Le contrat ci-dessus n’affirme pas que les endpoints existent déjà.

## 9. Timeline, sauvegarde et rendu

- Horloge unique de projet à 24 images/s pour corps, expressions et caméra.
- Clip corporel : ressource, personnage, début, durée, offsets et paramètres d’adaptation.
- Clip facial : personnage, début, durée et pistes de poids.
- Politique de chevauchement V1 : pas de mélange implicite entre deux clips corporels ; remplacer ou décaler explicitement. Pour une expression donnée, une seule piste active par personnage.
- Définir le comportement avant/après clip : retour à une pose neutre ou maintien explicitement choisi ; aucun héritage accidentel du dernier état évalué.
- Lecture et recherche temporelle doivent reconstruire l’état à partir du temps demandé.
- Versionner le format `.cclayproject` ; migrer les anciens projets sans supprimer leurs ressources ou données cachées.
- Une réouverture restaure aussi les résultats déjà téléchargés ; elle ne dépend pas d’une URL GPU expirée.
- Exporter une séquence ou l’ensemble du montage, sans grille, poignées, interface ou marqueurs techniques.
- Pour l’export, évaluer corps, expressions et caméra aux temps exacts des images ; maîtriser les spring bones par pas fixes/préroulage ou désactivation explicitement choisie.
- Les changements de format recadrent sans déformer les personnages ; signaler les sujets hors cadre.
- En V1, MP4 sans audio. Préparer la structure temporelle pour de futures pistes sonores sans implémenter leur rendu.
- Export annulable, progression et erreur explicite ; restaurer ensuite l’état de prévisualisation.

## 10. Interface simplifiée et retrait de fonctions

Parcours visible : Projet, Instructions IA, Personnages, Décor, Caméra, Timeline, Prévisualisation et Export.

Conserver au besoin un panneau avancé pour les corrections compatibles. Masquer initialement le workflow à nœuds, les modèles de vidéo IA, les packs de référence, les exports profondeur/normales/OTIO et la capture de mouvement photo/vidéo.

Ne supprimer leur code qu’après validation du parcours principal et examen des dépendances. Le masquage ne doit ni effacer les données des anciens projets ni casser les outils communs utilisés par l’agent.

MCP et CLI peuvent rester disponibles pour le pilotage et la QA ; ils ne sont pas obligatoires dans l’interface utilisateur.

## 11. Étapes de développement et critères de passage

| Étape | Travail studio | Validation avant étape suivante |
| --- | --- | --- |
| E0 — Contrats | Figer données de projet, expressions et HTTP ; préparer fixtures | Client et serveur acceptent les mêmes exemples et conventions |
| E1 — VRM statique | Ressources, import, rendu, dimensions et instances | Deux avatars distincts et deux copies d’un même avatar, matériaux conservés, formats corrects |
| E2 — Corps VRM | Adaptateur cskel27, racine, proportions et appuis | Marche, arrêt, rotation et geste lisibles sur au moins deux avatars aux proportions différentes |
| E3 — Visage | Schéma, validation, lecture et édition ; branchement LLM | Expressions indépendantes, transitions, absence d’expression gérée, recherche temporelle correcte |
| E4 — HTTP simulé | Service local, jobs, polling, annulation et artefacts | Succès, échec, coupure réseau, doublon et résultat obsolète correctement traités |
| E5 — IA de scène | Plan structuré, outils VRM et actions temporelles | Brief à deux personnages construit puis corrigé sans régénération inutile |
| E6 — Persistance/export | Version de projet, réouverture et MP4 | Projet portable ; exports 16:9 et 9:16 conformes à la prévisualisation |
| E7 — API réelle | Brancher l’instance GPU et mesurer les mouvements | Fixtures et jobs réels produisent des animations compatibles ; erreurs non destructives |
| E8 — Simplification | Masquer les fonctions hors périmètre, puis nettoyage ciblé | Parcours personnel complet, anciens projets toujours ouvrables |

L’utilisateur peut développer le serveur GPU dès E0. Son absence ne bloque pas E1 à E6 : utiliser les mêmes fixtures contractuelles. Les étapes studio restent dépendantes des critères de passage ci-dessus ; ce document ne prescrit pas des agents de codage parallèles.

## 12. Scénarios de recette

1. Deux personnages face à face dans un décor de trois objets : un geste et des expressions différentes, caméra fixe, 10 secondes.
2. Un personnage marche vers un point et s’arrête ; comparer destination demandée et déplacement réellement mesuré sur deux proportions d’avatar.
3. Deux instances du même VRM ont des animations et expressions indépendantes.
4. Un avatar sans expression `surprised` reçoit une erreur ou un avertissement explicite ; aucun faux succès.
5. Déplacer la timeline directement à 7 secondes donne la même pose et expression que la lecture jusqu’à cet instant.
6. Régénérer le visage conserve le corps ; régénérer le corps conserve les expressions hors intervalle concerné.
7. Une erreur GPU, une annulation ou un résultat tardif n’écrase pas le travail récent.
8. Sauvegarder, fermer et réouvrir sans serveur GPU restitue le projet et ses animations.
9. Exporter le même projet dans les deux formats ; vérifier dimensions, durée, couleurs, cadrage et expressions.
10. Ouvrir un ancien projet CozyClay après migration et vérifier scènes, caméras et ressources.

Objectifs de recette initiaux proposés : écart de destination au sol ≤ 10 cm, pieds sous le sol ≤ 2 cm sur un clip de marche de référence, durée exportée à une image près. Mesurer ces valeurs après adaptation VRM ; les confirmer sur fixtures avant de les considérer comme garanties produit. Les contacts complexes restent hors de ces critères.

Vérification : tests de schémas/convertisseurs pour les risques de données, fixtures contractuelles API, QA navigateur pour import/édition/lecture et contrôle visuel des exports. Respecter les gates du dépôt (`npm test`, QA des changements UI) lors des futurs PR.

## 13. Points à figer en E0

- Deux avatars de recette autorisés d’utilisation, dont un avec proportions différentes.
- Compatibilité VRM 0.x dès la première livraison ou immédiatement après VRM 1.0.
- Limites pratiques : durée d’un job, concurrence GPU, taille des fichiers VRM et durée totale d’un projet.
- Contraintes Kimodo réellement disponibles, notamment trajectoires et orientation pendant les arrêts.
- Politique de conservation des jobs et délai d’expiration des fichiers serveur.
- Distribution locale du studio et configuration du jeton API.
- Ordre et données exactes du squelette de référence, validés par une fixture commune.

Ces points doivent être résolus à partir des modèles et du backend choisis. Ils ne nécessitent pas de remettre en question le périmètre confirmé par l’utilisateur.
