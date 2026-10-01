# 07 — Missions de développement et recette d’intégration

Objectif : pouvoir distribuer ce dossier à des sous-agents sans qu’ils inventent chacun un workflow différent. Les missions ci-dessous sont des instructions de travail à transmettre ; aucun agent n’a été lancé pour implémenter l’application dans cette session.

Lire README, 01 et le document métier du lot avant de coder. Lire CLAUDE.md/AGENTS.md du dépôt concerné. Vérifier la branche et les changements utilisateur. Pas de modification des bases/media utilisateur ; tests avec ressources fixtures et bases temporaires.

## 1. Règles communes

- Une mission = périmètre borné, tests de contrat, résultat démontrable. Pas de refonte opportuniste de App.jsx.
- Les fichiers centraux src/App.jsx, src/commands/index.js, src/project.js, src/domains/scenes.js et tools/run-tests.mjs sont intégrés séquentiellement par l’intégrateur. Les sous-agents proposent des patches documentés ; pas quatre architectures concurrentes.
- Fichiers nouveaux listés dans 01–08 sont cibles prescrites, non fichiers déjà existants. Ne pas stubber un appel manquant puis annoncer la feature faite.
- Source distante read-only pour le studio ; authentification et génération payante explicites.
- Tests locaux : convention réelle test/verify-*.mjs, test/bus/verify-*.mjs et runner tools/run-tests.mjs. Tests navigateur via tools/qa-browser.mjs. Pas de nouveau runner Jest/Vitest par défaut.
- Chaque livraison indique tests exécutés, résultats, tests non exécutés et limitation restante. Un mock fournisseur valide l’orchestration, pas la qualité de mouvement réelle.

## 2. Tableau des dépendances

| Lot | Dépend de | Livrable utilisable |
| --- | --- | --- |
| L0 — Contrat partagé | Aucun | Fixtures canoniques validées Python/JS |
| L1 — Distant lecture + publication | L0 | ID vidéo → snapshot API immuable |
| L2 — Owner/persistance locale | L0 | Source et plan sauvegardables/rechargeables |
| L3 — Connexion et écran | L1 fixture, L2 | Récupération par ID, étapes et diagnostics |
| L4 — Correctifs import | Aucun, contrat asset existant | Assets dimensionnés/licenciés correctement |
| L5 — Compiler décors/plans | L2, L4 | Scènes natives et caméras inspectables |
| L6 — Runner durable | L2, L3 | Étapes reprenables sans duplication |
| L7 — Avatars/clips | L5, L6 | Deux acteurs animés indépendamment |
| L8 — Interaction/pacing | L7 | Contact daté et montage cohérent |
| L9 — Export/recette | L5–L8 | MP4 multi-scène et preuves de validation |

Parallélisable après contrat : L1 avec L2, L4. L3 attend l’interface du owner. Les installations et intégrations centrales restent séquentielles.

## 3. Fiches de mission

### L0 — Contrat et fixtures

Lire 02 et 08. Produire docs/studio-export.openapi.json côté distant et fixtures exportées identiques dans test/fixtures/production/ côté studio et tests/fixtures/studio/ côté distant.

Fixtures : bureau 12 s (2 acteurs, 3 shots, salut et pickup), récit 30 s (2 décors, retour dans un décor), legacy flow sans keyframe_shots, legacy agnes avec sous-plans, source invalide. Hashes réels et vecteurs de canonicalisation partagés.

Ajouter src/production/source-contract.js et plan-contract.js. Validation erreurs par chemin, limites, références, temps et champs legacy. Aucun fetch. Acceptation : même fixture acceptée/rejetée par Python et JS ; manifeste actions compte aussi les expressions ; aucune durée dépend de generation_duration.

### L1 — Backend distant

Fichiers exacts : 08 §1–2. Implémenter modèles draft/snapshot, lecture API, publication et resources sécurisées. Ajouter imports modèles à database.py et router à main.py. Préparation texte + UI distante constituent L1b après API de lecture, pas une dépendance pour le premier connecteur legacy.

Tests : lecture authentifiée, fixtures flow/agnes, révisions immuables, TTS sélectionné, pagination, source changée → conflit, aucune génération image/vidéo. Livrer commande locale de démarrage selon README réel et un ID fixture ; aucune clé commitée.

Acceptation : un client HTTP récupère manifest puis toutes les sections d’une révision et reconstruit exactement le snapshot. Les anciens modes flow/agnes fonctionnent encore.

### L2 — Document production

Ajouter src/domains/production.js, src/production/resources.js, fingerprint.js et adaptations project.js/scenes.js/app-context suivant 01. Créer test/verify-production-project.mjs et test/bus/verify-production-owner.mjs.

Acceptation : document v4 ouvre sans production ; v5 conserve source, drafts, overrides, bindings et ressources encore non installées ; changement de scène conserve l’owner ; undo installation invalide binding ; aucune credential exportée. Lire ancienne version sans perte.

### L3 — Connexion et panneau

Ajouter modules sidecar source-connections/source-client/source-routes prescrits en 03, client navigateur et ProductionPanel. Modifier les deux launchers tools/dev-full.mjs et bin/cozyclay.mjs. L’intégrateur monte le panneau et le hook owner dans App.jsx.

