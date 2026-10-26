# Mettre le jeu en ligne sur alwaysData

Le serveur Node sert à la fois le jeu (Socket.IO) et l'interface compilée : il n'y a qu'une seule application à déployer.

## 1. Préparer le site

Dans l'administration alwaysData :

1. **Environnement → Node.js** (ou dans le formulaire du site) : choisis une version **Node.js 20 ou plus récente**.
2. **Web → Sites → Ajouter un site** :
   - **Adresses** : `ton-compte.alwaysdata.net` (ou ton domaine).
   - **Type** : **Node.js**.
   - **Commande** : `npm start`
   - **Répertoire de travail** : `gangOfFour` (le dossier cloné à l'étape 2).
   - **Environnement** (variables, une par ligne) : `NODE_ENV=production`
   - Laisse alwaysData fournir `IP` et `PORT` : le serveur les lit déjà.
3. Enregistre. Le site ne démarrera correctement qu'après l'étape 2.

## 2. Récupérer et compiler le code (en SSH)

Les accès SSH sont dans **Accès distant → SSH** (active la connexion par mot de passe si besoin). Puis :

```bash
ssh ton-compte@ssh-ton-compte.alwaysdata.net

# Le dépôt est privé : utilise un jeton GitHub (Settings → Developer settings →
# Personal access tokens → Fine-grained, accès « Contents: Read » au dépôt gangOfFour).
git clone https://<jeton>@github.com/AkariSensei/gangOfFour.git
cd gangOfFour
npm ci --include=dev
npm run build
```

`npm run build` crée `packages/client/dist`, que le serveur sert automatiquement.

## 3. Démarrer et vérifier

1. Dans **Web → Sites**, redémarre le site (icône de redémarrage).
2. Ouvre `https://ton-compte.alwaysdata.net` : l'accueil du jeu doit s'afficher.
3. En cas de souci, les journaux sont dans `~/admin/logs/sites/` (ou via **Web → Sites → Journaux**). Le serveur écrit au démarrage « Interface servie depuis … » si la compilation a bien été trouvée.

## Mettre à jour après une modification

```bash
ssh ton-compte@ssh-ton-compte.alwaysdata.net
cd gangOfFour
git pull
npm ci --include=dev
npm run build
```

Puis redémarre le site dans l'administration.

## Bon à savoir

- Les parties sont gardées en mémoire : un redémarrage du site coupe les parties en cours.
- Un salon dont tous les joueurs sont partis est supprimé au bout de 10 minutes.
- Si l'interface et le serveur sont un jour séparés sur deux adresses, ajoute `CORS_ORIGIN=https://adresse-de-l-interface` dans l'environnement du site.
