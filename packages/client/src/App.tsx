import { type GameView, type RoomView, isBattleshipView, isSlotsView } from '../../server/src/protocol';
import { BattleshipTable } from './BattleshipTable';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { SlotsTable } from './SlotsTable';
import { Table } from './Table';
import { MaintenanceBanner, MaintenanceScreen, useMaintenance } from './Maintenance';
import { errorLabel } from './labels';
import { useAccount, useGameConnection } from './socket';

export function App() {
  const { connected, session, room, game, messages, kicked, remember } = useGameConnection();
  const account = useAccount();
  const admin = !!account.account?.admin;
  const maintenance = useMaintenance();

  /** La table du jeu du salon. */
  const table = (game: GameView, room: RoomView) => {
    const props = { room, messages, admin, felt: account.account?.felt, onLeave: () => remember(null) };
    if (isSlotsView(game)) return <SlotsTable game={game} {...props} />;
    if (isBattleshipView(game)) return <BattleshipTable game={game} {...props} />;
    return <Table game={game} {...props} />;
  };

  let screen;
  // Maintenance : tout le monde voit le message, sauf l'admin qui teste le site (rien tant qu'on ne sait pas encore).
  if (maintenance === null) screen = null;
  else if (maintenance && !admin) screen = <MaintenanceScreen account={account} />;
  else if (!session || !room) screen = <Home onEnter={remember} account={account} notice={kicked ? errorLabel('kicked') : ''} />;
  else if (session.spectator) screen = game ? table(game, room) : null;
  else if (!room.started || !game) screen = (
      <Lobby room={room} session={session} messages={messages} admin={admin} felt={account.account?.felt} onLeave={() => remember(null)} />
    );
  else screen = table(game, room);

  return (
    <div className="app">
      {!connected && <div className="banner">{errorLabel('disconnected')}</div>}
      {maintenance && admin && <MaintenanceBanner />}
      {screen}
    </div>
  );
}