Tests nouveaux test/verify-source-routes.mjs, verify-source-client.mjs, verify-production-panel-browser.mjs. Acceptation : saisir URL+clé puis projectId ; fetch ne génère rien ; champs consultables par section ; auth invalide message compréhensible ; fetch partiel reprenable ; clé absente du storage/browser logs et fichiers projet ; source révisée montre diff et conflits.

Le panneau fonctionne avec fixtures sans dépendre d’un agent IA actif.

### L4 — Correctifs assets

Appliquer C1–C4 de 06. Lire route/library actuelles avant modification ; tester sans nouvelle recherche payante avec réponses capturées anonymisées ou fixtures.

Acceptation : dimensions/pivot/collider cohérents, y conservé, licence source vérifiée, pagination borne reçus, race query corrigée, body stream limité et cancellable. Aucun endpoint de téléchargement libre depuis un prompt.

### L5 — Compilation et installation

Fichiers 05 §§1–4 : normalize/compiler/geometry/camera-planner et installers. Ajouter upsert shots via bus. Pas de génération GPU.

Tests test/verify-production-compiler.mjs, verify-production-installers.mjs, verify-production-camera.mjs. Acceptation : fixture 12 s construit bureau, deux avatars de référence, trois shots ; caméra portrait correcte ; seconde exécution sans doublons ; override manuel conservé ; scénario invalide bloqué avant mutation.

### L6 — Orchestration

Fichiers 04 : controller/run-store/reconcile/commands ; registre et contrôles agent intégrés avec owner.

Tests test/verify-production-controller.mjs, verify-production-recovery.mjs et test/bus/verify-production-commands.mjs. Acceptation : pause/reload/resume, double clic, crash aux frontières, timeout uncertain, user changeproject, budget/grants. Reprise ne repaye pas les unités artifact-ready. Afficher phase et diagnostic, pas uniquement spinner.

### L7 — Producteurs avatars et clips

Extraire les producteurs existants plutôt que dupliquer leur code ; nouvelle composition motion et sérialisation refs. Introduire migration scene v5 uniquement lors de ce lot si nouveaux champs layer nécessaires.

Tests test/verify-production-clips.mjs et verify-production-avatar.mjs. Acceptation mocked : trois jobs pour A marche, A salue, B répond ; A et B indépendants ; caméra cut n’interrompt pas mouvement ; source clips conservés dans projet ; recompose A seul lors de regen. Recette fournisseur réelle : consentement séparé, journal et artifact refs, qualité visuelle contrôlée.

### L8 — Interactions et pacing

Appliquer 05 §§6–7, C6–C8. Ajouter time-map et tests test/verify-production-interaction.mjs, verify-production-time-map.mjs. Revoir uniquement les adaptateurs IK effectivement présents.

Acceptation : prop avant/après contact correct, scrub déterministe, collider dynamique, salut root immobile non supprimé, rythme repeat changed:false, ripple refusé si piste non gérée. Si IK réel insuffisant, livrer état unsupported et limitation visible plutôt qu’un contact simulé annoncé parfait.

### L9 — Export et narration

Créer export-sequence, préparer transitions async, conserver timestamps globaux. Tests test/verify-production-export.mjs et verify-production-export-browser.mjs. Rapport crédits inclus.

Scope première livraison : MP4 vidéo native multi-scène, éventuellement muette explicitement. Si produit final demandé narré, ajouter lot audio : téléchargement ressource contrôlé, décodage et alignement TTS, mux audio adapté au module actuel, erreurs/samples/duration contrôlés. Ce lot reste requis pour déclarer une vidéo narrée complète ; il ne peut être remplacé par les subtitles seuls.

Acceptation : 12 s × 24 = 288 frames ; aucune frame sautée/dupliquée aux cuts ; source fermée puis projet rechargé encore exportable ; scène initiale restaurée après succès/erreur ; aucune route vidéo IA appelée.

## 4. Recette finale et preuves

R1 sans services payants :
1. API fixture distante → saisie ID → sections téléchargées.
2. Préparer plan → inspecter hypothèses → accepter.
3. Construire décors/avatars de référence/plans.
4. Installer clips fixtures mono-acteur et pickup.
5. Sauver/fermer/rouvrir sans réseau.
6. Exporter vidéo et crédits ; examiner première/dernière frame et frames de cut/contact.

R2 API distante réelle : répéter sur un projet flow et un projet agnes, en corrigeant leurs ambiguïtés. L’import ne prétend pas reproduire automatiquement le style raster des anciennes images.

R3 services réels autorisés : générer avatars/motions limités, vérifier dimensions, naturel, personnages et contacts, puis exporter. Ne pas utiliser la clé Poly Pizza publiée dans le prompt historique : la remplacer et la fournir par canal sécurisé.

Livrables preuves : rapport par unité avec inputHash/ressource/native IDs, liste appels fournisseurs, captures cut/contact, ffprobe ou outil équivalent sur MP4 si disponible, build et runner tests, liste des limites. Éviter données confidentielles dans rapports.

## 5. Définition de terminé

Une fonctionnalité terminée possède schéma, commande, owner, UI, persistance, reprise, erreurs et tests adaptés. Un bouton qui écrit seulement un statut, une doc de contrat sans endpoint ou une ressource reçue mais jamais installée ne satisfait pas cette définition.

Le dossier de specs ne vaut pas approbation de tous les choix d’implémentation : si un agent découvre une contrainte réelle contradictoire, il documente l’écart et propose un ajustement ciblé avant d’étendre le périmètre.

