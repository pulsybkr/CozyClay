# Contrat avec le workflow source et recette de livraison

Ce contrat est une cible proposée, pas une API déjà disponible. Il complète le document de connexion existant et remplace ses ambiguïtés. Aucun code n’est fourni ici.

## 1. Répartition des responsabilités

| Producteur | Données ou résultat attendu |
| --- | --- |
| Application de script | Récit, distribution, lieux, plans, narration horodatée, actions et intentions caméra |
| Studio et agent | Interprétation 3D, dimensions, choix d’assets, construction, préparation des clips et des caméras |
| Poly Pizza | Modèles et métadonnées officielles ; la licence est vérifiée par le studio |
| Atelier | Avatar VRM et identifiant de job externe |
| Kimodo | Mouvement d’un personnage par unité de génération |
| Orchestrateur | Dépendances, suivi, budgets, installation, reprise et contrôles |
| Renderer 3D | Prévisualisation et images composant le MP4 final |
| Post-production éventuelle | Narration audio et bonus tant que leur montage n’est pas intégré au studio |

Le workflow source ne doit pas inventer de downloadUrl ou de licence. Il peut demander une chaise de bureau et une taille souhaitée ; le studio cherche et vérifie le modèle.

## 2. Structure fonctionnelle du contrat

### Enveloppe et projet

Champs obligatoires : version du contrat, identifiant stable du projet source, révision, titre et format. Cadence canonique de la première version : 24 images/s, conformément au studio actuel. Les transports doivent conserver les mêmes données et erreurs de validation.

La durée doit provenir de la fin de la séquence globale ou d’une durée explicitement fixée. Si les deux sont présentes, elles doivent être compatibles. Le studio doit expliquer toute conversion ou correction.

### Distribution

Chaque personnage possède un identifiant narratif unique, un nom, une description d’apparence, une hauteur en mètres si connue et une stratégie d’avatar : référence existante, import ou génération.

Une référence VRM doit correspondre à une ressource réellement disponible. Une description seule ne signifie pas qu’un avatar existe déjà. Le studio conserve le lien entre identifiant narratif, ressource de modèle et instances dans les scènes.

Les personnages figurants et absents d’un plan doivent être distingués des personnages actifs. Deux instances du même avatar conservent des squelettes indépendants.

### Décors

Chaque décor possède un identifiant stable, une description, une structure et un inventaire d’objets. Pour chaque objet : identifiant, nom, rôle, stratégie d’acquisition, dimensions souhaitées ou contraintes de taille, emplacement et éventuel support.

Stratégies : construction par primitives, recherche en bibliothèque, ressource existante ou arbitrage du studio. Les murs et couloirs doivent porter dimensions et ouvertures nécessaires ; une couleur de fond 2D ne devient pas automatiquement un mur situé au bon endroit.

Les couleurs et l’éclairage peuvent être structurés ; une information stylistique non exploitable est gardée comme intention. Aucun suffixe de prompt d’image ne doit modifier arbitrairement l’action narrative.

### Séquence globale et plans

Chaque plan possède un identifiant, le décor utilisé, son début et sa fin dans le temps global, les personnages visibles, l’intention caméra et les actions référencées.

Les durées de narration validées doivent être conservées. Si elles ne sont encore qu’indicatives, ce statut doit être explicite. Des plans peuvent utiliser des temps locaux calculés par le studio, mais le document source doit distinguer ces temps des temps globaux.

Un cut est une frontière entre deux plans. Un mouvement de caméra est une animation à l’intérieur d’un plan. Une ellipse narrative est une autre information, autorisant une discontinuité d’action ou de lieu.

### Actions et mouvements

Une action comporte un identifiant, un personnage cible, une fenêtre temporelle, une description corporelle et, si nécessaire, une trajectoire, un regard, une pose ou un point de contact.

Une action à plusieurs personnages doit être décomposée en mouvements individuels liés à des événements partagés. Exemple : pour un échange de tasse, le donneur tend la tasse, le receveur approche sa main, puis la propriété de l’objet change à un événement unique. Générer deux gestes sans cet événement partagé ne suffit pas.

