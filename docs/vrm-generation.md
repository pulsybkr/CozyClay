# Générer des personnages avec Atelier

Dans l’espace **Scene**, ouvrez **Générer un personnage VRM** dans l’inspecteur. Donnez un nom et une description de l’apparence : coiffure, tenue, couleurs, silhouette. Le bouton lance `POST /api/v1/jobs/text-to-vrm`, suit le job, télécharge le VRM terminé et ajoute un nouveau personnage.

Le panneau affiche les états et pourcentages renvoyés par Atelier et conserve les vingt derniers jobs dans ce navigateur. **Reprendre le suivi et ajouter** suit le même job après une interruption. **Ajouter ce VRM à la scène** réimporte un résultat terminé ; cette action peut créer une autre instance.

Les fichiers sont stockés dans IndexedDB et incorporés au `.cclayproject`. Une réouverture du projet utilise ces fichiers, sans retélécharger le modèle sur Atelier. Son identifiant de modèle `vrm-mesh-…` est réutilisable dans ce projet. Le rendu utilise le même runtime VRM que Sakura, avec les animations Kimodo et les expressions disponibles sur l’avatar.

## Demande à l’agent

> Génère avec Atelier deux nouveaux personnages VRM et ajoute-les à la scène actuelle. Le premier s’appelle Lina : cheveux bruns courts, yeux verts, veste bleue et pantalon beige. Le second s’appelle Noé : cheveux noirs, yeux marron, t-shirt rouge et pantalon noir. Génère-les successivement avec leurs descriptions distinctes, suis chaque job jusqu’à son import, puis place-les à deux mètres l’un de l’autre. Vérifie que les deux avatars sont chargés et indique leurs expressions disponibles. Ne génère pas encore de mouvement corporel.

Actions disponibles :

- `character.generateVrm` : nom, description, genre/auteur/modèle Ollama optionnels, placement `{x,z,rot}` optionnel. Génère puis importe.
- `character.importVrmJob` : `jobId` Atelier, nom et placement optionnel. Suit/import le résultat sans soumettre une nouvelle génération.
- `vrm.jobs` : historique local, identifiants Atelier, progression et résultat de l’import.
- `vrm.status` : état actuel d’un job auprès d’Atelier.

Le branchement de l’agent attend automatiquement la réception finale de l’import VRM. Un appel brut à l’éditeur peut répondre `started` avec un UUID de job **CozyClay** : seul `job.await` doit recevoir ce UUID. `vrm.jobs` donne l’identifiant **Atelier**, commençant par `job_`, nécessaire à `vrm.status` et à une reprise. Un UUID CozyClay est refusé avant tout appel HTTP vers Atelier. L’import terminé est annulable avec sa réception. Les demandes de plusieurs avatars se font successivement ; elles ne consomment pas la limite des générations de mouvements corporels.

## Configuration

En développement, Vite relaie `/vrm-api` vers `http://127.0.0.1:8765`. Aucune configuration supplémentaire n’est nécessaire sur cette machine. Une autre adresse peut être renseignée dans `.env` :

```dotenv
CCLAY_VRM_API_URL=http://127.0.0.1:8765
```

Redémarrer le serveur après modification. Pour un déploiement statique, exposer le même relais `/vrm-api`, ou définir `VITE_CCLAY_VRM_API_URL` lors de la compilation avec une API autorisant les requêtes du navigateur.

## Reprise et limites

- Le suivi automatique dure au maximum cinq minutes par commande. Après un délai dépassé, une fermeture de page ou un changement de scène, reprendre le job existant avec `character.importVrmJob`.
- L’API n’expose pas d’annulation distante : `job.cancel` arrête le suivi/import local, mais Atelier peut continuer la génération. Aucun avatar n’est ajouté si la scène ou le casting a changé pendant le travail.
- Le résultat doit être un GLB 2 contenant un humanoïde VRM, de taille maximale 32 MiB. Un fichier invalide ne crée pas de personnage.
- Les possibilités de style dépendent du catalogue VRoid et du moteur Atelier. Le studio transmet la description et rapporte les erreurs.
- `test/verify-vrm-generation.mjs` vérifie le contrat, la reprise, les échecs, l’annulation et l’incorporation au projet. `test/qa-vrm-generation.mjs` vérifie une génération réelle dans Chrome, deux avatars chargés, les expressions, l’annulation de l’import et la réouverture.
