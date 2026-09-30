# Corrections des collisions sur les avatars VRM

## Fonctionnement

Après l’installation d’un mouvement généré pour un VRM, le studio examine les
frames de l’animation et corrige les contacts des bras avec le corps. Les
corrections sont enregistrées sous forme de clés IK dans la couche du personnage.
Elles sont rejouées lors de la lecture, des déplacements dans la timeline et de
l’export vidéo. La génération et ses corrections partagent une entrée d’historique.
Le fichier projet conserve ces clés dans `motionRef.correctionKeys` et les
restaure dans la couche du personnage à sa réouverture.

Ce traitement utilise le mouvement déjà reçu de Kimodo : il ne déclenche pas de
nouvelle génération sur le GPU. Le résultat de `motion.generate` expose
`output.collisionReview` avec le nombre de frames examinées, corrigées et les
contacts résiduels. Une notification affiche aussi ce bilan dans l’éditeur.

Les mouvements avec des poses explicitement contraintes sont préservés : le
traitement automatique est alors ignoré et son rapport indique
`skipped: true`, `reason: "authored-pose-constraints"`.

## Corriger une animation existante

Dans l’agent web, demander par exemple :

> Corrige les collisions corporelles de Sakura sur toute son animation existante,
> sans régénérer le mouvement. Vérifie ensuite l’animation et indique les défauts
> encore présents. Applique également un sourire à CHAR 02 en utilisant une
> expression réellement disponible sur son avatar.

L’action correspondante est `motion.fixCollisions` avec le `characterId` de Sakura
et `scope: "clip"`. `scope: "frame"` traite uniquement la frame courante.
Le traitement manuel tient également compte des objets et des autres personnages
au moyen des volumes de collision déjà utilisés par le studio.

La liste d’expressions est accessible via `inspect_studio` pour chaque personnage
VRM chargé. Voir [les expressions faciales](expressions-faciales.md).

## Limites

- Le contrôle automatique porte sur les bras et les collisions avec le propre
  corps du personnage. Il ne résout pas automatiquement toutes les interactions
  entre personnages, les appuis des pieds ou les contacts avec le décor.
- Les collisions corporelles utilisent des capsules ajustées à la géométrie de
  l’avatar. Elles ne constituent pas une simulation physique du maillage, des
  vêtements ou des cheveux. Certains contacts peuvent rester visibles.
- Les contacts volontaires, tels qu’une main posée sur le ventre, n’ont pas encore
  de description sémantique qui permette au correcteur de les distinguer.
- La vérification du mouvement fonctionne désormais sur une copie isolée du
  squelette VRM, avec sa pose de référence et sa peau synchronisée. Elle peut
  conserver le statut `unverified` si d’autres critères restent insatisfaits.
  Ce statut ne doit pas être présenté comme une validation physique complète.

## Validation effectuée

`test/qa-vrm-physics.mjs` teste Sakura et CHAR 02 sur leurs vrais fichiers VRM :
une pénétration volontaire main/torse, sa correction, les clés sur plusieurs
frames, la relecture dans un ordre différent et la vérification isolée d’un
mouvement déjà généré. La pose et les expressions du personnage affiché sont
préservées pendant cette vérification.

Les résultats sont archivés dans [le rapport QA](qa/vrm-physics/report.json).
Les profondeurs mesurées dans ces fixtures passent de 0,177 m et 0,202 m à zéro
pour les contacts main/torse ciblés. Cela ne garantit pas l’absence de tout défaut
dans une autre animation.

`test/qa-vrm-generation-review.mjs` couvre le parcours réel de l’éditeur :
installation d’un artefact réutilisé, rapport automatique à l’agent, correction
d’une animation existante et annulation par l’historique, sans nouvel appel GPU.
Il vérifie également que les 48 clés du mouvement de test survivent à une
sauvegarde puis à la réouverture du fichier projet.

Pour lancer ces QA, fournir un artefact CozyClay NPZ déjà généré avec
`QA_KIMODO_NPZ`, l’URL du studio avec `QA_URL` et le port du hub avec
`COZYCLAY_LIVE_PORT`, puis utiliser `tools/qa-browser.mjs`.
