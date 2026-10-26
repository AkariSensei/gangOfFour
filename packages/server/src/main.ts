import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server';

// alwaysData fournit IP et PORT ; en local, on écoute sur 3001.
const port = Number(process.env.PORT ?? 3001);
const host = process.env.IP ?? '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'];

// En production, le serveur sert aussi l'interface compilée par « npm run build ».
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
const staticDir = existsSync(clientDist) ? clientDist : undefined;

// L'historique des parties est gardé hors du code, dans data/ à la racine du projet (modifiable via DATA_FILE).
const historyFile = process.env.DATA_FILE ?? fileURLToPath(new URL('../../../data/parties.json', import.meta.url));

const { http } = createGameServer({ corsOrigin, staticDir, historyFile });
http.listen(port, host, () => {
  console.log(`Serveur Gang of Four sur http://${host}:${port}`);
  console.log(staticDir ? `Interface servie depuis ${staticDir}` : 'Interface non compilée : utilise « npm run dev » pour le développement.');
});
