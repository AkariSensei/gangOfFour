import { X } from 'lucide-react';
import { useEffect } from 'react';

/** Règles des échecs telles que le site les applique : surtout la pendule, la nulle et ce qui compte au classement. */
export function ChessRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles des échecs" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <h2>Règles des échecs</h2>
        <section>
          <h3>Les règles de la FIDE, toutes</h3>
          <ul className="rules-list">
            <li>Roque, prise en passant et promotion au choix (dame, tour, fou ou cavalier).</li>
            <li>Mat : la partie s’arrête. Pat, triple répétition, règle des 50 coups ou matériel insuffisant : nulle, constatée automatiquement.</li>
            <li>Les couleurs sont tirées au sort, puis s’échangent à chaque revanche.</li>
          </ul>
        </section>
        <section>
          <h3>La pendule</h3>
          <ul className="rules-list">
            <li>L’hôte choisit la cadence : bullet 1 min, blitz 3 + 2 ou 5 min, rapide 10 min ou 15 + 10, classique 30 min. Le second nombre est l’incrément, ajouté après chaque coup.</li>
            <li>Ta pendule ne tourne qu’à partir de ton premier coup, mais tu as 30 secondes pour le jouer : sinon la partie est annulée et ne compte pas.</li>
            <li>Drapeau tombé : tu perds, sauf si l’adversaire n’a plus de quoi mater (nulle).</li>
          </ul>
        </section>
        <section>
          <h3>Pendant la partie</h3>
          <ul className="rules-list">
            <li>Glisse une pièce, ou clique-la puis clique sa case. Pendant le tour de l’autre, tu peux préparer un coup (prémouvement) : il part dès que c’est à toi, s’il est permis. Clic droit pour l’annuler.</li>
            <li>Une proposition de nulle par coup. Jouer sans répondre la refuse.</li>
            <li>Un adversaire déconnecté depuis une minute : aucun bot ne joue pour lui, sa pendule tourne, et tu peux réclamer la victoire.</li>
            <li>Les flèches du clavier font revoir la partie coup par coup. À la fin, copie la PGN ou ouvre la partie sur Lichess pour l’analyser.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
