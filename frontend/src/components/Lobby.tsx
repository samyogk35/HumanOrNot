import { useState } from 'react';

interface LobbyProps {
  onJoinRoom: (roomId: string) => void;
}

function Lobby({ onJoinRoom }: LobbyProps) {
  const [roomId, setRoomId] = useState('');

  return (
    <div className="lobby-container">
      <input
        className="brutal-input"
        type="text"
        placeholder="Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />
      <button className="brutal-button" onClick={() => onJoinRoom(roomId)}>
        Join Room
      </button>
    </div>
  );
}

export default Lobby;
