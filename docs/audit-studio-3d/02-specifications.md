# Spécifications de correction et de complétion

Ce document prescrit des comportements et des critères d’acceptation. Il ne contient pas de code et n’autorise pas leur implémentation pendant l’audit. Les identifiants Axx renvoient à l’audit détaillé.

## 1. Ordre de réalisation

P0 : nécessaire pour livrer et certifier le parcours complet. P1 : défaut à corriger avant de l’utiliser en production. P2 : fiabilité et finition. Les priorités P0 ne justifient pas de repousser les erreurs de proportions ou de licence.

| Lot | Objectif | Dépendances | Constats |
| --- | --- | --- | --- |
| L1 | Fiabiliser import et recherche d’assets | Aucune | A01–A06, A14–A16 |
| L2 | Figer et valider le contrat source | Aucune | A07, A17 |
| L3 | Orchestrer une production reprenable | L1, L2 | A07, A08 |
| L4 | Préserver continuité et temps narratifs | L2, L3 | A10, A11 |
| L5 | Améliorer mesure et correction des animations | L4 | A09–A11 |
| L6 | Ajouter interactions datées et contacts | L1, L4 | A12, A13 |
| L7 | Définir le parcours 3D final et ses livrables | L3, L4 | A06, A18 |
| L8 | Recette complète et documentation finale | Tous les lots utiles au scénario | A19, A20 |

L6 peut être livré par étapes. Une vidéo sans préhension complexe peut valider le cœur, mais ne doit pas être annoncée comme preuve d’interactions complètes.

## 2. SPEC-01 — Import d’assets à l’échelle et au bon emplacement — P1

**Portée :** commandes bibliothèque, domaine objects, normalisation et rendu. Constats A01–A03.

Le téléchargement doit transmettre un contrat interne unique. Le domaine doit recevoir et appliquer hauteur souhaitée, indication de hauteur, emplacement et provenance sans renommer implicitement leurs champs.

La hauteur mesurée doit être accompagnée d’une information explicite de confiance ou de repli. Une mesure réelle de 1 m ne doit pas être confondue avec un repli artificiel à 1 m. Une indication de catégorie n’est qu’une estimation ; une taille explicitement demandée reste prioritaire.

Lors d’un changement de hauteur, les trois dimensions doivent varier dans les mêmes proportions, sauf déformation explicitement demandée. L’empreinte enregistrée, les limites de sélection, les obstacles et la géométrie rendue doivent correspondre. Les dimensions doivent être présentées en mètres avec leur origine : mesurées, estimées ou imposées.

L’emplacement y doit désigner la hauteur de la base du modèle dans le monde. Poser sur une table doit utiliser la surface réelle de support ou une hauteur déclarée, sans réinterprétation silencieuse. Une position partiellement renseignée doit avoir des valeurs par défaut documentées.

**Acceptation :**

- Une chaise dont le fichier nécessite un repli d’unités utilise effectivement l’indication de 0,9 m sur la voie commande → domaine réel → objet rendu.
- Un modèle réellement haut de 1 m conserve cette taille si aucune surcharge n’est demandée.
- Un accessoire demandé à y = 0,75 m a sa base à cette hauteur dans la prévisualisation et le MP4.
- Imposer une hauteur doublée double la largeur/profondeur visuelles et leur empreinte stockée.
- Sauvegarde, réouverture, duplication et annulation conservent les résultats.
- Un test d’intégration utilise l’import réel ; une doublure qui reproduit le contrat souhaité ne suffit pas.

## 3. SPEC-02 — Licence vérifiée et crédits publiables — P1

**Portée :** métadonnées bibliothèque, parseur, import, export. Constats A04–A06.

Les licences doivent être reconnues par identifiants complets et versions explicites. La politique actuelle « CC0 ou CC-BY acceptés ; autres licences refusées » doit être implémentée exactement. Les variantes NC, ND, SA et combinaisons doivent conserver leurs différences. Une licence inconnue reste inconnue.

