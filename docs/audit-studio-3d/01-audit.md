# Audit détaillé — état réel et écarts avec la demande

Date : 1er octobre 2026. État initial observé : HEAD 6a58215 et modifications locales présentes au démarrage. Contrôle final : 11eb442.

## 1. Verdict

Le travail des agents est utile, mais la demande initiale est seulement partiellement satisfaite. Le studio contient désormais une bibliothèque 3D, des avatars VRM, des caméras réutilisables et des outils de mouvement. Il manque surtout la connexion exécutable entre un récit externe et une production complète, ainsi que des interactions temporelles fiables.

Plusieurs ajouts ont été testés isolément. Ces tests ne couvrent pas certaines erreurs de raccordement entre la commande, le domaine de données et le rendu. Deux erreurs de placement et une erreur de classification des licences sont présentes alors que leurs suites ciblées réussissent.

Ce rapport ne recommande pas de reconstruire le studio. Il recommande de fiabiliser les briques existantes, puis de livrer et vérifier leur orchestration.

## 2. Périmètre et valeur des preuves

Lecture du code, de l’historique récent, des documents livrés et des tests. Compilation lancée par npm test. Exécution de quatorze fichiers de tests ciblés et reproduction directe du parseur de licences et de la mesure de rythme.

Les modifications locales préexistantes touchent src/App.jsx, src/commands/motion.js, src/studio-agent-context.js, src/studio-agent-protocol.js et test/verify-studio-agent-protocol.mjs. Elles appartiennent à l’état audité ; elles ne sont pas des corrections effectuées par cet audit.

Des travaux concurrents ont ajouté les commits c00a502 puis 11eb442 pendant cet audit. Ils ont notamment enregistré les modifications locales, remplacé le document de modifications manuelles par docs/etat-chantier-studio-3d.md et actualisé la QA bibliothèque. Les erreurs de transmission hint/heightHint et de placement y ont été revérifiées après ces changements et restent présentes. Les résultats de tests ci-dessous décrivent les exécutions de cet audit, sans reprendre comme preuve indépendante les annonces de cette autre session.

Les constats sont classés ainsi :

- **Confirmé** : comportement établi dans le code ou reproduit.
- **Manquant documenté** : le document de livraison indique explicitement que la fonction reste à faire.
- **Risque à vérifier** : aucune preuve suffisante pour conclure à un défaut de rendu réel.
- **Preuve historique** : résultat QA enregistré dans le dépôt, non rejoué visuellement pendant cet audit.

Les deux liens trycloudflare fournis n’étaient pas accessibles avec l’outil de consultation utilisé. Leur contenu et leur apparence ne sont donc pas certifiés par cet audit. La documentation locale qui affirme les avoir examinés est une source historique, pas une observation actuelle.

