import { useEffect, useState } from 'react';
import type { DailyView, PlayerProfile } from '../../server/src/protocol';
import { socket } from './socket';

/** Fiche du joueur connecté, rechargée quand le classement change (undefined : en chargement, null : pas encore joué). */
export function useMyProfile(name: string | undefined): PlayerProfile | null | undefined {
  const [profile, setProfile] = useState<PlayerProfile | null | undefined>(undefined);
  useEffect(() => {
    if (!name) return;
    const load = () => void socket.emitWithAck('stats:player', { name }).then((r) => setProfile(r.ok ? r.profile : null));
    load();
    socket.on('stats:changed', load);
    return () => {
      socket.off('stats:changed', load);
    };
  }, [name]);
  return profile;
}

/** Série de jours joués du joueur connecté, rechargée à chaque partie terminée. */
export function useDaily(accountKey: unknown): DailyView | null {
  const [daily, setDaily] = useState<DailyView | null>(null);
  useEffect(() => {
    if (!accountKey) return;
    const load = async () => {
      const result = await socket.emitWithAck('daily:get');
      if (result.ok) setDaily(result.daily);
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    socket.on('stats:changed', load);
    return () => {
      socket.off('connect', load);
      socket.off('stats:changed', load);
    };
  }, [accountKey]);
  return daily;
}
