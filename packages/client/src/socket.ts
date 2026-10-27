import type { PlayerView } from '@gof/engine';
import { useCallback, useEffect, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import type { ChatMessage, ClientToServerEvents, Look, RoomView, ServerToClientEvents, Session } from '../../server/src/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SESSION_KEY = 'gof-session';
const SEAT_KEY = 'gof-seat';
const NAME_KEY = 'gof-name';
const LOOK_KEY = 'gof-look';
const BROWSER_KEY = 'gof-browser';
const ADMIN_KEY = 'gof-admin';

// Le siège est gardé par onglet (sessionStorage) : un rechargement reprend la même place.
// Il est aussi retenu pour tout le navigateur (localStorage) : après avoir fermé l'onglet,
// revenir sur le site rend la place, sauf si elle est encore ouverte dans un autre onglet.
function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function readStorage(kind: 'local' | 'session', key: string): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(kind: 'local' | 'session', key: string, value: string | null) {
  try {
    if (value === null) storage(kind)?.removeItem(key);
    else storage(kind)?.setItem(key, value);
  } catch {
    // Stockage indisponible : on se passe de la reconnexion automatique.
  }
}

/**
 * Identifiant du navigateur, commun à tous ses onglets : le serveur refuse qu'il prenne deux sièges d'un même salon.
 * L'admin ouvre une fois le site avec « ?admin=sa-clé » : la clé est retenue et lève cette limite pour tester seul.
 */
function connectionAuth() {
  let browser = readStorage('local', BROWSER_KEY);
  if (!browser) {
    browser = crypto.randomUUID();
    writeStorage('local', BROWSER_KEY, browser);
  }
  const url = new URL(window.location.href);
  const admin = url.searchParams.get('admin');
  if (admin !== null) {
    writeStorage('local', ADMIN_KEY, admin || null);
    url.searchParams.delete('admin');
    window.history.replaceState(null, '', url);
  }
  return { browser, admin: readStorage('local', ADMIN_KEY) ?? undefined };
}

export const socket: GameSocket = io({ autoConnect: true, auth: connectionAuth() });

export const savedName = () => readStorage('local', NAME_KEY) ?? '';
export const saveName = (name: string) => writeStorage('local', NAME_KEY, name);

/** Avatar et couleur choisis, retenus pour tout le navigateur comme le pseudo. */
export function savedLook(): Look {
  try {
    return JSON.parse(readStorage('local', LOOK_KEY) ?? '{}');
  } catch {
    return {};
  }
}
export const saveLook = (look: Look) => writeStorage('local', LOOK_KEY, JSON.stringify(look));

function readSession(kind: 'local' | 'session', key: string): Session | null {
  try {
    return JSON.parse(readStorage(kind, key) ?? 'null');
  } catch {
    return null;
  }
}

/** Oublie la place retenue pour le navigateur si c'est bien celle-ci. */
function forgetSeat(s: Session | null) {
  const seat = readSession('local', SEAT_KEY);
  if (s && seat?.token === s.token) writeStorage('local', SEAT_KEY, null);
}

/** État de connexion, salon et partie, avec reprise automatique du siège après un rechargement. */
export function useGameConnection() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<PlayerView | null>(null);
  // Le chat ne vit que dans la page : rien n'est gardé, ni ici après un départ, ni sur le serveur.
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const remember = useCallback((s: Session | null) => {
    if (!s) forgetSeat(readSession('session', SESSION_KEY));
    setSession(s);
    writeStorage('session', SESSION_KEY, s ? JSON.stringify(s) : null);
    if (s && !s.spectator) writeStorage('local', SEAT_KEY, JSON.stringify(s));
    if (!s) {
      setRoom(null);
      setGame(null);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    const rejoin = async () => {
      setConnected(true);
      const saved = readSession('session', SESSION_KEY);
      if (saved) {
        const result = saved.spectator
          ? await socket.emitWithAck('room:watch', { code: saved.code })
          : await socket.emitWithAck('room:rejoin', { code: saved.code, token: saved.token });
        if (!result.ok) forgetSeat(saved);
        remember(result.ok ? saved : null);
        return;
      }
      // Nouvel onglet : reprendre la place laissée en fermant l'onglet, si elle est libre.
      const seat = readSession('local', SEAT_KEY);
      if (!seat) return;
      const result = await socket.emitWithAck('room:rejoin', { code: seat.code, token: seat.token, onlyIfFree: true });
      if (result.ok) remember(seat);
      else if (result.error !== 'seatTaken') forgetSeat(seat);
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', rejoin);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', setRoom);
    socket.on('game:state', setGame);
    const onMessage = (m: ChatMessage) => setMessages((list) => [...list.slice(-99), m]);
    socket.on('chat:message', onMessage);
    if (socket.connected) void rejoin();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', setRoom);
      socket.off('game:state', setGame);
      socket.off('chat:message', onMessage);
    };
  }, [remember]);

  return { connected, session, room, game, messages, remember };
}
