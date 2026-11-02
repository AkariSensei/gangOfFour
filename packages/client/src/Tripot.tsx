import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { TripotView } from '../../server/src/protocol';
import { errorLabel } from './labels';
import { socket } from './socket';

/** Envoi des donnes au serveur : groupées, toutes les 10 secondes (et avant chaque achat). */
const SYNC_MS = 10_000;

const intFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const smallFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const bigFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Un nombre de jetons lisible : 12 480, 3,4 M, 1,25 Md… */
export function chipsLabel(n: number): string {
  if (n < 10) return smallFormat.format(n);
  if (n < 1e6) return intFormat.format(Math.floor(n));
  const units: [number, string][] = [
    [1e15, 'Bd'],
    [1e12, 'Bn'],
    [1e9, 'Md'],
    [1e6, 'M'],
  ];
  const [size, unit] = units.find(([s]) => n >= s)!;
  return `${bigFormat.format(n / size)} ${unit}`;
}

type Float = { id: number; x: number; y: number; text: string };

/**
 * Le Tripot : on clique sur le paquet pour distribuer des donnes, on achète du personnel et des salles qui
 * produisent seuls, et l'on fait grandir l'établissement. Le serveur garde la partie : ici, on affiche le compteur
 * qui monte en continu et l'on envoie les donnes par paquets.
 */
