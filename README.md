# Gang of Four

Version web du jeu de cartes Gang of Four, jouable en ligne entre collègues (4 joueurs, chacun sur son poste).

## Organisation

Un seul dépôt, en plusieurs paquets npm (workspaces) :

- `packages/engine` : le moteur de jeu en TypeScript pur (cartes, combinaisons, tours, scores), sans interface.
- `packages/server` *(à venir)* : serveur Node.js + Socket.IO qui fait autorité sur la partie.
- `packages/client` *(à venir)* : interface React + TypeScript.

## Commandes

```bash
npm install
npm test          # tests de tous les paquets
npm run typecheck # vérification des types
```

## Règles implémentées dans le moteur

- 64 cartes : 1 à 10 en vert, jaune et rouge (deux exemplaires de chaque), le 1 multicolore, le phénix vert, le phénix jaune et le dragon rouge. Ordre des couleurs : vert < jaune < rouge.
- 4 joueurs, 16 cartes chacun. Le détenteur du 1 multicolore ouvre la partie avec un coup qui le contient.
- Combinaisons : carte seule, paire (dont la paire de phénix), brelan, et cinq cartes (suite < couleur < full < quinte flush). Le 1 multicolore remplace n'importe quelle couleur. Phénix et dragon ne vont pas dans les combinaisons de cinq cartes.
- Un « gang » (4 à 7 cartes de même valeur) bat toute autre combinaison ; un gang plus long bat un gang plus court, à longueur égale la valeur décide.
- On peut passer puis rejouer plus tard dans le même pli. Quand tous les autres ont passé, le dernier à avoir posé ouvre un nouveau pli.
- Si le joueur suivant n'a plus qu'une carte, on ne peut jouer une carte seule que si c'est sa plus forte.
- Fin de manche : chaque carte restante coûte 1 point (1 à 7 cartes), x2 (8 à 10), x3 (11 à 13), x4 (14 à 15), x5 (16).
- Manches suivantes : le perdant donne sa meilleure carte au gagnant, qui lui rend une carte de son choix. Le perdant ouvre la manche (réglable).
- La partie s'arrête quand un joueur atteint 100 points ; le score le plus bas gagne.
