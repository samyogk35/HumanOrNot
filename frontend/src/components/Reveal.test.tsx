import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Reveal from './Reveal'; // Claude to implement

describe('Frontend Phase 6: Reveal Component', () => {
  const mockUsers = [
    { id: '1', username: 'Player_1' },
    { id: '2', username: 'MysteryUser' },
    { id: '3', username: 'Player_3' }
  ];
  // MysteryUser (2) got 2 votes, Player_1 (1) got 1, Player_3 (3) got none.
  const tally = { '2': 2, '1': 1 };

  it('should reveal the true bot username in the banner', () => {
    render(
      <Reveal users={mockUsers} trueBotId="2" tally={tally} onPlayAgain={() => {}} />
    );

    const banner = screen.getByTestId('reveal-banner');
    expect(banner).toHaveTextContent('MysteryUser');
  });

  it('should render a result row per user with their vote count', () => {
    render(
      <Reveal users={mockUsers} trueBotId="2" tally={tally} onPlayAgain={() => {}} />
    );

    const rows = screen.getAllByTestId(/^reveal-row-/);
    expect(rows).toHaveLength(3);

    // Player_3 received no votes -> 0.
    expect(screen.getByTestId('reveal-row-3')).toHaveTextContent('0');
    expect(screen.getByTestId('reveal-row-2')).toHaveTextContent('2');
  });

  it('should mark the bot row and render a brutalist play-again button', () => {
    const onPlayAgain = vi.fn();
    render(
      <Reveal users={mockUsers} trueBotId="2" tally={tally} onPlayAgain={onPlayAgain} />
    );

    expect(screen.getByTestId('reveal-row-2')).toHaveClass('reveal-row-bot');

    const btn = screen.getByRole('button', { name: /play again/i });
    expect(btn).toHaveClass('brutal-button');

    fireEvent.click(btn);
    expect(onPlayAgain).toHaveBeenCalled();
  });
});
