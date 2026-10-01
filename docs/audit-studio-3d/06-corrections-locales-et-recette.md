# Corrections locales et recette — 1 octobre 2026

## Verdict

Les corrections ci-dessous sont implémentées dans la copie du studio, sans commit ni push. Elles remplacent des chemins qui annonçaient une réussite sans effet natif vérifiable. Elles ne constituent PAS une validation complète des vagues 3 et 4 : la production native des motions, les interactions temporelles et l'assemblage vidéo multi-scène restent à raccorder.

Les modifications préexistantes de l'utilisateur ont été conservées. Aucun appel GPU payant, aucun téléchargement de modèle réel pour les tests et aucune modification de la base distante n'ont été effectués.

## Changements implémentés

| Fichier | Correction |
| --- | --- |
| src/production/installers/index.js | scene.create reçoit un objet vide puis scene.rename utilise le vrai ID ; chaque installation sélectionne la scène liée ; les bindings portent unitId et nativeSceneId. |
| src/production/installers/scene.js et objects.js | Les anciennes entrées délèguent désormais aux installateurs utilisés par le contrôleur. Les tests ne passent plus par une implémentation différente. |
| src/production/installers/index.js | Installation des murs ET des props ; dimensions métriques converties en scaleX/Y/Z sur les primitives ; cube remplace l'ancien kind invalide box. Couleurs et rotations conservées. |
| src/production/installers/index.js | Les acquisitions library utilisent asset.searchLibrary puis asset.downloadLibraryModel, avec le filtre usable/non-heavy, le modèle explicitement choisi si fourni, et la hauteur demandée. Pas de remplacement silencieux par un cube en cas d'échec. |
| src/production/installers/index.js | Les personnages reçoivent x/y/z/rot/model/scale, selon les champs réellement consommés par createCharacterEntry. Les bindings sont distincts par occurrence de scène. |
| src/production/avatar-producer.js | IDs natifs sakura-vrm et char-02-vrm ; plus d'URL de build codée en dur comme preuve ; generate/library sans producteur configuré échouent explicitement. |
| src/production/compiler.js | Contact à 10 s = frame 240 ; releaseSeconds null reste null ; hand et le contrat interaction sont conservés ; marche/salut/signe de tête sont distingués ; les expressions ne sont plus perdues ou converties en idle. |
| src/production/compiler.js | Caméra high/low et push-in traduits en cadrage et clés locales ; empreinte du plan inclut les clés. Les autres intentions caméra complexes restent hors de cette correction. |
| src/production/compiler.js | Application des overrides height, placement, actor, window, camera et choix builtin/procedural/library. Les variantes non implémentées refusent la compilation au lieu de prétendre être appliquées. |
| src/production/controller.js et run-store.js | Journal complet et états failed/blocked sauvegardés dans le document ; coalescence des appels identiques ; cache inputHash ; reprise après création partielle ; refus des cycles et des exécutions concurrentes ; propagation des annulations. |
| src/production/controller.js | Verrou inter-onglets via Web Locks quand disponible. Les producteurs/installateurs non raccordés ne passent plus automatiquement à done. |
| src/production/reconcile.js | Vérification des IDs dans leur scène, pas seulement dans la scène active ; un binding supprimé invalide l'unité. |
| src/domains/production.js | Cache de session local associé aux IDs des scènes ; restauration contrôlée ; états stale au bon champ et unitId ; changement de source invalide l'ancien plan. Les bindings du même projet sont conservés pour réconciliation. |
| src/production/source-client.js | Toutes les pages sont récupérées ; contrôle des identités, révisions, manifestHash retourné, totaux, SHA-256 de sections et IDs ; détection des boucles ; limite sur le snapshot assemblé ; resources conservées. |
| src/commands/production.js | Erreurs réseau propagées ; compilation invalide refusée ; verify exige toutes les unités done ; export appelle le véritable export.shotVideo pour une seule scène et exige fileName/frameCount cohérents. Multi-scène explicitement refusé. |
| src/App.jsx et src/studio-actions.js | L'installation passe par le vrai bus transactionnel du studio ; export soumis à confirmation pour l'agent ; délais des exécutions portés à 300 s. |
| src/panels/ProductionPanel.jsx | Suivi issu du checkpoint en temps réel ; scènes/avatars/cast/plans/motions/expressions/interactions accessibles ; pause disponible pendant le run ; refus du bus visibles ; résumé lit project.durationSeconds/aspect/fps. |
| test/verify-source-routes.mjs | Injection du coffre de clés simulé dans le test environnement ; aucune lecture du vrai providers.json. |
| test/verify-production-regressions.mjs et tools/run-tests.mjs | Dix régressions ajoutées et inscrites dans le manifeste de tests. |

