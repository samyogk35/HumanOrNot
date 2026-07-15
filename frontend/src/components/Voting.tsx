import { useState } from 'react';

interface User {
  id: string;
  username: string;
}

interface VotingProps {
  users: User[];
  onCastVote: (targetId: string) => void;
}

function Voting({ users, onCastVote }: VotingProps) {
  const [votedFor, setVotedFor] = useState<string | null>(null);

  const handleVote = (targetId: string) => {
    // One vote per player (mirrors backend VotingManager.castVote).
    if (votedFor !== null) return;
    setVotedFor(targetId);
    onCastVote(targetId);
  };

  return (
    <div className="voting-container">
      <h2 className="voting-title">Who is the bot?</h2>

      <div className="vote-list">
        {users.map((user) => (
          <button
            key={user.id}
            className={`brutal-button vote-button ${
              votedFor === user.id ? 'vote-button-selected' : ''
            }`}
            data-testid="vote-button"
            onClick={() => handleVote(user.id)}
            disabled={votedFor !== null && votedFor !== user.id}
          >
            {user.username}
          </button>
        ))}
      </div>

      {votedFor !== null && (
        <p className="vote-status">Vote locked in. Waiting for reveal...</p>
      )}
    </div>
  );
}

export default Voting;
