# Gang of Four

Jeu de cartes Gang of Four jouable en ligne entre collègues (3 ou 4 joueurs, comptes Google). Monorepo npm workspaces, TypeScript strict partout.
Le [README.md](README.md) décrit le protocole Socket.IO, les variables d'environnement et les règles implémentées : s'y référer plutôt que de les redécouvrir.

## Commandes (depuis la racine)

```bash
npm run dev        # serveur (3001) + client Vite (5173)
npm test           # Vitest sur engine et server
npm run typecheck  # tsc --noEmit dans chaque paquet
npm run build      # client puis serveur, sortie dans dist/ (le serveur sert aussi l'interface)
npm start          # lance la version construite (dist/serveur/main.js)
npm run demo       # partie complète entre bots via le serveur (npm run demo -- 3 pour 3 joueurs)
```

Avant de considérer un changement terminé : `npm run typecheck && npm test && npm run build` (c'est ce que vérifie la CI).

## Architecture

- `packages/engine` : logique de jeu pure (cartes, combinaisons, donne, tours, scores, échange), sans E/S. Toute règle du jeu vit ici et se teste ici (`test/`).
- `packages/server` : Node + Socket.IO, fait autorité sur la partie. Types du protocole partagés avec le client dans `src/protocol.ts`.
  - `server.ts` (commandes Socket.IO), `rooms.ts` (salons, sièges, bots remplaçants, pause, exclusion), `bot.ts` (IA des bots).
  - `accounts.ts` + `google.ts` : comptes Google, sessions signées, admin (`ADMIN_EMAIL`).
  - `history.ts` (parties terminées, classements), `badges.ts`, `limits.ts` (anti-abus), `errors.ts` (journal d'erreurs), `static.ts` (sert l'interface en production).
  - `scripts/` : bot de test et `demo`.
- `packages/client` : React 18 + Vite. Ne contient pas de règles du jeu : il affiche la vue (`game:state`) envoyée par le serveur. L'essentiel de la partie est dans `Table.tsx` ; les cartes sont des images dans `public/cards/`. Thème sombre uniquement, pas de sons.
- `client` et `server` dépendent de `@gof/engine` (importé directement depuis ses sources).

## Données (dossier `data/`, ignoré par git)

`parties.json` (historique, `DATA_FILE`), `comptes.json` (comptes + clé de signature des sessions, `ACCOUNTS_FILE`), `salons.json` (parties en cours rechargées au redémarrage, `ROOMS_FILE`), `erreurs.jsonl` (`ERRORS_FILE`). En production, une mise à jour ne remplace que `dist/` : ces fichiers sont conservés, donc tout changement de leur format doit rester compatible avec l'existant.

## Conventions

- Identifiants de code en anglais ; commentaires, messages de commit, docs et textes d'interface en français.
- Commits : phrase à l'infinitif, sans préfixe (ex. « Ajouter l'historique des parties ») ; le numéro de PR est ajouté à la fusion.
- `noUncheckedIndexedAccess` est actif : gérer le cas `undefined` des accès indexés plutôt que forcer avec `!`.
- Une nouvelle commande ou donnée du protocole : la typer dans `protocol.ts`, la tester dans `packages/server/test/server.test.ts` et la documenter dans le README.

## Déploiement et surveillance

Chaque fusion sur `main` avec la CI verte met le jeu en ligne sur alwaysData (`.github/workflows/ci.yml`, voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)) et redémarre le site. Une fusion sur `main` est donc une mise en production.
`.github/workflows/surveillance.yml` vérifie toutes les 15 minutes que le site répond, relève `erreurs.jsonl` et ouvre une issue GitHub en cas de problème.
