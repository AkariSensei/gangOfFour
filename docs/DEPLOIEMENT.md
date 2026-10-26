# Mettre le jeu en ligne sur alwaysData

Le serveur Node sert à la fois le jeu (Socket.IO) et l'interface : il n'y a qu'une seule application à déployer.
`npm run build` produit tout dans le dossier `dist` (environ 1 Mo) :

- `dist/client` : l'interface compilée ;
- `dist/serveur/main.js` : le serveur en un seul fichier, qui emporte ses bibliothèques.

L'hébergement n'a donc besoin ni de `node_modules` ni du code source : l'offre gratuite d'alwaysData suffit largement.

Une fois réglé, **chaque fusion sur `main` met le jeu en ligne toute seule** (comme pour le blackjack).

## 1. Le compte alwaysData

Un compte alwaysData par jeu : depuis ton profil, ajoute un compte (offre **Free**) nommé par exemple `gangoffour`.
Son nom donne l'adresse du jeu : `https://gangoffour.alwaysdata.net`. Dans la suite, remplace `gangoffour` par le nom choisi.

Règle le mot de passe SSH dans **Accès distant → SSH** si ce n'est pas déjà fait.

## 2. Créer le site

Menu **Web → Sites → Ajouter un site** :

| Champ | Valeur |
| --- | --- |
| Adresses | `gangoffour.alwaysdata.net` |
| Type | **Node.js** |
| Commande | `node dist/serveur/main.js` |
| Répertoire de travail | `gangoffour` |
| Version de Node.js | 22 (ou plus récente) |

alwaysData donne lui-même l'adresse et le port d'écoute (variables `IP` et `PORT`) : rien d'autre à régler.
Le site ne répondra qu'après le premier envoi du jeu (étape 4).

## 3. Brancher GitHub (une seule fois)

Sur GitHub, dépôt gangOfFour → **Settings → Secrets and variables → Actions** :

- onglet **Variables** → **New repository variable** :
  - `ALWAYSDATA_COMPTE` : le nom du compte alwaysData (par exemple `gangoffour`).
- onglet **Secrets** → **New repository secret** :
  - `ALWAYSDATA_SSH_PASSWORD` : le mot de passe SSH du compte ;
  - `ALWAYSDATA_API_KEY` : une clé d'API alwaysData, créée dans **Profil → Gestion des tokens** (sans restriction
    d'adresse IP). La clé déjà utilisée pour le blackjack marche aussi si les deux comptes sont dans le même profil.

## 4. Premier envoi

Onglet **Actions → CI → Run workflow** sur `main`. Le job `deploiement` construit le jeu, l'envoie dans
`~/gangoffour/dist` sur alwaysData et redémarre le site. Ouvre ensuite `https://gangoffour.alwaysdata.net`.

## Mettre à jour

Rien à faire : à chaque fusion sur `main`, les tests tournent, puis le job `deploiement` remet le jeu en ligne.
Sans la variable et les deux secrets, le job affiche juste un avertissement et ne met rien en ligne.

**À la main** (si GitHub est en panne) : `npm ci && npm run build` sur ton PC, envoie le dossier `dist` par SFTP
dans `gangoffour/` (en remplaçant l'ancien), puis **Web → Sites → Redémarrer**.

## Bon à savoir

- Les parties en cours sont recopiées dans `~/gangoffour/data/salons.json` : après une mise à jour ou un plantage,
  le serveur les recharge et les joueurs reprennent leur place tout seuls (la page se reconnecte en quelques secondes).
- Les parties terminées sont enregistrées dans `~/gangoffour/data/parties.json` (le classement du bureau).
  Une mise à jour ne remplace que `dist` : le classement est conservé.
- Un salon dont tous les joueurs sont partis est supprimé au bout de 10 minutes.
- **Journaux** : dossier `admin/logs/sites` (en SFTP) ou **Web → Sites → Journaux**. Au démarrage, le serveur écrit
  « Interface servie depuis … » si l'interface a bien été trouvée.
- Si l'interface et le serveur sont un jour séparés sur deux adresses, ajoute `CORS_ORIGIN=https://adresse-de-l-interface`
  dans l'environnement du site.
