
interface User {
  id: string;
  username: string;
}

interface RevealProps {
  users: User[];
  trueBotId: string;
  // targetId -> number of votes (mirrors backend RevealPayload.tally).
  tally: Record<string, number>;
  onPlayAgain: () => void;
}

function Reveal({ users, trueBotId, tally, onPlayAgain }: RevealProps) {
  const bot = users.find((u) => u.id === trueBotId);

  return (
    <div className="reveal-container">
      <div className="reveal-banner" data-testid="reveal-banner">
        The bot was{' '}
        <span className="reveal-bot-name">{bot ? bot.username : 'Unknown'}</span>
      </div>

      <div className="reveal-list">
        {users.map((user) => {
          const isBot = user.id === trueBotId;
          const votes = tally[user.id] ?? 0;

          return (
            <div
              key={user.id}
              className={`reveal-row ${isBot ? 'reveal-row-bot' : ''}`}
              data-testid={`reveal-row-${user.id}`}
            >
              <span className="reveal-row-name">{user.username}</span>
              {isBot && <span className="reveal-row-tag">BOT</span>}
              <span className="reveal-row-votes">{votes}</span>
            </div>
          );
        })}
      </div>

      <button className="brutal-button" onClick={onPlayAgain}>
        Play Again
      </button>
    </div>
  );
}

export default Reveal;
