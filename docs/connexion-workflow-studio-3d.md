# Connexion du workflow source au studio 3D — modifications à apporter

Document de travail, 1er octobre 2026. Branche `feat/studio-3d-assets`.

Objet : le workflow qui produit aujourd'hui des vidéos par génération d'images (Flow / Agnes / MiniMax) doit devenir la source d'instructions du studio 3D CozyClay. Ce document liste ce que le studio attend, ce que le workflow doit changer, et ce qui n'a pas besoin de bouger.

## 1. Ce que le studio sait déjà faire, et ce qu'il ne fait pas

Constat après lecture du code, pour éviter de faire redévelopper ce qui existe :

| Brique | État réel | Où |
| --- | --- | --- |
| Scènes, décors, objets, couleurs, éclairage | fait | `src/domains/scenes.js`, `src/scene-objects.js` |
| Formats 16:9 et 9:16, caméras réutilisables | fait | `src/app-stage.jsx`, `src/domains/scenes.js` |
| Plans (shots), coupes, plages, rail de caméra | fait | `src/domains/shots.js` |
| Personnages VRM, plusieurs instances indépendantes | fait | `src/character-models.js`, `src/domains/cast.js` |
| Import VRM local et génération d'avatars | fait | `src/commands/vrm.js` |
| Mouvements du corps par API distante, adaptation VRM | fait | `src/ardy/playback.js`, `tools/ardy/bridge.mjs` |
| Pistes d'expressions faciales (clés, interpolation) | fait | `src/domains/cast.js`, `docs/expressions-faciales.md` |
| Interaction personnage ↔ objet (porter, poser, lâcher) | partiel | `object.attach`, os de la main |
| Recherche et téléchargement de modèles 3D existants | **ajouté par cette branche** | `src/poly-pizza.js`, `src/commands/library.js` |
| Voix, synchronisation labiale | hors périmètre | — |
| Audio, effets sonores, VFX | hors périmètre | — |

Conséquence directe pour le workflow : **le studio ne génère plus d'images.** Il consomme des descriptions et produit un rendu 3D. Tout ce qui, dans le workflow actuel, sert à décrire une image (suffixes de style visuel, prompts « nano », références `<Picture N>`) est soit inutile, soit à traduire.

## 2. Ce que le workflow source doit changer

### 2.1 Décors : d'un prompt d'image à une liste d'objets

Le workflow actuel produit, par exemple :

> « the minimalist family desk space with a sleek solid dark violet background and muted horizontal desk edge »

C'est une description d'image. Le studio a besoin de la même intention, mais sous forme de mobilier et de matières. Le décor doit être éclaté :

- **Structure** : murs, sol, plafond, couloirs, portes. Ce sont les éléments à garder en IA/géométrie, parce que leurs proportions doivent être exactes.
- **Mobilier et accessoires** : bureau, chaise, lit, lampe, cadre, plante. Ce sont des téléchargements (voir §2.5) sauf s'ils sont trop spécifiques.
- **Matières** : couleur dominante du mur, teinte du sol, température de l'éclairage. Le studio les accepte en hexadécimal ou en mots.

Le prompt `ENV_02` actuel devient donc trois champs : une description de structure, une liste de mobilier nommé, et une couleur/teinte. La partie « sleek solid dark violet background » est une consigne d'image 2D (un fond) : en 3D, l'équivalent est la couleur du mur et l'éclairage, pas un fond.

### 2.2 Personnages : la bible est déjà au bon format

La bible personnages (`CHAR_01`, `CHAR_02`, `CHAR_03` : âge, cheveux, moustache, vêtements, chaussures) est directement exploitable : c'est exactement ce qu'un avatar VRM doit porter. Deux adaptations :

- Ajouter, par personnage, un **identifiant de modèle VRM** (le studio accepte plusieurs instances du même avatar ; deux personnages ne peuvent pas partager un squelette).
- Marquer explicitement la **taille** en mètres quand un personnage s'écarte de la norme (enfant, géant). Le studio part de 1,8 m et laisse le réglage par personnage.

Ce qui n'a plus d'utilité : les références `<Picture N> = CHAR_02` et les consignes de fidélité de référence. Le studio ne réinjecte pas d'image d'identité dans une génération ; il charge le modèle VRM.

### 2.3 Plans : séparer l'action de la caméra

Le workflow actuel décrit, par plan :

- un cadrage (« Medium shot, slight high-angle, three-quarter profile composition »),
- les acteurs et leur position à l'écran (« CHAR_03 on screen-left … »),
- le mouvement de caméra (« A subtle, steady push-in »),
- une action narrative,
- le tout noyé dans un prompt unique.

Le studio veut ces quatre informations **séparées**, parce qu'il les traite par des chemins différents :

| Information | Forme attendue par le studio |
| --- | --- |
| Cadrage et focale | taille de plan (`wide`, `medium`, `close`…) + angle |
| Position à l'écran | position monde relative au décor (`screen-left` → `x` négatif par rapport au décor) |
| Mouvement de caméra | début et fin de rail, ou deux cadrages (le studio nomme ensuite le mouvement : dolly, crane, arc) |
| Action | texte, une phrase par plan, avec la durée |

Le champ « texte à l'écran » (règles d'incrustation) n'a pas d'équivalent : le studio ne grave pas de texte dans la 3D. Il faut soit l'ajouter au montage après rendu, soit l'abandonner.

### 2.4 Continuité : le point le plus important

