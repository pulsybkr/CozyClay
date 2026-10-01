# Contre-vérification des corrections du rapport 04

Date : 1er octobre 2026. Base : 11eb442 et changements locaux utilisateur.
Ce document complète 04-verification-vagues-1-4.md ; il ne remplace pas ses scénarios T1–T6.
Aucun code applicatif modifié et aucun job payant lancé par cette vérification.

## Verdict

Les corrections sont réelles mais partielles. La déclaration « toutes les corrections ont été appliquées et validées » n’est pas confirmée par le code et les sondes. Le parcours de production native jusqu’au MP4 n’est pas encore livré.

## Résultats exécutés

- Compilation Vite réussie : 1 356 modules. Pas de certification de toute la commande npm build (sitemap).
- 22 fichiers de tests ciblés exécutés dans des processus Node frais : 21 réussissent, 1 échoue. Nouvelle suite verify-production-recovery incluse.
- Échec identique de test/verify-source-routes.mjs : 4 sous-tests passent ; celui des variables d’environnement lit le providers.json utilisateur hors périmètre et rencontre EPERM. Cela n’est pas une erreur HTTP distante démontrée.
- Sondes indépendantes Node avec fixtures et domaines en mémoire : compiler, producteur, registre réel, installateurs et runner.
- Pas de suite générale npm test, recette navigateur, tests Python distants live, MP4 réellement rendu ou fournisseur réel dans ce contrôle.
- Les imports des sondes sont chargés dans un nouveau processus : pas de résultat basé sur un ancien module en cache.

## Corrections confirmées

1. Client : manifest.project conservé, sections indexées par name, snapshot invalide rejeté.
2. Domaine : setSourceSnapshot accepte désormais snapshot/manifest/connectionId/projectId et fournit la forme source.snapshot.
3. Interface : productionId ajouté aux commandes de préparation/exécution/pause/reprise.
4. Compiler : unités cast-instance, structures et fenêtres motion ajoutées ; structure hash changé lorsque la hauteur du bureau passe à 9 m.
5. Runner : contrôle de dépendances et tri ajouté ; les erreurs natives ne sont plus systématiquement transformées en done.
6. Journal : inputHash ajouté aux événements/états.
7. Export : plan vide désormais rejeté avec EXPORT_NOT_VERIFIED.
8. Adaptation : le faux adapted:true a été retiré ; source non structurée retourne une limite explicite.

Ces confirmations ne signifient pas que la construction complète, les mouvements et l’export sont raccordés.

## État des constats du rapport 04

| Constat | État actuel |
| --- | --- |
| B1 récupération | Partiellement corrigé : forme project correcte, intégrité hash/révision non vérifiée |
| B2 owner source | Normalisation corrigée dans le domaine ; parcours UI + save/open réel non certifié |
| B3 boutons | ID corrigé ; suivi long job/pause et rendu UI non certifiés |
| B4 installation | Commandes améliorées mais schémas, dimensions, structures, placement et contexte scène restent défectueux |
| B5 compiler | Hashes et unités améliorés ; overrides ignorés, sémantique motion/contact incorrecte |
| B6 vraie animation | Non corrigé : métadonnées, pas d’animation squelettique ou binaires installés |
| B7 exécution fiable | Dépendances/échec corrigés ; protections, preuve native et unités non gérées restent insuffisantes |
| B8 durabilité/idempotence | Non corrigé au niveau requis : mémoire, réexécution des unités done, journal non durable |
| B9 contacts/rythme renderer | Non raccordé dans le pipeline de production inspecté |
| B10 MP4 | Faux export non vide toujours présent ; seul le plan vide est bloqué |
| B11 legacy/erreurs réseau | Faux adaptation retiré, adaptation non implémentée ; connect/fetch masquent encore erreurs |
| B12 distant | Code inspecté inchangé sur révision inventée et clé par défaut |

## Problèmes restants et preuves

### R1 — Export toujours sans fichier, et unités failed acceptées

src/commands/production.js, branche production.export (exported:true vers ligne 489).

La commande vérifie que le plan contient des unités puis teste resumeCandidates. Elle ne lance toujours ni capture, ni encoder, ni muxer, ni téléchargement MP4.

