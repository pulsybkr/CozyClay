# 03 — Connexion locale, synchronisation et interface

## 1. Parcours utilisateur de la connexion

Ajouter un bouton « Production » dans la barre du studio. Il ouvre ProductionPanel dans un tiroir latéral ; l’utilisateur garde la scène visible et peut lancer sa prévisualisation.

Premier écran :

~~~text
Production distante
Connexion : Mon workflow             [Configurer]
ID du projet : [88LTeGwzPgE]          [Récupérer]

La tasse du bureau — révision r17 — 12 s — 9:16
2 personnages · 1 décor · 1 scène · 3 plans
Synchronisation : téléchargé à 08:12   [Actualiser]
~~~

Configurer demande nom et URL API, puis « Tester la connexion ». La clé peut être configurée par variable d’environnement ou saisie dans le formulaire de connexion ; dans ce dernier cas elle est envoyée une fois au sidecar, jamais gardée dans localStorage, l’état du projet, le transcript ou la réponse API. Le champ doit être vidé après envoi. Réutiliser le gestionnaire Node de clés existant.

La récupération du projet n’efface pas la scène ouverte. Elle crée un ProductionDocument candidat. « Utiliser cette production » crée sa collection de scènes quand la première installation est demandée. Si une production existe, afficher « nouvelle production » ou « actualiser cette production » selon projectId.

## 2. Routes locales proposées

Namespace /agent/source ; montage avant le handler générique /agent.

| Route | Entrée / sortie |
| --- | --- |
| GET /agent/source/connections | Liste publique : id, name, baseUrl, credentialConfigured |
| POST /agent/source/connections | Créer connexion ; name, baseUrl, credential optionnel |
| PATCH /agent/source/connections/{id} | Modifier configuration ; secrets write-only |
| POST /agent/source/connections/{id}/test | capabilities et latence ; aucune mutation distante |
| GET /agent/source/connections/{id}/projects/{projectId}/manifest | Proxy validé du manifest courant |
| GET /agent/source/connections/{id}/projects/{projectId}/revisions/{revision}/sections/{section} | Page du snapshot |
| GET /agent/source/connections/{id}/projects/{projectId}/revisions/{revision}/snapshot | Snapshot borné |
| GET /agent/source/connections/{id}/projects/{projectId}/revisions/{revision}/resources/{resourceId} | Flux binaire référencé |

V1 ne permet pas de proxy arbitraryUrl. Les routes amont sont construites depuis la connexion enregistrée et les segments validés. Une redirection doit rester sur une origine autorisée par la connexion ; ne pas envoyer Authorization à un autre domaine.

Conserver les règles de allowAgentOrigin et de serveur loopback. Une connexion explicite à un serveur LAN/localhost peut être autorisée ; ce choix de l’utilisateur ne doit pas être remplacé par un blocage général des adresses privées.

## 3. Implémentation Node

Ajouter :

- bin/agent/source-connections.mjs : lecture/écriture des configurations publiques ; storageRoot injectable et COZYCLAY_SOURCE_CONFIG_DIR pour tests. Utiliser secure-file pour écriture atomique.
- bin/agent/source-client.mjs : fetchManifest, fetchSectionPage, fetchSnapshot, fetchResource, testConnection ; transport injectable.
- bin/agent/source-routes.mjs : factory createSourceRoute({env, keys, configStore, fetchImpl, port}).
- bin/agent/source-contract.mjs si le validateur navigateur dépend d’import.meta.env ; sinon importer directement le module partagé source-contract.js.

Stocker la configuration publique dans la config utilisateur CozyClay et la clé via provider-keys sous workflow-source:<connectionId>. Si COZYCLAY_WORKFLOW_API_URL et COZYCLAY_WORKFLOW_API_KEY existent, publier une connexion env non modifiable par l’UI. Ne pas créer un fichier avec la clé copiée dans la documentation.

Modifier tools/dev-full.mjs et bin/cozyclay.mjs : instancier sourceHandler, le monter dans les deux lanceurs avant agentHandler, transmettre port/origin, fermer les opérations en cours à l’arrêt. Tester les deux chemins ; une intégration seulement Vite est insuffisante.

Délais par requête source : 15 s, couvrant en-têtes et corps ; annulation sur fermeture HTTP du client. Pour ressources : 60 s et streaming. Reprises automatiques GET : maximum deux sur réseau/503, délai 500 ms puis 1 500 ms avec jitter ; respecter Retry-After pour 429, maximum attente affichée 30 s avant laisser l’utilisateur reprendre. Aucun retry sur 401/403/404/410/422.

Bornes : page 2 MiB, snapshot cumulé 8 MiB, VRM/mesh selon ASSET_MAX_SOURCE_BYTES, motion selon MOTION_MAX_BYTES. Vérifier les tailles pendant lecture et non après arrayBuffer complet.

## 4. Client navigateur et récupération progressive

Ajouter src/production/source-client.js, exposant les fonctions des routes locales, sans clé ni URL amont arbitraire. Les erreurs doivent conserver code, retryable et requestId.

Lors de « Récupérer » :

1. Lire le manifest courant.
2. Valider la version et les limites.
3. Fig­er projectId/revision/manifestHash.
4. Récupérer les sections légères dans l’ordre personnages, décors, scènes, plans, actions, narration ; montrer un compteur par page.
5. Après chaque section complète, vérifier hash/IDs et checkpoint local.
6. Publier le snapshot final avec ses ambiguïtés ; aucun asset ni motion généré.

