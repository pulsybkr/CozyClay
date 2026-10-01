# 01 — Architecture et modèle de données

## 1. Contraintes du dépôt qui orientent l’architecture

- src/commands/index.js enregistre les actions du studio. Ajouter des commandes ici, plutôt qu’un chemin d’écriture réservé au panneau de production.
- src/app-context.js compose les domaines et leurs historiques. Les documents éditables doivent être possédés par un domaine.
- src/command-bus.js protège les installations par hôte, révision, domaine et cible. Un changement de scène pendant un job peut rendre sa publication périmée.
- src/domains/scenes.js sauvegarde la scène active avant changement. Les commandes de scène attendent afterRender ; la scène suivante doit être prête avant les commandes suivantes.
- src/domains/motion.js possède aujourd’hui une prise active et sa source complète par personnage. Des clips indépendants ne sont pas encore un montage multiclips.
- src/motion/generation.js limite les prompts à 500 caractères, les blocs à cinq secondes, et les trajectoires à 32 points. La préparation doit respecter ces bornes.
- src/studio-agent-protocol.js borne les reçus à 8 Kio. Ne pas retourner un projet complet dans un reçu.
- src/studio-app-binding.js expose déjà les conventions : mètres, +Y, yaw zéro vers +Z, yaw positif vers +X, 24 fps, bornes exclusives.
- src/project.js et src/scenes.js utilisent tous deux la version 4. Une extension persistante doit être migrée et testée.

## 2. Trois couches et une seule vérité par couche

~~~text
Application distante
  └─ export narratif immuable, revision + hash
       ↓ HTTP via sidecar local
Snapshot source local
  └─ source sans transformations destructrices
       ↓ normalisation puis adaptation contrôlée
ProductionDocument
  ├─ plan 3D accepté, bindings, séquence et artefacts
  └─ commandes du bus → domaines scenes/objects/cast/shot/motion
       ↓ lecture et renderer existants
Scènes natives + prises composées
  └─ prévisualisation et MP4 3D
~~~

Le journal d’exécution ne possède jamais les objets, les personnages ou les shots. Il décrit la progression et les tentatives. Le plan accepté ne contient pas une deuxième copie modifiable de leurs transforms : il conserve l’intention et le lien vers les entités natives.

Les divergences entre intention et scène doivent être affichées. Une modification manuelle de l’objet natif ne doit pas être automatiquement écrasée parce que le plan initial disait autre chose.

## 3. Schéma persistant proposé

Types ci-dessous descriptifs ; le projet est en JavaScript. Implémenter des validateurs partagés, pas une migration implicite vers TypeScript.

~~~ts
type ProductionDocument = {
  version: 1;
  productionId: string;       // UUID local stable
  source: {
    connectionId: string;     // référence publique, jamais une clé
    projectId: string;
    revision: string;
    manifestHash: string;
    fetchedSections: Record<string, SectionSnapshot>;
  };
  planRevision: number;
  plan: {
    fps: 24;
    aspect: "9:16" | "16:9";
    frameCount: number;
    units: ProductionUnit[];
    sequence: SequenceEntry[];
    events: NarrativeEvent[];
    decisions: Decision[];
  };
  bindings: Record<string, EntityBinding>;
  artifacts: Record<string, ArtifactRef>;
  overrides: LocalOverride[];
  executionCheckpoint: PortableCheckpoint;
};

type SectionSnapshot = {
  section: "characters" | "sets" | "scenes" | "shots" | "actions" | "narration";
  revision: string;
  hash: string;
  items: unknown[];           // validés par variante avant stockage
};

type ProductionUnit = {
  id: string;                 // stable, p.ex. decor:ENV_01
  kind: "scene" | "structure" | "asset" | "avatar" | "cast-instance"
      | "shot" | "motion-clip" | "motion-compose"
      | "expressions" | "interaction" | "verify" | "export";
  sourceRefs: string[];
  sceneId: string | null;     // identifiant narratif, avant binding
  dependsOn: string[];
  inputHash: string;          // hash d’entrées normalisées effectives
  payload: object;            // schéma discriminé par kind
  review: "ready" | "needs-input" | "unsupported";
};

