import { createGameServer } from './server';

// alwaysData fournit IP et PORT ; en local, on écoute sur 3001.
const port = Number(process.env.PORT ?? 3001);
const host = process.env.IP ?? '0.0.0.0';
const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'];

const { http } = createGameServer({ corsOrigin });
http.listen(port, host, () => console.log(`Serveur Gang of Four sur http://${host}:${port}`));
