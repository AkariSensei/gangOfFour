import { useCallback, useEffect, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import type { AccountView, ChatMessage, ClientToServerEvents, GameView, RoomView, ServerToClientEvents, Session } from '../../server/src/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SESSION_KEY = 'gof-session';
const SEAT_KEY = 'gof-seat';
const ACCOUNT_KEY = 'gof-account';

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

// La session du compte (remise après la connexion Google) est envoyée à chaque connexion, reconnexions comprises.
export const socket: GameSocket = io({
  autoConnect: true,
  auth: (cb) => cb({ session: readStorage('local', ACCOUNT_KEY) ?? undefined }),
});

export interface AccountState {
  /** undefined : pas encore chargé ; null : pas connecté. */
  account: AccountView | null | undefined;
  googleClientId: string | null;
}

/** Compte du joueur : chargé à chaque connexion, mis à jour par la connexion Google, le profil ou la déconnexion. */
export function useAccount() {
  const [state, setState] = useState<AccountState>({ account: undefined, googleClientId: null });

  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('account:get');
      if (result.ok) setState({ account: result.account, googleClientId: result.googleClientId });
    };
    socket.on('connect', load);
    if (socket.connected) void load();
    return () => {
      socket.off('connect', load);
    };
  }, []);

  const setAccount = useCallback((account: AccountView | null) => setState((s) => ({ ...s, account })), []);

  const signIn = useCallback(
    async (credential: string) => {
      const result = await socket.emitWithAck('account:google', { credential });
      if (!result.ok) return result.error;
      writeStorage('local', ACCOUNT_KEY, result.session);
      setAccount(result.account);
      return null;
    },
    [setAccount],
  );

  const signOut = useCallback(async () => {
    writeStorage('local', ACCOUNT_KEY, null);
    writeStorage('local', SEAT_KEY, null);
    await socket.emitWithAck('account:signOut');
    setAccount(null);
  }, [setAccount]);

  return { ...state, setAccount, signIn, signOut };
}

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
  const [game, setGame] = useState<GameView | null>(null);
  // Le chat ne vit que dans la page : rien n'est gardé, ni ici après un départ, ni sur le serveur.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Exclu par l'hôte ou l'admin : l'accueil le dit. */
  const [kicked, setKicked] = useState(false);

  const remember = useCallback((s: Session | null) => {
    if (!s) forgetSeat(readSession('session', SESSION_KEY));
    setKicked(false);
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
    const onKicked = () => {
      remember(null);
      setKicked(true);
    };
    socket.on('room:kicked', onKicked);
    if (socket.connected) void rejoin();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', setRoom);
      socket.off('game:state', setGame);
      socket.off('chat:message', onMessage);
      socket.off('room:kicked', onKicked);
    };
  }, [remember]);

  return { connected, session, room, game, messages, kicked, remember };
}
