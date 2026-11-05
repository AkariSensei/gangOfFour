import { X } from 'lucide-react';
import { FLEET } from '@gof/engine';
import { useEffect } from 'react';

/** Règles de la bataille navale telles qu'on les joue sur le site. */
export function BattleshipRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles de la bataille navale" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <h2>Règles de la bataille navale</h2>
        <section>
          <h3>La flotte</h3>
          <p>Chacun place en secret cinq bateaux sur sa grille de 10 × 10, à l’horizontale ou à la verticale :</p>
          <ul className="rules-list">
            {FLEET.map((f) => (
              <li key={f.name}>
                {f.name} : {f.size} cases
              </li>
            ))}
          </ul>
          <p>Les bateaux peuvent se toucher, mais pas se chevaucher. La flotte part placée au hasard : déplace-la à ta guise.</p>
        </section>
        <section>
          <h3>La bataille</h3>
          <ul className="rules-list">
            <li>On tire chacun son tour sur une case de la grille adverse, en commençant par l’hôte.</li>
            <li>« À l’eau », « Touché » ou « Touché-coulé » : un bateau coulé apparaît chez l’adversaire.</li>
            <li>Un seul tir par tour, même après un touché.</li>
            <li>Le premier qui coule toute la flotte adverse gagne.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