Le studio doit résoudre la fiche officielle par identifiant ou utiliser une référence de recherche qu’il a lui-même enregistrée et validée. Un appelant ne doit pas pouvoir choisir simultanément une URL quelconque et une licence déclarative faisant foi. Les changements de fiche entre recherche et import doivent être signalés.

La provenance doit accompagner chaque instance et chaque ressource réutilisée. Les crédits de publication doivent être générés à partir des objets réellement utilisés dans la production, avec titre, auteur, source et licence. Les doublons doivent être regroupés. Les adaptations doivent pouvoir être décrites.

Le livrable attendu est un fichier de crédits lisible accompagnant la vidéo et une version facile à copier dans une description de publication. Une incrustation vidéo peut être optionnelle : elle ne doit pas être ajoutée arbitrairement au montage.

**Acceptation :**

- CC-BY-NC, CC-BY-ND et CC-BY-NC-SA ne passent plus pour CC-BY dans la politique actuelle.
- Une tentative de changer la licence ou l’URL d’un résultat est rejetée ou remplacée par les données officielles.
- Deux instances du même modèle produisent un crédit regroupé ; deux auteurs restent distincts.
- Export/reprise ne perdent pas les crédits ; l’utilisateur voit ce qui doit accompagner sa publication.
- La documentation décrit une politique produit sans généraliser abusivement le droit applicable à toutes les licences.

## 4. SPEC-03 — Recherche fiable, paginée et bornée — P1/P2

**Portée :** interface, commandes, client et sidecar. Constats A14–A16.

Les résultats doivent respecter la limite effective de taille des reçus, mesurée en octets UTF-8. Le nombre d’éléments ne suffit pas à garantir cette limite. Les détails volumineux doivent être accessibles à la demande par identifiant ; la pagination doit avoir un curseur ou un numéro de page validé et un état explicite de fin.

L’agent et l’interface doivent partager le même comportement, y compris avec une recherche sans limit. Le catalogue ne doit pas apparaître vide quand la réponse a été refusée pour taille, quota ou clé manquante.

Changer ou vider le champ doit invalider immédiatement les requêtes précédentes. Le panneau doit ignorer les réponses périmées et afficher le refus d’import ou l’échec réseau. Une annulation doit arrêter le transport lorsqu’il le permet et empêcher toute installation tardive.

Les bornes réseau doivent couvrir les en-têtes et le corps. Un téléchargement sans Content-Length doit être arrêté dès dépassement de la limite, avant mise en mémoire complète. Le sidecar doit appliquer les paramètres admis, suivre les réponses de limitation et distinguer les erreurs temporaires des refus définitifs.

**Acceptation :**

- Recherches par défaut, à vingt résultats et avec métadonnées longues : reçu valide ou pagination, jamais perte silencieuse de réponse.
- Recherche A lente, puis B, puis champ vidé : seule l’intention courante peut apparaître.
- Téléchargement annulé : aucun nouvel objet n’arrive après l’annulation.
- Corps HTTP qui reste lent après réception des en-têtes : expiration explicite.
- Corps sans longueur dépassant 32 MiB : arrêt avant lecture intégrale.
- Réseau coupé, clé absente, 401/403 et 429 : explication utile, reprise possible et aucune fausse réussite.

## 5. SPEC-04 — Import de récit versionné — P0

**Portée :** contrat avec le workflow source et entrée de production. Constats A07, A17.

Le studio doit accepter le contrat décrit dans le troisième document via fichier et via une interface d’intégration documentée. Le transport initial peut être local ; il n’est pas nécessaire de déployer une plateforme supplémentaire.

Avant toute génération, une validation doit résoudre les identifiants, unités, temps, références, formats, assets et contraintes. Elle doit produire un plan de production lisible et la liste des hypothèses. Un projet incohérent doit être refusé avant appel payant.

Le contrat doit distinguer récit/intention de mise en scène et paramètres exécutables. Une description libre peut nécessiter une interprétation par l’agent. Un plan déjà structuré doit pouvoir être appliqué sans réinventer les durées ou identités.

