# Vérification des vagues 1 à 4 et recette avant vague 5

Date : 1er octobre 2026. Base Git locale : 11eb442 + modifications utilisateur non commitées présentes au moment du contrôle.
Dépôts lus : studio CozyClay et C:/Users/pulsy/Videos/workflow_gen_short_with_ia.
Aucun correctif applicatif réalisé. Les sondes utilisent des fixtures et des domaines isolés en mémoire, sans appels payants.

## Verdict

Ne pas démarrer la vague 5 comme si le parcours principal était terminé. Les modules et tests ont progressé, mais le raccordement de bout en bout reste incomplet. Des commandes retournent un succès sans résultat natif ou fichier exporté.

| Vague | État constaté |
| --- | --- |
| 1 — Connexion/persistance | Routes et panneau présents ; contrat navigateur incompatible et structure source incohérente |
| 2 — Construction 3D | Compiler et installateurs présents ; plusieurs commandes natives incorrectes, erreurs masquées |
| 3 — Orchestration/motions | Runner présent ; durabilité, contrôle des dépendances et vraies ressources motion non livrés dans ce chemin |
| 4 — Interactions/export | Helpers testés isolément ; raccordement renderer et export global non démontré, production.export reste un faux succès |

## Contrôles exécutés

- Compilation Vite : réussie, 1 356 modules. Avertissements police inter-latin non résolue au build et bundles volumineux. Ce contrôle n’inclut pas toute la commande npm build (sitemap).
- 21 fichiers de tests ciblés : 20 réussis, 1 en échec. Chaque fichier a été exécuté avec node, timeout individuel de 12 s ; aucun timeout atteint.
- Échec test/verify-source-routes.mjs : 4 sous-tests réussis, 1 échoue sur EPERM à la lecture de C:/Users/pulsy/.config/cozyclay/providers.json. Limitation d’accès et défaut d’isolation du test, pas preuve que l’API distante échoue.
- Sondes de contrat/compiler/controller en mémoire : reproductions détaillées ci-dessous.
- La suite générale npm test n’a pas été exécutée dans ce contrôle.
- API FastAPI distante inspectée en lecture ; pas de lancement ni de tests Python live. Le TestClient existant active le lifespan de l’application : vérifier l’isolation d’init_db avant d’exécuter sur ce poste.
- Vérification navigateur impossible : aucun navigateur connecté via le skill browser:control-in-app-browser. Aucune capture visuelle, MP4 produit, qualité de contact ou de mouvement ne sont prétendus.
- Aucun job avatar/motion réel ni téléchargement Poly Pizza payant lancé.

Tests ciblés exécutés : verify-library-commands, verify-poly-pizza-route, verify-pace, verify-offscreen-export, verify-production-compiler, verify-production-clips, verify-production-camera, verify-production-avatar, verify-poly-pizza, verify-production-project, verify-production-interaction, verify-production-installers, verify-production-controller, verify-production-contract, verify-production-time-map, verify-production-run-store, verify-production-reconcile, verify-source-routes, verify-source-client, bus/verify-production-owner, bus/verify-production-commands. Tous sous test/, suffixe .mjs.

## Blocages à corriger avant recette complète

### B1 — Récupération navigateur incompatible avec l’API

Fichier : src/production/source-client.js, fetchFullSnapshotProgressive.

L’API distante publie manifest.project et sections comme liste de résumés nommés. Le client les lit comme manifest.aspect/durationSeconds/fps et sectionsMeta[sectionName]. Il reconstruit un objet sans project et perd la configuration originale, notamment durée/ratio.

Sonde sur office-12s et un manifest de forme canonique : valid:false, erreur /project MISSING_FIELD. Le panneau affiche malgré tout le candidat sans bloquer son application sur valid:false. Les hashes/IDs/révisions des pages ne sont pas réellement contrôlés à la fin de ce parcours.

À faire : conserver project, indexer sections par name, normaliser les expressions de la section actions, vérifier total/IDs/hash/version/révision et rejeter le candidat invalide. Tester avec une fixture de 30 s en 16:9 pour détecter les valeurs par défaut trompeuses.

### B2 — Source enregistrée et source relue différentes

Fichiers : src/panels/ProductionPanel.jsx, src/domains/production.js, src/commands/production.js.

Le panneau envoie snapshot et manifest à setSourceSnapshot ; le domaine prend seulement un argument et en copie les champs dans source. Le panneau relit source.snapshot/source.manifest, tandis que production.fetch/read utilisent source.sections. Aucun format unique n’est utilisé.

L’ancien défaut de signature recordAction a été corrigé (label ou fonction accepté), mais pas cette divergence.

À faire : définir un seul owner de source avec connectionId, projectId, revision, manifest et snapshot/sections validées ; rendre panneau, commandes, compilation et save/open compatibles avec ce schéma. Recharger depuis fichier sans dépendre du state React temporaire.

