import { SLOT_SYMBOLS, SLOTS_GOAL, SLOTS_START, THREE_OF_A_KIND, TWO_OF_A_KIND } from '@gof/engine';
import { useEffect } from 'react';
import { SLOT_NAMES, SlotIcon } from './SlotsTable';

/** Règles du duel de machines à sous, avec la table des gains. */
export function SlotsRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles du Duel Jackpot" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>Règles du Duel Jackpot</h2>
        <section>
          <h3>Le duel</h3>
          <ul className="rules-list">
            <li>
              Deux joueurs, {SLOTS_START} € fictifs chacun, une machine à sous chacun. On tire chacun son tour.
            </li>
            <li>La mise est imposée : 5 € les trois premiers tours, puis 10 €, 15 €… Personne ne choisit, personne ne fait tapis.</li>
            <li>
              À la fin d’un tour, si l’un est à 0 € ou que quelqu’un atteint {SLOTS_GOAL} €, le plus riche gagne. Chacun tire donc
              autant de fois que l’autre.
            </li>
            <li>Qui n’a plus assez pour la mise joue ce qu’il lui reste.</li>
          </ul>
        </section>
        <section>
          <h3>Les gains</h3>
          <table className="slots-paytable">
            <tbody>
              {[...SLOT_SYMBOLS].reverse().map((s) => (
                <tr key={s}>
                  <td>
                    <SlotIcon symbol={s} />
                    <SlotIcon symbol={s} />
                    <SlotIcon symbol={s} />
                  </td>
                  <td>Trois × {SLOT_NAMES[s]}</td>
                  <td>
                    <strong>× {THREE_OF_A_KIND[s]}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>2 identiques</td>
                <td>N’importe lesquels</td>
                <td>
                  <strong>× {TWO_OF_A_KIND}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">Le gain est la mise multipliée : avec 10 € de mise, trois cloches rapportent 300 €.</p>
        </section>
        <section>
          <h3>Bon à savoir</h3>
          <ul className="rules-list">
            <li>C’est de la chance pure, et de l’argent fictif : rien ne s’achète et rien ne se gagne en vrai.</li>
            <li>Le jeu est en bêta : les gains peuvent encore bouger.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