**Acceptation :**

- Import d’une distribution, de deux décors et d’au moins six plans avec temps connus.
- Référence à un personnage inconnu : erreur avec l’emplacement précis dans le document, avant génération.
- Conversions de temps vers frames déterministes et somme des durées cohérente.
- Import du même document deux fois : pas de duplication involontaire.
- Version inconnue : refus explicite ; version prise en charge : migration annoncée si nécessaire.
- Les informations non prises en charge sont listées, jamais supprimées silencieusement.

## 6. SPEC-05 — Orchestrateur de production et budgets — P0

**Portée :** agent, jobs, mouvements, avatars et assets. Constat A08.

Une demande de production doit créer une tâche persistante composée d’unités identifiables : avatar, décor, accessoire, clip de personnage, plan et export. Chaque unité conserve ses entrées, dépendances, état, résultat installé et erreur éventuelle.

La limite d’une génération par personnage et par message doit être remplacée ou complétée par une politique compatible avec cette tâche. Des clips distincts et autorisés pour le même personnage doivent être admis ; une retransmission du même clip ne doit pas dépenser de nouveau. Les tentatives de correction doivent être bornées et comptabilisées, en distinguant échec avant soumission et génération effectivement facturée.

Un job démarré, un job externe terminé et un résultat installé sont trois états différents. Une reprise après fermeture du navigateur doit rechercher le résultat connu avant de resoumettre. Le studio doit conserver les identifiants externes et signaler une annulation locale qui ne stoppe pas le fournisseur.

La génération peut être séquentielle. Il faut coordonner les fenêtres temporelles de tous les personnages avant de lancer les clips ; un personnage secondaire ne doit pas hériter du prompt ou du mouvement du personnage actif.

**Acceptation :**

- Une seule demande produit trois clips d’Alex et deux de Marie selon le plan autorisé.
- Relancer la tâche reprend les unités manquantes sans refaire les clips installés.
- L’échec d’un avatar ne consomme pas le budget d’un autre personnage.
- Le coût ou le nombre d’appels prévu est visible ; un dépassement ne provoque pas une boucle autonome infinie.
- Changement de scène ou rechargement : installation dans la bonne scène, pas dans celle actuellement affichée par hasard.
- Vérification finale par personnage : mouvement présent, durée et placement corrects ; un reçu started ne vaut pas preuve d’installation.

## 7. SPEC-06 — Continuité narrative et plusieurs décors — P0/P1

**Portée :** scènes, distribution, séquence globale et raccords.

Définir une scène persistante par décor et une séquence globale de plans qui référence ces scènes. Un cut de caméra à l’intérieur d’un décor ne doit pas régénérer ce décor. Une ellipse ou un changement de lieu peut modifier les positions, mais doit être explicite.

Les identités narratives restent stables. Leurs instances dans un décor doivent avoir leur propre état d’animation. Un même modèle VRM peut être réutilisé sans partager squelette, expressions ou objets portés entre deux instances indépendantes.

Entre deux plans continus, le studio doit vérifier positions, orientations, regards, accessoires, expressions et phase d’action. La caméra peut changer sans remettre les personnages à leur pose initiale. Les positions écran doivent être résolues relativement à la caméra ou conservées comme intention, jamais converties par un simple signe de x monde.

**Acceptation :**

- Deux cuts consécutifs dans un décor gardent l’état des personnages et de l’accessoire.
- Une ellipse autorisée peut modifier cet état et apparaît dans le plan de production.
- Un changement de lieu conserve l’identité et l’apparence de chaque personnage.
- Modifier une caméra partagée annonce les plans affectés ; une variante indépendante utilise une copie.
- L’export assemble les scènes dans l’ordre global, avec un temps de production continu.

## 8. SPEC-07 — Politique temporelle et corrections non destructrices — P1

**Portée :** mouvement, expressions, IK, plans et objets. Constats A10, A11.

