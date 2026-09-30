# Bibliothèque 3D (Poly Pizza)

Statut : implémenté, testé unitairement et vérifié dans Chrome. Branche `feat/studio-3d-assets`.

## Ce que ça fait

Le studio sait maintenant **chercher et télécharger un modèle 3D existant** au lieu de le construire avec des primitives. Une chaise, un canapé, une lampe, une voiture, un arbre : ce sont des téléchargements. Les murs, les couloirs et les objets qui doivent s'emboîter restent construits en studio, où les proportions sont exactes.

Trois surfaces, une seule implémentation :

| Surface | Entrée | Ce qu'elle fait |
| --- | --- | --- |
| Étagère Assets | section **3D LIBRARY** | recherche, vignettes, clic pour placer |
| Agent | `asset.searchLibrary`, `asset.downloadLibraryModel` | chercher puis télécharger et placer |
| Terminal (MCP) | mêmes actions via `run_action` | identique |

## Pourquoi la clé ne va jamais dans le navigateur

L'API de recherche de Poly Pizza (`api.poly.pizza`) **ne renvoie aucun en-tête CORS**. Un navigateur ne peut donc pas lire sa réponse, avec ou sans clé. C'est une contrainte utile : elle force la clé à rester dans le sidecar local, là où vivent déjà les autres clés de fournisseurs, et elle préserve la règle du studio (« le navigateur ne détient jamais d'identifiant »), que `test/verify-agent-panel.mjs` vérifie en lisant le source.

Les fichiers de modèles, eux, sont servis par un CDN qui envoie `access-control-allow-origin: *`. C'est ce qui permet au studio de télécharger un modèle directement, sans proxy.

Configuration : `POLY_PIZZA_API_KEY` dans l'environnement, ou une clé enregistrée sous l'identifiant `poly-pizza` dans `providers.json`. Sans clé, la recherche refuse en expliquant quoi définir — jamais une grille vide qui se lirait comme « aucun résultat ».

## Licences

Le catalogue mélange des licences CC0, CC-BY et d'autres. Les règles tenues par le code :

- **CC0 et CC-BY sont utilisables.** CC-BY oblige à créditer : l'attribution est donc enregistrée **sur l'objet**, pas seulement affichée.
- **Toute autre licence est refusée** (partage à l'identique, pas de dérivé, droits réservés, licence absente). Un décor est une œuvre dérivée, et le studio ne peut pas expédier un modèle dont la licence l'interdit.
- Le refus est appliqué dans `src/commands/library.js`, pas seulement décrit dans l'aide de l'outil : un agent qui oublierait la consigne ne peut toujours pas installer le modèle.
- Dans l'étagère, un modèle refusé **reste visible, grisé et désactivé**. Le masquer le ferait passer pour absent, et l'utilisateur ne pourrait plus distinguer un refus de licence d'une recherche vide.

## Taille et placement

Un modèle téléchargé arrive à la bonne échelle sans intervention :

1. La boîte du fichier est mesurée à l'import (comme pour un GLB déposé à la main).
2. Cette mesure n'est **pas** fiable si le fichier est en centimètres ou à l'échelle d'une ville : dans ce cas l'heuristique existante retombe sur exactement 1 m. Une hauteur mesurée à 1,000 m est donc traitée comme « le fichier ne nous a rien dit ».
3. Dans ce cas, une hauteur indicative par catégorie prend le relais (« chair » → 0,9 m, « door » → 2,05 m, « table » → 0,75 m).
4. Une hauteur demandée explicitement gagne toujours.

Le placement est celui du studio : devant la caméra du plan par défaut, ou `x`/`z` au sol et `y` pour poser sur une surface.

## Vérifications

- `node test/verify-poly-pizza.mjs` — chemins d'API, normalisation, licences, classement, téléchargement borné.
- `node test/verify-poly-pizza-route.mjs` — la route du sidecar : admission des chemins, résolution de la clé, chaque phrase d'échec.
- `node test/verify-library-commands.mjs` — les deux actions, dont le **refus de licence avant tout téléchargement**.
- `node test/verify-library-pane.mjs` — cartes, blocages, arguments de téléchargement.
- `test/qa-library-browser.mjs` — Chrome : recherche réelle, licence refusée visible, téléchargement et provenance sur l'objet.

Commande QA :

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:QA_URL = 'http://127.0.0.1:5191/app/'
$env:CDP_PORT = '9357'
node tools/qa-browser.mjs -- node test/qa-library-browser.mjs
```

Preuves conservées : `docs/qa/library/01-library-pane.png`, `02-library-results.png`, `03-library-placed.png`, `result.json`.

## Limites connues

- **La page de résultats est bornée.** Le reçu de commande refuse au-delà de 8 Kio, donc l'étagère demande 8 modèles par recherche. Mesuré sur le catalogue réel : 8 lignes ≈ 5 Kio, 12 lignes ≈ 8,1 Kio. Élargir demanderait le curseur de détail du bus, pas un relèvement de la limite.
- Les vignettes viennent du CDN de la bibliothèque : sans réseau, les cartes s'affichent avec un substitut, le modèle restant téléchargeable.
- Un modèle animé est placé dans sa pose de référence ; la carte l'annonce.