Les deux projets d'exemple montrent des vidéos faites de plusieurs plans qui racontent une histoire continue (« il garde un dossier de photos », puis « sa mère exige une preuve »). Le studio gère la continuité par **une seule scène** contenant plusieurs plans, pas par plusieurs générations indépendantes. Ce qui doit changer :

- Le workflow doit produire **une scène continue** (décor persistant, personnages persistants) et une **liste de plans** qui s'y déroulent, et non un prompt par image.
- Les personnages gardent leur position entre les plans sauf indication contraire. Le workflow doit donc dire *où* ils sont dans le décor, pas seulement à gauche ou à droite de l'image.
- Les durées de plan doivent être exprimées en secondes, pas déduites du TTS. Le studio travaille à 24 images/s et la timeline est en images.

C'est le changement de fond : **passer d'une logique image-par-image à une logique scène + plans.**

### 2.5 Modèles 3D existants (Poly Pizza)

Le studio sait maintenant chercher et télécharger des modèles (branche `feat/studio-3d-assets`). Règles à refléter dans le workflow :

- Un élément **générique** (chaise, canapé, lampe, voiture, arbre, cône) est un téléchargement, pas une génération.
- Un élément **structurel ou spécifique** (murs, couloirs, une table sur mesure, un objet qui doit s'emboîter) reste construit en studio, où les proportions sont exactes.
- Toute description de mobilier doit donc porter un **nom cherchable** en anglais (« office chair », pas « siège de bureau design »), parce que le catalogue est indexé en anglais.
- Le workflow doit remonter, avec chaque élément téléchargé, sa **licence et son attribution** : le studio conserve ces informations dans le projet, et une licence qui interdit l'usage dérivé bloque le téléchargement. Le studio refuse par construction les modèles dont la licence ne le permet pas.

### 2.6 Ce que le workflow doit continuer à produire

- La **narration horodatée** reste utile : c'est elle qui donne la durée et le rythme des plans. Le studio ne produit pas de voix, mais il doit savoir quand un plan commence et finit.
- Les **prompts de plans** restent utiles comme *intention d'action*, une fois séparés du style visuel et du cadrage.
- La **bible personnages** reste utile telle quelle.

## 3. Contrat d'échange proposé

Un fichier JSON par projet, produit par le workflow et accepté par le studio. Forme minimale :

```json
{
  "projet": { "nom": "…", "format": "9:16", "dureeSecondes": 26.2, "imagesParSeconde": 24 },
  "scene": {
    "structure": "chambre minimaliste, porte bordeaux, mur vert menthe clair",
    "murs": { "couleur": "#b7e3cf" },
    "sol": { "couleur": "#d9cfc0" },
    "eclairage": { "temperature": 0.55, "intensite": 1.2 },
    "mobilier": [
      { "nom": "desk", "libelle": "Bureau familial", "x": 0, "z": -1.2, "rotation": 0 },
      { "nom": "office chair", "libelle": "Chaise de bureau", "x": -1.1, "z": -1.2 }
    ]
  },
  "personnages": [
    { "id": "CHAR_01", "nom": "Le jeune homme", "avatar": "vrm:…", "taille": 1.78,
      "description": "cheveux châtain clair en désordre, sweat bleu ciel, jean gris clair, baskets blanches" }
  ],
  "plans": [
    { "numero": 1, "debutSecondes": 0, "finSecondes": 6.96,
      "cadrage": "medium", "angle": "three-quarter",
      "camera": { "mouvement": "push-in", "amplitude": 0.4 },
      "action": "Le père et la mère se penchent au-dessus du bureau et exigent une preuve.",
      "acteurs": [
        { "id": "CHAR_03", "position": { "x": -0.8, "z": -1.0 }, "orientation": 90 },
        { "id": "CHAR_02", "position": { "x": 0.8, "z": -1.0 }, "orientation": -90 }
      ],
      "expressions": [ { "id": "CHAR_03", "expression": "angry", "debutSecondes": 0.5, "finSecondes": 2.5 } ] }
  ]
}
```

Chaque champ optionnel peut être omis ; le studio applique alors une valeur par défaut et l'annonce comme hypothèse. Les positions sont en mètres dans le repère du décor, `y` étant le sol.

## 4. Ce qui doit disparaître du workflow

- Les suffixes de style visuel (`minimalist flat vector 2D animation style, …`) : sans objet dès lors que le rendu est 3D. Le style devient un réglage de matériaux et d'éclairage du studio.
- Les consignes de fidélité aux images de référence `<Picture N>` : remplacées par le chargement du modèle VRM.
- Les modèles d'image (`nano2-lite`, `nano2nano-pro`, `image4`) et leurs ratios : plus d'étape image.
- Les règles d'audio (`Sound & SFX`, interdiction de musique) : le studio ne produit pas d'audio à ce stade ; ces règles restent valables pour la post-production.
- Les règles de texte à l'écran : à traiter en post-production, pas dans la 3D.

## 5. Ce qui reste à faire côté studio

Ces points sont hors de la présente livraison et doivent être planifiés séparément :

1. **Lecteur du contrat JSON** décrit en §3, avec import par le panneau Agent.
2. **Voix et synchronisation labiale**, si la narration doit venir du rendu 3D.
3. **Audio et VFX** : signalés par l'utilisateur comme fonctionnalités bonus, à traiter après validation du parcours complet.
4. **Contacts précis entre personnages** (une main qui saisit réellement un objet avec blocage) : aujourd'hui l'attachement existe, la physique de préhension non.