### B3 — Boutons incompatibles avec les commandes

Fichiers : src/panels/ProductionPanel.jsx, src/studio-actions.js, src/commands/production.js.

Préparer appelle production.prepare avec {} ; le schéma exige productionId. RunStage, pause, resume et retry omettent également cet identifiant. Le panneau lit result.plan/result.runId, tandis que les commandes renvoient output et le bus peut renvoyer un job started à attendre.

Sonde du registre réel : production.prepare({}) rejette INVALID_ARGUMENT, Required field missing.

À faire : transmettre selectors et révision/hash attendus ; gérer correctement envelope/job.await puis production.read pour le plan et suivi. Tester les boutons par le vrai bus, pas seulement les handlers appelés directement.

### B4 — Construction native non fiable

Fichiers : src/production/installers/index.js, scene.js, objects.js ; src/commands/objects.js, shot.js.

Le controller utilise les wrappers index.js, pas les installateurs complets testés à part. Ces wrappers :
- tentent de renommer une scène sans la créer/switcher correctement ;
- appellent object.create alors que la commande native exposée est object.add ;
- appellent shot.create avec des paramètres d’import qui ne correspondent pas au chemin déterministe shot.upsert ;
- renvoient ok:true lorsque le bus manque ou que les appels ont échoué.

Les anciens installateurs utilisent aussi objects.create et un nativeSceneId fabriqué sans récupérer l’identité effectivement créée.

À faire : unifier les installateurs ; créer/switcher scène cible, récupérer IDs réels, utiliser schémas natifs et upserts ; échouer si natif non installé. Persister bindings et vérifier présence/projection après commit.

### B5 — Compiler incomplet pour les données essentielles

Fichier : src/production/compiler.js.

Les props sont pris en compte, mais set.structure (murs/planchers) n’est pas traduit en géométrie d’installation. Le cast sert au cadrage sans produire les unités cast-instance nécessaires. Les mouvements n’embarquent pas start/end frames, trajectoires ou détails d’interaction ; toutes les actions deviennent motion-clip.

Les inputHashes ne couvrent pas les données utilisées : structure basée sur IDs uniquement, caméra principalement ID/bornes. Une modification de hauteur de bureau conserve son hash de structure dans la sonde.

À faire : payloads discriminés complets, unités d’instance et d’interaction, hashes d’entrées effectives, application des overrides. Test de changement de hauteur/caméra/timing produisant exactement les invalidations attendues.

### B6 — Producteurs motion/avatar encore descriptifs

Fichiers : src/production/clip-producer.js, avatar-producer.js, controller.js.

produceMotionClip ne soumet pas de job ni ne produit un tableau d’animation/NPZ. composeActorTracks trie des descriptions, pas des poses squelettiques. Le controller n’installe pas ces résultats dans un take native.

Sonde office-12s : marche, salut, réponse et pickup deviennent tous idle, startFrame=0, endFrame=72, durée 3 s. La cause est le payload body/interaction sans type de mouvement ni fenêtres, puis les valeurs par défaut du producteur.

Le producteur avatar choisit un VRM builtin sans génération réelle ; le compiler ne transmet pas correctement la stratégie distante. Le controller n’a pas de branche d’installation cast-instance.

À faire : chemins explicites fixture/builtin/generate ; ressources binaires stockées et validées ; installation des acteurs ; composition vraie dans le lecteur natif ; aucune substitution silencieuse annoncée comme génération.

### B7 — Succès runner sans dépendances ni installation

Fichier : src/production/controller.js.

Les commentaires annoncent validation grant/dépendances/idempotence, mais startRun/executeUnit ne les appliquent pas. Les units sont parcourues dans l’ordre du compiler, où certains shots précèdent leur scène.

Sonde : une unité dépendant de missing et un bus qui rejette chaque création passent quand même en completedCount:1, status:completed et checkpoint state:done.

À faire : tri topologique, validation review/plan accepté/grant/hash/contexte, receipts natifs contrôlés ; done réservé aux résultats vérifiés. Le runUnit direct doit utiliser les mêmes protections.

### B8 — Reprise pas durable au niveau annoncé

Fichiers : src/production/run-store.js, controller.js, reconcile.js.

Le journal est en mémoire (Map/array), pas IndexedDB. Le domaine reçoit principalement une ligne done par unité, pas les tentatives/resources/jobs/events du journal. Les états mémoire ne conservent pas toujours inputHash utilisé par reconcile. L’idempotency key importée n’est pas appliquée au runner. Les nouvelles exécutions peuvent recommencer des unités déjà traitées.

reconcile fait passer des unités done sur checkpoint sans preuve native lorsqu’aucune scène n’est fournie. La condition « aucun resumeCandidate » peut aussi cacher des unités failed/blocked/uncertain.

