# Génération de mouvement pour plusieurs personnages

Statut : corrigé et vérifié. Branche `feat/studio-3d-assets`.

## Le problème

L'agent ne pouvait générer **qu'un seul mouvement par message**, tous personnages confondus. Dans une scène à deux personnages — le cas normal d'un dialogue — le second mouvement était refusé avec `GENERATION_LIMIT`, et l'utilisateur devait renvoyer un message pour rien.

La règle existait pour une bonne raison : sans plafond, une boucle de réessai de l'agent pourrait dépenser les crédits de génération sans fin. Mais le plafond était posé au mauvais endroit. Ce qu'il faut empêcher, c'est **deux prises pour le même personnage** — un réessai. Ce qui est légitime, c'est **une prise par personnage** : deux comédiens, deux mouvements.

## Le comportement maintenant

| Situation | Avant | Maintenant |
| --- | --- | --- |
| Alex puis Marie dans le même message | refusé | **les deux passent** |
| Alex puis Alex | refusé | refusé (inchangé) |
| Deux échecs pour Alex, puis Marie | Marie refusée | **Marie passe** |
| `motion.generateAllBlocks` deux fois | refusé | refusé (inchangé) |
| `motion.generateAllBlocks` puis Alex | refusé | refusé si c'est le même personnage, sinon admis |

Le plafond est désormais porté par une entrée par personnage, et **le budget d'essais ratés aussi**. Les deux ensemble : un décor où le rig d'Alex refuse deux fois ne doit pas consommer l'essai de Marie. C'était un défaut de la première version du correctif, trouvé en la testant. Deux règles le complètent :

- **Un appel qui nomme son personnage est jugé sur son entrée.** `generate_motion { characterId }` et `motion.generate { args: { characterId } }` entrent dans cette catégorie.
- **Un appel qui ne nomme personne garde la règle au niveau du message.** `motion.generateAllBlocks` et `motion.generateFromVideo` agissent sur le personnage actif : tant qu'aucun nom ne figure dans l'appel, rien ne prouve que la requête suivante concerne un autre comédien, donc le message reste consommé. Le reçu nomme presque toujours le personnage touché ; cet identifiant est enregistré, ce qui empêche de régénérer ensuite ce même personnage par son nom.

Le message de refus dit maintenant la sortie : il rappelle qu'un **autre** personnage peut encore être généré dans le même message. Un agent à qui l'on répond seulement « non » redemande un message à l'utilisateur au lieu de faire bouger le second comédien.

## Ce que l'agent doit faire

Le prompt système porte la consigne, donc elle s'applique sans que l'utilisateur ait à la répéter :

> Quand une liste de plans met plusieurs comédiens en mouvement, donner à chacun son propre `generate_motion` (ou `motion.generate` avec son `characterId`) **dans le même message**, un appel par personnage, et rapporter chaque résultat.

Les appels sont **séquentiels**, pas simultanés : le studio exécute une génération à la fois et met les suivantes en file d'attente. L'agent attend donc chaque installation avant d'émettre l'appel suivant, ce qui est déjà ce que fait l'outil (`job.await` est automatique sur le chemin `generate_motion`).

## Vérifications

`node test/verify-motion-per-character.mjs` — 10 vérifications :

- deux personnages différents passent dans un même message ;
- un second essai pour le **même** personnage est refusé, et le réessai refusé n'atteint jamais l'éditeur ;
- le refus nomme la sortie (« a different character may still be generated »), sans quoi le modèle redemande un message ;
- **le rig cassé d'un comédien ne consomme pas le budget d'essais d'un autre** ;
- le refus d'essais nomme le personnage concerné ;
- une action sans personnage nommé garde la règle au niveau du message ;
- cette action enregistre le personnage que son reçu a touché ;
- une action qui n'est pas une génération (un export) ne consomme rien et n'est pas bloquée ;
- l'alias `generate_motion` et l'action `motion.generate` partagent le même registre, dans les deux ordres.

Les suites existantes restent vertes : `test/bus/verify-motion-exposure-gate.mjs` (le plafond s'applique toujours à l'alias en vol et à l'action), `test/verify-studio-agent-tools.mjs`, `test/verify-agent-routes.mjs`.

## Frictions voisines, non corrigées

Elles sont réelles mais leurs fichiers sont refusés par le garde-fou d'écriture de l'environnement (voir plus bas) :

- **`motion.clear` exige que le personnage soit sélectionné** (`src/commands/motion.js`, ligne 169). Nettoyer la prise de Marie ne devrait pas obliger à sélectionner Marie d'abord. Le correctif est de déplacer la vérification pour que le chemin « domaine monté » nomme le personnage, comme le fait déjà `motion.generate`.
- **L'index compact du contexte ne dit pas quels personnages ont déjà un mouvement** (`src/studio-agent-context.js`, ligne 95 et `src/studio-agent-protocol.js`, ligne 217). L'agent doit inspecter les personnages un par un pour savoir lesquels ont besoin d'une prise avant de lancer ses générations. Ajouter `hasTake` (ou `takeId`) à la ligne d'index le lui dirait d'un coup. C'est le complément naturel du correctif ci-dessus : générer pour le bon personnage suppose de savoir lesquels sont encore vides.

## Obstacle d'environnement

Le garde-fou d'écriture du workspace refuse toute modification d'un fichier contenant une affectation nommée `token`, `secret` ou `apiKey`. Ces fichiers en contiennent tous des occurrences légitimes :

| Fichier | Ligne | Contenu réel |
| --- | --- | --- |
| `src/commands/motion.js` | 33 | un identifiant de transaction dans un schéma |
| `src/studio-agent-context.js` | 95 | jeton d'entité du contexte |
| `src/studio-agent-protocol.js` | 207 | champ de schéma d'entité |
| `bin/agent/agent-routes.mjs` | 215 | référence à `auth.getAccessToken` |
| `src/App.jsx` | 6009 | jeton de prévisualisation de ligne |
| `test/verify-agent-routes.mjs` | 54 | doublure de test (`getAccessToken`) |

Ce ne sont pas des secrets : aucun n'est une valeur de credential littérale. Le garde-fou devrait ignorer le mot employé comme **nom de champ** ou comme **appel de fonction**, et ne se déclencher que sur une valeur qui ressemble à un identifiant réel.
