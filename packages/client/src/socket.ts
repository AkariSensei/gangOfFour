import type { PlayerView } from '@gof/engine';
import { useCallback, useEffect, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import type { ClientToServerEvents, RoomView, ServerToClientEvents, Session } from '../../server/src/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SESSION_KEY = 'gof-session';
const NAME_KEY = 'gof-name';

export const socket: GameSocket = io({ autoConnect: true });

// Le siège est gardé par onglet (sessionStorage) : un rechargement reprend la même place,
// mais un nouvel onglet est un nouveau joueur. Le pseudo, lui, est retenu pour tout le navigateur.
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

export const savedName = () => readStorage('local', NAME_KEY) ?? '';
export const saveName = (name: string) => writeStorage('local', NAME_KEY, name);

function readSession(): Session | null {
  try {
    return JSON.parse(readStorage('session', SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** État de connexion, salon et partie, avec reprise automatique du siège après un rechargement. */
export function useGameConnection() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<PlayerView | null>(null);

  const remember = useCallback((s: Session | null) => {
    setSession(s);
    writeStorage('session', SESSION_KEY, s ? JSON.stringify(s) : null);
    if (!s) {
      setRoom(null);
      setGame(null);
    }
  }, []);

  useEffect(() => {
    const rejoin = async () => {
      setConnected(true);
      const saved = readSession();
      if (!saved) return;
      const result = await socket.emitWithAck('room:rejoin', { code: saved.code, token: saved.token });
      remember(result.ok ? saved : null);
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', rejoin);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', setRoom);
    socket.on('game:state', setGame);
    if (socket.connected) void rejoin();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', setRoom);
      socket.off('game:state', setGame);
    };
  }, [remember]);

  return { connected, session, room, game, remember };
}
