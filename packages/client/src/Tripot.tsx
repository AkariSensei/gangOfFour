import type { Card } from '@gof/engine';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { HandType, TripotEvent, TripotView } from '../../server/src/protocol';
import { EVENT_WINDOW_MS, HAND_SIZE, REPUTATION_UNIT, affordable, bestHand, bulkCost, earnedForReputation, handOf, reputationFor } from '../../server/src/tripot';
import { cardImage } from './CardView';
import { errorLabel } from './labels';
import { socket } from './socket';

/** Envoi des cartes au serveur : groupées, toutes les 10 secondes (et avant chaque achat). */
const SYNC_MS = 10_000;

const intFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const smallFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const bigFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Les grands nombres à la française : million, milliard, billion, billiard… */
const UNITS: [number, string, string][] = [
  [1e33, 'Qnd', 'quintilliards'],
  [1e30, 'Qn', 'quintillions'],
  [1e27, 'Qad', 'quadrilliards'],
  [1e24, 'Qa', 'quadrillions'],
  [1e21, 'Trd', 'trilliards'],
  [1e18, 'Tr', 'trillions'],
  [1e15, 'Bd', 'billiards'],
  [1e12, 'Bn', 'billions'],
  [1e9, 'Md', 'milliards'],
  [1e6, 'M', 'millions'],
];

/** Un nombre de jetons lisible : 12 480, 3,4 M, 1,25 Md… */
export function chipsLabel(n: number): string {
  if (n < 10) return smallFormat.format(n);
  if (n < 1e6) return intFormat.format(Math.floor(n));
  const unit = UNITS.find(([s]) => n >= s);
  if (!unit) return n.toExponential(2);
  return `${bigFormat.format(n / unit[0])} ${unit[1]}`;
}

/** Le même, en toutes lettres pour le grand compteur (« 3,4 milliards »). */
function chipsWords(n: number): string {
  if (n < 1e6) return chipsLabel(n);
  const unit = UNITS.find(([s]) => n >= s);
  if (!unit) return n.toExponential(2);
  return `${bigFormat.format(n / unit[0])} ${unit[2]}`;
}