Le helper clip-producer reste un planificateur de descripteurs. Ses résultats portent plannedOnly: true. Ses tests ne prouvent PAS qu'un squelette bouge ou qu'un NPZ a été généré.

## Tests effectués et portée des preuves

- Les 18 fichiers ciblés production/connecteur passent lors de la dernière relance : 109 tests, dont dix nouvelles régressions.
- Vite build passe. Ce contrôle n'est pas l'équivalent de npm test ni d'une validation de l'export vidéo réel.
- Les régressions natives valident les arguments contre les véritables schémas des commandes et utilisent createSceneObject/updateSceneObject/createCharacterEntry pour contrôler dimensions et placement. Le transport est simulé.
- L'encodeur est simulé dans la régression export : preuve de raccordement à l'encodeur et de contrôle de sa réponse, PAS preuve d'un MP4 réellement visionné.
- node tools/run-tests.mjs a été lancé et a échoué (processus exitCode 1). Échecs observés hors du périmètre production : copie de fixture vers le profil utilisateur refusée dans mcp/verify-import-mesh.mjs, écrasement explicite refusé dans mcp/verify.mjs, et UNKNOWN_MODEL openai-codex/gpt-5.4 dans test/verify-agent-runner-errors.mjs. Des avertissements de port WebSocket occupé ont également été observés. Ne pas annoncer la suite générale verte.
- git diff --check signale une ligne vide finale préexistante dans src/styles.css ; cette modification utilisateur n'a pas été retouchée.
- Le navigateur de la session n'est pas disponible. Aucun screenshot ni contrôle visuel manuel de ce panneau n'a été produit. La compétence de contrôle du navigateur a été suivie pour vérifier cette indisponibilité.

## Recette locale sans services payants

Exécuter depuis la racine du studio :

~~~powershell
node test/verify-production-regressions.mjs
node test/verify-production-installers.mjs
node test/verify-production-recovery.mjs
node test/verify-source-client.mjs
node test/verify-source-routes.mjs
node node_modules/vite/bin/vite.js build
~~~

Pour un aperçu natif sans bibliothèque distante ni GPU, choisir explicitement des avatars builtin et des props procédurales avant de préparer le plan. Exemple de production.updateDraft (utiliser le vrai productionId et la vraie planRevision) :

~~~json
{
  "productionId": "ID_LOCAL",
  "expectedPlanRevision": 1,
  "operations": [
    { "op": "choose-resource", "sourceId": "CHAR_A", "strategy": "builtin" },
    { "op": "choose-resource", "sourceId": "CHAR_B", "strategy": "builtin" },
    { "op": "choose-resource", "sourceId": "DESK", "strategy": "procedural", "kind": "cube" },
    { "op": "choose-resource", "sourceId": "CUP", "strategy": "procedural", "kind": "cylinder" }
  ]
}
~~~

Ces choix autorisent un aperçu de géométrie ; ils ne doivent pas être présentés comme des avatars fidèles ou des modèles détaillés de bureau/tasse. Le JSON office-12s fourni contient une stratégie generate : sans override builtin, son étape avatar doit signaler l'absence de producteur, pas fabriquer une réussite.

Dans le panneau : récupérer la source, l'enregistrer, préparer, puis exécuter scene → avatar → cast → shot. Vérifier dans la hiérarchie et le viewport les murs, leurs dimensions, les deux personnages et les cuts. Relancer une étape terminée ne doit pas ajouter de doublons. Supprimer un élément lié puis lancer production.verify doit invalider la production. Sauvegarder un .cclayproject, recharger et vérifier les bindings/checkpoints.

Les motions et interactions du fixture ne sont pas raccordées à un producteur natif : leur refus est attendu pour l'instant. Ne pas les retirer du plan simplement pour obtenir un export présenté comme complet.