Chaque piste doit indiquer à quoi son temps est lié : temps global du projet, temps local d’une scène, temps d’un clip ou événement narratif. Une correction de vitesse doit utiliser ces liens pour calculer les dépendances affectées.

Deux modes doivent être explicitement distingués : conserver la durée narrative en réorganisant le mouvement dans la fenêtre existante, ou changer cette durée et propager le changement aux éléments dépendants. Le premier doit être le choix par défaut pour un projet déjà aligné sur une narration.

La correction doit partir du montage actuellement visible. Elle doit préserver les passages supprimés, les segments et les vitesses non visés. Si la source entière doit être réutilisée, cela constitue une opération différente, annoncée.

Le résultat doit indiquer avant/après, événements déplacés, pistes conservées et collisions temporelles non résolues. L’ensemble doit pouvoir être annulé dans une opération cohérente. Un second passage identique doit être sans changement lorsqu’il ne modifie plus l’état.

**Acceptation :**

- Un geste accéléré reste synchronisé avec la réponse de l’autre personnage et avec sa prise d’objet.
- Une expression liée au geste suit son nouveau temps ; une expression liée à la narration conserve son horodatage.
- Une portion précédemment supprimée ne réapparaît pas après tightenPace.
- Annulation et réouverture restaurent la même synchronisation.
- Une correction incompatible avec un événement fixé est refusée ou proposée comme choix explicite.

## 9. SPEC-08 — Mesure utile du mouvement et du naturel — P1

**Portée :** analyse de rythme et consignes de l’agent. Constat A09.

Séparer les mesures : déplacement global, activité articulatoire, immobilité réelle, rythme, glissement des pieds et continuité des transitions. Le visage et les pauses narratives sont des informations supplémentaires, pas des preuves de mouvement corporel.

La détection d’une attente supprimable doit prendre en compte mains, pieds, tête et rotations ainsi que les événements. Une faible vitesse de racine ne suffit pas. L’analyse ne doit pas appeler rigide une prise uniquement parce qu’elle se déplace lentement.

Une acceleration explicite doit être possible lorsque le geste est effectivement trop lent, y compris sur place. La correction automatique doit respecter les phases de contact et les pauses voulues. La rééchantillonnage ne garantit pas que chaque frame source reste affichée : ce qui doit être conservé est l’action et ses événements significatifs, vérifiés à la cadence finale.

**Acceptation :**

- Racine fixe avec main qui salue : classée active.
- Saut vertical, rotation sur place et personnage assis qui gesticule : pas considérés immobiles sur la seule absence de translation x/z.
- Pose réellement immobile : détectée comme telle.
- Geste avant une marche : conservé lors du rognage des attentes.
- Pause narrative marquée : conservée.
- Deux vitesses d’un même geste : différences mesurées, et validation visuelle du résultat exporté.

## 10. SPEC-09 — Interactions datées — P1, livraison progressive

**Portée :** objets, timeline, IK et poses de mains. Constats A12, A13.

Première étape : enregistrer les événements prise, portage et dépose avec objet, personnage, main, temps, transform de contact et support cible. L’état de l’objet à une frame doit être calculable directement, indépendamment de l’ordre de lecture de la timeline.

Au début du portage, convertir monde vers repère de la main sans saut de position. À la dépose, convertir vers le monde ou le support avec continuité. Les pistes de trajectoire et d’attachement doivent avoir une priorité définie.

Deuxième étape : approche de la main par IK, pose de préhension compatible avec le rig et contrôle de contact. L’absence de doigts utilisables doit donner une approximation annoncée. La résolution d’un os ne doit pas être annoncée comme une prise crédible.

Troisième étape : collisions de l’objet porté avec environnement et corps, en excluant seulement les contacts autorisés de la main. Les deux acteurs doivent partager le même instant d’interaction. Une poignée de main ou un échange d’objet ne peut pas être validé par deux générations textuelles indépendantes sans contrôle de leurs points de rencontre.

**Acceptation :**

