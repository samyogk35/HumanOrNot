import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotManager } from '../src/game/bot-manager'; // Claude needs to implement

describe('Game Layer 9c: Hidden Bot Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should inject exactly one bot into the game room', () => {
    const botManager = new BotManager();
    const roomId = 'room-bot-test';

    // Add humans
    botManager.addHuman(roomId, { id: 1, username: 'Alice' });
    botManager.addHuman(roomId, { id: 2, username: 'Bob' });
    
    // Inject the bot
    botManager.injectBot(roomId, { id: 3, username: 'Charlie' });

    // Try to inject a second bot (should throw or be rejected)
    expect(() => {
      botManager.injectBot(roomId, { id: 4, username: 'Dave' });
    }).toThrow(/only one bot allowed/i);

    const allPlayers = botManager.getInternalPlayers(roomId);
    expect(allPlayers.length).toBe(3);
    
    const bots = allPlayers.filter(p => p.isBot);
    expect(bots.length).toBe(1);
    expect(bots[0].username).toBe('Charlie');
  });

  it('should hide the bot identity in player-facing payloads', () => {
    const botManager = new BotManager();
    const roomId = 'room-payload-test';

    botManager.addHuman(roomId, { id: 1, username: 'Alice' });
    botManager.injectBot(roomId, { id: 2, username: 'BotPlayer' });

    const publicPlayers = botManager.getPublicPlayers(roomId);
    
    expect(publicPlayers.length).toBe(2);
    
    // Ensure absolutely no 'isBot' field leaks to the client
    publicPlayers.forEach(player => {
      expect(player).not.toHaveProperty('isBot');
      expect(player).toHaveProperty('id');
      expect(player).toHaveProperty('username');
    });
  });

  it('should trigger the bot to chat on a cadence', async () => {
    const botManager = new BotManager();
    const roomId = 'room-cadence-test';
    
    let botPublishedMessage = false;

    botManager.injectBot(roomId, { id: 1, username: 'AI-Bot' });
    
    // Mock the publishing function the bot will use
    const mockPublish = vi.fn().mockImplementation(() => {
      botPublishedMessage = true;
    });

    botManager.startBotCadence(roomId, mockPublish, 5000); // Trigger every 5 seconds

    expect(botPublishedMessage).toBe(false);

    // Fast-forward 4 seconds -> should not have fired yet
    await vi.advanceTimersByTimeAsync(4000);
    expect(botPublishedMessage).toBe(false);

    // Fast-forward 1 more second -> should fire
    await vi.advanceTimersByTimeAsync(1000);
    
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const publishedPayload = mockPublish.mock.calls[0][0];
    
    // Ensure the message looks like a normal chat payload from the bot
    expect(publishedPayload.senderId).toBe(1);
    expect(publishedPayload.roomId).toBe(roomId);
    
    botManager.stopBotCadence(roomId);
  });
});
