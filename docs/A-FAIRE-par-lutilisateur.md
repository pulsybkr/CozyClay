# Modifications à appliquer à la main

Document opérationnel. Branche `feat/studio-3d-assets`. Écrit le 1er octobre 2026.

Chaque modification donne : le fichier, la ligne, le texte **exact** à chercher, le texte de remplacement, et la vérification qui prouve que c'est fait. Les tests correspondants existent déjà dans le dépôt : lance-les après coup, ils te diront si c'est bon.

## Pourquoi ces modifications ne sont pas faites

Le contrôle d'écriture de l'environnement refuse toute écriture dans un fichier contenant une affectation nommée `token`, `secret` ou `apiKey`. Ces six fichiers en contiennent tous des occurrences **légitimes** (jetons générés à l'exécution, champs de schéma, doublures de test). Ce n'est pas un secret : aucun n'est une valeur d'identifiant réelle. Le passage en mode normal n'a pas suffi.

C'est aussi la raison pour laquelle deux choses restent à faire plus bas (§7) : leurs fichiers de destination sont `bin/agent/agent-routes.mjs` et `src/App.jsx`, tous deux bloqués.

---

## 1. `motion.clear` doit accepter un personnage non sélectionné

**Fichier** : `src/commands/motion.js`, ligne 165-173.

**Le problème** : nettoyer la prise de Marie oblige à sélectionner Marie d'abord. Dans une scène à plusieurs comédiens, l'agent ne peut pas ranger une prise sans changer ce que l'utilisateur regarde. `motion.generate`, lui, accepte déjà un `characterId` quelconque — c'est exactement la situation bloquante que le verrou de génération par personnage a corrigée, restée ici.

**À chercher** (texte exact, l'indentation est une tabulation) :

```js
	registry.register({ ...clear, available: () => Boolean(ports.storeDomain?.('motion')) || typeof ports.clearMotionNative === 'function' || 'The motion owner is not mounted.',
		run({ characterId }) {
			if (ports.storeDomain?.('motion')) { characterOf(ports, characterId); owner().clear(characterId); }
			else {
				if (ports.state().activeCharacterId !== characterId) fail('TARGET_NOT_READY', 'Select this character before clearing its take.');
				ports.clearMotionNative();
			}
			return { affectedIds: [characterId], summary: 'Cleared motion.' };
		} });
```

**À remplacer par** :

```js
	registry.register({ ...clear, available: () => Boolean(ports.storeDomain?.('motion')) || typeof ports.clearMotionNative === 'function' || 'The motion owner is not mounted.',
		run({ characterId }) {
			characterOf(ports, characterId);
			// The native path clears whatever the editor is SHOWING, so it can only
			// clear the character the editor is showing. The mounted domain owns the
			// whole cast's layers and clears the one named, whichever is selected —
			// in a scene with several performers, "clear Marie's take" must not
			// require selecting Marie first.
			if (ports.storeDomain?.('motion')) owner().clear(characterId);
			else {
				if (ports.state().activeCharacterId !== characterId) fail('TARGET_NOT_READY', 'Select this character before clearing its take.');
				ports.clearMotionNative();
			}
			return { affectedIds: [characterId], summary: 'Cleared motion.' };
		} });
```

**Vérification** : `node test/bus/verify-motion-exposure-gate.mjs`, puis `node test/verify-studio-agent-tools.mjs`. Les deux couvrent l'admission des commandes de mouvement.

---

## 2. L'agent doit voir quels personnages ont déjà un mouvement

**Fichiers** : `src/studio-agent-context.js` ligne 80, et `src/studio-agent-protocol.js` ligne 217.

**Le problème** : l'index compact du contexte liste chaque entité avec son `id`, son `kind`, son `name` et sa `position` — mais pas si elle a un mouvement. Pour savoir lesquels doivent être générés, l'agent doit inspecter les personnages **un par un**. C'est le complément direct du correctif « une génération par personnage » : générer pour le bon personnage suppose de savoir lesquels sont vides.

**Étape 2a — le schéma d'abord** (`src/studio-agent-protocol.js`, ligne 217). À chercher :

```js
const indexRow = object({ id, kind: choices(["object", "character", "rig"]) }, { name, position: vec3 });
```

À remplacer par :

```js
// `hasMotion` is on the COMPACT row on purpose: it is the one fact that decides
// whether a character still needs a generation, and answering it from the
// entity index saves the agent a detail read per performer.
const indexRow = object({ id, kind: choices(["object", "character", "rig"]) }, { name, position: vec3, hasMotion: bool });
```

**Étape 2b — la valeur** (`src/studio-agent-context.js`, ligne 80). À chercher :

```js
	const indexRow = e => ({ id: e.id, kind: e.kind, ...(e.name ? { name: [...e.name].slice(0, 60).join("") } : {}),
		...(e.position ? { position: { x: cm(e.position.x), y: cm(e.position.y), z: cm(e.position.z) } } : {}) });
```

À remplacer par :

```js
	const indexRow = e => ({ id: e.id, kind: e.kind, ...(e.name ? { name: [...e.name].slice(0, 60).join("") } : {}),
		...(e.position ? { position: { x: cm(e.position.x), y: cm(e.position.y), z: cm(e.position.z) } } : {}),
		// Only a character can carry a take; an object or a rig row must not
		// claim `false` as if it had been measured.
		...(e.kind === "character" ? { hasMotion: (e.motion?.takeId ?? null) !== null || (e.motion?.frames ?? 0) > 0 } : {}) });
```

**Vérification** : `node test/verify-studio-agent-protocol.mjs` puis `node test/verify-studio-agent-tools.mjs`. Le second a un cas nommé `context-entity-index` qui épingle la forme des lignes ; s'il râle, c'est que la ligne a changé de forme et il faut lire son attendu.

---

## 3. Monter le geste de placement dans l'étagère

**Fichier** : `src/App.jsx`, ligne 8157-8158.

**Le problème** : ce n'est **pas** un blocage, c'est un finissage. Le panneau 3D **est déjà monté** dans l'étagère (`src/asset-pane.jsx` ligne 455 : `<AssetLibraryPane onPlaced={onLibraryPlaced} />`). Il ne manque que la prop `onLibraryPlaced` côté App, qui sert à sélectionner l'objet téléchargé et à le signaler. Sans elle, le modèle se place correctement mais reste non sélectionné : l'utilisateur doit le retrouver dans la hiérarchie.

**À chercher** :

```jsx
						resourceManifest={projectManifest}
					/>
```

**À remplacer par** :

```jsx
						resourceManifest={projectManifest}
						onLibraryPlaced={(receipt, card) => {
							// A downloaded model is an ordinary object: select it so the
							// gizmo is ready, and say what arrived — the same courtesy a
							// dropped file gets.
							if (receipt?.ok === false) { setToast(receipt.message); return; }
							const objectId = receipt?.affectedIds?.[0];
							if (objectId) setSelectedHierarchyId(`object:${objectId}`);
							setToast(`${card?.title ?? "Model"} placed — type its real height in metres to set the scale`);
						}}
					/>
```

Adapte `setToast` / `setSelectedHierarchyId` aux noms réels de ton App si besoin (`setToast` existe déjà, il est utilisé ligne 6563).

**Vérification** : `npx vite build`, puis à la main : onglet Assets → section **3D LIBRARY** → chercher *chair* → cliquer une carte → le modèle apparaît dans la scène **et** dans la hiérarchie, sélectionné.

---

## 4. La bibliothèque 3D et la clé API (rappel d'installation)

Rien à modifier, mais à savoir pour que ça fonctionne :

- la clé se passe au **serveur**, jamais à un fichier : définir `POLY_PIZZA_API_KEY` dans l'environnement avant de lancer `node tools/dev-full.mjs` (ou `npx cozyclay`).
- sans clé, la recherche répond **503** avec la variable à définir. C'est le comportement voulu, pas une panne.
- la route est montée dans les deux lanceurs (`tools/dev-full.mjs` et `bin/cozyclay.mjs`) — le second était manquant, c'est corrigé.

---

## 5. Ce qui est déjà fait et n'a besoin de rien

Pour éviter de refaire ce qui existe :

| Sujet | État |
| --- | --- |
| Génération de mouvement par personnage (deux comédiens dans un même message) | fait, testé |
| Budget d'essais ratés par personnage | fait, testé |
| Prompt système et descriptions d'actions alignés sur la règle | fait |
| Bibliothèque 3D : recherche, licence, téléchargement, provenance | fait, testé |
| Panneau 3D dans l'étagère Assets | **monté**, sauf la sélection post-placement (§3) |
| Attachement d'objet sur un avatar VRM (porter une tasse) | **corrigé et vérifié** sur Sakura et CHAR 02 : 10 os d'attache sur 10 se résolvent |
| Rythme des animations : mesure + resserrage | fait, testé, branché sur les actions `motion.readPace` / `motion.tightenPace` |
| Route de la bibliothèque dans le paquet publié | corrigé, testé |

---

## 6. Vérifications à lancer après ces modifications

```powershell
node test/verify-studio-actions.mjs
node test/verify-studio-agent-protocol.mjs
node test/verify-studio-agent-tools.mjs
node test/bus/verify-motion-exposure-gate.mjs
node test/verify-attach-bone.mjs
node test/verify-pace.mjs
node test/verify-pacing-commands.mjs
node test/verify-motion-per-character.mjs
node tools/run-tests.mjs
```

Deux échecs sont **antérieurs** à ces travaux et sans rapport : `mcp/verify-import-mesh.mjs` (il attend un chemin POSIX `/tmp/...` et échoue sous Windows) et un cas de `test/verify-studio-agent-tools.mjs` (lecture de `item.content` sur une charge utile d'agent simulée). Vérifiés en remisant l'arbre de travail.

---

## 7. Ce qui reste à développer, et qui n'est pas bloqué

Ces points ne sont pas des bugs : ce sont les fonctionnalités que tu avais demandées et qui restent ouvertes.

### 7.1 Saisie réelle d'un objet (préhension)

**État** : l'objet **suit** la main depuis le correctif VRM. Ce qui manque est le **geste** : aucune action ne modèle une prise. L'IK sait déplacer une main (`character.setIkKey`, pistes `leftHand` / `rightHand`), mais il n'y a ni articulation des doigts, ni sémantique « ramasser ».

**Où intervenir** : `src/studio-actions.js` (une action `object.grasp` ou `object.pickUp`), `src/commands/objects.js` (l'implémentation), et `src/ardy/ik.js` (poser la main sur l'objet puis la fermer). Le vocabulaire des doigts existe déjà : `src/humanoid-rig.js` déclare les 15 os de doigts par main (`VRM_PHYSICS_BONES`).

**Forme suggérée** : une action qui prend `objectId` + `characterId` + `bone`, calcule la position de la poignée de l'objet, y déplace la main par IK à une frame donnée, puis applique une pose de doigts serrée. Une entrée d'historique.

### 7.2 Collision des objets portés

**État** : un objet attaché est **explicitement exclu** des collisions — `src/ardy/collision-blockers.js` ligne 129 (`if (object.attach) continue;`) et `src/ardy/ground.js` ligne 48. Un objet porté peut donc traverser le corps. C'est le comportement conçu, pas un oubli : le commentaire du module explique qu'il faudrait le graphe de scène vivant pour le résoudre.

**Où intervenir** : ces deux fichiers **ne sont pas bloqués**, tu peux les modifier directement. Le chemin prévu est de laisser l'App résoudre la frame de l'objet porté (`attachFrameMatrix`, déjà exporté par `src/app-stage.jsx`) et de la passer au calcul de collisions.

### 7.3 Voix, audio, VFX

Hors périmètre, comme tu l'as indiqué. À traiter après validation du parcours complet.

---

## 8. Si tu veux débloquer ces fichiers toi-même

Les occurrences qui déclenchent le contrôle, et leur nature réelle :

| Fichier | Ligne | Contenu réel |
| --- | --- | --- |
| `src/App.jsx` | 6009, 7422, 7446, 8252 | jetons de transaction de scène |
| `src/studio-agent-protocol.js` | 207, 240, 264, 429 | champs de schéma (`targetId`/`token` pour la garde de cible) |
| `src/studio-agent-context.js` | 95 | jeton d'entité du contexte |
| `src/commands/motion.js` | 33 | identifiant d'une édition préparée |
| `src/domains/motion.js` | 363 | `crypto.randomUUID()` |
| `bin/agent/agent-routes.mjs` | 238 | `randomBytes(32)` pour le hub local |

Un renommage neutre (`token` → `txId` ou `entityId`) les ferait tous passer, au prix d'un diff large sans valeur fonctionnelle. Le contrôle, lui, devrait ignorer le mot quand il est un **nom de champ** ou un **appel de fonction**, et ne se déclencher que sur une valeur qui ressemble à un identifiant réel.
