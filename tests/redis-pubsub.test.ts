import { describe, it, expect } from 'vitest';
import { serializeMessage, parseMessage } from '../src/redis-glue'; // Claude to implement

describe('Redis Pub/Sub Unit Tests', () => {
  it('should serialize a chat message correctly for Redis publishing', () => {
    const payload = {
      type: 'chat',
      roomId: 'room-1',
      sender: 'Alice',
      text: 'hello world'
    };
    
    const serialized = serializeMessage(payload);
    expect(typeof serialized).toBe('string');
    
    const parsedBack = JSON.parse(serialized);
    expect(parsedBack).toEqual(payload);
  });

  it('should parse an incoming Redis message back into a chat object', () => {
    const incomingStr = JSON.stringify({
      type: 'chat',
      roomId: 'room-2',
      sender: 'Bob',
      text: 'redis is cool'
    });
    
    const parsed = parseMessage(incomingStr);
    expect(parsed.type).toBe('chat');
    expect(parsed.roomId).toBe('room-2');
    expect(parsed.sender).toBe('Bob');
  });

  it('should throw or return null on invalid JSON from Redis', () => {
    expect(() => parseMessage('this is not json')).toThrow();
  });
});
