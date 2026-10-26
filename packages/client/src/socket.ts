import type { PlayerView } from '@gof/engine';
import { useCallback, useEffect, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import type { ClientToServerEvents, RoomView, ServerToClientEvents, Session } from '../../server/src/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SESSION_KEY = 'gof-session';
const NAME_KEY = 'gof-name';

export const socket: GameSocket = io({ autoConnect: true });

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée) : on se passe de la reconnexion automatique.
  }
}

export const savedName = () => readStorage(NAME_KEY) ?? '';
export const saveName = (name: string) => writeStorage(NAME_KEY, name);

function readSession(): Session | null {
  try {
    return JSON.parse(readStorage(SESSION_KEY) ?? 'null');
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
    writeStorage(SESSION_KEY, s ? JSON.stringify(s) : null);
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
