# 06 — Correctifs techniques préalables

Références : constats A01–A20 dans ../audit-studio-3d/01-audit.md. Vérifier l’état de la branche avant chaque correction : certaines mises à jour de documentation ont déjà eu lieu pendant l’audit. Aucun correctif applicatif n’est exécuté par ce dossier.

## C1. Import mesh : dimensions et placement — A01 à A03

Fichiers : src/commands/library.js, src/domains/objects.js, src/scene-objects.js et chargeur/renderer mesh utilisé par ces modules.

- Aligner le schéma de la commande sur heightHint réellement consommé ; remplacer hint ou fournir une migration de l’alias explicitement testée.
- Transmettre y au niveau réellement lu par le domaine ; ne pas perdre placement.y dans une reconstruction x/z/rot.
- Après uniform scaling, mettre à jour largeur/profondeur/hauteur, base offset et bounds utilisés pour collision et caméra. Le footprint téléchargé non redimensionné n’est plus la source de vérité.
- Rejeter hauteur nulle, NaN, bounds dégénérés ; ne pas extrapoler une taille de meuble depuis sa catégorie sans afficher cette hypothèse.

Test : mesh 2 m ramené à 1 m ; dimensions, pivot et collider divisés par deux ; prop y=0,75 conservé après save/open.

## C2. Licence et provenance — A04 à A06

Fichiers : src/asset-library.js, route Poly Pizza dans bin/agent, src/commands/library.js, stockage assets et export.

Remplacer le préfixe startsWith par whitelist exacte de licences supportées. CC0 et CC-BY connus peuvent être autorisés selon la politique ; CC-BY-NC, ND, SA, licence inconnue : refus ou validation explicite conforme au cas, jamais reclassifiés automatiquement comme CC-BY.

Résoudre modelId côté serveur et tirer URL, auteur, titre, source, licence de la réponse autoritative. Le client ne choisit pas une URL arbitraire avec une licence déclarée. Conserver provenance avec resource hash ; importer depuis cache doit conserver les crédits.

À l’export : liste dédupliquée des assets utilisés, attribution et lien licence. Rapport crédits manquants bloquant pour les assets qui l’exigent. Ne pas copier de clé API dans les documents ou fixtures.

Tests : les variantes NC/ND/SA ne passent pas par le cas BY ; falsification downloadUrl rejetée ; crédits présents après rouverture et export.

## C3. Recherche paginée et concurrence UI — A14 et A16

Fichiers : src/asset-library-pane.jsx, src/commands/library.js, src/asset-library.js, route recherche et formatage reçus du bus.

Supprimer l’incohérence entre 8 cartes UI, 12 résultats par défaut et schéma 20 ; retenir limite configurable mais pagination par octets en sortie agent. Réponse compacte id/name/license/author/dimensions disponibles, pas description intégrale de tous les résultats. Fournir cursor/hasMore.

À toute modification de query, y compris chaîne vide : incrémenter request generation, annuler timer et requête, ignorer toute réponse dont requestId/query ne correspondent plus. L’ancienne liste ne doit pas revenir après effacement.

Tests : saisie→effacement avant réponse, A lent/B rapide, changement filtre, résultat de 20 items longs inférieur au budget reçu avec curseur utilisable.

## C4. Téléchargement borné et annulation — A15

Fichiers : client import library, proxy Poly Pizza et helpers fetch du sidecar.

Faire traverser AbortSignal. Garder timeout actif jusqu’à lecture complète du body, pas seulement jusqu’aux headers. Lire le flux en comptant les octets avant accumulation ; rejeter si limite dépassée même sans Content-Length. Limiter redirections et origines destinations autorisées.

Tests : headers rapides/body bloqué ; réponse chunked trop grande ; annulation pendant body ; cleanup handles ; aucune installation après projet changé.

## C5. Clips multiples et gate agent — A08

Fichiers : bin/agent/studio-tools.mjs, src/commands/motion.js, src/domains/motion.js, src/studio-agent-motion.js et nouveaux modules production.

Ne pas supprimer toutes les protections anti-boucle. Ajouter l’autorisation par unité et séparer les ressources motion de l’installation (04–05). Une même personne peut avoir deux clips distincts autorisés ; répéter le même unitId/inputHash ne crée pas deux jobs.

Tests : A marche+A salue+B répond ; seuls trois jobs ; retry cache sans nouveau job ; commande libre hors grant conserve son garde-fou ; jobs réellement séquentiels selon capacités.

## C6. Pacing squelettique et idempotence — A09 et A11

Fichiers : src/ardy/pace.js, src/commands/pacing.js, src/domains/motion.js.

L’énergie doit inclure articulations/root rotations, pas seulement translation root x/z. Normaliser déplacements par taille du personnage ; utiliser seuils et fenêtres déclarés. Un salut statique actif ne doit pas devenir dead-air. Identifier séparément hold intentionnel, idle, silence et immobilité du root.

Calculer la proposition sur la composition courante, et non systématiquement fullMotionFor brut. Appliquer via mapping source/destination sauvegardé. Deux appels avec mêmes données/options rendent la seconde opération changed:false, sans écrasement d’un montage existant.

Tests : wave root immobile ; walk ; pose tenue volontaire ; montage source coupé ; deux appels identiques ; contact/impact protégé.

## C7. Remapping cohérent — A10

Fichiers : src/domains/motion.js et owners des pistes cast/camera/shot/objects ; ajouter src/production/time-map.js.

Distinguer trim mono-clip à timeline fixe d’un ripple global. Un ripple calcule un TimeMap commun puis remappe segments, IK, prompts, expressions, root waypoints, shots, camera keys, interactions, autres acteurs et narration si la politique l’autorise. Les intervalles supprimés ont une politique explicite (suppression/clip/erreur), pas clamp implicite de tout sur la même frame.

Transaction composée et undo atomique. Si un owner ne sait pas remapper sa piste, refuser la commande globale avant mutation.

Tests : deux acteurs+camera+expression+pickup ; trim local inchangé pour B ; ripple global conserve synchronisation ; undo exact ; narration fixe bloque un raccourcissement non autorisé.

## C8. Attaches et collisions — A12 et A13

Fichiers : src/attach-bone.js, renderer objets et src/ardy/collision-blockers.js.

Garder object.attach pour son usage statique mais ne pas l’étiqueter pickup. Introduire tracks datées évaluables à toute frame (05). Un prop attaché conserve un collider dynamique ; filtrer seulement les paires attendues, pas tout le prop.

Tests : frame avant contact objet table ; après contact main ; après release world ; scrub inverse ; prop porté traverse mur détecté.

## C9. Documentation et preuve de fin — A07, A17 à A20

Fichiers : docs de connexion/état chantier, src/project.js et profils workflow.

La connexion ne sera « implémentée » que lorsque les routes, commandes et UI auront été testées ensemble. Distinguer production3D des anciens générateurs image/vidéo ; ne pas annoncer leur suppression si les fonctions sont conservées. Désactiver les chemins payants image/video dans production3D sans casser les autres workflows.

La recette finale comprend source distante réelle, imports, deux acteurs, plusieurs mouvements, plusieurs scènes, sauvegarde/rouverture et MP4 inspecté. Les tests unitaires ne remplacent pas cette recette.

## Contrat de fermeture d’un correctif

Pour chaque Cn : test rouge reproductible avant fix, test vert après, tests proches, build, vérification visuelle si renderer/UI, et note de changement associée au constat audit. Ne pas masquer les échecs de tests existants en changeant leur attente sans expliquer le contrat corrigé.

