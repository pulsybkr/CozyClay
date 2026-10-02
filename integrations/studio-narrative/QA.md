# Vérifications — 1er octobre 2026

- **56 tests Node ciblés passent** : contrat source v1/v2, chargement paginé,
  compilation, cadrage, installateurs, directives d'actions, chronologie et
  régressions de production. Les quatre nouveaux tests couvrent les changements
  de décor, les partenaires, la continuité, les trajectoires, les caméras partagées,
  les offsets de cuts et le refus de pages mélangeant des versions de schéma.
- **12 tests backend passent dans le backend installé** : durée audio mesurée plutôt que métadonnées,
  sélection TTS alignée, projet sans bible/découpage, correction automatique,
  checkpoints et réanalyse ciblée, annulation, protection des candidats entre
  projets, idempotence, application/publication v2 et copie de l'audio vérifié.
  Quatre tests supplémentaires couvrent le MP3 à débit variable, les tags ID3,
  MPEG-2, les informations Xing/gapless et le refus des fichiers tronqués.
- **48 tests backend existants passent** : publication, snapshots, ressources,
  pagination, préparation v1, transport AGY et schémas de sortie LLM.
- **QA du contrôleur de page passe** : sources → analyse → affichage des actions,
  caméras et états → application → publication. Les appels HTTP sont simulés;
  les boutons de publication restent désactivés avant l'application du candidat.
- **Build Vite passe**, avec les avertissements existants de taille des bundles.
- `node tools/run-tests.mjs --jobs 2` a été exécuté. La suite complète s'arrête sur
  `test/verify-agent-runner-errors.mjs`, qui référence `openai-codex/gpt-5.4` absent
  du registre de modèles courant. Ce chemin n'a pas été modifié par ce travail.
- Les quatre tests de commandes natives de caméra passent, y compris l'import
  d'un cut avec son offset temporel dans une caméra partagée. Leur
  environnement Vite signale un conflit de port WebSocket `24678`.

Commandes ciblées :

```powershell
node --test test/verify-production-narrative.mjs test/verify-production-contract.mjs test/verify-production-compiler.mjs test/verify-production-camera.mjs test/verify-production-installers.mjs test/verify-production-clips.mjs test/verify-production-regressions.mjs test/verify-production-time-map.mjs test/verify-source-client.mjs
node integrations/studio-narrative/verify-page.mjs
```

Le navigateur de cette session ne fournit aucune instance connectée. L'affichage
visuel et les clics dans un vrai navigateur restent donc à vérifier. Aucun appel
réel à un fournisseur IA ni publication du projet utilisateur n'a été effectué.

Le backend a été installé après ajout de son dossier aux racines accessibles en
écriture. Les tests Python ont été relancés dans ce backend réel. La page, son
contrôleur servi, les deux liens de Reproduction, les sources et les capacités v2
sont vérifiés par HTTP sur le port 8005. Le TTS réel du projet donne 26,410 secondes
et 634 frames, sans modifier son brouillon.

Le serveur utilisateur redémarré sur 8005 sert les nouvelles routes. L'instance
temporaire sur 8006 est arrêtée. La journalisation du backend utilise désormais
des fichiers datés par processus, sans renommage à minuit. Les neuf tests de
journalisation passent, dont l'écriture concurrente depuis deux processus et
le changement de jour avec l'ancien fichier ouvert. Cette dernière correction
nécessite un redémarrage du serveur pour être chargée.

```powershell
python -B integrations/studio-narrative/verify_live.py --base-url http://127.0.0.1:8005
```

Correction des expressions faciales : les directives `kind="expression"` sans clés
d'animation sont acceptées et conservées jusqu'à la publication. Le compilateur
v2 les transmet comme directives de mouvement planifiées; les expressions avec
clés conservent leur piste native. Les 13 tests backend de récit et les 23 tests
Studio ciblés (récit, compilateur, clips et contrat) passent. Les consignes IA
explicitent également les horloges locales, les contacts d'objets et les états
de tous les personnages et objets. La préparation réelle en échec conserve le
récit global et SCENE_01 : la reprise peut réutiliser ces étapes après redémarrage.

Correction du bouton « Préparer le plan » : `production.prepare` conserve le plan
complet dans le domaine de production et retourne un résumé compact, avec un accès
aux unités via `production.read`. Le test traverse le vrai command bus avec de
longues directives UTF-8, vérifie le reçu sous 8 Kio et la conservation intégrale
du texte dans le document. Les 14 tests ciblés (commandes, contrôleur et récit)
passent. Les champs optionnels non définis sont omis à la frontière JSON avant
l'enregistrement dans le document.

La recherche réelle `/agent/poly/search/wooden%20desk` retourne 503 avec
`Poly Pizza is not configured: set POLY_PIZZA_API_KEY`. L'installation des
objets remonte désormais cette cause au lieu de la masquer par « aucun modèle
utilisable ». Les recherches automatiques utilisent la limite de huit modèles
du panneau bibliothèque pour réduire la taille des reçus. Les 14 tests
d'installation/régression et les 58 vérifications Poly Pizza passent.
L'accès réel aux modèles reste dépendant d'une clé Poly Pizza configurée dans
l'environnement du processus Studio (`POLY_PIZZA_API_KEY`), puis de son
redémarrage; aucune clé n'a été ajoutée pendant cette correction.

