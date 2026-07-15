import { useState, useRef, useEffect } from 'react';
import Auth from './Auth';
import Lobby from './Lobby';
import ChatRoom from './ChatRoom';
import Voting from './Voting';
import Reveal from './Reveal';

type View = 'auth' | 'lobby' | 'chat' | 'voting' | 'reveal';
type GameState = 'lobby' | 'chatting' | 'voting' | 'reveal';

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

function App() {
  const [view, setView] = useState<View>('auth');
  const [gameState, setGameState] = useState<GameState>('lobby');
  const [token, setToken] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [trueBotId, setTrueBotId] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const handleTokenReceived = (newToken: string) => {
    setToken(newToken);
    setView('lobby');
  };

  const handleJoinRoom = (newRoomId: string) => {
    setRoomId(newRoomId);
    setView('chat');
  };

  // Open the WebSocket once we have a token + room. The socket persists across
  // the chat -> voting -> reveal phases (deps intentionally exclude `view`).
  useEffect(() => {
    if (!token || !roomId || wsRef.current) return;

    const ws = new WebSocket(`ws://localhost:3000/?token=${token}`);
    wsRef.current = ws;

    const sendJoin = () => ws.send(JSON.stringify({ type: 'join', roomId }));
    ws.onopen = sendJoin;
    // Socket may already be open (e.g. synchronously in tests, where the mocked
    // WebSocket has no static OPEN constant, so we also check the raw value 1).
    if (ws.readyState === WebSocket.OPEN || (ws.readyState as number) === 1) sendJoin();

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'chat') {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id ?? `${Date.now()}-${prev.length}`,
            senderId: msg.senderId,
            text: msg.text,
            isSelf: false,
          },
        ]);
      } else if (msg.type === 'users') {
        // Optional roster update the server may push before voting.
        setUsers(msg.users ?? []);
      } else if (msg.type === 'state') {
        setGameState(msg.state);
        if (msg.state === 'voting') setView('voting');
        else if (msg.state === 'chat' || msg.state === 'chatting') setView('chat');
      } else if (msg.type === 'reveal') {
        setTrueBotId(msg.trueBotId);
        setTally(msg.tally ?? {});
        setView('reveal');
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token, roomId]);

  const handleSendMessage = (text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'chat', roomId, text }));
  };

  const handleStart = () => {
    wsRef.current?.send(JSON.stringify({ type: 'start', roomId }));
  };

  const handleVote = (targetId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'vote', roomId, targetId }));
  };

  const handlePlayAgain = () => {
    setMessages([]);
    setTrueBotId(null);
    setTally({});
    // Back to the pre-game lobby phase in the same room; Start begins a fresh game.
    setGameState('lobby');
    setView('chat');
  };

  return (
    <div className="app-container">
      {view === 'auth' && <Auth onTokenReceived={handleTokenReceived} />}
      {view === 'lobby' && <Lobby onJoinRoom={handleJoinRoom} />}
      {view === 'chat' && (
        <ChatRoom
          users={users}
          messages={messages}
          onSendMessage={handleSendMessage}
          gameState={gameState}
          onStart={handleStart}
        />
      )}
      {view === 'voting' && <Voting users={users} onCastVote={handleVote} />}
      {view === 'reveal' && trueBotId !== null && (
        <Reveal
          users={users}
          trueBotId={trueBotId}
          tally={tally}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}

export default App;
