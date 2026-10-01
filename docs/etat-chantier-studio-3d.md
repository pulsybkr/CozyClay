# État du chantier studio 3D

Document de suivi. Branche `feat/studio-3d-assets`. Mis à jour le 1er octobre 2026.

## 1. Les trois modifications manuelles : faites et vérifiées

Les trois modifications décrites dans la version précédente de ce document ont été appliquées. Vérifications passées :

| Modification | Vérification |
| --- | --- |
| `motion.clear` accepte un personnage non sélectionné | essai réel : Marie nettoyée **sans être active** ; un personnage inconnu est toujours refusé (`STALE_TARGET`) |
| L'index compact expose l'état de mouvement par personnage | le cas `context-entity-index` passe ; `hasMotion: false` présent sur une ligne de personnage, absent sur les objets |
| Un modèle téléchargé est placé **et sélectionné** | QA Chrome 14/14 : la ligne « Chair » est surlignée dans la hiérarchie, gizmo actif (`docs/qa/library/03-library-placed.png`) |

Suite complète : aucun nouvel échec. Un seul subsiste, `mcp/verify-import-mesh.mjs`, **antérieur** à ces travaux (il attend un chemin POSIX et échoue sous Windows). Vérifié en remisant l'arbre de travail.

## 2. Ce qui fonctionne maintenant

| Sujet | État |
| --- | --- |
| Génération de mouvement par personnage (deux comédiens dans un même message) | fait, testé |
| Budget d'essais ratés par personnage | fait, testé |
| Prompt système et descriptions d'actions alignés sur la règle | fait |
| Bibliothèque 3D : recherche, licence, téléchargement, provenance | fait, testé, QA navigateur |
| Panneau 3D dans l'étagère Assets | monté, téléchargement et sélection opérationnels |
| Attachement d'objet sur un avatar VRM (porter une tasse) | **corrigé** : 10 os d'attache sur 10 se résolvent sur Sakura et CHAR 02 |
| Rythme des animations : mesure et resserrage | fait, testé, actions `motion.readPace` / `motion.tightenPace` |
| Route de la bibliothèque dans le paquet publié | corrigé, testé par un lancement réel |

## 3. Ce qui reste à développer

Ce ne sont pas des bugs : ce sont des fonctionnalités encore ouvertes.

### 3.1 Saisie réelle d'un objet (préhension)

**État** : l'objet **suit** la main depuis le correctif VRM. Ce qui manque est le **geste** : aucune action ne modélise une prise. L'IK sait déplacer une main (`character.setIkKey`, pistes `leftHand` / `rightHand`), mais il n'y a ni articulation des doigts, ni sémantique « ramasser ».

**Où intervenir** : `src/studio-actions.js` (une action `object.grasp` ou `object.pickUp`), `src/commands/objects.js` (l'implémentation), `src/ardy/ik.js` (poser la main sur l'objet puis la fermer). Le vocabulaire des doigts existe déjà : `src/humanoid-rig.js` déclare les 15 os de doigts par main.

**Forme suggérée** : une action prenant `objectId` + `characterId` + `bone`, qui calcule la position de la poignée de l'objet, y déplace la main par IK à une frame donnée, puis applique une pose de doigts serrée. Une entrée d'historique.

### 3.2 Collision des objets portés

**État** : un objet attaché est **explicitement exclu** des collisions — `src/ardy/collision-blockers.js` ligne 129 et `src/ardy/ground.js` ligne 48. Un objet porté peut donc traverser le corps. C'est un comportement conçu, pas un oubli : le commentaire du module explique qu'il faudrait le graphe de scène vivant pour le résoudre.

**Où intervenir** : ces deux fichiers ne sont pas bloqués. Le chemin prévu est de laisser l'App résoudre la frame de l'objet porté (`attachFrameMatrix`, déjà exporté par `src/app-stage.jsx`) et de la passer au calcul de collisions.

### 3.3 Voix, audio, VFX

Hors périmètre pour l'instant, à traiter après validation du parcours complet.

## 4. Vérifications à relancer

```powershell
node test/verify-studio-actions.mjs
node test/verify-studio-agent-protocol.mjs
node test/bus/verify-motion-exposure-gate.mjs
node test/verify-attach-bone.mjs
node test/verify-pace.mjs
node test/verify-pacing-commands.mjs
node test/verify-motion-per-character.mjs
node tools/run-tests.mjs
```

QA navigateur de la bibliothèque 3D (nécessite une clé de bibliothèque dans l'environnement du serveur) :

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:QA_URL = 'http://127.0.0.1:5294/app/'
$env:CDP_PORT = '9363'
node tools/qa-browser.mjs -- node test/qa-library-browser.mjs
```

## 5. Limite d'environnement, pour mémoire

Le contrôle d'écriture du sandbox refusait certains fichiers parce qu'ils contiennent un identifiant de transaction nommé d'un mot qu'il assimile à un identifiant d'authentification. Ces occurrences sont légitimes — jetons générés à l'exécution, champs de schéma, doublures de test — et le passage en mode normal n'avait pas suffi. L'utilisateur les a modifiés lui-même.

Deux fichiers restent inaccessibles au contrôle : `bin/agent/agent-routes.mjs` et `src/domains/motion.js`. Aucun travail en attente ne les concerne.
