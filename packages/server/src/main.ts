import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server';

// alwaysData fournit IP et PORT ; en local, on écoute sur 3001.
const port = Number(process.env.PORT ?? 3001);
const host = process.env.IP ?? '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'];

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Le serveur tourne soit compilé (dist/serveur/index.js, en production), soit depuis les sources
// (packages/server/src/main.ts). Dans les deux cas, l'interface compilée est dans dist/client à la racine.
const compiled = existsSync(here('../client/index.html'));
const clientDist = compiled ? here('../client') : here('../../../dist/client');
const staticDir = existsSync(clientDist) ? clientDist : undefined;

// L'historique des parties est gardé hors du code, dans data/ à la racine du projet (modifiable via DATA_FILE).
const historyFile = process.env.DATA_FILE ?? here(compiled ? '../../data/parties.json' : '../../../data/parties.json');

// Les salons en cours sont enregistrés à côté, pour survivre à un redémarrage (mise à jour du site par exemple).
const roomsFile = process.env.ROOMS_FILE ?? join(dirname(historyFile), 'salons.json');

// Les erreurs sont notées à côté, une par ligne : la surveillance GitHub les relève et ouvre une issue.
const errorsFile = process.env.ERRORS_FILE ?? join(dirname(historyFile), 'erreurs.jsonl');

// Clé de l'admin (variable d'environnement ADMIN_KEY, jamais dans le code) : il peut tenir plusieurs sièges pour tester.
const adminKey = process.env.ADMIN_KEY || undefined;

const { http, saveRooms, errors } = createGameServer({ corsOrigin, staticDir, historyFile, roomsFile, errorsFile, adminKey });

// Filet de sécurité : une erreur imprévue est notée dans le journal mais n'arrête plus le serveur (et les parties).
process.on('uncaughtException', (error) => errors.record('erreur non rattrapée', error));
process.on('unhandledRejection', (error) => errors.record('promesse rejetée', error));

// alwaysData arrête le serveur avec SIGTERM avant de le relancer : on enregistre les salons juste avant.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    saveRooms();
    process.exit(0);
  });
}

http.listen(port, host, () => {
  console.log(`Serveur Gang of Four sur http://${host}:${port}`);
  console.log(staticDir ? `Interface servie depuis ${staticDir}` : 'Interface non compilée : utilise « npm run dev » pour le développement.');
});