/** Une durée courte : 45 s, 12 min, 3 h, 2 j. */
function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${smallFormat.format(seconds / 3600)} h`;
  return `${smallFormat.format(seconds / 86400)} j`;
}

export const HAND_LABELS: Record<HandType, string> = {
  pair: 'Paire',
  trio: 'Brelan',
  straight: 'Suite',
  flush: 'Couleur',
  fullHouse: 'Full',
  straightFlush: 'Quinte flush',
  gang: 'Gang of Four',
};

type Float = { id: number; x: number; y: number; text: string };
type Amount = 1 | 10 | 'max';
type Tab = 'salle' | 'ameliorations' | 'succes';

/**
 * Le Tripot : on clique sur le paquet pour distribuer des cartes (cinq font une main, et une belle combinaison
 * rapporte gros), on achète du personnel et des salles qui produisent seuls, et l'on s'agrandit pour gagner de la
 * réputation. Le serveur garde la partie : ici, on affiche le compteur qui monte en continu, les cartes distribuées
 * (les mêmes que celles que le serveur comptera), et l'on envoie les clics par paquets.
 */
export function TripotScreen() {
  const [view, setView] = useState<TripotView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  // Écart entre l'horloge du serveur et celle de l'écran, pour caler les passages du Dragon.
  const [clockOffset, setClockOffset] = useState(0);
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>('salle');
  const [amount, setAmount] = useState<Amount>(1);
  const [error, setError] = useState('');
  const [awayGain, setAwayGain] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [combo, setCombo] = useState<{ id: number; type: HandType; gain: number } | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [caughtEvent, setCaughtEvent] = useState(0);
  const [confirmGrow, setConfirmGrow] = useState(false);
  // Cartes distribuées depuis le dernier envoi (et jetons qu'elles ont rapportés), et celles d'un envoi en cours.
  const pending = useRef({ deals: 0, gain: 0 });
  const sending = useRef({ deals: 0, gain: 0 });
  const nextId = useRef(0);

  const announce = useCallback((text: string) => {
    const id = nextId.current++;
    setNotice({ id, text });
    setTimeout(() => setNotice((n) => (n?.id === id ? null : n)), 4000);
  }, []);

  const receive = useCallback(
    (tripot: TripotView) => {
      setView(tripot);
      setReceivedAt(Date.now());
      setClockOffset(tripot.now - Date.now());
      const names = tripot.newAchievements.map((id) => tripot.achievements.find((a) => a.id === id)?.name).filter(Boolean);
      if (names.length > 0) announce(`🏆 Succès : ${names.join(', ')} (+${names.length} % de production)`);
    },
    [announce],
  );

  /** Envoie les cartes en attente (ou rien), éventuellement avec un achat, et reçoit la partie à jour. */
  const sync = useCallback(
    async (buy?: { kind: 'building' | 'upgrade'; id: string; count?: number | 'max' }) => {
      const batch = pending.current;
      pending.current = { deals: 0, gain: 0 };
      sending.current = batch;
      const result = buy
        ? await socket.emitWithAck('tripot:buy', { ...buy, deals: batch.deals })
        : await socket.emitWithAck('tripot:sync', { deals: batch.deals });
      sending.current = { deals: 0, gain: 0 };
      if (result.ok) {
        receive(result.tripot);
        setError('');
        return;
      }
      setError(errorLabel(result.error));
      // Achat refusé : les cartes envoyées avec lui sont comptées quand même, on recharge la partie pour les voir.
      // Envoi simple raté : on les garde pour le prochain.
      if (!buy) pending.current = { deals: pending.current.deals + batch.deals, gain: pending.current.gain + batch.gain };
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
    // En quittant l'écran ou en fermant l'onglet, on n'oublie pas les dernières cartes.
    const flush = () => {
      if (pending.current.deals > 0) socket.emit('tripot:sync', { deals: pending.current.deals }, () => {});
      pending.current = { deals: 0, gain: 0 };
    };
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(syncTimer);
      clearInterval(tickTimer);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [receive, sync]);

  if (!view) return <p className="muted">{error || 'Ouverture du tripot…'}</p>;

  // Ce que le joueur voit : les jetons du serveur, plus la production depuis (frénésie comprise), plus les cartes
  // pas encore envoyées.
  const now = Date.now();
  const serverNow = now + clockOffset;
  const sentAt = receivedAt + clockOffset;
  const frenzyLeft = Math.max(0, view.frenzyUntil - serverNow) / 1000;
  const frenzied = Math.max(0, Math.min(serverNow, view.frenzyUntil) - sentAt) / 1000;
  const produced = view.rate * ((now - receivedAt) / 1000) + view.rate * 6 * frenzied;
  const unsent = pending.current.deals + sending.current.deals;
  const local = produced + pending.current.gain + sending.current.gain;
  const chips = view.chips + local;
  const earned = view.earned + local;
  const earnedAll = view.earnedAll + local;
  const rate = frenzyLeft > 0 ? view.rate * 7 : view.rate;

  // La main en cours : les cartes déjà distribuées de la main (la dernière main complète reste affichée).
  const dealt = view.deals + unsent;
  const handIndex = dealt === 0 ? 0 : Math.floor((dealt - 1) / HAND_SIZE);
  const shownCards = dealt === 0 ? 0 : dealt - handIndex * HAND_SIZE;
  const hand = handOf(view.seed, handIndex);

  // Le Dragon (ou le Phénix) passe : on a quelques secondes pour cliquer dessus.
  const eventOn = serverNow >= view.nextEventAt && serverNow <= view.nextEventAt + EVENT_WINDOW_MS && caughtEvent !== view.nextEventAt;

  function dealCard(e: MouseEvent<HTMLButtonElement>) {
    const index = view!.deals + pending.current.deals + sending.current.deals;
    let gain = view!.dealValue;
    if (index % HAND_SIZE === HAND_SIZE - 1) {
      const type = bestHand(handOf(view!.seed, Math.floor(index / HAND_SIZE)));
      if (type) {
        const value = view!.handValues[type];
        gain += value;
        setCombo({ id: nextId.current++, type, gain: value });
      } else setCombo(null);
    } else if (index % HAND_SIZE === 0) setCombo(null);
    pending.current = { deals: pending.current.deals + 1, gain: pending.current.gain + gain };
    const box = e.currentTarget.getBoundingClientRect();
    const id = nextId.current++;
    // Le « +N » s'envole d'où l'on a cliqué (au centre du paquet au clavier).
    const x = e.clientX ? e.clientX - box.left : box.width / 2;
    const y = e.clientY ? e.clientY - box.top : box.height / 2;
    setFloats((f) => [...f.slice(-14), { id, x, y, text: `+${chipsLabel(view!.dealValue)}` }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  }

  async function catchIt() {
    setCaughtEvent(view!.nextEventAt);
    const batch = pending.current;
    pending.current = { deals: 0, gain: 0 };
    sending.current = batch;
    const result = await socket.emitWithAck('tripot:catch', { deals: batch.deals });
    sending.current = { deals: 0, gain: 0 };
    if (!result.ok) {
      announce('Trop tard, il est passé…');
      const fresh = await socket.emitWithAck('tripot:get');
      if (fresh.ok) receive(fresh.tripot);
      return;
    }
    receive(result.tripot);
    const event: TripotEvent = result.event;
    announce(
      event.kind === 'frenzy'
        ? '🐉 Le Dragon s’emballe : tout le tripot produit sept fois plus pendant une minute !'
        : `🦅 Le Phénix renaît dans ta caisse : +${chipsLabel(event.gain)} jetons !`,
    );
  }

  async function grow() {
    setConfirmGrow(false);
    // D'abord les dernières cartes, pour qu'elles comptent dans la réputation.
    await sync();
    const result = await socket.emitWithAck('tripot:prestige');
    if (result.ok) {
      receive(result.tripot);
      announce(`🏛️ Bienvenue : ${result.tripot.venue}. Réputation ${result.tripot.reputation}.`);
    } else setError(errorLabel(result.error));
  }

  const available = view.upgrades.filter((u) => u.available);
  const achievementsDone = view.achievements.filter((a) => a.done).length;
  // Les activités se dévoilent au fil des jetons gagnés, une seule activité encore cachée restant visible : la prochaine.
  const revealed = view.buildings.map((b) => b.owned > 0 || earned >= b.cost / 2);
  const shownBuildings = view.buildings.filter((_, i) => revealed[i] || i === revealed.indexOf(false));
  // Réputation méritée selon le compteur affiché, et avancée vers le point suivant.
  const gain = Math.max(0, reputationFor(earnedAll) - view.reputation);
  const nextPointAt = earnedForReputation(reputationFor(earnedAll) + 1);
  const repProgress = 100 * (Math.cbrt(earnedAll / REPUTATION_UNIT) % 1);

  return (
    <div className={`tripot venue-${Math.min(view.level, 6)}`}>
      <section className="tripot-main">
        <div className="tripot-bank">
          <div className="tripot-venue">
            {view.venue}
            {view.reputation > 0 && (
              <span>
                {' '}
                · Réputation {intFormat.format(view.reputation)}
              </span>
            )}
            <span> · ×{bigFormat.format(view.bonus)}</span>
          </div>
          <div className="tripot-amount">
            {chipsWords(chips)} <span>jetons</span>
          </div>
          <div className="tripot-rate">
            <b>+ {chipsLabel(rate)} / s</b> · {chipsLabel(view.dealValue)} par carte
          </div>
        </div>

        {frenzyLeft > 0 && (
          <div className="tripot-frenzy" role="status">
            🐉 Frénésie du Dragon : production ×7 encore {Math.ceil(frenzyLeft)} s
          </div>
        )}
        {awayGain > 0 && (
          <button type="button" className="tripot-away" onClick={() => setAwayGain(0)}>
            🌙 Pendant ton absence, le tripot a rapporté <b>+{chipsLabel(awayGain)} jetons</b>. (Il tourne à{' '}
            {view.offlineFactor === 0.5 ? 'moitié' : 'trois quarts'}, {view.offlineHours} h au plus : reviens vite !)
          </button>
        )}

        <div className="tripot-table">
          <div className="tripot-hand" aria-label="La main en cours">
            {Array.from({ length: HAND_SIZE }, (_, i) =>
              i < shownCards ? (
                <img key={`${handIndex}-${i}`} className="tripot-card" src={cardImage(hand[i] as Card)} alt="" draggable={false} />
              ) : (
                <span key={`${handIndex}-${i}`} className="tripot-card empty" />
              ),
            )}
          </div>
          {combo && shownCards === HAND_SIZE && (
            <div key={combo.id} className={`tripot-combo combo-${combo.type}`}>
              {HAND_LABELS[combo.type]} ! <b>+{chipsLabel(combo.gain)}</b>
            </div>
          )}
          <button type="button" className="tripot-deal" onClick={dealCard} aria-label="Distribuer une carte">
            <img src="/cards/dos.webp" alt="" draggable={false} />
            <img src="/cards/dos.webp" alt="" draggable={false} />
            <img src="/cards/dos.webp" alt="" draggable={false} />
            {floats.map((f) => (
              <span key={f.id} className="tripot-float" style={{ left: f.x, top: f.y }}>
                {f.text}
              </span>
            ))}
          </button>
          {eventOn && (
            <button type="button" className="tripot-event" onClick={() => void catchIt()} aria-label="Attraper le Dragon">
              <img src="/cards/DR.webp" alt="" draggable={false} />
            </button>
          )}
          {dealt < 10 && <span className="tripot-hint">Clique sur le paquet : cinq cartes font une main</span>}
        </div>

        {view.buildings.some((b) => b.owned > 0) && (
          <div className="tripot-crew" aria-label="Ton personnel">
            {view.buildings
              .filter((b) => b.owned > 0)
              .map((b) => (
                <span key={b.id} title={`${b.owned} × ${b.name}`}>
                  {b.icon}
                  <small>{intFormat.format(b.owned)}</small>
                </span>
              ))}
          </div>
        )}

        <div className="tripot-paytable" aria-label="Ce que rapportent les mains">
          {(Object.keys(HAND_LABELS) as HandType[]).map((t) => (
            <span key={t}>
              {HAND_LABELS[t]} <b>+{chipsLabel(view.handValues[t])}</b>
              {(view.hands[t] ?? 0) > 0 && <small> ×{intFormat.format(view.hands[t] ?? 0)}</small>}
            </span>
          ))}
        </div>

        <div className="tripot-stats">
          <span>
            Cartes distribuées <b>{intFormat.format(dealt)}</b>
          </span>
          <span>
            Jetons gagnés en tout <b>{chipsLabel(earnedAll)}</b>
          </span>
          {view.rent !== null && (
            <span>
              Rente <b>+{view.rent} XP</b> par jour de passage
            </span>
          )}
        </div>

        <div className="tripot-prestige">
          <span className="tripot-prestige-icon" aria-hidden>
            🏛️
          </span>
          <span className="tripot-prestige-text">
            <strong>{gain > 0 ? `S’agrandir : +${intFormat.format(gain)} de réputation` : 'S’agrandir'}</strong>
            <small>
              {gain > 0
                ? `Tu repars de zéro avec ${intFormat.format(view.reputation + gain)} de réputation (+2 % de production chacun).`
                : `${view.reputation > 0 ? 'Prochain' : 'Premier'} point de réputation à ${chipsLabel(nextPointAt)} jetons gagnés en tout.`}{' '}
              Prochain établissement : <b>{view.nextVenue?.name}</b> à {intFormat.format(view.nextVenue?.reputation ?? 0)} de réputation.
            </small>
            <span className="level-bar">
              <span style={{ width: `${repProgress}%` }} />
            </span>
          </span>
          <button type="button" className={gain > 0 ? 'primary' : ''} disabled={gain === 0} onClick={() => setConfirmGrow(true)}>
            {gain > 0 ? 'S’agrandir' : `${Math.floor(repProgress)} %`}
          </button>
        </div>
        {view.perks.length > 0 && (
          <ul className="tripot-perks">
            {view.perks.map((p) => (
              <li key={p}>✓ {p}</li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <aside className="tripot-shop">
        <div className="tripot-shop-chips">
          {chipsLabel(chips)} jetons · +{chipsLabel(rate)} / s
        </div>
        <div className="segmented tripot-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'salle'} className={tab === 'salle' ? 'on' : ''} onClick={() => setTab('salle')}>
            Établissement
          </button>
          <button role="tab" aria-selected={tab === 'ameliorations'} className={tab === 'ameliorations' ? 'on' : ''} onClick={() => setTab('ameliorations')}>
            Améliorations {available.length > 0 && <span className="tripot-count">{available.length}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'succes'} className={tab === 'succes' ? 'on' : ''} onClick={() => setTab('succes')}>
            Succès
          </button>
        </div>
        {tab === 'salle' && (
          <>
            <div className="segmented tripot-amounts" role="group" aria-label="Quantité">
              {([1, 10, 'max'] as Amount[]).map((a) => (
                <button key={a} className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>
                  {a === 'max' ? 'Max' : `×${a}`}
                </button>
              ))}
            </div>
            <ul className="tripot-items">
              {shownBuildings.map((b) => {
                if (!revealed[view.buildings.indexOf(b)]) {
                  return (
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
                  );
                }
                const count = amount === 'max' ? Math.max(1, affordable(b, b.owned, chips)) : amount;
                const price = bulkCost(b, b.owned, count);
                const share = view.rate > 0 ? (100 * b.owned * b.rate) / view.rate : 0;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={`tripot-item ${chips >= price ? 'affordable' : ''}`}
                      disabled={chips < price}
                      onClick={() => void sync({ kind: 'building', id: b.id, count: amount === 'max' ? 'max' : count })}
                      title={b.text}
                    >
                      <span className="tripot-icon" aria-hidden>
                        {b.icon}
                      </span>
                      <span className="tripot-item-text">
                        <strong>
                          {b.name}
                          {count > 1 && <em> ×{count}</em>}
                        </strong>
                        <small>
                          +{chipsLabel(b.rate)} / s chacun{share >= 1 && ` · ${Math.round(share)} % de la production`}
                        </small>
                        <small className="tripot-payback">Rentabilisé en {durationLabel(price / (b.rate * count) + Math.max(0, price - chips) / Math.max(rate, 1e-9))}</small>
                      </span>
                      <span className="tripot-price">
                        <span className="tripot-owned">{b.owned}</span>
                        <small>{chipsLabel(price)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {tab === 'ameliorations' && (
          <ul className="tripot-items">
            {view.upgrades.length === 0 && <li className="muted">Distribue et embauche : les améliorations arrivent vite.</li>}
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
                  <span className="tripot-price">{u.available ? <small>{chipsLabel(u.cost)}</small> : <span className="tripot-done">✓</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {tab === 'succes' && (
          <>
            <p className="tripot-achievements-head">
              <b>
                {achievementsDone} / {view.achievements.length}
              </b>{' '}
              succès · +{achievementsDone} % de production. Ils restent quand tu t’agrandis.
            </p>
            <ul className="tripot-achievements">
              {view.achievements.map((a) => (
                <li key={a.id} className={a.done ? 'done' : ''} title={`${a.name} : ${a.text}`}>
                  <span aria-hidden>{a.done ? a.icon : '🔒'}</span>
                  <small>{a.done ? a.name : '???'}</small>
                  <span className="tripot-achievement-text">{a.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {notice && (
        <div key={notice.id} className="tripot-notice" role="status">
          {notice.text}
        </div>
      )}

      {confirmGrow && (
        <div className="overlay" onClick={() => setConfirmGrow(false)}>
          <div className="panel modal tripot-grow pop-in" role="dialog" aria-label="S’agrandir" onClick={(e) => e.stopPropagation()}>
            <div className="trophy">🏛️</div>
            <h2>S’agrandir ?</h2>
            <p>
              Tu vends tout (jetons, activités, améliorations) et tu gagnes <b>+{intFormat.format(gain)} de réputation</b>, soit{' '}
              {intFormat.format(view.reputation + gain)} en tout : <b>+{intFormat.format(2 * (view.reputation + gain))} % de production</b> pour
              toujours.
            </p>
            <p className="muted">Tes succès, tes cartes distribuées et tes mains gagnées restent.</p>
            {view.nextVenue && view.reputation + gain >= view.nextVenue.reputation && (
              <p>
                🎉 Tu ouvres <b>{view.nextVenue.name}</b> : {view.nextVenue.perk}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirmGrow(false)}>
                Pas encore
              </button>
              <button type="button" className="primary" onClick={() => void grow()}>
                S’agrandir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