La page officielle [Poly Pizza v1.1](https://poly.pizza/docs/api/v1.1) était consultable, mais son contenu technique n’était pas extrait par l’outil. Les hypothèses actuelles sur les quotas, les champs et le CORS doivent être validées par une recette réseau ; elles ne sont pas présentées ici comme une vérification indépendante de la documentation API.

Aucun appel payant à Kimodo ou Atelier et aucun essai réel de l’agent avec gpt-6-luna/Codex n’ont été faits. La clé copiée dans le prompt n’a pas été réutilisée ni recopiée dans les livrables.

## 3. Couverture de la demande initiale

| Demande | État constaté | Limite importante |
| --- | --- | --- |
| Chercher et télécharger des accessoires Poly Pizza | Implémenté, tests ciblés réussis, preuve QA historique | Proportions, hauteur de placement, résultats volumineux et licences à corriger |
| Construire murs et couloirs dans le studio | Primitives et édition existantes | Pas de compilation complète du contrat source démontrée |
| Réutiliser/générer les personnages avec l’API | VRM et jobs Atelier implémentés | Recette API réelle et adéquation des apparences non vérifiées ici |
| Plusieurs personnages animés séparément | Admission par personnage corrigée | Deuxième génération du même personnage bloquée dans une même demande |
| Plusieurs plans, cuts, mouvements de caméra | Présents ; tests caméras réussis | Production longue et orchestration narrative non validées |
| Histoire continue et changements de décor | Base de scènes et timeline présente | Contrat proposé limité à une scène ; orchestration entre décors non livrée |
| Connecter automatiquement l’application de script | Manquant documenté | Le contrat JSON est une proposition sans lecteur livré |
| Animation plus naturelle et dynamique | Outil de rythme ajouté | Mesure seulement la translation horizontale du bassin ; ne traite pas la rigidité articulatoire |
| Toucher, soulever, poser un objet | Attachement disponible | Pas d’événements datés de prise/dépose ; pas de vraie préhension |
| Contacts des objets portés | Limitation confirmée | Les objets attachés sont exclus des obstacles de collision |
| Export vidéo finale 3D | Chemin MP4 existant, preuve historique de cuts exportés | Pas de recette complète récit → vidéo longue démontrée |
| Document des modifications du workflow source | Livré | Contient des erreurs de repère, un exemple incohérent et des ambiguïtés temporelles |
| Audio/VFX en bonus après le cœur du workflow | Différé | Ce report est cohérent avec la priorité donnée au cœur ; ne bloque pas à lui seul la livraison visuelle |

## 4. Défauts et lacunes détaillés

### A01 — Indication de hauteur perdue lors du téléchargement — P1, confirmé

Dans src/commands/library.js, l’appel de l’import transmet **hint**. Dans src/domains/objects.js:405, l’import lit **args.heightHint**. Une chaise dont les unités imposent le repli à un mètre conserve donc ce repli, malgré l’indication de catégorie à 0,9 m.

Les tests test/verify-library-commands.mjs attendent précisément domain.lastArgs.hint. Ils prouvent que la mauvaise clé est transmise à la doublure ; ils ne prouvent pas que le véritable import l’utilise.

Conséquence : la promesse de proportions automatiquement adaptées dans docs/bibliotheque-3d.md n’est pas tenue dans ce cas.

### A02 — Position y perdue entre commande et import — P1, confirmé

La commande place x/y/z/rot dans args.placement. createMeshObject initialise y à zéro et ne lit pas placement.y. L’import bibliothèque ne corrige y que si **args.y** existe, à src/domains/objects.js:415. Or la commande ne transmet pas ce champ au premier niveau.

Demander une tasse à y = 0,75 m pour la poser sur une table place son origine au sol. Le test de commande utilise une doublure qui lit placement.y et masque la divergence avec createMeshObject.

### A03 — Empreinte au sol non recalculée lors d’une hauteur imposée — P1, confirmé

src/domains/objects.js:405-408 change height mais transmet footprint telle qu’elle a été calculée avant ce changement. createMeshObject conserve cette empreinte. Le rendu ImportedMesh normalise pourtant la géométrie selon object.height.

L’aspect visuel peut rester proportionné, mais la largeur/profondeur utilisées par le plan, les sélections et les obstacles sont alors différentes de la géométrie rendue. Une taille imposée deux fois plus grande doit aussi doubler l’empreinte ; cela ne se produit pas dans cette voie d’import.

### A04 — Licences restrictives classées comme CC-BY utilisable — P1, reproduit

src/poly-pizza.js, polyLicenseOf, accepte tout préfixe cc-by sauf la variante détectée cc-by-sa. Les entrées CC-BY-NC 4.0, CC-BY-ND 4.0 et CC-BY-NC-SA 4.0 ont toutes renvoyé allows: true pendant l’audit, avec un identifiant cc-by et une URL de licence BY générique.

Ce défaut contredit la politique de refus annoncée dans la documentation. Le constat concerne la classification et la cohérence du produit ; il ne constitue pas une qualification juridique de chaque vidéo ou licence.

### A05 — La licence et l’URL de téléchargement sont déclarées par l’appelant — P1, confirmé

asset.downloadLibraryModel accepte id, title, license et downloadUrl librement. L’implémentation normalise la licence fournie mais ne récupère pas la fiche officielle correspondant à id et ne lie pas les données à un résultat de recherche validé.

Un agent ou client qui modifie accidentellement ces champs peut enregistrer une fausse provenance ou faire accepter une licence différente de celle de la fiche. L’instruction « ne jamais inventer » dans le prompt ne constitue pas une vérification. Il faut une résolution autoritative par identifiant ou un résultat de recherche authentifié par le studio.

### A06 — Attribution conservée dans le projet mais non livrée avec la vidéo — P1 pour les exports concernés, confirmé par inspection

La provenance est normalisée, dupliquée et persistée avec les objets. C’est utile et à conserver. La recherche des consommateurs de credit/attribution dans src et bin/agent n’a toutefois pas trouvé de génération de crédits accompagnant le MP4.

Conserver des crédits dans un projet privé ne les transmet pas automatiquement au spectateur d’une vidéo publiée. Le studio doit produire les crédits de publication et annoncer leurs obligations selon sa politique de licences. Ne pas affirmer que le MP4 contient déjà ces crédits.

### A07 — Contrat externe proposé, lecteur non livré — P0 fonctionnel, manquant documenté

Le §5 de docs/connexion-workflow-studio-3d.md classe explicitement le lecteur JSON du §3 parmi les éléments restant à développer. Les champs proposés dureeSecondes/debutSecondes/finSecondes/imagesParSeconde n’ont pas de consommateurs trouvés dans src ou bin/agent.

La création à partir d’instructions libres via l’agent reste possible, mais ce n’est pas un import déterministe et validé des données du workflow externe. La principale finalité de la demande reste ouverte.

### A08 — Une génération par personnage et par message reste trop restrictive — P0 pour le parcours autonome, confirmé

bin/agent/studio-tools.mjs et son test vérifient qu’une seconde génération réussie pour un même characterId est refusée par GENERATION_LIMIT. Le changement autorise Alex puis Marie ; il n’autorise pas Alex dans trois séquences distinctes d’un même projet.

Une génération unique peut contenir plusieurs beats et suffire à certains récits. Cela n’annule pas la limite pour des clips distincts, des décors différents ou une correction nécessaire après inspection. L’autonomie demandée nécessite une notion de tâche autorisée et de budget par unité de production, avec protection contre les doublons.

Le verrou pending est également global pendant un appel : l’admission de plusieurs personnages ne prouve pas leur génération simultanée. La génération séquentielle est acceptable si son suivi est fiable.

### A09 — Rythme mesuré uniquement sur le bassin horizontal — P1, reproduit et confirmé

rootSpeeds mesure uniquement les composantes x/z de rootPos. Les rotations, bras, mains, jambes, visage et déplacement vertical sont ignorés. Un personnage assis qui parle avec les mains ou un personnage qui saute peut être actif sans translation x/z.

Une racine stationnaire de 48 frames à 24 fps a produit dead-air et padded-ends, avec stillShare = 1. Toute animation articulaire ajoutée à cette même racine recevrait le même diagnostic, car ces données ne sont pas lues.

Si tout le bassin est immobile, actionRange renvoie null et tightenPace ne corrige pas le geste. Si des gestes précèdent une marche, le rognage peut supprimer ces gestes en les considérant comme une attente. L’affirmation de préservation de « toutes les poses de l’action » dans le commentaire est donc trop large.

Enfin, une racine lente n’est pas une mesure de rigidité. Accélérer une performance ne résout pas nécessairement les transitions, le glissement des pieds ou l’absence de regards.

### A10 — Correction du rythme désynchronise les pistes narratives — P1, confirmé dans la voie d’écriture

src/domains/motion.js:253-267 remappe les clés IK et les promptClips du personnage. Cette voie ne remappe pas les expressions faciales, les caméras, les autres personnages ou les trajectoires d’objets selon les événements du récit.

Raccourcir uniquement la prise d’Alex peut avancer son geste alors que Marie répond toujours à l’ancien instant et que la caméra cadre encore le plan précédent. Certaines pistes peuvent volontairement rester liées au temps global : le défaut est l’absence de politique et d’avertissement explicites pour ces dépendances.

### A11 — tightenPace remplace le montage courant par un seul segment de la source complète — P1, confirmé

src/commands/pacing.js lit fullMotionFor ; paceSegments propose un segment unique ; editSegments remplace la liste de segments courante. Les découpes et vitesses précédemment choisies par l’utilisateur ne sont pas prises en compte.

Une correction dite ciblée peut donc restaurer des passages déjà retirés ou écraser une organisation de clips. Le second appel est testé avec une doublure qui attend encore changed: true : cette vérification ne prouve pas un comportement sans changement ni une conservation du montage réel.

### A12 — Attachement sans prise et dépose datées — P1, confirmé

object.attach/object.detach modifient l’état permanent de l’objet. L’attachement sauvegardé contient characterId et bone, sans intervalle. src/props.jsx applique cet état à toutes les frames.

La résolution de l’os VRM est une amélioration réelle. Elle permet de porter un accessoire pendant une animation. Elle ne permet pas à elle seule de raconter « la tasse est sur la table, puis saisie à 3 s, puis reposée à 7 s ». Cliquer attacher/détacher pendant la lecture ne crée pas cette histoire dans le MP4 ou après réouverture.

### A13 — Objet porté exclu des collisions — P1, confirmé

src/ardy/collision-blockers.js:129 ignore explicitement object.attach ; docs/A-FAIRE-par-lutilisateur.md signale aussi l’exclusion dans le calcul du sol.

Une tasse portée peut traverser le torse ou le mobilier sans être un obstacle de cette correction. Cette limite connue doit être exposée comme telle, puis traitée avec les transformations mondiales de chaque frame et des contacts autorisés pour la main porteuse.

### A14 — Résultats de recherche incompatibles avec la limite du reçu — P1, confirmé comme incompatibilité de contrat

L’interface demande huit modèles. La commande et son schéma autorisent jusqu’à vingt ; le défaut du client est douze. docs/bibliotheque-3d.md rapporte une limite de reçu à 8 Kio et une recherche réelle de douze lignes à environ 8,1 Kio.

L’interface évite une taille observée, mais les appels d’agent avec la valeur par défaut ou limit: 20 ne sont pas protégés. Même huit lignes ne constituent pas une garantie si titres, URLs, descriptions ou attributions sont plus longs. Aucun curseur de pagination n’est exposé par le schéma de commande malgré le support page dans le client.

### A15 — Délais, annulation et limites de téléchargement incomplets — P2, confirmé

Le téléchargement de modèle est effectué sans transmettre context.signal. La borne de taille repose sur Content-Length, puis un arrayBuffer complet avant contrôle. Une réponse sans longueur peut donc être entièrement chargée avant le refus.

Dans poly-pizza-route.mjs, le timer de huit secondes est supprimé après réception des en-têtes, avant response.text. Un corps qui arrive très lentement n’est plus couvert par ce timer. La borne MAX_RESPONSE_BYTES intervient après lecture et compte une longueur de chaîne, pas les octets transférés.

Ce n’est pas une preuve de panne sur le CDN actuel. C’est un défaut de comportement pour annulation, réseau dégradé et réponses volumineuses.

### A16 — Course entre recherche en cours et champ vidé — P2, confirmé par lecture

Dans AssetLibraryPane.runSearch, une requête vide réinitialise le panneau sans invalider requestRef. Une ancienne réponse peut ensuite restaurer ses résultats. Le ticket n’est incrémenté qu’au démarrage de la recherche, après le délai de debounce.

Le résultat visible peut donc correspondre à un texte qui n’est plus celui du champ. L’invalidation doit suivre le changement d’intention, y compris le passage à une chaîne vide.

### A17 — Document de connexion incohérent sur repères et références — P1 documentaire, confirmé

Le document traduit screen-left par x négatif dans le décor. Cette conversion est fausse en général : la gauche à l’écran dépend de l’orientation de la caméra.

L’exemple JSON déclare seulement CHAR_01 mais référence CHAR_02 et CHAR_03 dans les actions/expressions. Il n’est pas un exemple de contrat valide. Il décrit y comme « étant le sol » alors que y est la hauteur, et ne fixe pas clairement les axes, les rotations, le caractère local ou global des temps ni l’inclusion des bornes.

Le texte parle de narration horodatée, mais recommande aussi de ne pas déduire les durées du TTS. Il faut préserver les temps de narration validés et expliciter quand ils sont indicatifs. Il ne faut pas abandonner l’alignement avec la narration pour rendre les plans indépendants.

Le choix d’une seule scène n’est pas suffisant pour tout récit à plusieurs lieux. Une scène persistante par décor et une liste globale de plans constituent une cible plus générale.

### A18 — « Plus de génération d’images » n’est pas le comportement actuel — P1 de parcours, confirmé

Le document de connexion affirme que le studio ne génère plus d’images. Pourtant WorkflowBuilder conserve des nœuds image/video, le chemin video-generation, l’appel au fournisseur et la création d’un nœud vidéo depuis une capture de scène. Les adaptateurs Fal/Comfy et ai.prepareShot existent toujours.

Leur présence héritée ne prouve pas qu’ils sont utilisés dans le parcours 3D. En revanche, aucune séparation explicite du parcours principal livré n’a été démontrée. Le mode de production final demandé doit garantir le rendu 3D et éviter l’envoi accidentel du projet dans l’ancien pipeline vidéo IA.

### A19 — Documentation de fin de travaux périmée puis partiellement actualisée — P2, confirmé

docs/A-FAIRE-par-lutilisateur.md annonce des modifications encore à appliquer pour hasMotion et onLibraryPlaced. Ces modifications existent dans les fichiers locaux au moment de l’audit.

La prétendue correction motion.clear modifie surtout la validation préalable ; characterOf vérifie l’existence, sans imposer la sélection. L’ancien chemin avec domaine monté appelait déjà clear(characterId). La description du problème ne correspond donc pas au code montré dans le document.

Le blocage d’écriture ancien rapporté par les agents ne doit pas être utilisé comme preuve que la fonctionnalité est absente aujourd’hui. La documentation doit décrire l’état final observable, pas les restrictions rencontrées pendant leur session.

Mise à jour observée pendant l’audit : 11eb442 supprime ce document et crée docs/etat-chantier-studio-3d.md. La liste de modifications manuelles est donc désormais remplacée. Le nouveau document continue toutefois à annoncer la bibliothèque et le rythme comme fonctionnels sans couvrir les défauts A01–A16, et sa mention « suite complète : un seul échec » ne constitue pas le résultat des tests effectués ici. Ce point doit être lu comme un constat sur les documents successifs, pas comme une demande de recréer le fichier supprimé.

### A20 — Preuve de livraison globale insuffisante — P0 de recette

Des fichiers QA historiques prouvent des essais locaux précis. docs/qa/scene-cameras/result.json rapporte notamment un MP4 de 96 frames, quatre secondes, 1920 × 1080, avec deux hashes de part et d’autre d’un cut. docs/qa/library/result.json rapporte huit cartes et zéro erreur.

Ces preuves sont utiles. Elles ne couvrent pas simultanément : import du récit, plusieurs personnages, plusieurs décors, interactions, corrections temporelles, sauvegarde/reprise et export d’une production longue. Le résultat final de la demande ne doit pas être marqué terminé sur cette seule base.

Le rapport bibliothèque a été modifié par la session concurrente : son champ status affiche désormais « Searching the 3D library… » avec huit cartes et zéro échec. Cette donnée ne prouve pas à elle seule que la recherche était stabilisée lors de la capture. Il faut conserver un résultat de recette corrélé à sa révision et distinguer les anciennes cartes d’une nouvelle réponse.

## 5. Résultats de vérification pendant l’audit

La compilation Vite a réussi : 1 337 modules transformés. Avertissements observés : référence de police non résolue au build et bundles volumineux. Ce sont des points secondaires, sans preuve ici qu’ils empêchent le studio de fonctionner.

| Fichier ciblé | Résultat |
| --- | --- |
| verify-poly-pizza | Réussi, 39 contrôles |
| verify-poly-pizza-route | Réussi, 18 contrôles |
| verify-library-commands | Réussi, 15 contrôles |
| verify-library-pane | Réussi, 12 contrôles |
| verify-attach-bone | Réussi, 14 contrôles |
| verify-motion-per-character | Réussi, 10 contrôles |
| verify-pace | Réussi, 20 contrôles |
| verify-pacing-commands | Réussi, 11 contrôles |
| verify-vrm-generation | Réussi |
| verify-vrm-project | Réussi |
| verify-scene-cameras | Réussi |
| bus/verify-motion-exposure-gate | Réussi, deux sous-tests ; avertissement de port WebSocket occupé |
| verify-studio-agent-protocol | Échec initial avec restrictions de sessions ; après isolation : 28/29 sous-tests réussis |
| verify-studio-agent-tools | Échec : item.content?.some is not a function, ligne 384 |

Le dernier échec du protocole concerne une attente obsolète d’enum de deux bots : le schéma actuel ne fournit pas cet enum. L’échec du test tools vient d’une assertion qui suppose que content est toujours un tableau. Ces résultats ne suffisent pas à prouver une panne utilisateur, mais la suite ne peut pas être dite entièrement verte.

La suite complète a été lancée, puis relancée après un changement des permissions de l’environnement. Aucun bilan final fiable n’a été récupéré. Échecs observés :

- mcp/verify-import-mesh : chemin Windows C:\tmp\stove.glb comparé à /tmp/stove.glb.
- Tests MCP : EPERM lors d’une tentative d’écriture dans le répertoire utilisateur .config/cozyclay/live ; erreur d’environnement, pas une panne du studio démontrée.
- verify-agent-runner-errors : UNKNOWN_MODEL pour openai-codex/gpt-5.4 dans un cas de test. Cause exacte et antériorité non établies ici.

Les anciennes notes affirment que certains échecs sont antérieurs. Cet audit n’a pas remisé les modifications utilisateur ni rejoué une autre révision : il ne certifie donc pas cette antériorité.

## 6. Ce qui doit être conservé

Conserver le bus de commandes et ses reçus, l’historique, les ressources persistées, la provenance des objets, les jobs VRM distinguant identifiants locaux et externes, les instances VRM indépendantes et les caméras réutilisables.

Conserver les protections contre les appels coûteux en boucle. Les adapter à une tâche de production autorisée plutôt que les supprimer. Conserver le rendu MP4 natif ; l’enjeu est sa validation sur le récit complet.

Ne pas annoncer de défaut visuel précis des avatars, pieds, visages ou spring bones sur la seule lecture. Ces points exigent les scénarios de recette du troisième document.