export function TripotScreen() {
  const [view, setView] = useState<TripotView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<'salle' | 'ameliorations'>('salle');
  const [error, setError] = useState('');
  const [awayGain, setAwayGain] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  // Donnes distribuées depuis le dernier envoi, et celles parties dans un envoi en cours.
  const pending = useRef(0);
  const sending = useRef(0);
  const nextFloat = useRef(0);

  const receive = useCallback((tripot: TripotView) => {
    setView(tripot);
    setReceivedAt(Date.now());
  }, []);

  /** Envoie les donnes en attente (ou rien), éventuellement avec un achat, et reçoit la partie à jour. */
  const sync = useCallback(
    async (buy?: { kind: 'building' | 'upgrade'; id: string }) => {
      const deals = pending.current;
      pending.current = 0;
      sending.current = deals;
      const result = buy ? await socket.emitWithAck('tripot:buy', { ...buy, deals }) : await socket.emitWithAck('tripot:sync', { deals });
      sending.current = 0;
      if (result.ok) {
        receive(result.tripot);
        setError('');
        return;
      }
      setError(errorLabel(result.error));
      // Achat refusé : les donnes envoyées avec lui sont comptées quand même, on recharge la partie pour les voir.
      // Envoi simple raté : on les garde pour le prochain.
      if (!buy) pending.current += deals;
      else {
        const fresh = await socket.emitWithAck('tripot:get');
        if (fresh.ok) receive(fresh.tripot);
      }
    },
    [receive],
  );

  useEffect(() => {
    void socket.emitWithAck('tripot:get').then((result) => {
      if (!result.ok) return setError(errorLabel(result.error));
      receive(result.tripot);
      setAwayGain(result.tripot.awayGain);
    });
    const syncTimer = setInterval(() => void sync(), SYNC_MS);
    // Le compteur avance en continu entre deux envois (dix fois par seconde suffit à l'œil).
    const tickTimer = setInterval(() => setTick((t) => t + 1), 100);
    return () => {
      clearInterval(syncTimer);
      clearInterval(tickTimer);
      // En quittant l'écran, on n'oublie pas les dernières donnes.
      if (pending.current > 0) void socket.emitWithAck('tripot:sync', { deals: pending.current });
    };
  }, [receive, sync]);

  if (!view) return <p className="muted">{error || 'Ouverture du tripot…'}</p>;

  // Ce que le joueur voit : les jetons du serveur, plus la production depuis, plus les donnes pas encore envoyées.
  const elapsed = (Date.now() - receivedAt) / 1000;
  const unsent = pending.current + sending.current;
  const chips = view.chips + view.rate * elapsed + unsent * view.dealValue;
  const earned = view.earned + view.rate * elapsed + unsent * view.dealValue;

  function dealCards(e: MouseEvent<HTMLButtonElement>) {
    pending.current += 1;
    const box = e.currentTarget.getBoundingClientRect();
    const id = nextFloat.current++;
    // Le « +N » s'envole d'où l'on a cliqué (au centre du paquet au clavier).
    const x = e.clientX ? e.clientX - box.left : box.width / 2;
    const y = e.clientY ? e.clientY - box.top : box.height / 2;
    setFloats((f) => [...f.slice(-14), { id, x, y, text: `+${chipsLabel(view!.dealValue)}` }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  }

  async function grow() {
    if (!confirm(`Ouvrir ${view!.nextVenue} ? Tu repars de zéro (jetons, personnel, améliorations), avec 10 % de jetons en plus pour toujours.`)) return;
    // D'abord les dernières donnes, pour qu'elles comptent dans l'objectif.
    await sync();
    const result = await socket.emitWithAck('tripot:prestige');
    if (result.ok) receive(result.tripot);
    else setError(errorLabel(result.error));
  }

  const canGrow = view.nextVenue && earned >= view.prestigeGoal;
  const available = view.upgrades.filter((u) => u.available);
  // Les activités se dévoilent selon le compteur affiché (pas seulement le dernier chiffre du serveur), une seule
  // activité encore cachée restant visible à la fois : la prochaine.
  const revealed = view.buildings.map((b) => b.owned > 0 || earned >= b.cost / 2);
  const shownBuildings = view.buildings.filter((_, i) => revealed[i] || i === revealed.indexOf(false));

  return (
    <div className="tripot">
      <section className="tripot-main">
        <div className="tripot-bank">
          <div className="tripot-venue">
            {view.venue}
            {view.prestige > 0 && <span> · +{view.prestige * 10} % de jetons</span>}
          </div>
          <div className="tripot-amount">
            {chipsLabel(chips)} <span>jetons</span>
          </div>
          <div className="tripot-rate">
            <b>+ {chipsLabel(view.rate)} / s</b> · {chipsLabel(view.dealValue)} par donne
          </div>
        </div>

        {awayGain > 0 && (
          <button type="button" className="tripot-away" onClick={() => setAwayGain(0)}>
            🌙 Pendant ton absence, le tripot a rapporté <b>+{chipsLabel(awayGain)} jetons</b>. (La nuit, il tourne à moitié, 8 h au plus.)
          </button>
        )}

        <div className="tripot-table">
          <button type="button" className="tripot-deal" onClick={dealCards} aria-label="Distribuer une donne">
            <img src="/cards/dos.webp" alt="" draggable={false} />
            <img src="/cards/dos.webp" alt="" draggable={false} />
            <img src="/cards/DR.webp" alt="" draggable={false} />
            {floats.map((f) => (
              <span key={f.id} className="tripot-float" style={{ left: f.x, top: f.y }}>
                {f.text}
              </span>
            ))}
          </button>
          <span className="tripot-hint">Clique sur le paquet pour distribuer</span>
        </div>

        <div className="tripot-stats">
          <span>
            Donnes distribuées <b>{intFormat.format(view.deals + unsent)}</b>
          </span>
          <span>
            Jetons gagnés en tout <b>{chipsLabel(view.earnedAll + (earned - view.earned))}</b>
          </span>
        </div>

        {view.nextVenue && (
          <div className="tripot-prestige">
            <span className="tripot-prestige-icon" aria-hidden>
              🏛️
            </span>
            <span className="tripot-prestige-text">
              <strong>Ouvrir : {view.nextVenue}</strong>
              <small>
                Repars de zéro avec 10 % de jetons en plus, pour toujours. Il faut avoir gagné {chipsLabel(view.prestigeGoal)} jetons
                dans cet établissement.
              </small>
              <span className="level-bar">
                <span style={{ width: `${Math.min(100, (100 * earned) / view.prestigeGoal)}%` }} />
              </span>
            </span>
            <button type="button" className={canGrow ? 'primary' : ''} disabled={!canGrow} onClick={() => void grow()}>
              {canGrow ? 'S’agrandir' : `${Math.floor(Math.min(100, (100 * earned) / view.prestigeGoal))} %`}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <aside className="tripot-shop">
        <div className="segmented tripot-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'salle'} className={tab === 'salle' ? 'on' : ''} onClick={() => setTab('salle')}>
            Établissement
          </button>
          <button role="tab" aria-selected={tab === 'ameliorations'} className={tab === 'ameliorations' ? 'on' : ''} onClick={() => setTab('ameliorations')}>
            Améliorations {available.length > 0 && <span className="tripot-count">{available.length}</span>}
          </button>
        </div>
        {tab === 'salle' ? (
          <ul className="tripot-items">
            {shownBuildings.map((b) =>
              revealed[view.buildings.indexOf(b)] ? (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`tripot-item ${chips >= b.price ? 'affordable' : ''}`}
                    disabled={chips < b.price}
                    onClick={() => void sync({ kind: 'building', id: b.id })}
                    title={b.text}
                  >
                    <span className="tripot-icon" aria-hidden>
                      {b.icon}
                    </span>
                    <span className="tripot-item-text">
                      <strong>{b.name}</strong>
                      <small>
                        +{chipsLabel(b.rate)} jeton{b.rate >= 2 ? 's' : ''} / s · {b.text}
                      </small>
                    </span>
                    <span className="tripot-price">
                      <span className="tripot-owned">{b.owned}</span>
                      <small>{chipsLabel(b.price)} jetons</small>
                    </span>
                  </button>
                </li>
              ) : (
                <li key={b.id} className="tripot-item locked">
                  <span className="tripot-icon" aria-hidden>
                    ❔
                  </span>
                  <span className="tripot-item-text">
                    <strong>???</strong>
                    <small>Se dévoile à {chipsLabel(b.cost / 2)} jetons gagnés</small>
                  </span>
                  <span className="tripot-price">🔒</span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <ul className="tripot-items">
            {view.upgrades.length === 0 && <li className="muted">Distribue des donnes et embauche : les améliorations arrivent vite.</li>}
            {view.upgrades.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className={`tripot-item ${u.available ? (chips >= u.cost ? 'affordable' : '') : 'owned'}`}
                  disabled={!u.available || chips < u.cost}
                  onClick={() => void sync({ kind: 'upgrade', id: u.id })}
                >
                  <span className="tripot-icon" aria-hidden>
                    {u.icon}
                  </span>
                  <span className="tripot-item-text">
                    <strong>{u.name}</strong>
                    <small>{u.text}</small>
                  </span>
                  <span className="tripot-price">{u.available ? <small>{chipsLabel(u.cost)} jetons</small> : <span className="tripot-done">✓</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
