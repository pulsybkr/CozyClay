# Caméras du studio

Dans l’espace **Camera**, la section **Scene cameras** gère une bibliothèque de caméras nommées. Chaque plan choisit sa caméra avec **Current shot**. Les changements de plan produisent des coupes franches, dans la lecture et dans l’export vidéo.

## Utilisation

1. Cadrez une vue, puis utilisez **New from view**, ou sauvegardez le mouvement du plan avec **Save shot camera**. La sauvegarde du plan lui affecte la nouvelle caméra.
2. Nommez la caméra et affectez-la aux plans voulus. Une caméra peut être partagée : ses modifications affectent tous les plans qui l’utilisent.
3. Utilisez **Duplicate** pour obtenir une variante indépendante. **Preview** affiche un cadrage sans modifier les affectations.
4. Ajoutez des clés avec **Record view at playhead**, puis ajustez position, orientation et focale visuelle dans les champs de la clé. Les clés utilisent un temps local à 24 images/s : la première image du plan correspond à la frame locale 0. Une découpe conserve la progression du mouvement dans la partie suivante.
5. Choisissez une progression lissée, constante, ou un cadrage maintenu jusqu’à la clé suivante. La progression constante utilise la trajectoire existante autour du sujet ; elle ne garantit pas une vitesse constante en mètres/s.
6. **Remove**, ou l’affectation **Local camera**, conserve le mouvement du plan en le détachant de la bibliothèque. Une portion de mouvement peut être convertie en clés par image afin de préserver le rendu.

Les caméras, leurs clés et les affectations sont enregistrées dans le fichier `.cclayproject`. Les projets existants continuent à utiliser leurs caméras locales.

## Instructions à l’agent

L’agent découvre les actions `camera.create`, `camera.set`, `camera.assign`, `camera.capture`, `camera.duplicate`, `camera.preview` et `camera.remove`. `inspect_studio` avec le scope `cameras` retourne la bibliothèque. Les clés de `camera.set` utilisent des frames locales, des positions en mètres et des orientations en radians. Le mode peut être `keys`, `follow` ou `rail` ; les outils existants du plan restent disponibles pour régler le suivi et le rail.

Exemple :

> Sur la scène actuelle, conserve les personnages et leurs animations. Crée trois caméras nommées « Approche », « Salut Sakura » et « Réaction ». Fais un travelling d’accompagnement de 0 à 3 secondes, puis un plan moyen de Sakura de 3 à 6 secondes, puis un plan moyen de CHAR 02 de 6 à 8 secondes. Affecte une caméra distincte à chaque plan et conserve des coupes franches à 3 et 6 secondes. Vérifie le cadrage juste avant et juste après chaque coupe. Signale toute étape impossible.

## Limites et vérification

- Maximum : 32 caméras, 64 clés par caméra, 20 minutes de temps local.
- Cette fonctionnalité n’ajoute pas de résolution des collisions caméra/décor ni de réalisateur automatique avec règles de continuité.
- L’export vidéo sans mouvement corporel prend désormais toute la timeline lorsqu’elle contient plusieurs plans. Un export explicitement limité à un plan conserve sa plage.
- `test/verify-scene-cameras.mjs` vérifie le sampler, les coupes, le partage, les découpes et la persistance.
- `test/bus/verify-scene-camera-commands.mjs` vérifie les commandes de l’éditeur et l’annulation.
- `test/qa-scene-cameras.mjs` vérifie dans Chrome l’interface, les commandes agent, le travelling, la réouverture et un MP4 de 4 secondes. Les résultats sont dans `docs/qa/scene-cameras`.
