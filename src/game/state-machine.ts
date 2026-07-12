import Redis from 'ioredis';

export type GameState = 'lobby' | 'chatting' | 'voting' | 'reveal';

// Strict linear progression; each state may only advance to the next.
const NEXT_STATE: Record<GameState, GameState | null> = {
  lobby: 'chatting',
  chatting: 'voting',
  voting: 'reveal',
  reveal: null,
};

export class GameStateManager {
  private redis: Redis;

  constructor(redisUrl: string) {
    // family: 4 forces IPv4 so 'localhost' doesn't first try ::1.
    this.redis = new Redis(redisUrl, { family: 4 });
    this.redis.on('error', () => {});
  }

  private stateKey(roomId: string): string {
    return `game:${roomId}:state`;
  }

  async initGame(roomId: string): Promise<void> {
    await this.redis.set(this.stateKey(roomId), 'lobby');
  }

  async getState(roomId: string): Promise<GameState | null> {
    return (await this.redis.get(this.stateKey(roomId))) as GameState | null;
  }

  async transition(roomId: string, target: GameState): Promise<void> {
    const current = await this.getState(roomId);
    if (current === null) {
      throw new Error(`invalid transition: room ${roomId} has no game state`);
    }
    if (NEXT_STATE[current] !== target) {
      throw new Error(
        `invalid transition: cannot go from ${current} to ${target}`
      );
    }
    await this.redis.set(this.stateKey(roomId), target);
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}
