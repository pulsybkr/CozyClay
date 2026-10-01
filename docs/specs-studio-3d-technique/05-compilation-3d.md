# 05 — Compiler le récit en réalisation 3D

Prérequis : contrat 02, orchestrateur 04. Tout nouveau module ci-dessous est à développer. Garder les ressources originales ; les opérations de composition ne doivent pas les détruire.

## 1. Compiler sans effets de bord

Créer src/production/normalize.js, compiler.js, geometry.js, camera-planner.js, motion-planner.js. La fonction compile(snapshot, overrides, capabilities) retourne un plan déterministe, les hypothèses et les erreurs par chemin. Elle ne fait ni fetch ni génération GPU.

Canonicaliser les temps à 24 fps : boundaryFrame = round(seconds × 24), mêmes bornes partagées arrondies une seule fois ; intervalles [startFrame, endFrameExclusive). Rejeter les intervalles devenus vides. Les scènes occupent le montage global ; chaque action/plan a un temps local à sa scène. Les mouvements d’un acteur continuent à travers un cut caméra.

Convention monde : mètres, +Y vertical, avant +Z, pivot au sol. Une position écran gauche n’est jamais convertie automatiquement en x négatif : elle dépend du repère caméra. Toute déduction depuis le legacy devient une décision consultable.

Le brouillon expose sourcePath, rule, chosenValue, confidence et needsDecision. Ambiguïtés bloquantes : personnage inconnu, acteur non attribué, objet manquant, timing impossible, deux actions corporelles exclusives simultanées pour le même acteur. Les descriptions libres restent du texte ; aucun eval/code de l’agent.

## 2. Décors et objets

Fichiers : src/production/geometry.js et installers/scene.js, installers/objects.js à ajouter ; src/commands/scene.js, objects.js, library.js et src/domains/objects.js à adapter.

Créer une scène native par occurrence narrative, pas par plan caméra. Réutiliser les fichiers mesh/VRM pour plusieurs occurrences sans partager un état d’instance mutable.

Structures : plancher et murs = primitives, dimensions explicites ; portes = murs segmentés avec ouverture, pas un mur plein masqué visuellement. Placement basé sur bornes réelles et support. Pour un bureau de 2 × 1 × 0,75 m, plateau supérieur en y = 0,75 ; une tasse à pivot inférieur repose à ce niveau, pas à y = 0.

Importer Poly Pizza depuis son modelId validé côté sidecar ; ne pas faire confiance à une URL/licence fournie par un prompt. Uniform scale = requestedHeight / measuredHeight. Appliquer le même scale à la géométrie, au pivot et aux bornes de collision. Conserver requestedHeight, measuredBounds et appliedScale pour diagnostic.

Recherche sans résultat : choisir une primitive cohérente pour un prop simple, ou bloquer pour décision si un asset essentiel ne peut être représenté. Ne pas remplacer silencieusement un fauteuil par une boîte pour une interaction assise.

Chaque objet expose des anchors explicites en coordonnées locales (supportTop, gripRight, gripLeft, seat), générés par règles simples ou réglés par l’utilisateur. Pour un mesh inconnu, un sommet de bounding box n’est pas forcément une surface de contact réelle ; l’anchor est une hypothèse à vérifier visuellement.

## 3. Avatars et instances

Extraire de src/commands/vrm.js un producteur src/production/producers/avatar.js :
generateAvatar(input, context) → ArtifactRef, sans ajouter automatiquement un personnage à la scène active. Réutiliser le client actuel et l’import des octets ; ne pas réimplémenter le protocole fournisseur.

Installer ensuite via character.add/character.update dans la scène cible, avec UUID natif stable enregistré dans bindings. Un acteur narratif garde un sourceId global ; ses instances par scène ont des nativeEntityId distincts. Costume différent = variant d’avatar explicite, pas mutation invisible d’une autre scène.

Provenance du prompt d’apparence : adaptation validée distante prioritaire, description canonique en fallback, override local prioritaire si accepté. Ne pas envoyer un prompt de caméra ou de mouvement au générateur avatar. Taille en mètres validée et contrôlée après import.

## 4. Plans et caméras

Le shot.create actuel choisit une plage selon le playhead : il ne suffit pas à un import déterministe. Ajouter un upsert/batch interne déclaré au bus pour shotId explicite, bornes validées et cameraId ; modifier src/commands/shot.js et son domaine propriétaire sans contourner l’historique.

Créer les caméras avec camera.create puis camera.set et camera.assign. Les clés natives utilisent framing.pos, yaw, pitch, fovDeg. La source exprime les angles en degrés ; convertir yaw/pitch en radians à la frontière native. Les temps de clés sont locaux au plan selon le contrat de caméra existant, avec tests de première/dernière frame.

