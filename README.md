# Gang of Four

Version web du jeu de cartes Gang of Four, jouable en ligne entre collègues (4 joueurs, chacun sur son poste).

## Organisation

Un seul dépôt, en plusieurs paquets npm (workspaces) :

- `packages/engine` : le moteur de jeu en TypeScript pur (cartes, combinaisons, tours, scores), sans interface.
- `packages/server` : serveur Node.js + Socket.IO qui fait autorité sur la partie (salons, actions, reconnexion).
- `packages/client` : interface React + TypeScript (Vite).

## Commandes

```bash
npm install
npm run dev       # serveur + interface : ouvre http://localhost:5173 dans plusieurs onglets ou navigateurs
npm test          # tests de tous les paquets
npm run typecheck # vérification des types
npm run demo      # partie complète entre 4 joueurs automatiques via le serveur (npm run demo -- 3 pour 3 joueurs)
npm run dev:server # serveur en mode développement sur http://localhost:3001
npm run build && npm start # version de production (dossier dist) : le serveur sert aussi l'interface sur http://localhost:3001
```

Mise en ligne : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

Les parties terminées sont enregistrées dans `data/parties.json` (chemin modifiable avec `DATA_FILE`) et alimentent le classement du bureau affiché sur l'accueil.

## Serveur

Le client se connecte en Socket.IO. Toutes les commandes répondent par un accusé `{ ok: true }` ou `{ ok: false, error }`, et le serveur diffuse ensuite `room:state` (le salon) et `game:state` (la vue de la partie propre à chaque joueur, sans les mains des autres). Les types sont dans `packages/server/src/protocol.ts`.

- Comptes : pour jouer, il faut se connecter avec Google. `account:google { credential }` vérifie le jeton du bouton Google et renvoie une session signée, que le navigateur renvoie à chaque connexion (`auth.session`). `account:get`, `account:update { name, avatar, color }` (pseudo unique), `account:signOut`. L'admin (`ADMIN_EMAIL`) a `admin:accounts` et `admin:update { id, name?, blocked? }`, et peut tenir plusieurs sièges d'un salon pour tester seul.
- `room:create`, `room:join { code }` : prennent le pseudo et l'avatar du compte, et renvoient `{ code, playerId, token }`. Le salon a un code de 4 lettres et accueille 3 ou 4 joueurs, un siège par compte.
- `room:rejoin { code, token }` : reprendre son siège après une déconnexion (le client garde le jeton).
- `room:leave`, `game:start` (hôte uniquement), `game:play { cardIds }`, `game:pass`, `game:giveCard { cardId }`, `game:nextRound`.

Un salon dont tous les joueurs sont déconnectés est supprimé après 10 minutes. Variables d'environnement : `PORT` et `IP` (fournies par alwaysData), `CORS_ORIGIN` (origines autorisées, séparées par des virgules), `GOOGLE_CLIENT_ID` (client OAuth « Application Web » de la console Google Cloud, avec le site en origine JavaScript autorisée), `ADMIN_EMAIL` (adresse Google de l'admin). Les comptes sont gardés dans `data/comptes.json` (`ACCOUNTS_FILE`).

Classement : il suit les comptes. Les parties jouées avant les comptes reviennent au premier compte qui prend le même pseudo (ou que l'admin renomme ainsi).

## Règles implémentées dans le moteur

Conformes au livret officiel (Days of Wonder).

- 64 cartes : 1 à 10 en vert, jaune et rouge (deux exemplaires de chaque), le 1 multicolore, le phénix vert, le phénix jaune et le dragon rouge. Ordre des couleurs : vert < jaune < rouge ; le 1 multicolore est le plus fort des 1.
- 3 ou 4 joueurs, 16 cartes chacun. À 3, les 16 cartes restantes forment une main morte qui n'est pas jouée.
- Donne : le paquet n'est mélangé qu'une fois, en début de partie. Ensuite, comme dans le jeu réel, on ramasse les cartes, le donneur coupe le paquet où il veut (il clique entre deux cartes) et son voisin de gauche (nouveau donneur) distribue une carte à la fois en commençant par sa gauche.
- Première manche : le détenteur du 1 multicolore ouvre avec une combinaison qui le contient. À 3, si ce 1 est dans la main morte, le voisin du donneur ouvre. Manches suivantes : le gagnant de la manche précédente ouvre.
- Le sens de jeu s'inverse à chaque manche (horaire pour la première).
- Combinaisons : carte seule, paire (dont la paire de phénix), brelan, et cinq cartes (suite < couleur < full < quinte flush). Le 1 multicolore prend la couleur voulue dans une couleur ou une quinte flush. Les phénix peuvent servir de paire dans un full, mais jamais dans une suite, une couleur ou une quinte flush. Le dragon se joue seul.
- À valeur égale, la couleur la plus forte décide, puis la suivante en cas d'égalité : une paire de 10 rouge + jaune bat une paire de 10 rouge + vert. Une suite se départage par la couleur de sa plus haute carte, puis des suivantes.
- Un « gang » (4 à 7 cartes de même valeur) bat toute autre combinaison ; un gang plus long bat un gang plus court, à longueur égale la valeur décide.
- On ne peut pas poser une combinaison identique à celle sur la table. Passer est toujours permis, mais un joueur qui a passé ne rejoue plus jusqu'à la fin du pli. Quand tous les autres ont passé, le dernier à avoir posé ouvre un nouveau pli.
- « Carte ! » : annoncé automatiquement par l'application. Le joueur qui précède un joueur n'ayant plus qu'une carte doit ouvrir avec une combinaison s'il le peut, et toute carte seule qu'il joue doit être sa plus forte.
- Fin de manche : chaque carte restante coûte 1 point (1 à 7 cartes), x2 (8 à 10), x3 (11 à 13), x4 (14 à 15), et 16 cartes valent 80 points.
- Échange entre manches : le perdant (le plus de cartes restantes ; à égalité le plus gros score total, puis le plus proche du gagnant dans le sens antihoraire) donne sa meilleure carte au gagnant, qui lui rend une carte de son choix. Les deux cartes sont montrées à tous.
- La partie s'arrête quand un joueur atteint 100 points ; le score le plus bas gagne.
