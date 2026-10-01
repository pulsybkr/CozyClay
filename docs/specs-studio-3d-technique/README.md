# Dossier technique — studio connecté à un workflow distant

Version de spécification : 1.0, 1er octobre 2026. Base inspectée : 11eb442. Les noms de fichiers nouveaux, actions nouvelles et endpoints ci-dessous sont des propositions à implémenter ; ils ne sont pas actuellement disponibles.

## Résultat attendu

Dans le studio, l’utilisateur configure la connexion une fois, saisit l’ID d’un projet distant et clique sur « Récupérer ». Il voit les décors, personnages, scènes, plans et actions récupérés. Il peut ensuite préparer et réaliser une étape à la fois, inspecter le résultat et demander une correction ciblée.

La récupération ne lance aucune génération d’avatar ou de mouvement. Une étape ne vaut pas réussite parce qu’une requête est partie : le studio distingue préparation, génération, téléchargement, installation et vérification.

## Documents à donner aux développeurs

| Document | Utilité |
| --- | --- |
| [01 — Architecture et modèle de données](01-architecture.md) | Sources de vérité, persistance, unités de production, décisions structurantes |
| [02 — API et workflow distants](02-api-workflow-distant.md) | Spécification à transmettre au développeur de l’autre application ; requêtes et exemples |
| [03 — Connexion, synchronisation et interface locale](03-connexion-et-interface.md) | Routes du sidecar, écran par ID de projet, synchronisation et conflits |
| [04 — Orchestration et commandes](04-orchestration-et-reprise.md) | Machine d’états, reprise, budget, commandes de boutons et de l’agent |
| [05 — Compilation 3D, clips et export](05-compilation-3d.md) | Traduction exécutable du récit en géométrie, avatars, plans, animation et vidéo |
| [06 — Corrections techniques issues de l’audit](06-correctifs.md) | Changements précis des défauts existants et tests de régression |
| [07 — Lots et consignes aux sous-agents](07-lots-et-recette.md) | Missions bornées, fichiers, dépendances, livrables et conditions de fusion |
| [09 — Correctifs API distante et recette](09-api-distante-corrections-et-recette.md) | Priorités actuelles, fichiers réels, contrats de publication et tests à exécuter |
| [08 — Adaptation du dépôt distant](08-adaptation-depot-distant.md) | Fichiers FastAPI réels, mapping de reproduction, préparation et publication |
| [10 — Préparation 3D par IA](10-preparation-3d-par-ia.md) | Backend, jobs, contrats, capacités, revue, régénération et recette |
| [11 — Prompts complets](11-prompts-preparation-3d.md) | Système commun et sept étapes, schémas de sortie et variables à injecter |

L’audit précédent reste la liste des problèmes et de leurs preuves : [audit](../audit-studio-3d/01-audit.md).

## Décisions retenues

- L’application distante garde la rédaction du récit, la narration horodatée et ses anciens prompts. Elle expose un export structuré versionné.
- Le studio récupère une révision figée ; il construit les assets, les scènes, les caméras et les mouvements.
- La V1 de connexion lit le projet distant. Elle ne modifie pas le scénario distant et ne publie pas de vidéo.
- L’orchestrateur tourne dans le navigateur avec un journal durable local. Le sidecar gère la connexion réseau et ses identifiants. Une fermeture de l’onglet suspend l’orchestration ; les jobs distants déjà soumis peuvent continuer.
- Une seule scène est montée dans l’éditeur. Les installations se font séquentiellement dans la scène cible avec les protections de révision du bus.
- Les clips de mouvement sont des ressources séparées. Leur composition produit une prise continue compatible avec le lecteur actuel.
- Le rendu final est calculé par le renderer 3D existant. L’export global doit pouvoir passer d’une scène locale à une autre, sans recourir à une génération vidéo IA.
- Les boutons et les demandes naturelles utilisent les mêmes commandes production.*.

## Parcours concret

1. « Récupérer » : titre, révision, inventaire et sections du projet.
2. « Préparer » : convertir les descriptions en plan 3D validé, avec les hypothèses visibles.
3. « Construire les décors » : structures, accessoires et dimensions.
4. « Créer les personnages » : choisir les avatars existants ou générer ceux demandés, puis les placer.
5. « Installer les plans » : scènes locales, fenêtres temporelles, cadrages et cuts.
6. « Animer » : clips par personnage, composition et expressions.
7. « Vérifier » : contraintes, raccords, contacts et captures.
8. « Exporter » : MP4 3D de la production et crédits.

Chaque bouton peut viser tout le projet, une scène ou une unité. « Continuer » exécute uniquement le prochain ensemble d’unités prêtes dans le mode choisi. « Pause » termine ou suspend proprement l’opération courante selon son type ; elle n’abandonne pas les résultats connus.

Exemples de demandes à l’agent : « Construis seulement le bureau », « Anime Marie dans les plans 2 et 3 », « Reprends les étapes en échec », « Montre-moi ce qui manque avant l’export ». L’agent sélectionne les unités ; il ne reconstruit pas un scénario depuis le transcript.

## Dépôt distant examiné

Le dépôt C:/Users/pulsy/Videos/workflow_gen_short_with_ia a été inspecté en lecture après réception de son chemin. Le document 08 décrit les fichiers et données FastAPI réellement utilisés par la page reproduction ; le document 02 définit la nouvelle API à implémenter. Aucune connexion réelle ni modification distante n’a été effectuée.

## Livraisons progressives

- Vague 1 : connexion par ID, contrat, récupération, plan et suivi ; consultation sans API GPU.
- Vague 2 : construction 3D, avatars et plans, avec mouvements de référence.
- Vague 3 : vrais jobs et clips multiples, synchronisation et reprise.
- Vague 4 : interactions datées, export global et recette complète.

Ne pas annoncer « génération complète de vidéo » avant la recette de la vague 4. Chaque vague doit produire un résultat utilisable et inspectable, pas seulement un ensemble de composants internes.
