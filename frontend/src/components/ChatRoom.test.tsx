import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ChatRoom from './ChatRoom'; // Claude to implement

describe('Frontend Phase 3: ChatRoom Component', () => {
  const mockUsers = [
    { id: '1', username: 'Player_1' },
    { id: '2', username: 'MysteryUser' }
  ];
  
  const mockMessages = [
    { id: '100', senderId: '2', text: 'I am a human', isSelf: false },
    { id: '101', senderId: '1', text: 'That sounds suspicious', isSelf: true }
  ];

  it('should render users with circular avatars (using test-id user-pill)', () => {
    render(<ChatRoom users={mockUsers} messages={mockMessages} onSendMessage={() => {}} />);
    
    expect(screen.getByText('Player_1')).toBeInTheDocument();
    expect(screen.getByText('MysteryUser')).toBeInTheDocument();
    
    // Check if the user-pill elements are rendered
    const userPills = screen.getAllByTestId('user-pill');
    expect(userPills).toHaveLength(2);
  });

  it('should render messages with manga styling (using test-id chat-message)', () => {
    render(<ChatRoom users={mockUsers} messages={mockMessages} onSendMessage={() => {}} />);
    
    const messageElements = screen.getAllByTestId('chat-message');
    expect(messageElements).toHaveLength(2);
    
    expect(screen.getByText('I am a human')).toBeInTheDocument();
    expect(screen.getByText('That sounds suspicious')).toBeInTheDocument();
  });

  it('should call onSendMessage with the input text when submitted', () => {
    const onSendMessage = vi.fn();
    render(<ChatRoom users={mockUsers} messages={mockMessages} onSendMessage={onSendMessage} />);
    
    // Must use the brutalist placeholder and classes
    const input = screen.getByPlaceholderText(/write message/i);
    expect(input).toHaveClass('brutal-input');
    
    fireEvent.change(input, { target: { value: 'Hello world' } });
    
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).toHaveClass('brutal-button');
    
    fireEvent.click(sendBtn);
    
    expect(onSendMessage).toHaveBeenCalledWith('Hello world');
  });
});
