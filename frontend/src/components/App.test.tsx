import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';

// Mock child components
vi.mock('./Auth', () => ({
  default: ({ onTokenReceived }: any) => (
    <div data-testid="auth-mock">
      <button onClick={() => onTokenReceived('fake-jwt-token')}>Simulate Auth Success</button>
    </div>
  )
}));

vi.mock('./Lobby', () => ({
  default: ({ onJoinRoom }: any) => (
    <div data-testid="lobby-mock">
      <button onClick={() => onJoinRoom('ROOM_99')}>Simulate Join Room</button>
    </div>
  )
}));

vi.mock('./ChatRoom', () => ({
  default: ({ onSendMessage, messages, onStart, gameState }: any) => (
    <div data-testid="chat-mock">
      <div data-testid="messages-length">{messages?.length || 0}</div>
      <div data-testid="chat-game-state">{gameState}</div>
      <button onClick={() => onSendMessage('hello from chat')}>Simulate Send Message</button>
      <button onClick={() => onStart && onStart()}>Simulate Start</button>
    </div>
  )
}));

vi.mock('./Voting', () => ({
  default: ({ onCastVote, users }: any) => (
    <div data-testid="voting-mock">
      <div data-testid="voting-users-length">{users?.length || 0}</div>
      <button onClick={() => onCastVote('2')}>Simulate Vote</button>
    </div>
  )
}));

vi.mock('./Reveal', () => ({
  default: ({ trueBotId, tally, onPlayAgain }: any) => (
    <div data-testid="reveal-mock">
      <div data-testid="reveal-bot">{trueBotId}</div>
      <div data-testid="reveal-tally">{JSON.stringify(tally)}</div>
      <button onClick={onPlayAgain}>Simulate Play Again</button>
    </div>
  )
}));

describe('Frontend Phase 4: App Component (Integration & State)', () => {
  let mockWsSend: ReturnType<typeof vi.fn>;
  let mockWsInstance: any;

  beforeEach(() => {
    mockWsSend = vi.fn();
    // Mock the global WebSocket object
    global.WebSocket = vi.fn().mockImplementation((url) => {
      mockWsInstance = {
        url,
        readyState: 1,
        send: mockWsSend,
        close: vi.fn(),
        onmessage: null,
      };
      return mockWsInstance;
    }) as any;
  });

  it('should transition to Chat Room and open WebSocket after joining room', () => {
    render(<App />);
    
    // Progress through flow
    fireEvent.click(screen.getByText('Simulate Auth Success'));
    fireEvent.click(screen.getByText('Simulate Join Room'));
    
    expect(screen.getByTestId('chat-mock')).toBeInTheDocument();
    
    // Verify WebSocket was opened with the token
    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('ws://localhost:3000/?token=fake-jwt-token')
    );
  });

  it('should send join message immediately upon socket connection', () => {
    render(<App />);
    
    fireEvent.click(screen.getByText('Simulate Auth Success'));
    fireEvent.click(screen.getByText('Simulate Join Room'));
    
    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'join', roomId: 'ROOM_99' })
    );
  });

  it('should pass incoming WebSocket messages down to ChatRoom', () => {
    render(<App />);
    
    fireEvent.click(screen.getByText('Simulate Auth Success'));
    fireEvent.click(screen.getByText('Simulate Join Room'));
    
    // Initially 0 messages
    expect(screen.getByTestId('messages-length').textContent).toBe('0');
    
    // Simulate backend sending a chat message
    act(() => {
      mockWsInstance.onmessage({
        data: JSON.stringify({ type: 'chat', text: 'Backend says hi', senderId: '3' })
      });
    });
    
    // Messages array should now have 1 item
    expect(screen.getByTestId('messages-length').textContent).toBe('1');
  });

  it('should forward onSendMessage to the WebSocket', () => {
    render(<App />);
    
    fireEvent.click(screen.getByText('Simulate Auth Success'));
    fireEvent.click(screen.getByText('Simulate Join Room'));
    
    fireEvent.click(screen.getByText('Simulate Send Message'));
    
    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat', roomId: 'ROOM_99', text: 'hello from chat' })
    );
  });

  const enterChat = () => {
    render(<App />);
    fireEvent.click(screen.getByText('Simulate Auth Success'));
    fireEvent.click(screen.getByText('Simulate Join Room'));
  };

  it('should transition to the Voting view when the server sends state voting', () => {
    enterChat();

    act(() => {
      mockWsInstance.onmessage({
        data: JSON.stringify({ type: 'state', state: 'voting' })
      });
    });

    expect(screen.getByTestId('voting-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mock')).not.toBeInTheDocument();
  });

  it('should forward a cast vote to the WebSocket', () => {
    enterChat();

    act(() => {
      mockWsInstance.onmessage({
        data: JSON.stringify({ type: 'state', state: 'voting' })
      });
    });

    fireEvent.click(screen.getByText('Simulate Vote'));

    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'vote', roomId: 'ROOM_99', targetId: '2' })
    );
  });

  it('should transition to Reveal and pass trueBotId + tally when the server sends reveal', () => {
    enterChat();

    act(() => {
      mockWsInstance.onmessage({
        data: JSON.stringify({ type: 'reveal', trueBotId: '2', tally: { '2': 2, '1': 1 } })
      });
    });

    expect(screen.getByTestId('reveal-mock')).toBeInTheDocument();
    expect(screen.getByTestId('reveal-bot').textContent).toBe('2');
    expect(screen.getByTestId('reveal-tally').textContent).toBe(
      JSON.stringify({ '2': 2, '1': 1 })
    );
  });

  it('should forward a start message to the WebSocket', () => {
    enterChat();

    fireEvent.click(screen.getByText('Simulate Start'));

    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'start', roomId: 'ROOM_99' })
    );
  });

  it('should return to the lobby phase (chat view, gameState lobby) on play again', () => {
    enterChat();

    // Drive a full game to reveal.
    act(() => {
      mockWsInstance.onmessage({
        data: JSON.stringify({ type: 'reveal', trueBotId: '2', tally: { '2': 1 } })
      });
    });
    expect(screen.getByTestId('reveal-mock')).toBeInTheDocument();

    // Play again -> back in the room, pre-game lobby phase.
    fireEvent.click(screen.getByText('Simulate Play Again'));

    expect(screen.getByTestId('chat-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('reveal-mock')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-game-state').textContent).toBe('lobby');
  });
});