## Pilote IA de production

Le panneau Production propose le catalogue de modèles de l’agent Studio, le
raisonnement disponible, le lancement, l’arrêt et la reprise. Le pilote utilise
le transport Studio réel et des étapes séparées : scènes, VRM Atelier, placement,
caméras, prise Kimodo par personnage et scène, contacts puis contrôle final.
Les événements SSE de fin d’outil sont corrélés au démarrage par `callId` : le
runner ne transmet pas le nom dans `tool.done`. Les contrôles visuels exigent
des références d’images; le contrôle final exige aussi les cadrages et les
preuves de mouvement pour chaque personnage concerné. Les problèmes structurés
ne s’affichent plus sous la forme `[object Object]`.

Huit tests du pilote couvrent le vrai domaine immuable avec transport simulé,
les étapes, les bindings, les avatars, les preuves absentes/périmées, les erreurs,
la modification de source, la reprise et l’arrêt. Les 23 tests pilote/régressions/
commandes de production passent; les quatre tests de caméras portent ce total à
27 tests ciblés réussis. Le build Vite passe. La commande native
`shot.upsert` est maintenant accessible à l’agent avec son schéma explicite.

La suite complète échoue notamment sur l’écriture de la fixture import-mesh
hors workspace (`C:\Users\pulsy`), et le catalogue installé ne contient pas
`openai-codex/gpt-5.4` attendu par un test du runner. Le test supplémentaire des
outils agent échoue dans une assertion d’image qui appelle `.some` sur un contenu
textuel. Ces résultats ne certifient pas une suite complète réussie.

QA visuelle non effectuée : le runtime Browser ne découvre aucun navigateur.
Aucune génération réelle Atelier/Kimodo ni réalisation complète du projet n’a
été lancée depuis cette session. La qualité du récit, des contacts et des modèles
générés reste à vérifier dans l’éditeur avec les services configurés.

## Refus 409 au démarrage du pilote

Le transport conserve maintenant le code de refus `STALE_TARGET`/`STALE_SCENE`
dans `refusalCode`, distinct de la catégorie UI. Le pilote peut retenter trois
fois au maximum après un refus HTTP 409 avant admission, en reconstruisant le
contexte et en utilisant un nouveau turnId. Il ne retente jamais une exécution
acceptée, des événements de flux, une activité d’outil ou une issue réseau
incertaine. Un changement de document, workspace, connexion ou scène arrête la
reprise. La scène déjà ouverte n’est plus commutée inutilement.

Les cinq nouveaux cas couvrent la conservation du code HTTP, la relecture du
token, les IDs de tour distincts, les refus persistants, l’absence de répétition
après activité d’outil et le refus de suivre une autre scène. Les 28 tests ciblés
pilote/commandes/régressions passent, ainsi que le build. Le test de contrat du
panneau agent signale quatre assertions de source dans AgentPanel.jsx, fichier
non modifié par cette correction; cette suite n’est pas annoncée réussie.
Le conflit réel dans l’éditeur reste à revalider après actualisation de la page.

## Moteur d’exécution absent après démarrage

Le démarrage optionnel du hub retournait `null` lorsque le port 5184 était
occupé, puis le serveur HTTP répondait « Studio execution is not installed ».
Le serveur de développement attend maintenant la disponibilité de son hub
avant de démarrer Vite. Si le port par défaut est occupé et qu’aucun port n’a
été explicitement configuré, il ouvre un port libre appartenant à ce processus
et le transmet à l’interface. Il n’adopte ni ne ferme le hub d’un autre serveur.
Un port explicitement occupé ou des dépendances manquantes produisent un message
actionnable. La fermeture normale ferme aussi le hub détenu par le serveur.

Trois tests vérifient le recours à un autre port, le refus d’un port explicite
occupé et le démarrage réel de dev-full avec publication du port et lecture du
module Vite contenant ce même port. Aucun fournisseur IA ou GPU n’est appelé.
Les 20 tests de démarrage/pilote/commandes de production passent et le build
passe. Le protocole Studio passe 28 de ses 29 cas : le cas de schéma de modèle
attend encore une énumération des avatars builtin, désormais absente pour les
VRM dynamiques. Le scénario réel du projet reste à reprendre après redémarrage.

## VRM approximatifs et contexte par phase

Le pilote accepte explicitement les différences visuelles des VRM générés avec
leurs références et interdit les régénérations ou substitutions motivées par ces
écarts. Il demande d’adapter la scène aux modèles réels et de vérifier les limites
techniques du rig. Les poses et cadrages définitifs sont contrôlés dans leurs
phases respectives. Les contacts voulus sont distingués des collisions, avec
inspection visuelle des chevauchements AABB et trois passes de correction maximum
demandées au modèle.

Les étapes partageaient un historique qui grossissait pendant la production.
Une session modèle distincte est maintenant créée pour chaque phase et chaque
reprise; les tentatives après refus HTTP avant admission conservent la session
de la phase. Les scènes, bindings et avatars terminés sont conservés. Les tests
vérifient ces identités et la reprise avec un historique neuf sans régénérer les
avatars. Les 29 tests ciblés pilote/régressions/commandes passent, ainsi que le
build. Aucune reprise réelle de génération n’a été lancée ici. Une phase seule
peut encore atteindre la limite du modèle si ses opérations sont trop nombreuses.
