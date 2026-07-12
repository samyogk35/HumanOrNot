import { describe, it, expect, beforeEach } from 'vitest';
import { VotingManager } from '../src/game/voting-manager'; // Claude needs to implement

describe('Game Layer 9d: Voting and Scoring', () => {
  let voting: VotingManager;

  beforeEach(() => {
    voting = new VotingManager();
  });

  it('should allow players to cast exactly one vote', () => {
    const roomId = 'room-vote-1';
    
    voting.castVote(roomId, { voterId: 1, targetId: 3 });
    
    // A player trying to vote again should throw an error
    expect(() => {
      voting.castVote(roomId, { voterId: 1, targetId: 2 });
    }).toThrow(/already voted/i);

    const tally = voting.tallyVotes(roomId);
    expect(tally[3]).toBe(1); // Player 3 got 1 vote
    expect(tally[2]).toBeUndefined(); // Player 2 got 0 votes
  });

  it('should correctly tally votes for multiple players', () => {
    const roomId = 'room-vote-2';
    
    voting.castVote(roomId, { voterId: 1, targetId: 4 });
    voting.castVote(roomId, { voterId: 2, targetId: 4 });
    voting.castVote(roomId, { voterId: 3, targetId: 1 });
    
    const tally = voting.tallyVotes(roomId);
    expect(tally[4]).toBe(2);
    expect(tally[1]).toBe(1);
  });

  it('should calculate scores awarding points only to those who guessed the bot', () => {
    const roomId = 'room-score-1';
    const botId = 99; // The bot's secret ID

    // Alice(1) guesses the bot correctly
    voting.castVote(roomId, { voterId: 1, targetId: 99 });
    
    // Bob(2) guesses Alice
    voting.castVote(roomId, { voterId: 2, targetId: 1 });
    
    // Charlie(3) guesses the bot correctly
    voting.castVote(roomId, { voterId: 3, targetId: 99 });

    const scores = voting.calculateScores(roomId, botId);
    
    expect(scores[1]).toBe(1); // Alice gets 1 point
    expect(scores[3]).toBe(1); // Charlie gets 1 point
    expect(scores[2]).toBeUndefined(); // Bob gets nothing
  });

  it('should generate a reveal payload exposing the true bot and vote distribution', () => {
    const roomId = 'room-reveal-1';
    const botId = 42;

    voting.castVote(roomId, { voterId: 1, targetId: 42 });
    voting.castVote(roomId, { voterId: 2, targetId: 42 });

    const reveal = voting.getRevealPayload(roomId, botId);
    
    expect(reveal.trueBotId).toBe(42);
    expect(reveal.tally[42]).toBe(2);
  });
});