type EntityBinding = {
  sourceId: string;
  nativeSceneId: string;
  nativeEntityId: string;
  nativeKind: "scene" | "object" | "character" | "shot" | "camera";
  installedInputHash: string;
  observedProjectionHash: string;
};

type ArtifactRef = {
  kind: "vrm" | "mesh" | "motion";
  resourceId: string;         // ID de ressource natif, fondé sur le contenu
  provider: string;
  externalJobId: string | null;
  inputHash: string;
  metadata: object;          // cadence, taille, licence selon kind
};

type SequenceEntry = {
  shotId: string;             // narratif
  sceneId: string;            // occurrence de scène, pas seulement décor
  globalStartFrame: number;
  globalEndFrameExclusive: number;
  sceneStartFrame: number;
  nativeShotId: string | null;
};
~~~

Les IDs source sont conservés dans les bindings, même si les IDs natifs sont générés par le studio. Ne pas utiliser un nom d’affichage comme clé de reprise.

Limites V1 : durée maximale 1 200 s, 28 800 frames, 32 personnages narratifs, 32 occurrences de scènes, 256 plans ; 8 MiB de snapshot narratif cumulé hors binaires. Une dépassement donne une erreur avant mutations. Ne pas tronquer silencieusement pour entrer dans le contexte de l’agent.

## 4. Décor et occurrence de scène

Un décor est un modèle de lieu réutilisable : bureau, couloir. Une occurrence de scène représente un intervalle narratif continu qui utilise ce décor.

Exemple : bureau → couloir → bureau après une ellipse. Deux occurrences distinctes de bureau partagent les ressources de mobilier et les avatars ; elles ont des états et timelines indépendants.

V1 : une scène native pour chaque occurrence, créée depuis un template de décor ou par duplication contrôlée. Les objets de scène ont leurs propres IDs. Les assets binaires sont partagés. Cette décision simplifie la conversion vers les timelines locales existantes.

Plusieurs plans dans une même occurrence utilisent la même scène native et la même prise continue. Une simple coupe caméra ne crée pas une nouvelle scène.

## 5. Journal d’exécution distinct

Ajouter src/production/run-store.js : IndexedDB cozyclay-production-v1, magasins runs, attempts, events, snapshots. La source narrative incluse dans le projet reste lisible hors connexion ; le cache IndexedDB est un accélérateur et un journal, pas l’unique stockage portable.

~~~ts
type UnitRun = {
  productionId: string;
  unitId: string;
  inputHash: string;
  status: "pending" | "blocked" | "ready" | "running"
      | "waiting-provider" | "artifact-ready" | "installing"
      | "verified" | "done" | "failed" | "uncertain" | "stale";
  attemptId: string | null;
  externalJobId: string | null;
  artifactId: string | null;
  receiptId: string | null;   // preuve session, peut expirer
  lastError: {code: string; message: string; retryable: boolean} | null;
};

type PortableCheckpoint = {
  savedAt: string;
  units: Array<{
    unitId: string; inputHash: string; status: string;
    artifactId: string | null; externalJobId: string | null;
    installedProjectionHash: string | null;
  }>;
};
~~~

Ne pas inclure les clés API, cookies, URLs signées temporaires ou tokens de confirmation dans le fichier portable. Les IDs de job externes sont des références fonctionnelles, pas des autorisations.

Un reçu d’historique n’est pas éternel. Après réouverture, la preuve d’installation vient des bindings, des hashes de ressources et de la projection native, pas de canUndo d’un ancien reçu.

## 6. Domaine production et modifications natives

Ajouter src/domains/production.js, créé une seule fois au niveau projet ; ne pas le recharger lors de chaque scene.switch. Il possède ProductionDocument via createDocumentStore et s’enregistre dans appContext sous production.

Exposer read(), writePlan(), patchBindings(), artifactReferences(), setSourceSnapshot(), exportPortable(), loadPortable(), dispose(). Les méthodes d’écriture sont appelées par les commandes production.* sous l’autorité du bus.

