# Première étape du studio VRM

Travail local sur la branche `feat/vrm-studio`, dans le worktree `../CozyClay-wt/vrm-studio`.

## Essayer

Depuis ce dossier :

```powershell
$env:COZYCLAY_LIVE_PORT = '5291'
node tools/dev-full.mjs --host 127.0.0.1 --port 5191
```

Ouvrir `http://127.0.0.1:5191/app/?scene=vrm-dialogue`.

La scène de départ contient Sakura, CHAR 02, un mur bleu, une table et un élément vert. Elle propose un plan fixe de dix secondes. Le choix de scène est aussi disponible dans les projets de départ.

Sélectionner un personnage dans la hiérarchie pour changer son modèle dans l’inspecteur. Les deux avatars sont également disponibles dans l’onglet Assets. Les formats 16:9 et 9:16 utilisent les contrôles caméra existants.

## Réalisé

- Catalogue partagé par sauvegarde, outils IA et interface, avec les deux VRM fournis.
- Fichiers VRM intégrés au build Vite depuis `assets`, avec noms d’URL produits par le build.
- Chargement indépendant de chaque instance, matériaux et textures conservés, échelle en mètres et orientation VRM0 normalisée.
- Erreurs de chargement par avatar sans faire disparaître tout le studio.
- Pose debout de départ sur les os normalisés VRM.
- Première adaptation des animations cskel27 vers les os normalisés VRM, déplacement racine et restauration des poses.
- Scène simple sauvegardable/réouvrable, compatible avec les anciens modèles FBX.
- Correction des séparateurs de chemins dans le manifeste des tests pour son exécution sous Windows.
- Nettoyage du profil de QA borné au dossier temporaire, avec reprises si Chrome retient brièvement un fichier sous Windows.

## Limites de cette étape

- Le chargement concerne les deux avatars fournis ; l’import de nouveaux fichiers VRM depuis un sélecteur et leur intégration comme ressources portables restent à développer.
- Le retargeting corporel est une première base vérifiée sur une animation de référence. Les contacts précis, la fidélité des trajectoires selon les proportions et les corrections IK VRM nécessitent encore une validation dédiée.
- Les outils avancés de pose sont désactivés pour les VRM. Les poses Mixamo enregistrées ne sont pas transposées automatiquement.
- Les cheveux et vêtements restent sans simulation secondaire animée, pour éviter une divergence entre recherche temporelle et export.
- Les pistes d’expressions ont depuis été ajoutées ; leur préparation par l’agent est décrite dans [expressions-faciales.md](expressions-faciales.md). Le transport HTTP Kimodo v2 est maintenant branché et vérifié sur une génération réelle : voir [kimodo-api-v2.md](kimodo-api-v2.md).
- La validation vidéo complète dans les deux formats reste une étape distincte ; cette livraison ne la considère pas comme acquise.

## Vérifications

Compilation Vite réussie. Tests ciblés réussis : catalogue/projet VRM, scènes, projets, champs Studio, commandes de personnages, routage UI, liaison des outils de l’agent et lecture des anciens FBX.

QA Chrome : deux avatars chargés avec textures, sauvegarde/réouverture, changement de modèle dans l’inspecteur et annulation, deux instances indépendantes de Sakura, animation de référence, recherche temporelle reproductible et restauration des transformations. Le wrapper de QA termine avec le code 0 après correction du nettoyage Windows.

Commande QA :

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:QA_URL = 'http://127.0.0.1:5191/app/'
$env:CDP_PORT = '9236'
node tools/qa-browser.mjs -- node test/qa-vrm-browser.mjs
```

Preuves conservées : [capture de la scène](qa/vrm/scene-vrm.png) et [rapport](qa/vrm/report.json). Le script écrit les nouvelles exécutions dans `%TEMP%/cozyclay-vrm-qa/`.

La suite complète s’arrête sur `test/ardy/verify-secure-artifacts.mjs`, qui attend des permissions POSIX `0700`. Le même échec (`438 !== 448`) a été reproduit dans le checkout original sans les changements VRM. Ce gate ne peut donc pas être annoncé comme réussi sous cet environnement Windows.
