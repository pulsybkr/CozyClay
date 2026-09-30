# Expressions faciales VRM

## Découverte par l’agent web

Les personnages retournés par `inspect_studio` exposent maintenant `expressionCapabilities` : état `loading`, `ready` ou `unsupported`, noms disponibles avec leur caractère binaire, nombre total et indication de troncature. L’agent doit relire ces capacités après un changement de modèle, puis utiliser uniquement les noms disponibles. Il peut ainsi choisir `happy` pour un sourire sans demander à l’utilisateur le nom technique.

Vérification : `test/qa-agent-vrm-expressions.mjs` charge les deux VRM fournis, lit leurs capacités par la connexion réelle de l’agent et applique une piste `happy` via `character.set`. Le sourire affiché et sa présence dans le document sont vérifiés. Aucun appel LLM payant n’est nécessaire pour ce test.

## Utilisation

Dans l’inspecteur d’un personnage VRM, ouvrir **Expressions faciales**. La liste vient de l’avatar chargé, y compris ses expressions personnalisées et binaires.

1. Placer la timeline au moment voulu.
2. Choisir une expression et son intensité entre 0 et 1.
3. Cliquer **Ajouter / remplacer la clé ici**. Refaire ces étapes pour construire la transition.
4. Une intensité de zéro remet l’expression au repos. Une clé ou une piste peut être supprimée dans le panneau.

Les poids sont interpolés linéairement. Avant la première clé, le poids est zéro ; après la dernière clé, sa valeur est maintenue. Pour faire disparaître une émotion, ajouter une dernière clé à zéro. Le gestionnaire VRM applique les règles binaires et les priorités de l’avatar.

Les pistes sont propres à chaque personnage, sauvegardées dans le projet et modifiables avec annuler/rétablir. Elles restent indépendantes des animations du corps. La lecture et le rendu d’export évaluent les mêmes pistes à partir du numéro de frame ; l’export restaure ensuite le visage affiché dans l’éditeur.

## Génération IA

Décrire l’évolution du visage dans **Intention pour l’IA**, puis cliquer **Préparer la demande IA**. Le panneau Agent s’ouvre avec une demande contenant l’identifiant du personnage, la durée, les expressions réellement disponibles et le format des clés. Choisir un modèle configuré dans l’Agent puis envoyer la demande.

Le LLM utilise la commande existante `character.set` ou `patch_elements` pour écrire les pistes. La demande interdit de générer des mouvements du corps ou de la voix. L’ajout de ce panneau ne configure aucun fournisseur ni aucune clé API. Les tests ne lancent pas de génération payante ; la réponse d’un fournisseur réel reste à vérifier avec votre configuration.

## Données

Champ optionnel `character.expressions`, en secondes absolues de scène à 24 images/seconde :

```json
[
  {
    "expression": "happy",
    "keys": [
      { "t": 0, "weight": 0 },
      { "t": 2, "weight": 0.8 },
      { "t": 4, "weight": 0 }
    ]
  }
]
```

Limites : 64 pistes, 512 clés par piste, une heure de scène. Les noms doivent être uniques ; les temps sont finis, positifs ou nuls, strictement croissants ; les poids sont compris entre 0 et 1. Les noms indisponibles sont refusés lors de l’édition sur un avatar chargé. Un projet conservant des pistes d’un ancien modèle les signale dans l’inspecteur et permet de les retirer.

Les anciens projets sans expressions gardent leur forme et fonctionnent comme auparavant. Les clignements peuvent être écrits sous forme de clés `blink` lorsque l’avatar le permet. La voix, la synchronisation labiale et l’API Kimodo restent des étapes distinctes.

## Vérifications

- `node test/verify-facial-expressions.mjs` : interpolation, données invalides, capacités, copies indépendantes et sauvegarde.
- `node test/verify-studio-elements.mjs` : exposition des données aux commandes et conservation.
- `test/qa-vrm-browser.mjs` : avatars réels, édition et annulation, interpolation, export/restauration, indépendance entre personnages, noms absents, sauvegarde/réouverture et panneau.
- Pour les machines avec un pilote graphique instable, `QA_SOFTWARE_GL=1` permet à l’outil QA de lancer Chrome avec SwiftShader.