Le journal d’exécution passe par run-store et n’ajoute pas une entrée d’annulation par message de progression. Les modifications acceptées du plan, les overrides et les installations natives sont annulables.

Pour installer une unité, composer l’écriture native et son binding dans une même action via appContext.beginAction. Ajouter le domaine production à la composition avant commit. Ne pas ouvrir une transaction globale pendant un appel réseau : préparer d’abord, puis effectuer le commit court.

Le metadata nativeInstalled indique un résultat observable, pas une promesse du scheduler. Après undo, invalidateBindingsAgainstScene() passe l’unité en stale si le natif a disparu ou changé.

## 7. Persistance projet et migrations

Modifier :

- src/project.js : PROJECT_VERSION 5 ; paramètre production de createProjectDocument ; lecture/validation et sortie production de readProjectDocument ; migration v4 → production: null.
- src/domains/scenes.js : projectDocumentInput inclut production ; collectProjectSerialized inclut tous ses assets et mouvements référencés, même si pas encore installés dans une scène ; restore appelle production.loadPortable.
- src/project-resources.js : collecter les ressources de production.artifacts, clips et avatars réutilisables ; publier leurs statuts embedded/external/missing.
- src/scene-assets.js : referencedAssetIds inclut avatars et modèles référencés par production si cette fonction accepte le projet ; sinon ajouter referencedProductionAssetIds dans production/resources.js et unir les sets dans collectProjectSerialized.
- src/scenes.js : SCENES_VERSION 5 au lot multiclips/interactions ; migration v4 ajoutant layer.motionClips: [] et object.interactionTrack: null. Ne pas incrémenter cette version pour le seul panneau de connexion.
- src/production/resources.js, nouveau : collecte dédupliquée des références et validation des IDs.

Préserver les limites de ressources du projet. La production n’embarque pas un MP4 dans le JSON du projet. Une source NPZ utilisée par plusieurs clips n’est enregistrée qu’une fois. Les archives externes volumineuses sont un lot ultérieur ; en V1 dépasser la limite est signalé avant « projet sauvegardé ».

## 8. Fichiers à ajouter

| Fichier | Responsabilité |
| --- | --- |
| src/production/source-contract.js | Validation du contrat narratif canonique et limites |
| src/production/source-adapters.js | Adaptation explicite de versions/legacy connus |
| src/production/plan-contract.js | Validation des payloads d’unités et décisions |
| src/production/normalize.js | Conversion temps/IDs, références et canonicalisation |
| src/production/compiler.js | Création du graphe d’unités, pas d’effets de bord |
| src/production/fingerprint.js | Hash déterministe des entrées, projection et graphe |
| src/production/run-store.js | Journal IndexedDB et index d’idempotence |
| src/production/controller.js | Orchestration et progression |
| src/production/reconcile.js | Révisions source, état natif et conflits |
| src/domains/production.js | Propriétaire du document de production |
| src/commands/production.js | Surface de commandes commune UI/agent |
| src/panels/ProductionPanel.jsx | Parcours utilisateur par étapes |
| src/production/production.css | Styles du panneau, utilisant les tokens existants |

Les noms exacts sont à conserver pour éviter que chaque sous-agent crée sa propre architecture. Une modification de ce découpage doit être intégrée dans cette spec avant d’étendre le périmètre.

## 9. Contrôles de base

Tests nouveaux : test/verify-production-contract.mjs, verify-production-compiler.mjs, verify-production-project.mjs et test/bus/verify-production-owner.mjs.

Vérifier : import déterministe ; cycles et références absentes refusés ; un champ source non pris en charge conservé ou signalé ; réouverture sans réseau ; source IDs inchangés ; ressources encore non installées sauvegardées ; changement de scène sans perte du domaine production ; undo installation rendant le binding périmé.

Ces tests s’inscrivent dans tools/run-tests.mjs. Réutiliser les fixtures et conventions bus existantes ; ne pas créer un deuxième journal d’historique.