- Tasse sur table de 0 à 3 s, portée de 3 à 7 s, reposée après 7 s : même résultat en lecture, scrub direct, réouverture et MP4.
- Aucun saut visible aux transitions.
- Objet porté près du torse : pénétration résiduelle mesurée et signalée.
- Échange entre deux acteurs : aucune double propriété de l’objet ; passage continu.
- Annulation restaure les événements et les clés associées.

## 11. SPEC-10 — Parcours principal de rendu 3D — P1

**Portée :** interface de production, workflow et export. Constat A18.

Le parcours principal doit aller du récit à une vidéo calculée par le renderer du studio. La génération des avatars et des mouvements peut utiliser l’IA ; le rendu final doit rester 3D.

Les anciennes fonctions de vidéo IA peuvent être conservées comme outils distincts si utiles. Elles ne doivent pas être une étape implicite ni la destination par défaut de cette production. Le bilan doit identifier renderer, format, résolution, cadence, durée, nombre de frames et scènes utilisées.

Les ressources doivent être prêtes avant export. Un modèle encore remplacé par une boîte de secours ne doit pas être livré comme asset rendu sans avertissement. Les cuts doivent être résolus à chaque frame et vérifiés avant/après leur borne. L’export de la séquence globale doit être distingué de celui d’un seul plan.

**Acceptation :**

- Production 3D complète sans configuration Fal/Comfy et sans appel à un modèle de vidéo IA.
- MP4 9:16 et 16:9 avec durée et nombre de frames attendus.
- Plusieurs scènes dans l’ordre prévu ; aucun cut manquant.
- Résultat conforme après réouverture du projet et nouvelle exportation, hors écarts explicitement admis des effets secondaires.
- Crédits disponibles et avertissements résiduels visibles au moment de livrer.

## 12. SPEC-11 — Tests et recette honnêtes — P0 de livraison

**Portée :** tests ciblés, suite globale, QA réelle. Constats A19, A20.

Corriger les tests obsolètes en conservant leur intention : vérifier le catalogue et les modèles dynamiques, accepter les variantes documentées de contenu d’agent, rendre les chemins compatibles Windows et isoler les écritures de test.

Ajouter des tests d’intégration pour les erreurs d’interface révélées par les doublures. Éviter de prouver une fonctionnalité uniquement par la présence d’une chaîne dans le source. Les scénarios de production doivent avoir des entrées stables, des attentes temporelles et des preuves de rendu exporté.

La recette réelle de l’agent devra utiliser gpt-6-luna avec le provider Codex conformément à la demande initiale. Vérifier sa disponibilité dans le catalogue de la session ; ne pas prétendre qu’une simulation de hub prouve ce fonctionnement.

**Acceptation :**

- Suite ciblée verte et suite globale avec bilan final, ou liste explicite de tests bloqués par l’environnement.
- Les reproductions A01–A04 deviennent des régressions d’intégration.
- La recette du troisième document est exécutée et produit projet, vidéo, crédits et compte rendu.
- Les observations distinguent tests simulés, API réelles, images du navigateur et fichier exporté.
- Les deux exemples externes servent à extraire les attentes quand disponibles, sans exiger une copie de leur style.

## 13. SPEC-12 — Documentation finale — P2

Les documents existants doivent être mis à jour après correction et recette. Le statut livré doit décrire l’état réel du code, avec preuves et limitations. Retirer les instructions de modification manuelle devenues inutiles ; corriger les exemples qui citent des personnages non déclarés et les affirmations sur les générations d’image encore accessibles.

Le document de connexion doit expliquer qui produit chaque donnée : le workflow fournit le récit et les temps ; le studio choisit et vérifie les assets ; l’orchestrateur installe les résultats ; le renderer produit la vidéo. Les clés d’accès et restrictions anciennes d’environnement ne font pas partie du contrat narratif.

Audio, effets sonores, voix, synchronisation labiale et VFX restent des lots ultérieurs. Une narration externe peut continuer à être produite et montée ailleurs : cela n’empêche pas de valider la partie visuelle demandée.

