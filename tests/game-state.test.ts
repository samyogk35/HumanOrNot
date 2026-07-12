import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { GameStateManager } from '../src/game/state-machine'; // Claude needs to implement this

describe('Game State Machine (Redis Backed)', () => {
  let redisContainer: StartedTestContainer;
  let redis: Redis;
  let stateManager: GameStateManager;

  beforeAll(async () => {
    // Spin up an ephemeral Redis container for true round-trip testing
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    
    redis = new Redis(redisUrl);
    stateManager = new GameStateManager(redisUrl);
  }, 30000);

  afterAll(async () => {
    await stateManager.close();
    await redis.quit();
    await redisContainer.stop();
  });

  it('should initialize a room in the lobby state', async () => {
    const roomId = 'room-init';
    await stateManager.initGame(roomId);
    
    const state = await stateManager.getState(roomId);
    expect(state).toBe('lobby');

    // Verify it actually round-tripped to Redis
    const rawState = await redis.get(`game:${roomId}:state`);
    expect(rawState).toBe('lobby');
  });

  it('should allow valid linear transitions: lobby -> chatting -> voting -> reveal', async () => {
    const roomId = 'room-linear';
    
    await stateManager.initGame(roomId);
    expect(await stateManager.getState(roomId)).toBe('lobby');

    await stateManager.transition(roomId, 'chatting');
    expect(await stateManager.getState(roomId)).toBe('chatting');

    await stateManager.transition(roomId, 'voting');
    expect(await stateManager.getState(roomId)).toBe('voting');

    await stateManager.transition(roomId, 'reveal');
    expect(await stateManager.getState(roomId)).toBe('reveal');
  });

  it('should reject invalid transitions (e.g., lobby -> voting)', async () => {
    const roomId = 'room-invalid';
    await stateManager.initGame(roomId);
    
    // Attempting to skip the chatting phase should throw an error
    await expect(stateManager.transition(roomId, 'voting')).rejects.toThrow(/invalid transition/i);
    
    // State should remain unchanged in Redis
    expect(await stateManager.getState(roomId)).toBe('lobby');
  });

  it('should reject transitions backwards (e.g., reveal -> chatting)', async () => {
    const roomId = 'room-backwards';
    await stateManager.initGame(roomId);
    await stateManager.transition(roomId, 'chatting');
    await stateManager.transition(roomId, 'voting');
    await stateManager.transition(roomId, 'reveal');
    
    // Attempting to go back should throw
    await expect(stateManager.transition(roomId, 'chatting')).rejects.toThrow(/invalid transition/i);
    expect(await stateManager.getState(roomId)).toBe('reveal');
  });
});
