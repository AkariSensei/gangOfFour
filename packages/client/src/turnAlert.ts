import { useEffect } from 'react';

/** Prévient le joueur quand son tour arrive : le titre de l'onglet clignote s'il regarde ailleurs. */
export function useTurnAlert(active: boolean) {
  useEffect(() => {
    if (!active || !document.hidden) return;
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
  }, [active]);
}
