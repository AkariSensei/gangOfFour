import type { IncomingMessage } from 'node:http';

/** Garde-fous contre ceux qui ouvriraient des salons ou des connexions à la chaîne. */
export interface Limits {
  /** Nombre maximal de salons ouverts en même temps sur le serveur. */
  maxRooms: number;
  /** Salons qu'une même adresse IP peut créer par fenêtre de `windowMs`. */
  roomsPerIp: number;
  /** Salons qu'une même connexion peut créer par fenêtre de `windowMs`. */
  roomsPerSocket: number;
  /** Connexions ouvertes en même temps depuis une même adresse IP (un bureau partage souvent la sienne). */
  socketsPerIp: number;
  /** Nouvelles connexions acceptées depuis une même adresse IP par fenêtre de `windowMs`. */
  connectionsPerIp: number;
  windowMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxRooms: 60,
  roomsPerIp: 12,
  roomsPerSocket: 3,
  socketsPerIp: 40,
  connectionsPerIp: 80,
  windowMs: 5 * 60 * 1000,
};

/** Compte des événements par clé sur une fenêtre glissante. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Vrai si l'événement est accepté (et il est alors compté), faux si la clé a dépassé sa limite. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/**
 * Adresse IP du joueur. Derrière le proxy d'alwaysdata, la connexion vient du proxy : la vraie adresse est la
 * dernière ajoutée à X-Forwarded-For (les précédentes viennent du client et peuvent être inventées).
 */
export function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map((s) => s.trim());
  return list.filter(Boolean).pop() ?? request.socket.remoteAddress ?? 'inconnue';
}
