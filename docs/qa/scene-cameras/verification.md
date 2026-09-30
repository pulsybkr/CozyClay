# Vérifications

- Compilation Vite : réussie.
- Sampler des caméras nommées : réussi (coupes, horloge locale, découpe, détachement, persistance).
- Commandes des caméras et plage d’export via le bus réel : 3 tests réussis.
- Commandes existantes des plans : 7 tests réussis, avec parité UI/agent/MCP/CLI.
- Liaison agent/éditeur : 51 cas réussis dans la suite générale.
- Chrome : création depuis l’interface, affectation et édition par l’agent, travelling, coupe, réouverture du projet, export MP4 ; voir `result.json` et `library.png`.

La suite générale `node tools/run-tests.mjs` n’est pas entièrement verte sur cet environnement Windows. Échecs observés hors de la fonctionnalité caméra : `mcp/verify-import-mesh.mjs` attend `/tmp/stove.glb` au lieu du chemin Windows normalisé ; un test MCP construit `C:\C:\...\mcp` ; un test de modèles retourne `UNKNOWN_MODEL` pour `openai-codex/gpt-5.4`. Ces limites ne sont pas masquées par les vérifications ciblées.
