import Redis from 'ioredis';

export interface ChatMessage {
  type: string;
  roomId: string;
  sender?: string;
  text: string;
}

/** Serialize a chat payload for publishing over a Redis channel. */
export function serializeMessage(payload: object): string {
  return JSON.stringify(payload);
}

/** Parse a raw string received from a Redis channel. Throws on invalid JSON. */
export function parseMessage(raw: string): any {
  return JSON.parse(raw);
}

/** Create an ioredis client connected via process.env.REDIS_URL. */
export function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  // family: 4 forces IPv4 so 'localhost' doesn't first try ::1 (Redis binds IPv4).
  const client = new Redis(url, { family: 4 });
  // Avoid crashing on transient reconnect noise (e.g. container teardown).
  client.on('error', () => {});
  return client;
}

/** Channel name for a given room. */
export function channelForRoom(roomId: string): string {
  return `room:${roomId}`;
}