## Travaux encore nécessaires avant validation des vagues 3–4

1. Raccorder des producteurs natifs réels pour avatar generate/library et pour motion-clip/motion-compose ; résoudre les ressources de référence et vérifier leurs fichiers. Les ports handlers de createProductionController offrent une séparation producteur/installateur mais aucun provider payant n'a été activé.
2. Générer et stocker les clips par acteur, composer réellement les canaux osseux/racine, puis installer et vérifier les takes. Les cuts ne doivent pas fractionner les motions. Conserver l'identité des jobs externes et les artefacts après interruption pour éviter les doubles facturations.
3. Raccorder expressions et interactions temporelles au lecteur ET à l'exporteur. Inclure contact/release, attachement à la main, IK et état objet aux frames demandées. Actuellement ces unités refusent de devenir done sans installateur.
4. Raccorder le remapping de rythme à tous les événements dépendants (contacts, expressions, audio, cuts), pas uniquement aux helpers de calcul.
5. Implémenter l'assemblage multi-scène avec narration/audio et un MP4 réellement décodable. Le correctif actuel autorise seulement l'export réel mono-scène, après toutes ses unités terminées. Il ne certifie ni absence de clipping ni qualité visuelle.
6. Compléter les autorisations de coût des futurs handlers payants (budget, portée, expiration et révision). Aucun handler payant par défaut ; le champ grant n'est pas encore une politique complète.
7. Le journal de session est un cache localStorage et un document portable, pas une base IndexedDB d'artefacts. Tester quotas, fichiers manquants et persistance d'un job externe. Sans Web Locks disponible, pas de garantie inter-onglets.
8. Revoir le choix automatique du premier résultat de bibliothèque : licence/poids contrôlés, mais adéquation sémantique non garantie. Ajouter une décision utilisateur pour les résultats ambigus.

## Blocages côté workflow distant (non modifié)

Chemin lu : C:/Users/pulsy/Videos/workflow_gen_short_with_ia. Cette session n'a pas le droit d'y écrire.

- app/schemas/studio_story.py, canonical_json : la fonction supprime les clés dont la valeur est None et json.dumps conserve notamment 1.0. Le canonicalJson JavaScript conserve null et sérialise 1.0 en 1. Ces fonctions ne produisent donc pas les mêmes SHA-256. Employer un vrai sérialiseur JCS/RFC 8785 partagé/conforme ; ajouter des vecteurs croisés avec null, 1.0, accents, tableaux et nombres en notation exponentielle. Ne pas désactiver la vérification du studio pour masquer cette divergence.
- app/services/studio_story_snapshots.py : une révision demandée absente ne doit pas être créée à la volée ; renvoyer 404 ou 410 selon la politique. La publication d'une nouvelle révision après modification du projet doit être explicite et immuable.
- Retirer la clé de développement connue comme mécanisme d'authentification par défaut ; exiger un secret configuré.
- Ajouter les tests FastAPI avec lifespan/base temporaire véritablement isolés ; ne pas initialiser la base réelle dans une recette d'audit.

Le prochain passage doit d'abord corriger ces blocages distants et prouver un scénario complet à deux acteurs avec vraies motions/interactions/export. Les fonctionnalités bonus de vague 5 ne remplacent pas cette recette.

## Complément : spécification distante et tentative de commit

La spec [09 — API distante](../specs-studio-3d-technique/09-api-distante-corrections-et-recette.md) détaille les fichiers à modifier, la publication immuable, les hashes compatibles Python/JS, la pagination, la sécurité, les ressources et la recette sans services payants. Aucun fichier distant modifié.

Les 18 suites ciblées production/connecteur ont été relancées : 109 tests passent. Cela ne remplace pas une recette visuelle ni la validation de vrais jobs et du MP4 final.

Le commit demandé n’a pas pu être créé : git add et git apply --cached échouent avec Permission denied lors de la création de .git/index.lock. Le dossier .git est en lecture seule dans cette session. Aucun staging effectué, aucune permission contournée. Le périmètre prévu inclut le workflow de production, ses corrections, tests et documents ; exclut les changements Poly Pizza/MCP et la désactivation du bridge Ardy. App.jsx nécessite donc un staging partiel. Ne pas utiliser git add -A pour ce commit ciblé.