Les clips ont leur propre identifiant, distinct du personnage. Le plan et la correction doivent pouvoir cibler un clip sans régénérer toutes les prises du personnage.

### Expressions

Une piste indique personnage, expression, temps et poids. Les noms disponibles doivent être validés sur les capacités réelles du VRM. Les expressions sont indépendantes du coût de génération corporelle.

Chaque piste ou événement précise son ancrage temporel : récit global, scène locale ou action particulière. Les transitions et les valeurs de retour au neutre doivent être explicites lorsque nécessaires.

### Interactions

Déclarer objet, participants, main/os cible, événements approche/prise/portage/dépose, contact et support de destination. Préciser le niveau requis : suivi de main simple ou préhension crédible.

Une interaction non supportée doit être annoncée avant production, avec la proposition d’une approximation. Le studio ne doit pas transformer silencieusement « ramasser » en « objet collé à la main depuis le début ».

### Résultat et état de production

Le contrat de retour fournit un identifiant de production, son état, les unités réussies ou en échec, les hypothèses retenues, les références de projet/vidéo/crédits, et un bilan des vérifications.

Les états accepté, en cours, résultat fournisseur disponible, installé et exporté doivent être distingués. Une erreur temporaire doit inclure une possibilité de reprise, sans nécessiter de soumettre un projet neuf.

## 3. Conventions à figer

| Élément | Convention proposée |
| --- | --- |
| Distance | Mètres |
| Repère | Repère monde du studio ; y vers le haut ; x/z horizontaux, sens exact à documenter sur un exemple de scène |
| Sol | y = 0 pour le sol de référence ; supports explicitement placés |
| Rotation | Degrés pour les champs de placement, avec axe et sens déclarés |
| Temps narratif | Secondes dans la séquence globale |
| Fenêtre de plan | Début inclus, fin exclue |
| Conversion en frames | Conversion commune à toutes les pistes à 24 fps, avec politique d’arrondi unique |
| Caméra réutilisable | Temps local du mouvement ; conversion vers le plan par le studio |
| Gauche/droite écran | Intention dépendant de la caméra, jamais un signe x monde implicite |
| Référence absente | Erreur de validation si obligatoire ; hypothèse annoncée si facultative |

Un plan de [0, 4) secondes à 24 fps produit les frames 0 à 95. Le plan suivant commence à la frame 96. Éviter les doubles frames ou les trous aux cuts. La dernière borne du projet détermine le nombre d’images exportées.

## 4. Modifications concrètes du workflow source

1. Conserver identifiants de personnages, décors, objets, actions et plans entre les générations de script.
2. Séparer description de décor, construction structurelle et inventaire d’accessoires.
3. Séparer description d’apparence et actions d’un personnage.
4. Séparer cadrage, mouvement caméra et animation corporelle.
5. Fournir des temps de narration et de plans cohérents, sans les perdre dans les prompts textuels.
6. Déclarer les changements de lieu, les ellipses et les raccords continus.
7. Décrire les interactions avec des événements partagés et des objets identifiés.
8. Garder les anciens prompts d’image/vidéo comme contexte facultatif pour adaptation, pas comme commandes 3D exécutables.
9. Remplacer les références Picture N par des identifiants stables et des références de ressources réellement disponibles.
10. Accepter un bilan de production partielle et une reprise par identifiant de tâche.

Les coordonnées exactes peuvent rester une responsabilité du studio. Le contrat doit alors conserver l’intention spatiale : « assis à la table », « face à Marie », « main droite sur la tasse ». Demander des coordonnées GPS ne convient pas à ce repère de plateau ; ce sont des coordonnées monde en mètres.

## 5. Recette minimale de bout en bout

Créer un projet de référence indépendant des URLs temporaires : 30 secondes à 24 fps, six plans, deux personnages et deux décors. Livrer les fixtures narratives et les ressources nécessaires de façon stable. La narration peut être externe : la recette vérifie son alignement visuel sans imposer une nouvelle fonction audio.

