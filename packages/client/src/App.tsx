import { Home } from './Home';
import { Lobby } from './Lobby';
import { Table } from './Table';
import { errorLabel } from './labels';
import { useGameConnection } from './socket';

export function App() {
  const { connected, session, room, game, remember } = useGameConnection();

  let screen;
  if (!session || !room) screen = <Home onEnter={remember} />;
  else if (session.spectator) screen = game ? <Table game={game} room={room} onLeave={() => remember(null)} /> : null;
  else if (!room.started || !game) screen = <Lobby room={room} session={session} onLeave={() => remember(null)} />;
  else screen = <Table game={game} room={room} onLeave={() => remember(null)} />;

  return (
    <div className="app">
      {!connected && <div className="banner">{errorLabel('disconnected')}</div>}
      {screen}
    </div>
  );
}