À faire : journal durable, checkpoint complet, cache réel, verrou et doublon refusé ; reprise compatible avec ressources et scène du projet ; échec/ambiguïté sans retry payant automatique.

### B9 — Interactions/pacing encore non raccordés

Fichiers : src/production/interaction-track.js, expressions.js, pacing.js, time-map.js.

Ces helpers existent et ont des tests partiels, mais la recherche d’imports ne montre pas leur utilisation dans le pipeline renderer/player/export/controller du studio. Le compiler ne produit pas les tracks nécessaires.

À faire : intégrer dans l’évaluation commune par frame ; sauvegarder ; tester scrub inverse/contact/release et remapping de toutes les pistes. Une fonction mathématique testée n’est pas une tasse effectivement soulevée à l’écran.

### B10 — Export de production fictif

Fichier : src/commands/production.js, branche production.export.

Après reconcile, la commande retourne exported:true sans encoder, muxer, fichier, téléchargement ou scheduler multi-scène. Une production vide peut être annoncée « exported successfully » : reproduit via le registre réel.

L’export historique du studio reste une autre fonctionnalité ; son test unitaire vert ne valide pas cette nouvelle commande.

À faire : vrai scheduler global, préparation async des changements de scène, capture animation/props/camera, MP4 décodable, crédits et audio explicitement inclus ou absent. Refuser plan vide et états non vérifiés.

### B11 — Adaptation legacy présentée comme faite sans adaptation

Fichier : src/commands/production.js, production.adapt.

La commande retourne adapted:true sans modifier ni proposer les données structurées. production.connect/fetch masquent également certaines erreurs réseau dans des résultats réussis.

À faire : implémenter le brouillon réel ou retourner unsupported ; ne pas annoncer une connexion/adaptation validée sur erreur. Le parcours legacy doit rendre visibles les choix d’identité, scène et temps manquants.

### B12 — Contrat distant de révision et sécurité à renforcer

Dépôt distant : app/services/studio_story_snapshots.py, app/core/studio_access.py.

Une révision demandée inexistante peut être créée à la volée avec son nom au lieu de répondre 404/410. Le manifest courant réutilise le dernier snapshot sans processus de publication/actualisation des données source démontré. Une clé serveur par défaut connue est utilisée si STUDIO_API_KEY manque.

À faire : lecture de révision strictement immuable, publication/révision explicite, tests de source modifiée ; configuration explicite de clé hors mode test, ne pas exposer ce serveur sur Internet avec son défaut.

## Ordre de correction conseillé

1. B1–B3 : récupérer → appliquer → préparer via UI et recharger correctement.
2. B4–B5 : vraie scène native, objets, cast et caméras, hashes cohérents.
3. B7–B8 : résultat vérifié, protections et reprise, avant tout job payant.
4. B6 et B9 : vraies animations, composition, contacts dans le renderer.
5. B10 : export complet observable ; B11–B12 pour l’import réel legacy et les révisions.
6. Refaire tests isolés puis la recette suivante. Ces travaux ferment les vagues 1–4 ; ce ne sont pas des bonus de vague 5.

## Recette à exécuter après correction

### Préparation

Utiliser un projet de test distinct ; conserver les projets originaux. API locale seulement et clé dédiée. Éviter services payants jusqu’à réussite des fixtures. Un fichier fixture JSON présent sur disque n’est pas automatiquement un projet distant importable : il faut un serveur fixture ou un projet de test publié par l’API.

Deux terminaux PowerShell, depuis chaque dépôt :

Workflow distant (environnement Python du projet activé) :
~~~powershell
$env:STUDIO_API_KEY = "cle-test-local"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
~~~

Studio :
~~~powershell
npm run dev -- --port 5181
~~~

Ouvrir le studio à son chemin /app/. Configurer Production avec URL serveur de base, pas le chemin de la page reproduction, et même clé locale. Le champ ID est le video_id, pas l’ID SQL numérique.

### T1 — Récupération et sauvegarde (sans paiement)

Projet office-12s : 2 acteurs, 1 décor, 1 scène, 3 shots, 12 s à 24 fps, format 9:16.
- Tester connexion ; récupérer ; consulter acteurs/décors/plans/actions.
- Confirmer contenu avec la page reproduction et la fixture, pas juste des compteurs.
- Appliquer, sauvegarder via le menu Projet, fermer/rouvrir ; panneau retrouve source/révision/données.
- API arrêtée après sauvegarde : consultation locale et préparation restent disponibles.
- Mauvaise clé, ID absent, révision absente et source invalide : erreurs visibles, aucune scène effacée, aucune unité done.

### T2 — Construction 3D native

