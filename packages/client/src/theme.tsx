import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const THEME_KEY = 'gof-theme';

/** Thème déjà posé sur <html> par le petit script de index.html (choix mémorisé, sinon celui du système). */
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Bouton soleil / lune : bascule le thème et le mémorise pour ce navigateur. */
export function ThemeToggle({ className = 'icon' }: { className?: string }) {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1812' : '#efe7d4');
  }, [theme]);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Préférence non mémorisée.
    }
  }

  const label = theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
  return (
    <button className={className} onClick={toggle} title={label} aria-label={label}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