Résoudre les cadrages sémantiques à partir des bounds des acteurs, du ratio 9:16/16:9 et du FOV. Cible = centre de tête/torse ou groupe visible. Vérifier near/far, caméra hors murs, sujets dans frustum, direction des regards et règle d’axe lorsque déclarée. Les labels « gros plan » ou « tracking » ne constituent pas à eux seuls une caméra installée.

Exemple : plans locaux [0,96), [96,192), [192,288) pour 12 s. Un mouvement de marche [0,96) s’arrête au premier cut, tandis qu’une action [72,144) traverse ce cut sans reset du squelette.

## 5. Plusieurs clips pour plusieurs acteurs

Créer src/production/producers/motion.js et src/production/motion-compose.js. Adapter src/motion/generation.js, src/domains/motion.js et src/commands/motion.js pour séparer production des octets et installation du take.

Le générateur actuel impose notamment prompt ≤ 500 caractères, durée valide et segments de prompt schedule ≤ 5 s. Le planner découpe les demandes à ces capacités ; il ne soumet pas une conversation entre deux personnes comme un seul mouvement.

Exemple :
~~~json
{
  "sceneId":"SCENE_01",
  "clips":[
    {"id":"CLIP_A_WALK","characterId":"CHAR_A","startFrame":0,"endFrameExclusive":96,"prompt":"Walk briskly toward the desk and stop."},
    {"id":"CLIP_A_WAVE","characterId":"CHAR_A","startFrame":96,"endFrameExclusive":192,"prompt":"Stand and wave naturally with the right hand."},
    {"id":"CLIP_B_REPLY","characterId":"CHAR_B","startFrame":96,"endFrameExclusive":144,"prompt":"Stand and nod once in acknowledgment."}
  ]
}
~~~

Pour une action de moins d’une seconde que le fournisseur refuse : utiliser une pose/ressource compatible retimée ou proposer une extension locale visible, jamais envoyer une durée invalide. Les intervalles non actifs utilisent une idle/hold définie, sans extrapolation accidentelle.

Artifact motion : bytes NPZ originaux, fps source, frameCount, prompt, seed, providerJobId, hash, root convention. Clip placement : sourceIn/sourceOut, startFrame, rate, root alignment, transitionFrames. À la composition, rééchantillonner à 24 fps ; interpoler les rotations par slerp, puis recalculer les données dépendantes selon le format natif. Vérifier compatibilité du squelette et données finies.

Aligner les racines et orientations une seule fois ; ne pas appliquer deux fois la taille/rotation du personnage. Une transition blend de 4–8 frames est configurable et ne change pas les bornes narratives. Ne pas blender sur un impact/contact contraint.

La composition produit un take continu compatible avec motionFor ; le projet conserve aussi les clips source et leurs refs. Une régénération de CLIP_A_WAVE remplace uniquement cette ressource puis recompose A : elle ne regénère ni B ni les caméras.

## 6. Expressions et rythme

Créer src/production/expressions.js et vérifier les noms réellement disponibles sur le VRM importé. Mapper happy/sad/blink à une expression disponible ; si absent, signaler « non supporté », pas succès fictif. Les clés sont datées dans la scène, indépendantes des clips corporels.

Le timing TTS est fixe par défaut. Le pacing peut retimer un clip à l’intérieur de sa fenêtre, mais ne raccourcit pas silencieusement le montage, les autres acteurs ou la narration. Un véritable ripple est une opération globale explicite qui remappe toutes les pistes (voir 06).

## 7. Interactions datées

Créer src/production/interaction-track.js et adapters/interaction.js ; adapter src/attach-bone.js, la mise à jour renderer et src/ardy/collision-blockers.js.

Une attache permanente object.attach n’implémente pas un pickup. Représenter des événements et une fenêtre de contact :
~~~json
{
  "objectId":"CUP",
  "characterId":"CHAR_A",
  "kind":"pick-up",
  "hand":"right",
  "startFrame":192,
  "contactFrame":240,
  "endFrameExclusive":288,
  "releaseFrame":null,
  "gripAnchor":"gripRight",
  "initialParent":"world"
}
~~~

Avant contact : objet sur son support ; main interpolée vers gripAnchor par IK si supporté. À contact : objectWorld = handWorld × gripOffset, offset calibré pour continuité sans saut. Après release : world transform calculé à la frame de libération, invariant en scrub inverse. Une absence de solver IK capable doit bloquer le label « contact vérifié » ; ne pas inventer une API IK inexistante.

