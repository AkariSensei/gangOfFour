import { type GameView, type RoomView, isPresidentView } from '../../server/src/protocol';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { PresidentTable } from './PresidentTable';
import { Table } from './Table';
import { errorLabel } from './labels';
import { useAccount, useGameConnection } from './socket';

export function App() {
  const { connected, session, room, game, messages, kicked, remember } = useGameConnection();
  const account = useAccount();
  const admin = !!account.account?.admin;

  /** La table du jeu du salon. */
  const table = (game: GameView, room: RoomView) => {
    const props = { room, messages, admin, felt: account.account?.felt, onLeave: () => remember(null) };
    return isPresidentView(game) ? <PresidentTable game={game} {...props} /> : <Table game={game} {...props} />;
  };

  let screen;
  if (!session || !room) screen = <Home onEnter={remember} account={account} notice={kicked ? errorLabel('kicked') : ''} />;
  else if (session.spectator) screen = game ? table(game, room) : null;
  else if (!room.started || !game) screen = (
      <Lobby room={room} session={session} messages={messages} admin={admin} felt={account.account?.felt} onLeave={() => remember(null)} />
    );
  else screen = table(game, room);

  return (
    <div className="app">
      {!connected && <div className="banner">{errorLabel('disconnected')}</div>}
      {screen}
    </div>
  );
}