Sonde : une unité structure avec checkpoint state:failed produit encore :
exported:true ; summary « exported successfully ».

Pourquoi : les unités failed/blocked/uncertain ne sont pas forcément resumeCandidates. « Aucun candidat à reprendre » ne signifie pas « toutes les unités vérifiées ».

À faire :
- exiger état done vérifié pour toutes les unités requises et des ressources/projections natives valides ;
- raccorder le vrai export multi-scène ;
- retourner une preuve de fichier/encodage, pas une constante true ;
- test sur plan non vide failed, blocked, uncertain, ainsi que MP4 réellement décodable.

### R2 — Motions encore descriptives et mauvaise sémantique

src/production/clip-producer.js et compiler.js.

Les fenêtres sont maintenant correctes, mais aucune pose/frame squelettique, NPZ ni ressource binaire n’est produite. La composition reste un regroupement de descriptions ; le controller n’a pas de branche d’installation native pour motion-clip/motion-compose.

Sonde office-12s :
- ACT_A_WALK : idle, [0,96), pas de frames/binaires ;
- ACT_A_WAVE : wave, [96,192), pas de frames/binaires ;
- ACT_B_REPLY : talk, [96,192), pas de frames/binaires.

La recherche de mots anglais ne reconnaît pas « marche » ; « répond par un signe de tête » devient talk. Un label wave ne constitue pas une animation.

À faire : contrat d’intention mouvement explicite/adaptation validée, vrai producteur de motion ou ressource fixture exécutable, stockage et composition squelettique, installation dans le take lu par renderer. Unsupported doit rester unsupported, jamais done fictif.

Le producteur avatar reste builtin/fallback et ne satisfait pas la stratégie generate distante. Les ressources produites ne sont pas correctement reliées au cast et à la sauvegarde par le controller.

### R3 — Construction native perd données essentielles

src/production/installers/index.js.

Sondes :
- structure compilée : 1 élément de mur ; appels d’installation : uniquement 2 props, donc mur non installé ;
- props : bureau height=0,75, tasse height=0,12 ; les appels object.add ne transmettent ni dimensions ni asset ni changement d’échelle, uniquement kind=box, placement et name ;
- personnage attendu (-1,0,1), taille 1,78 ; après createCharacterEntry, x=0,z=0,scale=1 et modèle par défaut. L’installateur envoie position/yaw alors que l’entrée native normalise x/z/rot/model ;
- scene.create expose un schéma vide, additionalProperties:false, mais l’installateur envoie {name}. Ce payload est incompatible avec le vrai registre ; les mocks acceptent pourtant ce paramètre.

À faire : utiliser scene.create({}) puis rename sur ID réellement reçu ; installer les structures et dimensions ; mapping natif x/z/rot/model/scale ; lier la ressource avatar ; supprimer les fallbacks vers commandes inexistantes.
Chaque installateur doit cibler explicitement sa nativeSceneId. Les bindings actuels ne portent pas assez de contexte pour une installation multi-scène sûre. Ne pas créer toutes les scènes puis tout installer dans la dernière active.
Les erreurs caméra/timeline ne doivent pas être avalées puis annoncées comme installation vérifiée.

### R4 — Pickup : contact à 9 s au lieu de 10 s

src/production/compiler.js, branche interaction.

Source canonique : interaction.contactSeconds=10.
Résultat compilé : startFrame=192, contactFrame=216, donc 9 s.
Attendu : frame 240.

Le compiler lit action.contactFrame au mauvais niveau et utilise une valeur par défaut start+24 ; il ignore également une partie de interaction.kind/hand/releaseSeconds.

À faire : mapping du contrat canonique complet en frames locales, validation contact/release dans la fenêtre et utilisation effective du track dans preview/export.
Les modules interaction-track/expressions/pacing/time-map restent sans intégration démontrée dans le controller et renderer ; une unité interaction peut être marquée done sans effet visuel.

### R5 — Un second lancement réinstalle la même unité

src/production/controller.js, startRun/executeUnit ; run-store.js.

Sonde : exécuter deux fois une même unité avec même ID/hash fait deux appels natifs. computeIdempotencyKey est importé mais pas appliqué pour empêcher ce cas.