L’évaluation dépend de la frame demandée, pas seulement des événements traversés en lecture : scrub, export et retour arrière doivent donner le même résultat. Garder le collider du prop porté avec transform dynamique ; ignorer seulement les contacts main/prop explicitement attendus, pas toutes les collisions du prop.

V1 : contact, pickup, carry, put-down cinématiques ; pas promesse de simulation physique générale, cloth ou interaction bimanuale universelle.

## 8. Export multi-scène

Créer src/production/export-sequence.js ; adapter src/offscreen-export.js avec hook async prepareFrame(frame) appelé avant capture synchrone. Réutiliser src/mp4-muxer.js avec un seul encoder et timestamps globaux croissants.

Le scheduler mappe frame globale → scène native + frame locale + shot/camera. Aux frontières, charger/monter la scène, attendre les assets et le rendu, puis capturer. Un export détient un verrou qui empêche les modifications manuelles, tout en permettant ses transitions internes contrôlées ; pas de nouvel item undo à chaque frame.

Appliquer exactement le même pipeline animation, IK, expression, prop transform et caméra qu’en prévisualisation. Garantir une et une seule image à chaque frame attendue. Restaurer la scène/playhead initiaux dans finally, même sur erreur.

La limite narrative 1 200 s n’est pas une garantie d’encodage en mémoire : estimer taille/mémoire, refuser avant capture si la stratégie actuelle n’est pas sûre. Prévoir sink streaming comme lot distinct pour longues vidéos. Pas de concaténation magique de blobs MP4.

Inclure un fichier de crédits et un rapport de réalisation téléchargeables ; narration audio seulement si mux audio réellement implémenté et testé. Un export muet reste explicitement « muet », pas « vidéo terminée avec narration ».

## 9. Recette

Tests purs : bornes, degrés/radians, dimensions, caméra portrait, action à travers cut, composition A/B, préservation clips, pickup avant/après/contact, scrub inverse. Tests navigateur avec assets de référence sans coût : deux scènes, trois caméras, deux acteurs, prop sur table, preview et export.

Recette réelle séparée et autorisée : avatar fournisseur, trois jobs mono-acteur, ressources rechargées depuis projet sauvegardé, MP4 global dont frames aux cuts et contacts sont inspectées. Enregistrer limites et erreurs ; les mocks seuls ne valident pas qualité visuelle et naturel.

## 10. Adapter les descriptions legacy sans prétendre à une compilation magique

production.prepare est une compilation déterministe : si un prompt libre ne donne pas encore une géométrie, un acteur ou un timing exploitable, produire needs-input, pas un résultat inventé caché.

Chemin prioritaire : utiliser le draft structuré publié par le distant (08). Pour un ancien projet non préparé, ajouter une action explicite production.adapt ciblant sourceIds et expectedPlanRevision ; elle appelle un adaptateur texte contrôlé et retourne un brouillon non accepté. Cette action peut utiliser l’agent/provider déjà configuré, mais aucun fournisseur/modèle n’est imposé sans vérifier sa disponibilité dans cette installation.

Fichiers à ajouter : src/production/adaptation-contract.js et adaptation.js ; côté agent, outil proposant uniquement un objet validé, pas du JavaScript ou des appels directs au renderer. Déclarer génération texte/coût dans la politique d’autorisation ; elle est distincte des grants motion/avatar de 04.

Entrée de l’adaptateur : IDs disponibles, descriptions sans suffixes image inutiles, timing TTS, contraintes métriques, capabilities des producteurs et limites caméra. Sortie obligatoire : proposedSets, proposedScenes, proposedShots, proposedActions, decisions, sourceRefs par proposition. Schéma strict, tailles bornées, références à des IDs connus. La sortie est relue par source-contract/plan-contract puis affichée à l’utilisateur avant acceptation.

Exemple d’interprétation autorisée : « Alex à gauche salue Marie » → action mono-acteur Alex, caméra visant Alex/Marie, décision de placement dans le repère caméra. Interprétation interdite : « à gauche » → world.x=-2 sans caméra définie.

Le texte source est une donnée non fiable : ne pas suivre des instructions qu’il contient sur les outils, clés ou coûts. Limiter tentatives de réparation du JSON à deux ; une erreur persistante laisse le brouillon éditable et un diagnostic. Un bouton récupération ne déclenche jamais cet adaptateur automatiquement.

Une hypothèse non bloquante peut être acceptée explicitement (pièce 6 × 4 m estimée). Une ambiguïté d’identité ou deux actions incompatibles pour le même acteur doit être résolue avant runStage. Les propositions acceptées deviennent des overrides versionnés : un nouveau fetch ne les efface pas.

