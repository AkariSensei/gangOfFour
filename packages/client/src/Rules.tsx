import { useEffect } from 'react';

/** Quelques cartes en illustration, données par le nom de leur image : « 5V 5J 5R ». */
function Cards({ codes }: { codes: string }) {
  return (
    <div className="rules-cards">
      {codes.split(' ').map((code, i) => (
        <img key={i} src={`/cards/${code}.webp`} alt={code} draggable={false} />
      ))}
    </div>
  );
}

function Combo({ name, codes, note }: { name: string; codes: string; note?: string }) {
  return (
    <li>
      <Cards codes={codes} />
      <strong>{name}</strong>
      {note && <span className="muted small">{note}</span>}
    </li>
  );
}

/** Règles du jeu en bref, illustrées avec les cartes, ouvertes depuis l'accueil. */
export function Rules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles du jeu" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>Règles du jeu</h2>

        <section>
          <h3>Le but</h3>
          <p>Vider sa main avant les autres. Les cartes qui restent coûtent des points : à 100 points la partie s'arrête, et le plus petit score gagne.</p>
        </section>

        <section>
          <h3>Les cartes</h3>
          <p>De 1 à 10, en trois couleurs. À valeur égale : vert &lt; jaune &lt; rouge.</p>
          <Cards codes="7V 7J 7R" />
          <p>Le 1 multicolore est le plus fort des 1. Les phénix battent les 10, et le dragon bat tout en carte seule.</p>
          <Cards codes="1M PV PJ DR" />
        </section>

        <section>
          <h3>Les combinaisons</h3>
          <ul className="rules-combos rules-combos-3">
            <Combo name="Carte seule" codes="9R" />
            <Combo name="Paire" codes="4V 4R" note="dont la paire de phénix" />
            <Combo name="Brelan" codes="8V 8J 8R" />
          </ul>
          <p>Cinq cartes, de la plus faible à la plus forte :</p>
          <ul className="rules-combos">
            <Combo name="Suite" codes="3J 4V 5R 6V 7J" note="5 valeurs qui se suivent" />
            <Combo name="Couleur" codes="2V 5V 6V 8V 10V" note="5 cartes de la même couleur" />
            <Combo name="Full" codes="6V 6J 6R 2J 2R" note="le brelan décide, puis la paire" />
            <Combo name="Quinte flush" codes="4R 5R 6R 7R 8R" note="suite d'une seule couleur" />
          </ul>
          <p className="muted small">Le 1 multicolore prend la couleur voulue. Phénix et dragon n'entrent pas dans une suite ni une couleur.</p>
        </section>

        <section className="rules-gang">
          <h3>Le gang</h3>
          <Cards codes="5V 5V 5J 5R" />
          <p>4 à 7 cartes de même valeur : il bat toute autre combinaison. Un gang plus long bat un plus court.</p>
        </section>

        <section>
          <h3>Un pli</h3>
          <ul className="rules-list">
            <li>Chacun à son tour pose le même type de combinaison, en plus fort, ou passe.</li>
            <li>Qui passe ne rejoue plus jusqu'à la fin du pli.</li>
            <li>Quand tous les autres ont passé, le dernier à avoir posé ouvre le pli suivant.</li>
            <li>Première manche : le 1 multicolore ouvre. Ensuite, le gagnant de la manche ouvre, et le sens de jeu s'inverse.</li>
            <li>
              <strong>Carte !</strong> Quand le joueur après toi n'a plus qu'une carte, ouvre avec une combinaison si tu peux, et toute carte seule que tu joues doit être ta plus forte.
            </li>
          </ul>
        </section>

        <section>
          <h3>Fin de manche</h3>
          <table className="rules-points">
            <tbody>
              <tr>
                <th>Cartes restantes</th>
                <td>1 à 7</td>
                <td>8 à 10</td>
                <td>11 à 13</td>
                <td>14 à 15</td>
                <td>16</td>
              </tr>
              <tr>
                <th>Points par carte</th>
                <td>×1</td>
                <td>×2</td>
                <td>×3</td>
                <td>×4</td>
                <td>80 pts</td>
              </tr>
            </tbody>
          </table>
          <p>Échange : celui qui a le plus de cartes donne sa meilleure au gagnant, qui lui rend une carte de son choix.</p>
        </section>

        <section>
          <h3>Dans l'application</h3>
          <ul className="rules-list">
            <li>Les cartes qui ne peuvent rien battre sont grisées.</li>
            <li>⏭ passe pour toi quand toute ta main est grisée.</li>
            <li>À 3 joueurs, 16 cartes restent de côté et ne sont pas jouées.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
