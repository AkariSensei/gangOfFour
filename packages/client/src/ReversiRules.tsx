import { X } from 'lucide-react';
import { useEffect } from 'react';

/** Règles du Reversi. */
export function ReversiRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles du Reversi" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <h2>Règles du Reversi</h2>
        <section>
          <h3>Le principe</h3>
          <ul className="rules-list">
            <li>Deux joueurs, un plateau de 8 × 8. L’hôte joue les pions orange et commence, l’autre joue les pions crème.</li>
            <li>
              À ton tour, pose un pion de façon à <strong>encadrer</strong> des pions adverses en ligne droite : à l’horizontale, à la
              verticale ou en diagonale.
            </li>
            <li>Tous les pions encadrés se retournent et passent dans ton camp, dans toutes les directions à la fois.</li>
            <li>Un coup qui ne retourne rien est interdit. Sans aucun coup possible, on passe son tour.</li>
            <li>Quand plus personne ne peut jouer, celui qui a le plus de pions gagne.</li>
          </ul>
        </section>
        <section>
          <h3>Quelques conseils</h3>
          <ul className="rules-list">
            <li>Les coins ne se retournent jamais : ce sont les meilleures cases.</li>
            <li>Évite les cases juste à côté d’un coin libre : elles l’offrent à l’adversaire.</li>
            <li>Retourner beaucoup de pions tôt n’est pas forcément bon : garder des coups possibles compte plus.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
