# Vérifications Atelier

- Une génération réelle a été lancée avec le bouton du Studio : job `job_09dbec9169b54ade`, terminé par Atelier en 35,01 secondes, téléchargé et installé.
- Le premier essai a également chargé un autre VRM existant : les deux rigs étaient prêts, avec 14 expressions disponibles. Le test s’est ensuite arrêté parce qu’il cherchait `rigReady` au mauvais niveau de la réponse ; la lecture a été corrigée vers `capabilities.rigReady`.
- Les contrôles suivants ont réutilisé des jobs terminés pour éviter une nouvelle génération. Ils vérifient deux personnages, les expressions, l’annulation de l’import et la réouverture avec les octets VRM incorporés au projet. Voir `result.json` et `studio.png`.
- Tests du contrat VRM, des éléments Studio, des ressources de scène et du format de projet : réussis.
- Commandes du casting : 5 tests réussis, avec parité UI/agent/MCP/CLI, annulation, erreurs et révisions périmées.
- Compilation Vite : réussie.
- Régression du suivi par l’agent : attente automatique avec le UUID CozyClay, réception finale avant le deuxième avatar, révisions et identifiants de commande distincts ; les UUID sont refusés avant un appel HTTP Atelier. Vérifié par `test/verify-agent-vrm-jobs.mjs` et par le branchement réel de l’agent dans le script Chrome, sans nouvelle génération.

La vérification ne lance pas de nouveau mouvement Kimodo et ne mesure pas la fidélité artistique de la tenue par rapport au prompt. La suite générale présente les limites Windows/modèles déjà consignées dans `docs/qa/scene-cameras/verification.md`.