- Préparer puis accepter le brouillon ; construire uniquement le bureau.
- Hiérarchie : murs/plancher/props réels, IDs et scènes attendus.
- Dimensions contrôlées ; tasse en y=0,75 sur le plateau, pas au sol/dans la table.
- Deux avatars de référence distincts ; pieds au sol, placements/tailles corrects.
- Trois plans locaux [0,96), [96,192), [192,288) ; caméras portrait et sujets dans le cadre.
- Relancer la même construction : aucun doublon.
- Déplacer un objet à la main puis relancer : conflit/override visible, pas écrasement silencieux.
- Changer hauteur source du bureau : invalidation placement/contact/caméra concernée, pas régénération de tous les avatars.

### T3 — Animation de référence, puis fournisseur réel

D’abord utiliser des fichiers de mouvement de référence exécutables, pas des descriptions.
- A marche 0–4 s, A salue 4–8 s, B répond sur sa propre piste ; pickup 8–12 s.
- Aux cuts 4 et 8 s, continuité de pose/root quand l’action traverse le cut.
- Regénérer/remplacer uniquement le salut A : B et caméras inchangés.
- Scrub début/milieu/fin : animations présentes réellement dans le squelette.
- Sauvegarder/rouvrir sans réseau : mouvement reste lisible.
- Seulement ensuite, autoriser quelques jobs réels et contrôler prompts, durée, coût connu/inconnu, ID fournisseur et ressources reçues.

### T4 — Échecs et reprise

- Double clic : une seule soumission et un seul résultat.
- Pause pendant job ; reprise : pas de resoumission d’une ressource déjà reçue.
- Recharger entre artifact-ready et installation : réinstallation depuis cache.
- Erreur installation native : failed, jamais done.
- Changement projet/scène pendant job : aucun résultat dans le mauvais projet.
- Timeout de soumission ambigu : uncertain avec décision, pas paiement automatique.
- Deux onglets : un seul owner d’exécution.
- Vérifier que le journal survit au rechargement, pas seulement un badge React.

### T5 — Interaction et rythme

- Avant contact : tasse sur table.
- À contact (10 s, frame 240) : main atteint l’anchor ; pas de téléportation.
- Après contact : tasse suit la main ; release/put-down si scénario ajouté.
- Aller directement avant/après contact puis scrub inverse : résultat identique à lecture continue.
- Tasse portée contre mur : collision encore détectable.
- Salut avec root immobile : ne pas le supprimer comme silence.
- Retiming : expression/camera/IK/contacts restent synchronisés ; second appel identique ne change rien.

### T6 — Export court puis multi-scène

- office-12s : MP4 réellement téléchargé, 288 images à 24 fps, durée 12 s, format portrait.
- Inspecter 95/96 et 191/192 : vrais cuts sans frame manquante/dupliquée.
- Inspecter frame 240 : même contact que la prévisualisation.
- Crédits présents pour assets qui les nécessitent.
- Audio présent si narration incluse ; export muet étiqueté muet.
- story-30s : plusieurs scènes réellement rendues ; 720 images à 24 fps.
- Annuler/export échoué : scène et playhead initiaux restaurés, projet toujours modifiable.
- Sauvegarder puis exporter hors connexion avec ressources embarquées.

### Contrôles automatiques reproductibles

Studio :
~~~powershell
npm test
~~~

Tests ciblés et navigateur export existant (une fois le serveur lancé et le navigateur QA correctement configuré) :
~~~powershell
node test/verify-production-controller.mjs
node test/verify-production-installers.mjs
node test/verify-production-clips.mjs
node test/verify-production-interaction.mjs
node test/verify-production-time-map.mjs
node test/bus/verify-production-commands.mjs
$env:QA_URL = "http://127.0.0.1:5181/app/"
node tools/qa-browser.mjs -- node test/verify-offscreen-export-browser.mjs
~~~

Attention : ce dernier teste l’export historique, pas toute la production globale. Ajouter des tests browser spécifiques ProductionPanel, motion install, interactions et export multi-scène. Renforcer les tests natifs avec le vrai registre et des rejets explicites, plutôt qu’un mock acceptant toutes les commandes.

Distant, seulement après isolation du lifespan/init_db et de toute écriture :
~~~powershell
python -m pytest tests/test_studio_story_routes.py -q
~~~

## Autorisation de passage à vague 5

Feu vert uniquement lorsque :
- B1–B12 corrigés ou limitation explicitement acceptée sans faux succès ;
- T1–T6 réussis et preuves conservées ;
- vraie vidéo de 12 s ET multi-scène de 30 s exportées/rejouables ;
- pause/recharge/reprise sans doublons ni perte de ressources ;
- tests généraux et tests navigateur production documentés.

Preuves minimales : captures hiérarchie/caméras/contact, MP4, métadonnées fps/durée/dimensions, journal d’unités avec ressources/IDs natifs et bilan des tests. Les badges « completed », le nombre de fichiers et les commentaires du code ne sont pas des preuves de fonctionnalité terminée.

