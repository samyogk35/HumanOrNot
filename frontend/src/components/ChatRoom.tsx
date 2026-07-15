import { useState } from 'react';

interface User {
  id: string;
  username: string;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  isSelf: boolean;
}

interface ChatRoomProps {
  users: User[];
  messages: Message[];
  onSendMessage: (text: string) => void;
  // Pre-game phase: when 'lobby', show the Start button. Optional so the
  // component still renders standalone (and in unit tests) without game wiring.
  gameState?: 'lobby' | 'chatting' | 'voting' | 'reveal';
  onStart?: () => void;
}

function ChatRoom({ users, messages, onSendMessage, gameState, onStart }: ChatRoomProps) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="chatroom-container">
      {gameState === 'lobby' && (
        <button
          className="brutal-button start-button"
          data-testid="start-button"
          onClick={() => onStart?.()}
        >
          Start Game
        </button>
      )}

      <div className="user-list">
        {users.map((user) => (
          <div key={user.id} className="user-pill" data-testid="user-pill">
            <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
            <span className="user-name">{user.username}</span>
          </div>
        ))}
      </div>

      <div className="message-list">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.isSelf ? 'chat-message-self' : 'chat-message-other'}`}
            data-testid="chat-message"
          >
            {message.text}
          </div>
        ))}
      </div>

      <div className="message-input-row">
        <input
          className="brutal-input"
          type="text"
          placeholder="Write message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
        />
        <button className="brutal-button" onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatRoom;
