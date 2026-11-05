import { createPlayingDeck } from '@gof/engine';
import { useEffect } from 'react';
import { PlayingCardView } from './PlayingCard';

const deck = createPlayingDeck();

/** Quelques cartes en illustration, données par leur identifiant : « 7H 7S ». */
function Cards({ ids }: { ids: string }) {
  return (
    <div className="rules-cards p-rules-cards">
      {ids.split(' ').map((id) => {
        const card = deck.find((c) => c.id === id);
        return card ? <PlayingCardView key={id} card={card} small /> : null;
      })}
    </div>
  );
}

/** Règles du Président telles qu'on les joue au bureau, ouvertes depuis la page du jeu. */
export function PresidentRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules pop-in" role="dialog" aria-label="Règles du Président" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>Règles du Président</h2>

        <section>
          <h3>Le but</h3>
          <p>
            Se débarrasser de ses cartes le premier. Le premier sorti devient <strong>Président</strong>, le dernier est le{' '}
            <strong>Trou</strong>. On joue de 3 à 7, avec un jeu de 52 cartes distribué en entier.
          </p>
          <p>Du plus faible au plus fort : 3, 4, 5, 6, 7, 8, 9, 10, valet, dame, roi, as, et le 2, la carte la plus forte.</p>
          <Cards ids="3C 7D QS AH 2S" />
        </section>

        <section>
          <h3>Un pli</h3>
          <ul className="rules-list">
            <li>Celui qui ouvre pose une, deux, trois ou quatre cartes de même valeur.</li>
            <li>Les suivants posent autant de cartes, d’une valeur égale ou plus forte, ou passent.</li>
            <li>Qui passe est sorti du pli : il attend le suivant.</li>
            <li>Quand plus personne ne suit, le dernier à avoir posé ramasse et ouvre le pli suivant.</li>
          </ul>
          <Cards ids="9C 9H JD JS" />
        </section>

        <section>
          <h3>Les règles du bureau</h3>
          <ul className="rules-list">
            <li>
              <strong>Le 2 ferme le pli</strong> : celui qui le pose ramasse aussitôt et relance.
            </li>
            <li>
              <strong>« X ou rien »</strong> : quand deux poses de suite ont la même valeur, le suivant doit poser cette valeur, ou passer.
            </li>
            <li>
              <strong>Pas de fin sur un 2</strong> : celui qui pose son dernier 2 pour finir devient Trou.
            </li>
          </ul>
          <Cards ids="7H 7S" />
        </section>

        <section>
          <h3>Manches, points et échanges</h3>
          <p>
            L’hôte choisit 3, 5 ou 10 manches. Chaque manche rapporte des points selon la place : le Président en marque autant qu’il
            y a d’autres joueurs, puis un de moins à chaque place, et le Trou rien. À la fin, le plus de points gagne.
          </p>
          <p>
            À partir de la 2e manche, le Trou donne ses 2 meilleures cartes au Président, qui lui en rend 2 de son choix. À 4 joueurs
            et plus, le Vice-trou donne sa meilleure carte au Vice-président, qui lui en rend une. Le Trou ouvre la manche.
          </p>
        </section>

        <section>
          <h3>Dans l'application</h3>
          <ul className="rules-list">
            <li>Pour suivre, un clic sur une carte prend d’un coup autant de cartes de cette valeur qu’il en faut.</li>
            <li>Les cartes qui ne passent pas sont grisées, et ⏭ passe pour toi quand rien ne passe.</li>
            <li>À la première manche, celui qui a le 3 de trèfle commence.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
