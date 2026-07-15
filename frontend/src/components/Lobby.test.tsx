import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Lobby from './Lobby'; // Claude to implement

describe('Frontend Phase 2: Lobby Component', () => {
  it('should render the room input and join button with brutalist styling', () => {
    render(<Lobby onJoinRoom={() => {}} />);
    
    const roomInput = screen.getByPlaceholderText(/room id/i);
    expect(roomInput).toBeInTheDocument();
    expect(roomInput).toHaveClass('brutal-input');
    
    const joinBtn = screen.getByRole('button', { name: /join room/i });
    expect(joinBtn).toBeInTheDocument();
    expect(joinBtn).toHaveClass('brutal-button');
  });

  it('should call onJoinRoom with the entered room code when clicked', () => {
    const onJoinRoom = vi.fn();
    render(<Lobby onJoinRoom={onJoinRoom} />);
    
    const roomInput = screen.getByPlaceholderText(/room id/i);
    fireEvent.change(roomInput, { target: { value: 'ROOM_099' } });
    
    const joinBtn = screen.getByRole('button', { name: /join room/i });
    fireEvent.click(joinBtn);
    
    expect(onJoinRoom).toHaveBeenCalledWith('ROOM_099');
  });
});
