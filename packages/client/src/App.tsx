import { Home } from './Home';
import { Lobby } from './Lobby';
import { Table } from './Table';
import { errorLabel } from './labels';
import { ThemeToggle } from './theme';
import { useAccount, useGameConnection } from './socket';

export function App() {
  const { connected, session, room, game, messages, remember } = useGameConnection();
  const account = useAccount();

  let screen;
  if (!session || !room) screen = <Home onEnter={remember} account={account} />;
  else if (session.spectator)
    screen = game ? <Table game={game} room={room} messages={messages} onLeave={() => remember(null)} /> : null;
  else if (!room.started || !game) screen = <Lobby room={room} session={session} messages={messages} onLeave={() => remember(null)} />;
  else screen = <Table game={game} room={room} messages={messages} onLeave={() => remember(null)} />;

  return (
    <div className="app">
      {!connected && <div className="banner">{errorLabel('disconnected')}</div>}
      {screen}
      {screen?.type !== Table && <ThemeToggle className="icon theme-toggle" />}
    </div>
  );
}
