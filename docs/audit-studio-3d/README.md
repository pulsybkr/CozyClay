# Audit du studio vidéo 3D

Audit du 1er octobre 2026. État initial : `6a58215`, avec modifications locales préexistantes. Des travaux concurrents ont ensuite ajouté `c00a502` et `11eb442` ; leurs effets sur la documentation sont signalés dans le rapport. Aucun code applicatif corrigé par cet audit.

Le studio possède des briques utiles et plusieurs tests ciblés passent, mais le parcours demandé — importer un récit, construire les décors, coordonner les personnages, monter les plans et livrer une vidéo cohérente — ne peut pas être considéré comme livré et validé.

## Documents

- [Audit détaillé et preuves](01-audit.md) : couverture de la demande, défauts confirmés, limites et résultats de vérification.
- [Spécifications de correction](02-specifications.md) : comportement attendu, priorités et critères d’acceptation, sans code.
- [Contrat avec le workflow source et recette](03-contrat-et-recette.md) : données à échanger et scénarios de validation du parcours complet.
- [Spécifications techniques de développement](../specs-studio-3d-technique/README.md) : fichiers précis, contrats API, orchestration, réalisation 3D, missions et adaptation du dépôt distant inspecté.
- [Vérification des vagues 1–4 et recette avant vague 5](04-verification-vagues-1-4.md) : état réinspecté, blocages reproduits et tests manuels/automatiques à effectuer.
- [Contre-vérification après corrections](05-contre-verification-corrections.md) : corrections confirmées, sondes rejouées et problèmes restants.

## Priorités

1. Corriger les proportions et le placement des modèles téléchargés, les licences mal reconnues et les échanges de résultats trop volumineux.
2. Livrer un import de récit versionné et une orchestration reprenable des générations par personnage et par séquence.
3. Préserver les horodatages narratifs lors des corrections de rythme ; ajouter des interactions datées.
4. Valider l’ensemble dans une vraie vidéo exportée, puis traiter les bonus.

La compilation a réussi. Douze fichiers de tests ciblés sur quatorze ont réussi ; les deux autres ont des échecs détaillés dans l’audit. La suite complète n’a pas produit de bilan final exploitable. Les deux pages d’exemple n’étaient pas accessibles avec l’outil de consultation utilisé : aucune comparaison visuelle avec ces projets n’est prétendue.

- [Corrections locales et recette du 1 octobre 2026](06-corrections-locales-et-recette.md) : changements implémentés, preuves de tests et blocages restant avant la vague 5.