À faire : cache/états et preuve native avant soumission/installation ; saut des unités déjà vérifiées compatibles ; upsert dans le même contexte scène ; test double clic/reprise/resoumission identique avec compteurs natifs et fournisseur.

### R6 — Journal non durable et autorisations non appliquées

run-store.js continue à créer un store in-memory (Map et arrays). Le domaine reçoit surtout la ligne done par unité, pas le journal complet des jobs/tentatives/resources à chaque frontière sûre. Pas d’IndexedDB ni verrou inter-onglets effectif démontré.

startRun enregistre grant mais ne vérifie pas budget/périmètre/hash/consentement ; runUnit a le même problème. executeUnit peut encore marquer done des types sans installateur (motion, interaction, expressions, etc.) et accepter une exécution sans bus selon type.

À faire : persistance continue, reprise artifact-ready sans repayer, capture jobs ambigus, journal des échecs, mutex, vérification du contexte et grant commun UI/agent. L’absence d’une branche installable doit bloquer la réussite.

### R7 — Hash et révision reçus incorrects acceptés

src/production/source-client.js.

Sonde : manifest avec hashes faux et pages annonçant une autre révision ; fetchFullSnapshotProgressive retourne valid:true.

Le count mismatch reste un console.warn ; validateSnapshot contrôle la structure narrative mais pas l’identité des pages vis-à-vis du manifest.

À faire : projectId/revision/section, total, IDs et hash vérifiés ; nombre erroné = rejet ; curseurs bornés et non répétés. Normaliser expressions et préserver resources depuis l’API. Tests corruption/transformation narrative entre pages.

### R8 — Overrides et erreurs encore trompeurs

compiler.js reçoit overrides mais ne les applique pas à la compilation ; updateDraft empile les opérations sans matérialiser les changements.
connect/fetch continuent à convertir certaines erreurs réseau en résultat réussi/pending ou sections.error.
production.fetch ne traite qu’une page par section dans ce chemin agent.

À faire : appliquer patches typés avant compilation et hash, validation identités/valeurs ; pagination réelle ; erreurs structurées et état récupéré complet observable. Une limitation d’adaptation legacy explicite est acceptable uniquement si annoncée comme fonctionnalité non livrée.

### R9 — API distante non corrigée sur les points B12

Dépôt distant inspecté en lecture :
- app/services/studio_story_snapshots.py : une révision demandée inexistante peut toujours être créée avec ce nom ; manifest courant retourne le snapshot existant sans publication d’une nouvelle source démontrée ;
- app/core/studio_access.py : clé publique de développement par défaut si STUDIO_API_KEY absent.

À faire : séparer publication et consultation immuable ; absence de révision = 404/410 ; clé explicite hors mode test. Pas de déploiement public avec le défaut actuel.

## Tests à renforcer pour éviter un nouveau faux feu vert

Les tests actuels doivent contrôler les effets produits, pas seulement les clés de sortie :

1. Installer office-12s avec vrai registre et vrais owners ; vérifier transforms, dimensions, identité modèle, murs et caméras dans le document natif.
2. Changer hauteur bureau, position acteur et contactSeconds ; constater changement natif et invalidation juste.
3. Générer/install clip fixture squelettique ; frames réellement lues par motionFor et renderer.
4. Double exécution identique : aucune nouvelle création ni appel payant.
5. Recharger au milieu d’un job/artifact-ready : journal et ressources conservés.
6. Fournisseur/installation échoué : failed persistant, aucun export vérifié.
7. Réception hash/révision incorrects : rejet.
8. MP4 court et multi-scène : fichier présent, décodable, fps/durée/cuts/contacts concordants.
9. Tests UI via le bus et envelopes job started/completed, avec pause pendant travail réel.
10. Test source-routes entièrement isolé de la configuration utilisateur.

## Conclusion pour la suite

Continuer les corrections des vagues 1–4. Priorités : R1–R3 (résultat réel), R4 (contact), R5–R7 (fiabilité), R8–R9 (connexion réelle/contrat).
Le passage à vague 5 reste conditionné à la recette T1–T6 du rapport 04, avec vraies vidéos de référence et preuve de reprise.

