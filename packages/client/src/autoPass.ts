import { useEffect, useState } from 'react';
import type { RoomView } from '../../server/src/protocol';
import { socket } from './socket';

const AUTO_PASS_KEY = 'gof-auto-pass';

function readAutoPassSetting(): boolean {
  try {
    return localStorage.getItem(AUTO_PASS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Passe automatique quand toute la main est grisée : choix mémorisé dans le navigateur, et envoyé au serveur
 * dès que le siège ne l'a pas encore (nouvelle partie, reconnexion…).
 */
export function useAutoPass(room: RoomView, myId: string | undefined) {
  const [autoPass, setAutoPass] = useState(readAutoPassSetting);
  const onServer = room.players.find((p) => p.id === myId)?.autoPass;

  useEffect(() => {
    if (onServer !== undefined && onServer !== autoPass) void socket.emitWithAck('game:autoPass', { enabled: autoPass });
  }, [onServer, autoPass]);

  function toggleAutoPass() {
    const next = !autoPass;
    setAutoPass(next);
    try {
      localStorage.setItem(AUTO_PASS_KEY, next ? 'on' : 'off');
    } catch {
      // Préférence non mémorisée.
    }
  }

  return { autoPass, toggleAutoPass };
}
