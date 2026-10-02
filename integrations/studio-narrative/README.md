# Récit et mise en scène 3D

Le raccordement CozyClay et le backend sont installés dans leurs dossiers réels.
`backend/` conserve une copie synchronisée des fichiers d'intégration. Les sources
du projet de démonstration ont été vérifiées : TTS 508, audio MP3 de 26,410 secondes,
634 frames à 24 fps. Les MP3 sont mesurés directement en comptant leurs frames
audio, avec leurs informations de durée/gapless lorsqu'elles sont présentes.

La page est vérifiée sur le serveur utilisateur à `http://127.0.0.1:8005`.
Le serveur temporaire de vérification sur 8006 a été arrêté.

## Installation backend

Cette installation est déjà effectuée. Pour vérifier ou réinstaller le paquet,
lancer depuis ce dossier d'intégration avec le backend accessible en écriture :

```powershell
python install_backend.py --target "C:\Users\pulsy\Videos\workflow_gen_short_with_ia"
python install_backend.py --target "C:\Users\pulsy\Videos\workflow_gen_short_with_ia" --apply
```

Le premier appel vérifie seulement les fichiers. Le second installe les différences
et sauvegarde les fichiers remplacés. Le script refuse d'écraser un fichier modifié
depuis la préparation du paquet. Redémarrer ensuite le backend et ouvrir :

`http://127.0.0.1:8005/video/6PFqPX4d5hQ/studio3d`

L'entrée « Récit & mise en scène 3D » apparaît dans l'en-tête de Reproduction et à
côté du découpage/prompts. Elle fonctionne aussi sans bible ni découpage préalable.

## Fonctionnement

- Le fichier TTS sélectionné fournit la durée réellement mesurée. Sa transcription
  horodatée fournit la narration. Aucune durée de 12 secondes n'est inventée.
- La vidéo, la bible et les prompts existants sont des références textuelles et
  visuelles déjà analysées; le nouveau service n'effectue pas une nouvelle analyse
  des pixels de la vidéo. Il respecte les faits du TTS en cas de contradiction.
- Une première étape définit le récit, les personnages et les décors sobres. Une
  étape par scène planifie les actions des participants ensemble, les trajectoires,
  les objets, les effets, les caméras et les cuts. Les scènes couvrent toute la
  narration. Les fenêtres temporelles sont fixées par le serveur à 24 fps.
- Les incohérences déclenchent au maximum deux réparations après le premier essai.
  Aucun questionnaire de décisions n'est produit. Une donnée indispensable absente
  ou un résultat restant incohérent interrompt l'analyse avec un message précis.
- Les sorties validées sont enregistrées en checkpoints. Une reprise crée un job
  enfant; une réanalyse depuis une scène recalcule cette scène et les suivantes.
- Les conditions et les détenteurs des objets sont conservés entre scènes. Les
  effets des actions doivent expliquer les états de sortie. Les lieux et apparences
  sont réutilisés par ID; un objet transporté garde son identité et ses dimensions.
- Les budgets comptent les appels et réparations. L'annulation prend effet entre
  les appels. Les sources sont contrôlées après analyse, à l'application et à la
  publication. Le brouillon utilise une protection contre les modifications
  concurrentes. Les candidats sont toujours rattachés au projet demandé.
- Enregistrer remplace le brouillon. Publier crée la révision immuable importable
  dans le Studio et copie une ressource vérifiée pour l'audio TTS sélectionné.

## Contrat Studio

`cozy-story-v1` reste lisible. `cozy-story-v2` conserve les six sections paginées.
Les scènes portent `cameras`, `entryState`, `exitState`, `summary`, `timeContext`.
Les plans portent `cameraId`, `cameraOffsetFrame` et `directive`. Les actions
portent `intent`, `trajectory`, `eventId`, `participantIds` et `effects`.

Les trajectoires utilisent `timeSeconds` local à la scène et `positionMeters`.
Les caméras utilisent des clés à 24 fps, positions métriques, yaw/pitch en radians,
et FOV en degrés. Les cuts peuvent réutiliser un mouvement avec un offset temporel.
Travellings et panoramiques sont représentés par ces clés; les modes natifs rail
et follow ne sont pas exportés par cette première version de l'analyse.

Les actions sont des **directives**, sans choix imposé de preset. L'import conserve
les trajectoires, partenaires, objets et résultats. La préparation ne génère ni
animations, ni VRM, ni meshes et ne déclare jamais ces animations déjà exécutées.
Les limites actuelles du Studio restent de 20 minutes, 32 scènes, 32 personnages,
32 décors et 256 plans. Le traitement par scène ne supprime pas ces limites moteur.

## Réalisation par l’agent Studio

