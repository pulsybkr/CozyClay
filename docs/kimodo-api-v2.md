# Branchement de l’API Kimodo Modal v2

Le studio possède maintenant un transport HTTP serveur pour l’API Modal. Le token reste dans l’environnement serveur ; il ne passe pas dans les projets ni dans les propriétés du navigateur.

## Configuration

Dans le `.env` du worktree utilisé pour lancer le studio :

```dotenv
CCLAY_KIMODO_API_URL=https://pulsy26--kimodo-motion-web.modal.run
CCLAY_KIMODO_API_TOKEN=VOTRE_TOKEN
CCLAY_KIMODO_API_TIMEOUT_MS=900000
```

Le fichier est ignoré par Git. `tools/dev-full.mjs` charge ce `.env` avant de démarrer la passerelle. Redémarrer le serveur après toute modification de configuration. Le lancement par `bin/cozyclay.mjs` reconnaît aussi le transport HTTP lorsque ces variables sont présentes dans l’environnement du processus ; il ne charge pas automatiquement le `.env` du worktree.

Le serveur de travail est démarré sur `http://127.0.0.1:5191/app/`, avec la passerelle de mouvements sur le port 5192. Aucun tunnel SSH n’est nécessaire pour cette configuration.

Pour utiliser l’agent web, installer aussi les dépendances de la connexion à l’éditeur, puis démarrer le serveur complet depuis ce worktree :

```powershell
npm ci --prefix mcp
$env:COZYCLAY_LIVE_PORT = '5291'
node tools/dev-full.mjs --host 127.0.0.1 --port 5191
```

`dev:ui` ne démarre pas les services de l’agent. Une erreur de connexion WebSocket empêche l’agent de lire la scène. La lecture réelle de la scène a été vérifiée après installation des dépendances avec `test/qa-agent-live-ready.mjs`. Les messages concernant le port 8787 appartiennent au service Fal séparé, pas à Kimodo.

## Fonctionnement

1. Lire les capacités avec authentification, sans appeler le ping de chargement du modèle.
2. Traduire les trajectoires et poses via les convertisseurs CozyClay existants.
3. Créer un job v2 ; utiliser une clé d’idempotence conservée pour une éventuelle répétition de la création.
4. Suivre les états et étapes selon le délai de polling annoncé.
5. Lire les métadonnées et télécharger le NPZ depuis l’endpoint authentifié du job.
6. Vérifier taille, SHA-256, squelette, repère, fréquence et cohérence des tableaux.
7. Convertir SOMA77 vers le squelette CozyClay puis adapter la fréquence native à 24 fps ; l’adaptateur VRM applique ensuite les mouvements.

Le transport conserve les prompts contenant plusieurs phrases sans leur appliquer la segmentation par ponctuation du CLI. Il envoie un mode simple ou un tableau de segments selon la demande. Les contraintes utilisent la fréquence native de 30 fps et l’espace canonique Kimodo, avec la conversion existante des positions et des clés.

Les graines entières signées de l’ancien studio sont converties en entiers non signés sur 32 bits pour le contrat de l’API. Le post-traitement est activé. La guidance est régulière pour un mouvement sans contraintes, séparée lorsqu’il y a des contraintes.

Le wrapper reçoit une demande d’arrêt par son entrée standard, tente d’annuler le job connu, puis se termine. Un timeout déclenche également une demande d’annulation. Une terminaison forcée du processus ou une perte de réponse pendant la création ne permet pas de garantir que le job GPU a été arrêté. L’API peut elle-même terminer son calcul avant de traiter l’annulation.

## Vérifications effectuées

Le 30 septembre 2026 :

- Lecture authentifiée des capacités du déploiement v2 réussie.
- Génération réelle sur Modal : un personnage immobile fait un petit geste de la main droite, 2 secondes, graine 42.
- 60 frames natives à 30 fps ; post-traitement effectif ; aucun avertissement API.
- NPZ téléchargé, checksum vérifié, décodé et converti en 48 frames à 24 fps.
- Relecture de ce mouvement dans le navigateur sur Sakura et CHAR 02 : transformations finies, mouvement effectif, déplacement temporel déterministe et expression faciale conservée.
- Tests locaux du transport : authentification, résultat binaire réel de test, checksum invalide, erreur de génération, reprise idempotente, annulation et conversion SOMA77.
- Tests des anciens runners et convertisseurs de trajectoires, poses et extrémités.
- Build de production réussi.

Preuves conservées : [rapport de génération](qa/kimodo-api/report.json), [rapport de lecture VRM](qa/kimodo-api/browser-report.json) et [capture de la scène](qa/kimodo-api/vrm-replay.png). Les fichiers NPZ de vérification restent dans le dossier temporaire.

Les séquences, les poses et les trajectoires sont branchées aux convertisseurs existants et couvertes par leurs tests locaux. Leur précision sur le déploiement Modal n’a pas encore fait l’objet de générations GPU dédiées. Un seul cas réel court ne certifie donc pas toute la conformité P0/P1.

La suite de lancement des processus ne peut pas être annoncée entièrement réussie sur cette machine Windows : elle invoque `lsof`, qui n’y est pas disponible. Le démarrage réel du studio et de sa passerelle HTTP a néanmoins été vérifié. Le gate POSIX de permissions, décrit dans `vrm-studio-start.md`, reste également une limitation des tests globaux sous Windows.

## Points encore à préciser côté API

Le contrat déployé décrit les principales entrées et réponses v2. Quelques points de documentation restent :

- Les réponses d’erreur 409/422 de création n’exposent pas encore le schéma complet de l’enveloppe d’erreur ; d’autres routes indiquent encore le schéma standard FastAPI de validation.
- Les réponses 200 des fichiers v2 ne déclarent pas leur contenu binaire et son type dans OpenAPI.
- Certaines sous-sections de capacités et paramètres effectifs sont des objets libres ; la sélection exclusive du mode simple/séquence et certaines limites sont contrôlées à l’exécution mais peu décrites dans le schéma.
- Les anciennes routes et les routes de santé conservent des réponses `schema: {}`. La disparition totale de ces schémas vides n’est donc pas confirmée.

Ces points n’ont pas empêché le test réel de génération et de téléchargement.

## Limites du branchement actuel

- L’édition par conservation/inpainting n’est pas exposée par cette API : une demande explicite est refusée. Les fichiers natifs récupérés ne sont pas annoncés comme bases compatibles avec cette fonctionnalité distante.
- La lecture des capacités atteste que l’API est accessible et annonce le contrat attendu ; elle ne réserve pas de GPU et ne garantit pas sa disponibilité immédiate.
- Les expressions faciales restent indépendantes ; Kimodo ne les remplace pas.
- Le réglage des contacts exacts avec le décor ou entre deux avatars peut nécessiter des corrections après adaptation aux proportions VRM.

Contrat vérifié : [OpenAPI du déploiement](https://pulsy26--kimodo-motion-web.modal.run/openapi.json).
