import { useEffect, useState } from 'react';

const SOUND_KEY = 'gof-sound';

function readSoundSetting(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Petit carillon à deux notes, synthétisé pour ne dépendre d'aucun fichier audio. */
function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // Audio indisponible : l'alerte visuelle suffit.
  }
}

/** Prévient le joueur quand son tour arrive : son, et titre de l'onglet qui clignote s'il regarde ailleurs. */
export function useTurnAlert(active: boolean) {
  const [sound, setSound] = useState(readSoundSetting);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, sound ? 'on' : 'off');
    } catch {
      // Préférence non mémorisée.
    }
  }, [sound]);

  useEffect(() => {
    if (!active) return;
    if (sound) chime();
    if (!document.hidden) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? '🔔 À toi de jouer !' : original;
    }, 900);
    const stop = () => {
      if (document.hidden) return;
      clearInterval(timer);
      document.title = original;
    };
    document.addEventListener('visibilitychange', stop);
    return () => {
      clearInterval(timer);
      document.title = original;
      document.removeEventListener('visibilitychange', stop);
    };
  }, [active, sound]);

  return { sound, toggleSound: () => setSound((s) => !s) };
}