| Temps | Décor | Action et caméra | Ce que cela vérifie |
| --- | --- | --- | --- |
| 0–5 s | Bureau | Alex marche vers une table ; plan large avec déplacement caméra | Placement, trajet et début de production |
| 5–10 s | Bureau | Alex salue sur place ; Marie répond ; cut en plan moyen | Deux mouvements distincts, activité sans racine mobile, raccord |
| 10–15 s | Bureau | Alex prend une tasse à 12 s ; plan rapproché sur le contact | Position sur support, événement daté, contact de main |
| 15–20 s | Bureau | Alex porte puis repose la tasse à 18 s ; contrechamp | Portage, dépose, absence de saut et collisions |
| 20–25 s | Couloir | Ellipse déclarée ; Alex et Marie avancent ensemble | Changement de décor et identité persistante |
| 25–30 s | Couloir | Arrêt et regard commun ; sourire ; caméra fixe | Synchronisation, expressions et fin exacte du projet |

Le tableau décrit une cible d’acceptation ; les interactions manquantes ne sont pas disponibles aujourd’hui. Une première recette du cœur peut remplacer prise/dépose par un portage déclaré dès le début, mais doit être nommée comme recette limitée et ne ferme pas SPEC-09.

Exécuter dans cet ordre :

1. Valider le contrat sans réseau et obtenir le plan de production.
2. Utiliser des avatars et motions connus pour une recette déterministe du montage.
3. Vérifier les bornes de chaque plan, les contacts et la durée totale dans le studio.
4. Sauvegarder, fermer, réouvrir ; contrôler les mêmes frames et ressources.
5. Exporter en portrait puis paysage, et contrôler le MP4 décodé : 720 frames, 30 secondes, cuts aux bonnes bornes.
6. Reprendre la même tâche après interruption ; vérifier l’absence de doublons.
7. Exécuter ensuite une recette réelle Poly Pizza/Atelier/Kimodo et de l’agent gpt-6-luna via Codex, avec les accès autorisés pour cette validation.

## 6. Recettes de régression indispensables

### Assets

Chaise avec unités non métriques ; modèle réellement haut de 1 m ; hauteur explicite doublée ; tasse à y = 0,75 m ; crédits après duplication et export ; refus de variantes NC/ND/SA ; recherche volumineuse et pagination ; fichier absent ou trop grand ; annulation pendant téléchargement.

### Mouvements et continuité

Deux personnages dans une demande ; trois clips distincts pour un même personnage ; geste sur place ; saut vertical ; geste avant marche ; pause narrative ; montage déjà découpé avant correction ; expressions et contacts liés à une action ; interruption/reprise sans nouvel appel facturé.

### Caméras et export

Cut au début et à la fin d’un clip ; caméra partagée puis dupliquée ; plans à durée non entière en secondes ; dernier plan statique ; rendu de plusieurs décors ; ressource non chargée ; répétition du rendu après réouverture.

### Personnages VRM

Deux instances du même fichier ; changement de modèle ; expression inexistante ; rig non prêt ; tailles différentes ; pieds au sol ; portage ; vêtements/cheveux entre scrub et export. Les limites résiduelles doivent être quantifiées ou illustrées, pas masquées par un verdict global « naturel ».

### Erreurs de contrat

Personnage non déclaré, objet inconnu, durée contradictoire, chevauchement de plans non autorisé, temps négatif, format non supporté, version inconnue et référence de ressource inaccessible.

## 7. Critères de livraison et preuves

La livraison du cœur peut être déclarée complète lorsque le contrat structuré est importé, les unités prévues sont installées, la vidéo finale est produite et la recette confirme ses temps et ses raccords.

Le dossier de preuves doit contenir : contrat source, plan résolu, projet réouvrable, bilan des jobs avec fournisseurs et modèles réellement utilisés, MP4 final, crédits et compte rendu de contrôles. Les captures du studio complètent le MP4 ; elles ne le remplacent pas.

Une réussite en données simulées valide le contrat et le montage, pas l’API distante. Une réussite API valide la connexion, pas automatiquement la qualité esthétique. Une réussite visuelle sur un plan de quatre secondes ne certifie pas une production complète.

Les deux projets fournis par l’utilisateur pourront servir à compléter ce jeu de référence quand leur contenu sera accessible ou conservé localement. La recette doit rechercher la proximité du fonctionnement narratif et la continuité, sans exiger le même style graphique.
