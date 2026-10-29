import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { constants, brotliCompressSync, gzipSync } from 'node:zlib';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Fichiers texte qu'on envoie compressés ; les images (webp, png) le sont déjà. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

type Encoding = 'br' | 'gzip';

/** Meilleure compression acceptée par le navigateur (brotli, sinon gzip), ou aucune. */
function encodingFor(req: IncomingMessage): Encoding | null {
  const accepted = String(req.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

/**
 * Versions compressées des fichiers, faites une seule fois par fichier (et refaites s'il change) : les fichiers de
 * l'interface ne changent qu'à la mise à jour du site, et compresser à chaque visite gaspillerait le processeur.
 */
const compressed = new Map<string, { mtimeMs: number; br: Buffer; gzip: Buffer }>();

async function compressedFile(file: string, mtimeMs: number, encoding: Encoding): Promise<Buffer> {
  let entry = compressed.get(file);
  if (entry?.mtimeMs !== mtimeMs) {
    const content = await readFile(file);
    entry = {
      mtimeMs,
      br: brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 10 } }),
      gzip: gzipSync(content, { level: 9 }),
    };
    compressed.set(file, entry);
  }
  return entry[encoding];
}

/** Durée de cache : les fichiers de Vite ont un nom unique par version, les cartes changent rarement. */
function cacheControl(path: string): string {
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/cards/')) return 'public, max-age=604800';
  return 'no-cache';
}

/**
 * En-têtes de sécurité : le site ne peut pas être affiché dans un cadre d'un autre site (clics piégés), le
 * navigateur ne devine pas le type des fichiers, et seuls les scripts du site lui-même (et celui du bouton Google) peuvent s'exécuter.
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // Le bouton Google a besoin de connaître l'origine du site (pas le reste de l'adresse) et de charger son script.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "script-src 'self' https://accounts.google.com/gsi/client; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

/** Sert l'interface compilée (dist/client), avec index.html pour toute route inconnue. */
export function createStaticHandler(rootDir: string) {
  const root = resolve(rootDir);

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS).end();
      return;
    }
    // Une adresse mal encodée (« %E0 » seul par exemple) ferait échouer le décodage : on la refuse proprement.
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, SECURITY_HEADERS).end();
      return;
    }
    let path = urlPath === '/' ? '/index.html' : urlPath;
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, SECURITY_HEADERS).end();
      return;
    }

    let info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      path = '/index.html';
      file = join(root, path);
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404, SECURITY_HEADERS).end('Interface introuvable : lance « npm run build ».');
        return;
      }
    }

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(path),
    };
    const encoding = COMPRESSIBLE.has(extname(file)) ? encodingFor(req) : null;
    if (encoding) {
      const body = await compressedFile(file, info.mtimeMs, encoding);
      res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length, Vary: 'Accept-Encoding' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size, ...(COMPRESSIBLE.has(extname(file)) ? { Vary: 'Accept-Encoding' } : {}) });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
