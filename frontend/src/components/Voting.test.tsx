import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Voting from './Voting'; // Claude to implement

describe('Frontend Phase 5: Voting Component', () => {
  const mockUsers = [
    { id: '1', username: 'Player_1' },
    { id: '2', username: 'MysteryUser' },
    { id: '3', username: 'Player_3' }
  ];

  it('should render a brutalist vote button for each candidate (test-id vote-button)', () => {
    render(<Voting users={mockUsers} onCastVote={() => {}} />);

    const voteButtons = screen.getAllByTestId('vote-button');
    expect(voteButtons).toHaveLength(3);
    voteButtons.forEach((btn) => expect(btn).toHaveClass('brutal-button'));

    expect(screen.getByText('Player_1')).toBeInTheDocument();
    expect(screen.getByText('MysteryUser')).toBeInTheDocument();
  });

  it('should call onCastVote with the target user id when a candidate is clicked', () => {
    const onCastVote = vi.fn();
    render(<Voting users={mockUsers} onCastVote={onCastVote} />);

    fireEvent.click(screen.getAllByTestId('vote-button')[1]);

    expect(onCastVote).toHaveBeenCalledWith('2');
  });

  it('should prevent a player from voting twice', () => {
    const onCastVote = vi.fn();
    render(<Voting users={mockUsers} onCastVote={onCastVote} />);

    const buttons = screen.getAllByTestId('vote-button');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    expect(onCastVote).toHaveBeenCalledTimes(1);
    expect(onCastVote).toHaveBeenCalledWith('1');
  });
});
