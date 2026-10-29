import { useEffect, useState } from 'react';

/** Choix du joueur de recevoir une notification quand son tour arrive (gardé sur ce navigateur). */
const NOTIFY_KEY = 'gof-notify';

const supported = () => typeof Notification !== 'undefined';

/**
 * Notifications de tour : activées par le joueur (le navigateur demande l'autorisation la première fois, et
 * seulement après un clic). `state` vaut « unsupported », « denied » (bloquées dans le navigateur), « on » ou « off ».
 */
export function useTurnNotifications() {
  const [wanted, setWanted] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [permission, setPermission] = useState(() => (supported() ? Notification.permission : 'denied'));
  const state = !supported() ? 'unsupported' : permission === 'denied' ? 'denied' : wanted && permission === 'granted' ? 'on' : 'off';

  async function toggle() {
    if (!supported()) return;
    let next = !(wanted && permission === 'granted');
    if (next && Notification.permission !== 'granted') {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      next = answer === 'granted';
    }
    setWanted(next);
    try {
      localStorage.setItem(NOTIFY_KEY, next ? '1' : '0');
    } catch {
      // Sans stockage, le choix ne vaut que pour cette page.
    }
  }

  return { state, toggle };
}

/**
 * Prévient le joueur quand son tour arrive et qu'il regarde ailleurs : le titre de l'onglet clignote, et s'il a
 * activé les notifications, une notification du système s'affiche (un clic dessus ramène à la partie).
 */
export function useTurnAlert(message: string | null, notify: boolean) {
  useEffect(() => {
    if (!message || !document.hidden) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 ${message}` : original;
    }, 900);
    let notification: Notification | undefined;
    if (notify && supported() && Notification.permission === 'granted') {
      try {
        notification = new Notification('Gang of Four', { body: message, icon: '/cards/1M.webp', tag: 'gof-turn' });
        notification.onclick = () => {
          window.focus();
          notification?.close();
        };
      } catch {
        // Certains navigateurs mobiles refusent les notifications hors service worker : le titre clignote quand même.
      }
    }
    const stop = () => {
      if (document.hidden) return;
      clearInterval(timer);
      document.title = original;
      notification?.close();
    };
    document.addEventListener('visibilitychange', stop);
    return () => {
      clearInterval(timer);
      document.title = original;
      notification?.close();
      document.removeEventListener('visibilitychange', stop);
    };
  }, [message, notify]);
}