Après « Utiliser cette production » puis « Préparer le plan », choisir un modèle
dans « Pilotage IA du Studio » et lancer la réalisation. Le catalogue et le
transport sont ceux de l’agent Studio existant. Chaque étape observe le document
actuel et utilise ses outils : scènes, nouveaux personnages Atelier text-to-VRM,
composition et placement du décor, caméras et cuts, prise Kimodo continue par
personnage dans chaque scène, interactions, puis contrôle visuel. Les objets
absents de Poly Pizza sont composés avec les primitives natives disponibles.
Ce recours ne constitue pas une génération externe de mesh.

Les services Atelier et Kimodo doivent être accessibles avec la configuration
existante du Studio (`CCLAY_VRM_API_URL`, `CCLAY_KIMODO_API_URL` ou
`CCLAY_KIMODO_HOST`). Poly Pizza utilise `POLY_PIZZA_API_KEY`. Une étape en échec
interrompt le pilote avec sa cause; une réponse textuelle seule ne valide jamais
un résultat. « Reprendre » conserve les VRM et les étapes vérifiées et relance
les contrôles finaux des scènes. Après un timeout Atelier, l’agent doit inspecter
les jobs existants avant de soumettre une génération. L’arrêt du pilote ne garantit
pas l’annulation d’un job déjà soumis au service externe. Les contrôles natifs
mesurent placement, cadrage et mouvement; l’appréciation du récit reste celle du
modèle, avec des limites possibles sur les contacts et les expressions du VRM.

Les boutons par type d’unité restent une exécution directe avancée. Leur historique
est distinct des étapes du pilote IA.

Les VRM générés sont toujours considérés comme approximatifs : vêtements,
couleurs, coiffure, visage et silhouette peuvent différer des références sans
bloquer la réalisation ni déclencher une nouvelle génération. Le modèle installé
fait référence pour la continuité; la composition et les contacts sont adaptés
à sa géométrie réelle. Les rig inutilisables ou capacités nécessaires absentes
restent des limites techniques. L’étape de placement ne refuse pas un avatar
encore debout avant sa phase d’animation, ni le cadrage provisoire avant la phase
des caméras. Les collisions involontaires restent à corriger; des chevauchements
de boîtes englobantes doivent être confrontés aux images et aux contacts voulus.

Chaque phase et chaque reprise utilise une conversation neuve pour limiter
l’accumulation du contexte. La continuité provient du document Studio et des
checkpoints, avec conservation des VRM déjà terminés. Les identifiants des
conversations sont enregistrés par étape. Trois passes de correction maximum
sont demandées au modèle avant de signaler les problèmes techniques restants.

Lancer le serveur complet avec `npm run dev` pour disposer de l’exécution IA.
Le démarrage attend sa connexion à l’éditeur et transmet à Vite le port réellement
ouvert. Si le port par défaut est occupé, le serveur choisit un port libre;
si `COZYCLAY_LIVE_PORT` a été fixé explicitement, il respecte ce choix et signale
un conflit. Après une modification du serveur, redémarrer le processus puis
actualiser la page avant de reprendre le pilotage.

## Reprendre après un rechargement

La session Production est sauvegardée localement avec le document de scènes :
source, plan, bindings, ressources, avatars générés, modèle IA et étapes vérifiées.
Après actualisation, ouvrir Production et cliquer sur **Reprendre le pilotage IA**.
Une étape en cours apparaît comme interrompue; les étapes terminées sont conservées.
Le pilote inspecte les éléments et jobs existants avant de continuer, avec une
nouvelle conversation pour la phase reprise. Aucune génération ne démarre au
simple rechargement. Les scènes terminées sont revérifiées à la reprise.

La restauration exige le même ensemble d’identifiants de scènes locales pour
éviter de rattacher la production à un autre projet. La session est également
incluse dans la sauvegarde portable du projet. Une sauvegarde déjà perdue ne peut
pas être reconstruite à partir des seuls objets visibles.

## Tests

```powershell
node test/verify-production-narrative.mjs
node integrations/studio-narrative/verify-page.mjs
$env:NARRATIVE_DEPENDENCY_ROOT = "C:\Users\pulsy\Videos\workflow_gen_short_with_ia"
& "$env:NARRATIVE_DEPENDENCY_ROOT\venv\Scripts\python.exe" -B integrations/studio-narrative/backend/tests/test_studio_narrative.py
```

Les tests Python utilisent une base SQLite en mémoire et des audios temporaires.
Ils ne modifient pas le projet réel et n'appellent aucun fournisseur IA. Après
installation, les tests peuvent aussi être exécutés avec unittest dans le backend.

Voir [QA.md](QA.md) pour les résultats et limites de vérification.