L’utilisateur peut utiliser « Récupérer seulement les décors » si une révision est déjà épinglée. Les IDs du manifest permettent de voir les dépendances manquantes. Une section manquante bloque la préparation de ses unités, pas la consultation des sections déjà téléchargées.

AbortController par téléchargement. Les tickets de requêtes sont invalidés dès changement d’ID, connexion ou intention, avant debounce. Un ancien résultat ne doit pas remplir un nouveau projet sélectionné.

Un reçu production.fetch donne productionId, revision, sectionCounts et warningsCount ; les sections sont déjà dans le domaine/cache. Il ne renvoie pas leur texte intégral.

## 5. Actualisation et conflits

« Actualiser » commence par le nouveau manifest. Si revision/hash sont inchangés : aucun travail. Si changement :

- télécharger le nouveau snapshot candidat ;
- calculer un diff par entité source et par inputHash de chaque unité ;
- afficher « inchangé », « nouveau », « modifié », « supprimé », « conflit local » ;
- accepter les changements par sélection ;
- invalider uniquement les unités concernées et leurs dépendants.

~~~json
{
  "sourceId": "CUP",
  "fields": ["heightMeters"],
  "before": 0.12,
  "incoming": 0.15,
  "local": 0.18,
  "resolution": "needs-choice"
}
~~~

Règles de fusion à trois voies : base = source précédente acceptée ; local = override ou projection native actuelle ; incoming = nouvelle source. Si seul incoming change, proposer son application ; si seul local change, le conserver ; si les deux changent différemment, choix garder local / accepter source / dupliquer.

L’absence distante d’une entité ne doit pas supprimer automatiquement son natif. Proposer suppression et signaler ses références. Des plans utilisant un avatar inchangé ne justifient pas une nouvelle génération de cet avatar.

Les changements de caméra ne rendent pas les mouvements stales. Les changements de taille d’un accessoire rendent stales placement/contact et cadrages concernés, pas tous les avatars du projet. Les hashes sont calculés sur les données réellement utilisées par chaque unité, pas sur toute la révision distante.

## 6. Panneau de suivi

Sous le résumé, afficher les étapes :

~~~text
Préparation          Prête                 [Voir le plan]
Décors               3 / 4 installés       [Continuer]
Personnages          1 / 2 installés       [Créer les manquants]
Plans                Bloqué : Marie       [Voir le blocage]
Animations           0 / 5                [Préparer]
Vérification         À faire
Export               À faire
~~~

Une étape contient les unités avec nom humain, état, dépendance bloquante et résultat. Sélectionner une ligne cadre ou sélectionne le natif via commandes existantes ; ne pas reproduire un deuxième gizmo.

Actions au niveau unité : Voir le résultat, Préparer/Construire/Générer, Reprendre, Modifier l’intention, Utiliser une ressource existante, Marquer à vérifier. Une réussite manuelle doit être vérifiée avant done, pas simplement cochée.

Journal lisible :

- « Recherche de la tasse dans la bibliothèque »
- « Tasse téléchargée — hauteur estimée : 12 cm »
- « Modèle installé dans Bureau »
- « Mouvement de Marie en génération — progression fournie par Kimodo »
- « Résultat disponible ; installation interrompue après un changement de scène »

Éviter les tokens, corps HTTP, prompts système et messages internes dans les textes produit. Une vue Détails peut montrer IDs, receiptId, fournisseur, durée et erreur pour le diagnostic.

Progression réelle : compte d’unités et phase courante. Ne pas inventer un pourcentage de GPU si le fournisseur n’en fournit pas. Un compteur 3/8 doit indiquer si les unités sont préparées, installées ou vérifiées.

## 7. Intégration à App et AgentPanel

Modifier src/App.jsx :

- instancier useProduction(appContext) une seule fois ;
- ajouter panneau/toggle et son état d’ouverture ;
- fournir au domaine les ports nécessaires, en réutilisant appContext.bus ;
- exposer un résumé de production dans le binding d’agent ;
- interrompre proprement le controller au démontage du studio.

Modifier src/studio-app-binding.js, src/studio-agent-context.js et src/studio-agent-protocol.js : production summary facultatif avec productionId, source projectId/revision, runState, counts, nextReadyUnitIds (maximum huit), blockedUnitIds (maximum huit). Respecter les limites globales existantes.

La liste détaillée passe par production.read avec scope units et curseur ; un détail utilise scope unit et unitId. Ne pas ajouter des milliers d’actions ou tout le récit au contexte à chaque tour.

Le panneau workflow ReactFlow reste disponible. La V1 d’intégration par ID vit dans le studio ; aucun nouveau graphe de nœuds n’est requis pour lancer les étapes. Un futur nœud Source Project pourra être un adaptateur des mêmes commandes.

## 8. Tests et preuves

Ajouter :

- test/verify-source-client.mjs : authentification write-only, bornes, délais couvrant le corps et erreurs.
- test/verify-source-routes.mjs : routes exactes, origine, segments, redirects et pagination.
- test/process/verify-source-launcher.mjs : dev-full et launcher empaqueté.
- test/verify-production-sync.mjs : révision figée, pagination, diff et fusion à trois voies.
- test/verify-production-panel-browser.mjs : ID projet, erreurs, étapes, sélection et progression réelle.

Serveur fixture local : test/fixtures/source-api-server.mjs, avec project r17/r18, délai réglable et erreurs. Aucune clé de compte réelle. Config/session directories injectés dans un répertoire temporaire.

QA : un ID valide récupère l’inventaire sans changer les objets présents ; un second ID lent puis remplacé n’affiche pas les données du premier ; une mise à jour de caméra n’entraîne pas de job de mouvement ; un override de taille déclenche le choix de conflit.
